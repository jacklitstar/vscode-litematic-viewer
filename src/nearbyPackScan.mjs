import { opendir } from 'node:fs/promises';

export const MAX_NEARBY_ZIP_FILES = 1000;

export const scanNearbyZipPacks = async (folderPath, maxZipFiles = MAX_NEARBY_ZIP_FILES) => {
  const directory = await opendir(folderPath);
  const names = [];
  try {
    let entry;
    while ((entry = await directory.read()) !== null) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
        if (names.length >= maxZipFiles) {
          return { names: [], skipped: true };
        }
        names.push(entry.name);
      }
    }
  } finally {
    await directory.close();
  }
  return { names, skipped: false };
};
