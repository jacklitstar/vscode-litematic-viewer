import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import * as nbt from 'prismarine-nbt';
import { NbtCompound } from 'deepslate/nbt';
import { StringReader } from 'deepslate/util';

const AIR_IDS = new Set(['air', 'minecraft:air', 'minecraft:structure_void']);

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

const hasGzipHeader = (buffer) => buffer?.[0] === 0x1f && buffer?.[1] === 0x8b;

const normalizeProperties = (properties = {}) => {
  const normalized = {};
  for (const [key, value] of Object.entries(properties || {})) {
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
  const nameState = parseBlockStateString(String(entry?.Name || entry?.name || 'minecraft:air'));
  return {
    id: nameState.id,
    properties: {
      ...nameState.properties,
      ...normalizeProperties(entry?.Properties || entry?.properties || entry?.states || {})
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

const readBlockPos = (value) => {
  if (Array.isArray(value)) {
    const [x = 0, y = 0, z = 0] = value;
    return { x: toInt(x), y: toInt(y), z: toInt(z) };
  }

  if (value && typeof value === 'object') {
    return {
      x: toInt(value.x ?? value.X ?? value.minX ?? 0),
      y: toInt(value.y ?? value.Y ?? value.minY ?? 0),
      z: toInt(value.z ?? value.Z ?? value.minZ ?? 0)
    };
  }

  return { x: 0, y: 0, z: 0 };
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

const parseCompressedOrRawNbt = (fileBytes, format = 'big') => {
  const original = Buffer.from(fileBytes);
  const buffer = hasGzipHeader(original) ? gunzipSync(original) : original;
  const parsed = nbt.parseUncompressed(buffer, format, { noArraySizeCheck: true });
  return nbt.simplify(parsed);
};

const parseSnbt = (source) => {
  const reader = new StringReader(String(source || ''));
  return NbtCompound.fromString(reader).toSimplifiedJson();
};

const signedByte = (value) => {
  const normalized = Number(value) & 0xff;
  return normalized > 127 ? normalized - 256 : normalized;
};

const decodeBgRelativePosInt = (value) => ({
  x: signedByte(value >> 16),
  y: signedByte(value >> 8),
  z: signedByte(value)
});

const decodeBgSerializedPos = (value) => {
  const serialized = BigInt(value);
  const signExtend16 = (part) => {
    const normalized = Number(part & 0xffffn);
    return normalized > 0x7fff ? normalized - 0x10000 : normalized;
  };

  return {
    x: signExtend16(serialized >> 24n),
    y: Number((serialized >> 16n) & 0xffn),
    z: signExtend16(serialized)
  };
};

const decodeBgSerializedStateId = (value) => Number((BigInt(value) >> 40n) & 0xffffffn);

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

      const originX = hasBlocks ? minX : 0;
      const originY = hasBlocks ? minY : 0;
      const originZ = hasBlocks ? minZ : 0;
      const flatBlocks = [];
      for (const block of blocks) {
        flatBlocks.push(
          block.x - originX,
          block.y - originY,
          block.z - originZ,
          block.paletteIndex
        );
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
    const totalBlocks = width * height * length;

    for (let index = 0; index < totalBlocks; index += 1) {
      const paletteIndex = getPackedValue(regionBlockStates, index, bits);
      if (paletteIndex === 0 && isAirId(regionPalette[0]?.id)) {
        continue;
      }

      const y = Math.floor(index / (width * length));
      const z = Math.floor((index % (width * length)) / width);
      const x = index % width;
      const state = regionPalette[paletteIndex] || AIR_STATE;
      collector.addBlock(
        x + toInt(position.x),
        y + toInt(position.y),
        z + toInt(position.z),
        state
      );
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

const parseStructureNbtPreview = (root, fileName) => {
  const blocks = Array.isArray(root?.blocks) ? root.blocks : [];
  const palette = Array.isArray(root?.palette) ? root.palette.map(parsePaletteStateEntry) : [];
  const sizeList = Array.isArray(root?.size) ? root.size : [];
  const collector = createCollector();

  for (const block of blocks) {
    const pos = readBlockPos(block?.pos);
    const state = palette[toInt(block?.state, -1)] || AIR_STATE;
    collector.addBlock(pos.x, pos.y, pos.z, state);
  }

  return collector.finalize({
    fileName,
    format: 'nbt',
    declaredSize: {
      width: sizeList[0],
      height: sizeList[1],
      length: sizeList[2]
    }
  });
};

const parseMcstructurePreview = (root, fileName) => {
  const sizeList = Array.isArray(root?.size) ? root.size : [];
  const structure = root?.structure || {};
  const palette = Array.isArray(structure?.palette?.default?.block_palette)
    ? structure.palette.default.block_palette.map(parsePaletteStateEntry)
    : [];
  const blockIndices = Array.isArray(structure?.block_indices) ? structure.block_indices : [];
  const layer0 = Array.isArray(blockIndices[0]) ? blockIndices[0] : [];
  const size = {
    width: Math.max(1, toPositiveSize(sizeList[0], 1)),
    height: Math.max(1, toPositiveSize(sizeList[1], 1)),
    length: Math.max(1, toPositiveSize(sizeList[2], 1))
  };
  const collector = createCollector();

  for (let index = 0; index < layer0.length; index += 1) {
    const paletteIndex = toInt(layer0[index], -1);
    if (paletteIndex < 0) {
      continue;
    }

    const z = index % size.length;
    const y = Math.floor(index / size.length) % size.height;
    const x = Math.floor(index / (size.length * size.height));
    collector.addBlock(x, y, z, palette[paletteIndex] || AIR_STATE);
  }

  return collector.finalize({
    fileName,
    format: 'mcstructure',
    declaredSize: size
  });
};

const parseBgType0Preview = (root, fileName) => {
  const palette = Array.isArray(root?.blockstatemap) ? root.blockstatemap.map(parsePaletteStateEntry) : [];
  const stateList = Array.isArray(root?.statelist) ? root.statelist : [];
  const startPos = readBlockPos(root?.startpos);
  const endPos = readBlockPos(root?.endpos);
  const declaredSize = {
    width: Math.abs(endPos.x - startPos.x) + 1,
    height: Math.abs(endPos.y - startPos.y) + 1,
    length: Math.abs(endPos.z - startPos.z) + 1
  };
  const collector = createCollector();
  let counter = 0;

  for (let z = 0; z < declaredSize.length; z += 1) {
    for (let y = 0; y < declaredSize.height; y += 1) {
      for (let x = 0; x < declaredSize.width; x += 1) {
        const state = palette[toInt(stateList[counter], -1)] || AIR_STATE;
        counter += 1;
        collector.addBlock(x, y, z, state);
      }
    }
  }

  return collector.finalize({
    fileName,
    format: 'json',
    declaredSize
  });
};

const parseBgType1Preview = (root, fileName) => {
  const bounds = root?.header?.bounds || root?.header || {};
  const minPos = {
    x: toInt(bounds.minX, 0),
    y: toInt(bounds.minY, 0),
    z: toInt(bounds.minZ, 0)
  };
  const maxPos = {
    x: toInt(bounds.maxX, minPos.x),
    y: toInt(bounds.maxY, minPos.y),
    z: toInt(bounds.maxZ, minPos.z)
  };
  const declaredSize = {
    width: Math.abs(maxPos.x - minPos.x) + 1,
    height: Math.abs(maxPos.y - minPos.y) + 1,
    length: Math.abs(maxPos.z - minPos.z) + 1
  };
  const palette = Array.isArray(root?.data) ? root.data.map((entry) => parsePaletteStateEntry(entry?.state || {})) : [];
  const positions = Array.isArray(root?.pos) ? root.pos : [];
  const collector = createCollector();

  for (const serialized of positions) {
    const pos = decodeBgSerializedPos(serialized);
    const state = palette[decodeBgSerializedStateId(serialized)] || AIR_STATE;
    collector.addBlock(pos.x, pos.y, pos.z, state);
  }

  return collector.finalize({
    fileName,
    format: 'json',
    declaredSize
  });
};

const parseBgType2Preview = (root, fileName) => {
  const startPos = readBlockPos(root?.startPos);
  const endPos = readBlockPos(root?.endPos);
  const declaredSize = {
    width: Math.abs(endPos.x - startPos.x) + 1,
    height: Math.abs(endPos.y - startPos.y) + 1,
    length: Math.abs(endPos.z - startPos.z) + 1
  };
  const palette = Array.isArray(root?.mapIntState)
    ? root.mapIntState.map((entry) => parsePaletteStateEntry(entry?.mapState || {}))
    : [];
  const stateInts = Array.isArray(root?.stateIntArray) ? root.stateIntArray : [];
  const posInts = Array.isArray(root?.posIntArray) ? root.posIntArray : [];
  const collector = createCollector();

  for (let index = 0; index < stateInts.length; index += 1) {
    const paletteIndex = toInt(stateInts[index], 0) - 1;
    const pos = decodeBgRelativePosInt(toInt(posInts[index], 0));
    collector.addBlock(pos.x, pos.y, pos.z, palette[paletteIndex] || AIR_STATE);
  }

  return collector.finalize({
    fileName,
    format: 'json',
    declaredSize
  });
};

const parseBuildingGadgetsPreview = (fileBytes, fileName) => {
  const jsonSource = Buffer.from(fileBytes).toString('utf8');
  let jsonRoot = null;

  try {
    jsonRoot = JSON.parse(jsonSource);
  } catch {
    jsonRoot = null;
  }

  if (jsonRoot?.statePosArrayList) {
    return parseBgType0Preview(parseSnbt(jsonRoot.statePosArrayList), fileName);
  }

  if (typeof jsonRoot?.body === 'string') {
    const bodyRoot = parseCompressedOrRawNbt(Buffer.from(jsonRoot.body, 'base64'), 'big');
    return parseBgType1Preview(bodyRoot, fileName);
  }

  const snbtRoot = parseSnbt(jsonSource);

  if (typeof snbtRoot?.body === 'string') {
    const bodyRoot = parseCompressedOrRawNbt(Buffer.from(snbtRoot.body, 'base64'), 'big');
    return parseBgType1Preview(bodyRoot, fileName);
  }

  if (Array.isArray(snbtRoot?.mapIntState)) {
    return parseBgType2Preview(snbtRoot, fileName);
  }

  throw new Error('Unsupported Building Gadgets JSON format.');
};

export const createPreviewData = async (fileName, fileBytes, _options = {}) => {
  const ext = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName);

  if (ext === '.litematic') {
    return parseLitematicPreview(parseCompressedOrRawNbt(fileBytes, 'big'), baseName);
  }

  if (ext === '.schem') {
    return parseSchemPreview(parseCompressedOrRawNbt(fileBytes, 'big'), baseName);
  }

  if (ext === '.nbt') {
    return parseStructureNbtPreview(parseCompressedOrRawNbt(fileBytes, 'big'), baseName);
  }

  if (ext === '.mcstructure') {
    return parseMcstructurePreview(parseCompressedOrRawNbt(fileBytes, 'little'), baseName);
  }

  if (ext === '.json') {
    return parseBuildingGadgetsPreview(fileBytes, baseName);
  }

  throw new Error(`Unsupported schematic extension: ${ext}`);
};
