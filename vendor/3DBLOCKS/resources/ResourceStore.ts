import type { ItemRendererResources, Resources } from 'deepslate';
import { loadResource } from './loadResource';

export const blockResources: { value: (Resources & ItemRendererResources) | undefined } = {
  value: undefined
};

export const loadThreeDBlocksResources = async () => {
  await loadResource();
};
