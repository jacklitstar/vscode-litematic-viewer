import path from 'node:path';
import * as nbt from 'prismarine-nbt';

const AIR_IDS = new Set(['air', 'minecraft:air']);

const AIR_STATE = Object.freeze({
  id: 'minecraft:air',
  properties: {}
});

const toInt = (value, fallback = 0) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : fallback;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const toPositiveSize = (value, fallback = 0) => Math.abs(toInt(value, fallback));

const isAirId = (id) => AIR_IDS.has(String(id || '').toLowerCase());

const normalizeProperties = (properties = {}) => {
  const normalized = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined && value !== null) {
      normalized[key] = String(value);
    }
  }
  return normalized;
};

const stateKey = (state) => {
  const keys = Object.keys(state.properties).sort();
  if (keys.length === 0) {
    return state.id;
  }

  return `${state.id}[${keys.map((key) => `${key}=${state.properties[key]}`).join(',')}]`;
};

const cloneState = (state) => ({
  id: state.id,
  properties: { ...state.properties }
});

const parsePaletteStateEntry = (entry) => {
  const nameState = parseBlockStateString(String(entry?.Name || 'minecraft:air'));
  return {
    id: nameState.id,
    properties: {
      ...nameState.properties,
      ...normalizeProperties(entry?.Properties || {})
    }
  };
};

const parseBlockStateString = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    return AIR_STATE;
  }

  const splitIndex = value.indexOf('[');
  if (splitIndex === -1 || !value.endsWith(']')) {
    return {
      id: value,
      properties: {}
    };
  }

  const id = value.slice(0, splitIndex);
  const rawProps = value.slice(splitIndex + 1, -1);
  const properties = {};

  for (const chunk of rawProps.split(',')) {
    if (!chunk) continue;
    const [keyPart, valuePart] = chunk.split('=', 2);
    const key = String(keyPart || '').trim();
    const propValue = String(valuePart || '').trim();
    if (key) {
      properties[key] = propValue;
    }
  }

  return {
    id,
    properties
  };
};

const getPackedValue = (longArray, index, bits) => {
  if (!Array.isArray(longArray) || longArray.length === 0) {
    return 0;
  }

  const startOffset = BigInt(index) * BigInt(bits);
  const startArrayIndex = Number(startOffset >> 6n);
  const endArrayIndex = Number(((BigInt(index + 1) * BigInt(bits)) - 1n) >> 6n);
  const startBitOffset = Number(startOffset & 63n);
  const maxEntryValue = (1n << BigInt(bits)) - 1n;
  // NBT long arrays are signed 64-bit values, but block-state packing treats
  // each entry as an unsigned 64-bit word. Sign-extending negative values here
  // corrupts palette indices and makes blocks disappear seemingly at random.
  const firstPart = BigInt.asUintN(64, BigInt(longArray[startArrayIndex] ?? 0n));

  if (startArrayIndex === endArrayIndex) {
    return Number((firstPart >> BigInt(startBitOffset)) & maxEntryValue);
  }

  const secondPart = BigInt.asUintN(64, BigInt(longArray[endArrayIndex] ?? 0n));
  const endBitOffset = BigInt(64 - startBitOffset);
  const combined = (firstPart >> BigInt(startBitOffset)) | (secondPart << endBitOffset);
  return Number(combined & maxEntryValue);
};

const decodeVarIntArray = (source) => {
  const result = [];
  let index = 0;

  while (index < source.length) {
    let value = 0;
    let bitsRead = 0;

    while (true) {
      if (index >= source.length) {
        throw new Error('Unexpected end of schematic block data while decoding varints.');
      }

      const nextByte = Number(source[index]) & 0xff;
      index += 1;
      value |= (nextByte & 0x7f) << bitsRead;

      if ((nextByte & 0x80) === 0) {
        result.push(value >>> 0);
        break;
      }

      bitsRead += 7;
      if (bitsRead > 35) {
        throw new Error('Encountered an invalid schematic varint larger than 5 bytes.');
      }
    }
  }

  return result;
};

const createCollector = () => {
  const palette = [];
  const paletteLookup = new Map();
  const blocks = [];
  const materials = new Map();

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  return {
    addBlock(x, y, z, state) {
      if (!state || isAirId(state.id)) {
        return;
      }

      const key = stateKey(state);
      let paletteIndex = paletteLookup.get(key);
      if (paletteIndex === undefined) {
        paletteIndex = palette.length;
        paletteLookup.set(key, paletteIndex);
        palette.push(cloneState(state));
      }

      blocks.push({ x, y, z, paletteIndex });
      materials.set(state.id, (materials.get(state.id) || 0) + 1);

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    },

    finalize(meta) {
      const hasBlocks = blocks.length > 0;
      const defaultWidth = Math.max(1, toPositiveSize(meta?.declaredSize?.width, 1));
      const defaultHeight = Math.max(1, toPositiveSize(meta?.declaredSize?.height, 1));
      const defaultLength = Math.max(1, toPositiveSize(meta?.declaredSize?.length, 1));

      const size = hasBlocks
        ? {
            width: Math.max(1, maxX - minX + 1),
            height: Math.max(1, maxY - minY + 1),
            length: Math.max(1, maxZ - minZ + 1)
          }
        : {
            width: defaultWidth,
            height: defaultHeight,
            length: defaultLength
          };

      const flatBlocks = [];
      for (const block of blocks) {
        flatBlocks.push(block.x - minX, block.y - minY, block.z - minZ, block.paletteIndex);
      }

      const sortedMaterials = Array.from(materials.entries())
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

      return {
        fileName: meta.fileName,
        format: meta.format,
        size,
        palette,
        blocks: flatBlocks,
        materials: sortedMaterials,
        stats: {
          blockCount: blocks.length,
          declaredSize: {
            width: defaultWidth,
            height: defaultHeight,
            length: defaultLength
          },
          paletteSize: palette.length,
          regionCount: meta.regionCount || 0
        }
      };
    }
  };
};

const parseLitematicPreview = (root, fileName) => {
  const regions = root?.Regions || {};
  const metadataSize = root?.Metadata?.EnclosingSize || {};
  const collector = createCollector();

  for (const region of Object.values(regions)) {
    const regionPalette = Array.isArray(region?.BlockStatePalette)
      ? region.BlockStatePalette.map(parsePaletteStateEntry)
      : [];
    const regionBlockStates = Array.isArray(region?.BlockStates) ? region.BlockStates : [];
    const position = region?.Position || {};
    const size = region?.Size || {};
    const width = toPositiveSize(size.x);
    const height = toPositiveSize(size.y);
    const length = toPositiveSize(size.z);

    if (width === 0 || height === 0 || length === 0 || regionPalette.length === 0) {
      continue;
    }

    const bits = Math.max(2, Math.ceil(Math.log2(Math.max(1, regionPalette.length))));

    for (let y = 0; y < height; y += 1) {
      for (let z = 0; z < length; z += 1) {
        for (let x = 0; x < width; x += 1) {
          const paletteIndex = getPackedValue(regionBlockStates, y * width * length + z * width + x, bits);
          const state = regionPalette[paletteIndex] || AIR_STATE;
          collector.addBlock(
            x + toInt(position.x),
            y + toInt(position.y),
            z + toInt(position.z),
            state
          );
        }
      }
    }
  }

  return collector.finalize({
    fileName,
    format: 'litematic',
    declaredSize: {
      width: metadataSize.x,
      height: metadataSize.y,
      length: metadataSize.z
    },
    regionCount: Object.keys(regions).length
  });
};

const parseSchemPreview = (root, fileName) => {
  const schemaRoot = root?.Schematic || root || {};
  const blockRoot = schemaRoot?.Blocks || schemaRoot;
  const paletteSource = blockRoot?.Palette || schemaRoot?.Palette || {};
  const blockData = Array.isArray(blockRoot?.Data)
    ? blockRoot.Data
    : Array.isArray(schemaRoot?.BlockData)
      ? schemaRoot.BlockData
      : [];

  const paletteById = new Map();
  for (const [blockState, paletteIndex] of Object.entries(paletteSource)) {
    paletteById.set(toInt(paletteIndex), parseBlockStateString(blockState));
  }

  const decoded = decodeVarIntArray(blockData);
  const width = Math.max(1, toPositiveSize(schemaRoot?.Width, 1));
  const height = Math.max(1, toPositiveSize(schemaRoot?.Height, 1));
  const length = Math.max(1, toPositiveSize(schemaRoot?.Length, 1));

  const collector = createCollector();
  const slice = width * length;

  for (let index = 0; index < decoded.length; index += 1) {
    const state = paletteById.get(decoded[index]) || AIR_STATE;
    const y = Math.floor(index / slice);
    const z = Math.floor((index % slice) / width);
    const x = index % width;
    collector.addBlock(x, y, z, state);
  }

  return collector.finalize({
    fileName,
    format: 'schem',
    declaredSize: {
      width,
      height,
      length
    }
  });
};

export const createPreviewData = async (fileName, fileBytes) => {
  const ext = path.extname(fileName).toLowerCase();
  const buffer = Buffer.from(fileBytes);
  const { parsed } = await nbt.parse(buffer, 'big');
  const root = nbt.simplify(parsed);

  if (ext === '.litematic') {
    return parseLitematicPreview(root, path.basename(fileName));
  }

  if (ext === '.schem') {
    return parseSchemPreview(root, path.basename(fileName));
  }

  throw new Error(`Unsupported schematic extension: ${ext}`);
};
