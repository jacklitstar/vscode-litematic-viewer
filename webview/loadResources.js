import {
  BlockDefinition,
  BlockModel,
  Identifier,
  TextureAtlas,
  upperPowerOfTwo
} from 'deepslate';

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

export const loadVsCodeThreeDBlocksResources = async (resourceBase) => {
  const baseUrl = `${resourceBase}/minecraft`;
  const config = await fetchJson(`${baseUrl}/config.json`);
  const blockstates = await fetchJson(`${baseUrl}/assets/block_definition/data.min.json`);
  const models = await fetchJson(`${baseUrl}/assets/model/data.min.json`);
  const uvMap = await fetchJson(`${baseUrl}/assets/atlas/data.min.json`);
  const opaqueData = await fetchJson(`${baseUrl}/assets/opaque/blocks.json`);
  const { atlasSize, imageData } = await loadImageData(`${baseUrl}/assets/atlas/atlas.png`);

  const blockDefinitions = {};
  for (const id of Object.keys(blockstates)) {
    blockDefinitions[`${config.namespace}:${id}`] = BlockDefinition.fromJson(blockstates[id]);
  }

  const blockModels = {};
  for (const id of Object.keys(models)) {
    blockModels[`${config.namespace}:${id}`] = BlockModel.fromJson(models[id]);
  }
  flattenModels(blockModels);

  const rawUvMap = {};
  for (const [id, [u0, v0, du, dv]] of Object.entries(uvMap)) {
    const dv2 = (du !== dv && id.startsWith('block/')) ? du : dv;
    rawUvMap[new Identifier(config.namespace, id).toString()] = [u0, v0, u0 + du, v0 + dv2];
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

  const textureAtlas = new TextureAtlas(imageData, normalizedUvMap);
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
    getDefaultBlockProperties() {
      return {};
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
