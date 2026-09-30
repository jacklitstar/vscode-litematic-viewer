import {
  BlockDefinition,
  BlockModel,
  Identifier,
  TextureAtlas,
  upperPowerOfTwo
} from 'deepslate';
import { loadResourcePackFiles, parseResourcePackAssetPath, readResourcePackJson } from './resourcePackFiles.mjs';

const forEachConcurrent = async (items, concurrency, callback) => {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await callback(item);
    }
  }));
};

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
};

const fetchImage = async (url) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
  image.src = url;
});

const loadImageData = async (url) => {
  const image = await fetchImage(url);
  const atlasSize = upperPowerOfTwo(Math.max(image.width, image.height));

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(atlasSize, atlasSize);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error(`Failed to create OffscreenCanvas for ${url}`);
    }
    ctx.drawImage(image, 0, 0);
    return {
      atlasSize,
      imageData: ctx.getImageData(0, 0, atlasSize, atlasSize)
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = atlasSize;
  canvas.height = atlasSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error(`Failed to create 2D canvas for ${url}`);
  }
  ctx.drawImage(image, 0, 0);
  return {
    atlasSize,
    imageData: ctx.getImageData(0, 0, atlasSize, atlasSize)
  };
};

const flattenModels = (blockModels) => {
  const models = Object.values(blockModels);
  for (const model of models) {
    model.flatten({
      getBlockModel: (id) => blockModels[id.toString()] || null
    });
  }
};

const parseVariantProperties = (variantKey) => {
  if (typeof variantKey !== 'string' || variantKey.length === 0) {
    return {};
  }

  const properties = {};
  for (const chunk of variantKey.split(',')) {
    if (!chunk) continue;
    const [key, value] = chunk.split('=', 2);
    if (key && value !== undefined) {
      properties[key] = value;
    }
  }
  return properties;
};

const normalizeConditionValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join('|');
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
};

const normalizeMultipartCondition = (condition) => {
  if (!condition || typeof condition !== 'object') {
    return {};
  }

  if (Array.isArray(condition.OR)) {
    return {
      OR: condition.OR
        .map((entry) => normalizeMultipartCondition(entry))
        .filter((entry) => entry && Object.keys(entry).length > 0)
    };
  }

  if (Array.isArray(condition.AND)) {
    const merged = {};
    for (const entry of condition.AND) {
      const normalized = normalizeMultipartCondition(entry);
      if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized.OR)) {
        continue;
      }
      Object.assign(merged, normalized);
    }
    return merged;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(condition)) {
    normalized[key] = normalizeConditionValue(value);
  }
  return normalized;
};

const normalizeBlockDefinition = (definition) => {
  if (!definition || typeof definition !== 'object') {
    return definition;
  }

  return {
    ...definition,
    multipart: Array.isArray(definition.multipart)
      ? definition.multipart.map((part) => ({
          ...part,
          when: normalizeMultipartCondition(part?.when)
        }))
      : definition.multipart
  };
};

const deriveDefaultProperties = (definition) => {
  if (!definition || typeof definition !== 'object') {
    return {};
  }

  if (definition.variants && typeof definition.variants === 'object') {
    const keys = Object.keys(definition.variants);
    if (keys.length > 0) {
      return parseVariantProperties(keys[0]);
    }
  }

  if (Array.isArray(definition.multipart)) {
    for (const part of definition.multipart) {
      const when = part?.when;
      if (when && !Array.isArray(when.OR) && typeof when === 'object') {
        const properties = {};
        for (const [key, value] of Object.entries(when)) {
          if (typeof value === 'string' && value.length > 0) {
            properties[key] = value.split('|')[0];
          }
        }
        if (Object.keys(properties).length > 0) {
          return properties;
        }
      }
    }
  }

  return {};
};

export const loadVsCodeThreeDBlocksResources = async (resourceBase, packSource = null, maxTextureSize = 16384) => {
  const baseUrl = `${resourceBase}/minecraft`;
  const [config, blockstates, models, uvMap, opaqueData, atlas, packFiles] = await Promise.all([
    fetchJson(`${baseUrl}/config.json`),
    fetchJson(`${baseUrl}/assets/block_definition/data.min.json`),
    fetchJson(`${baseUrl}/assets/model/data.min.json`),
    fetchJson(`${baseUrl}/assets/atlas/data.min.json`),
    fetchJson(`${baseUrl}/assets/opaque/blocks.json`),
    loadImageData(`${baseUrl}/assets/atlas/atlas.png`),
    loadResourcePackFiles(packSource)
  ]);
  const { atlasSize: vanillaAtlasSize, imageData } = atlas;

  const packBlockstates = {};
  const packModels = {};
  const packTextures = [];
  await forEachConcurrent(packFiles, 12, async (file) => {
    const { namespace, category, name } = parseResourcePackAssetPath(file.path);
    const id = `${namespace}:${name}`;
    if (category === 'textures') {
      packTextures.push({ id, file });
    } else {
      const value = await readResourcePackJson(file);
      if (value) {
        if (category === 'blockstates') {
          packBlockstates[id] = value;
        } else {
          packModels[id] = value;
        }
      }
    }
  });

  const blockDefinitions = {};
  const blockDefaultProperties = {};
  for (const id of Object.keys(blockstates)) {
    const normalizedDefinition = normalizeBlockDefinition(blockstates[id]);
    blockDefinitions[`${config.namespace}:${id}`] = BlockDefinition.fromJson(normalizedDefinition);
    blockDefaultProperties[`${config.namespace}:${id}`] = deriveDefaultProperties(normalizedDefinition);
  }
  for (const [id, definition] of Object.entries(packBlockstates)) {
    try {
      const normalizedDefinition = normalizeBlockDefinition(definition);
      blockDefinitions[id] = BlockDefinition.fromJson(normalizedDefinition);
      blockDefaultProperties[id] = deriveDefaultProperties(normalizedDefinition);
    } catch (error) {
      console.warn(`Skipping invalid resource pack blockstate ${id}:`, error);
    }
  }

  const blockModels = {};
  for (const id of Object.keys(models)) {
    blockModels[`${config.namespace}:${id}`] = BlockModel.fromJson(models[id]);
  }
  for (const [id, model] of Object.entries(packModels)) {
    try {
      blockModels[id] = BlockModel.fromJson(model);
    } catch (error) {
      console.warn(`Skipping invalid resource pack model ${id}:`, error);
    }
  }
  flattenModels(blockModels);

  const rawUvMap = {};
  for (const [id, [u0, v0, du, dv]] of Object.entries(uvMap)) {
    const dv2 = (du !== dv && id.startsWith('block/')) ? du : dv;
    rawUvMap[new Identifier(config.namespace, id).toString()] = [u0, v0, u0 + du, v0 + dv2];
  }

  let atlasSize = vanillaAtlasSize;
  let atlasData = imageData;
  if (packTextures.length > 0) {
    const slotSize = 16;
    const columns = Math.floor(vanillaAtlasSize / slotSize);
    const usedHeight = Math.max(...Object.values(uvMap).map(([, y, , height]) => y + height));
    const extraStartY = Math.ceil(usedHeight / slotSize) * slotSize;
    const extraTextures = packTextures
      .filter(({ id }) => !rawUvMap[id])
      .sort((a, b) => a.id.localeCompare(b.id));
    const extraRows = Math.ceil(extraTextures.length / columns);
    atlasSize = upperPowerOfTwo(Math.max(vanillaAtlasSize, extraStartY + extraRows * slotSize));
    if (atlasSize > maxTextureSize) {
      throw new Error(`Resource pack needs a ${atlasSize}px texture atlas, but this device supports ${maxTextureSize}px.`);
    }

    extraTextures.forEach(({ id }, index) => {
      const x = (index % columns) * slotSize;
      const y = extraStartY + Math.floor(index / columns) * slotSize;
      rawUvMap[id] = [x, y, x + slotSize, y + slotSize];
    });

    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(atlasSize, atlasSize)
      : Object.assign(document.createElement('canvas'), { width: atlasSize, height: atlasSize });
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create resource pack texture atlas.');
    }
    ctx.putImageData(imageData, 0, 0);
    await forEachConcurrent(packTextures, 8, async ({ id, file }) => {
      const image = await file.image();
      const [x0, y0, x1, y1] = rawUvMap[id];
      const side = Math.min(image.width, image.height);
      ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
      ctx.drawImage(image, 0, 0, side, side, x0, y0, x1 - x0, y1 - y0);
      image.close?.();
    });
    atlasData = ctx.getImageData(0, 0, atlasSize, atlasSize);
  }

  const normalizedUvMap = {};
  for (const [id, [u0, v0, u1, v1]] of Object.entries(rawUvMap)) {
    normalizedUvMap[id] = [
      u0 / atlasSize,
      v0 / atlasSize,
      u1 / atlasSize,
      v1 / atlasSize
    ];
  }

  const textureAtlas = new TextureAtlas(atlasData, normalizedUvMap);
  const opaqueBlocks = new Set(
    Array.isArray(opaqueData?.opaque)
      ? opaqueData.opaque.map((id) => `${config.namespace}:${id}`)
      : []
  );

  return {
    getBlockDefinition(id) {
      return blockDefinitions[id.toString()] || null;
    },
    getBlockModel(id) {
      return blockModels[id.toString()] || null;
    },
    getTextureUV(id) {
      return textureAtlas.getTextureUV(id);
    },
    getTextureAtlas() {
      return textureAtlas.getTextureAtlas();
    },
    getPixelSize() {
      return textureAtlas.getPixelSize();
    },
    getBlockFlags(id) {
      return {
        opaque: opaqueBlocks.has(id.toString())
      };
    },
    getBlockProperties() {
      return null;
    },
    getDefaultBlockProperties(id) {
      return blockDefaultProperties[id.toString()] || {};
    },
    getItemModel() {
      return null;
    },
    getItemComponents() {
      return null;
    },
    getItemTint() {
      return undefined;
    },
    getItemModelResolver() {
      return null;
    },
    getItemDefinitions() {
      return null;
    },
    getItemRenderingContext() {
      return {};
    }
  };
};
