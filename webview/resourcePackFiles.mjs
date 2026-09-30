import { unzipSync } from 'fflate';

const packAssetPattern = /^assets\/([a-z0-9_.-]+)\/(blockstates|models|textures)\/(.+)\.(json|png)$/i;

export const parseResourcePackAssetPath = (path) => {
  const match = packAssetPattern.exec(path);
  if (!match) {
    return null;
  }
  const [, namespace, category, name, extension] = match;
  if (name.split('/').some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
    return null;
  }
  if (category === 'textures') {
    return name.startsWith('block/') && extension === 'png'
      ? { namespace, category, name }
      : null;
  }
  return extension === 'json' ? { namespace, category, name } : null;
};

export const readResourcePackJson = async (file, warn = console.warn) => {
  try {
    const value = await file.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Expected a JSON object.');
    }
    return value;
  } catch (error) {
    warn(`Skipping invalid resource pack JSON ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};

export const loadResourcePackFiles = async (source) => {
  if (!source) {
    return [];
  }
  if (source.kind === 'folder') {
    return source.files.filter((file) => parseResourcePackAssetPath(file.path)).map((file) => ({
      path: file.path,
      async json() {
        const response = await fetch(file.url);
        if (!response.ok) throw new Error(`Failed to fetch ${file.path}: ${response.status}`);
        return response.json();
      },
      async image() {
        const response = await fetch(file.url);
        if (!response.ok) throw new Error(`Failed to fetch ${file.path}: ${response.status}`);
        return createImageBitmap(await response.blob());
      }
    }));
  }
  if (source.kind !== 'zip') {
    throw new Error('Unknown resource pack source.');
  }

  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch resource pack: ${response.status}`);
  }
  let oversizedAsset = false;
  const archive = unzipSync(new Uint8Array(await response.arrayBuffer()), {
    filter: (entry) => {
      if (entry.name === 'pack.mcmeta') {
        return entry.originalSize <= 1024 * 1024;
      }
      if (!parseResourcePackAssetPath(entry.name)) {
        return false;
      }
      if (entry.originalSize > 64 * 1024 * 1024) {
        oversizedAsset = true;
        return false;
      }
      return true;
    }
  });
  if (oversizedAsset) {
    throw new Error('A resource pack asset exceeds the 64 MiB size limit.');
  }
  if (!archive['pack.mcmeta']) {
    throw new Error('The ZIP resource pack must contain pack.mcmeta at its root.');
  }
  const decoder = new TextDecoder();
  try {
    if (!JSON.parse(decoder.decode(archive['pack.mcmeta']))?.pack) {
      throw new Error('Invalid pack.mcmeta.');
    }
  } catch {
    throw new Error('Invalid pack.mcmeta in ZIP resource pack.');
  }
  return Object.entries(archive)
    .filter(([path]) => parseResourcePackAssetPath(path))
    .map(([path, bytes]) => ({
      path,
      async json() { return JSON.parse(decoder.decode(bytes)); },
      async image() { return createImageBitmap(new Blob([bytes], { type: 'image/png' })); }
    }));
};
