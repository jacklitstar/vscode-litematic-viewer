import * as vscode from 'vscode';
import { MAX_NEARBY_ZIP_FILES, scanNearbyZipPacks } from './nearbyPackScan.mjs';

const decoder = new TextDecoder();
const assetFilePattern = /^assets\/[a-z0-9_.-]+\/(?:blockstates\/.*\.json|models\/.*\.json|textures\/block\/.*\.png)$/i;

const readDirectoryIfPresent = async (uri) => {
  try {
    return await vscode.workspace.fs.readDirectory(uri);
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
      return [];
    }
    throw error;
  }
};

const readPackDescription = async (uri) => {
  try {
    const metadata = JSON.parse(decoder.decode(await vscode.workspace.fs.readFile(uri)));
    const description = metadata?.pack?.description;
    return typeof description === 'string' ? description : (description?.text || '');
  } catch {
    return null;
  }
};

export const getResourcePacksRoot = (context) =>
  vscode.Uri.joinPath(context.globalStorageUri, 'resourcepacks');

const listNearbyZipPacks = async (folderUri) => {
  try {
    if (folderUri.scheme === 'file') {
      return await scanNearbyZipPacks(folderUri.fsPath);
    }
    const entries = await readDirectoryIfPresent(folderUri);
    const names = [];
    for (const [name, type] of entries) {
      if ((type & vscode.FileType.File)
        && !(type & vscode.FileType.SymbolicLink)
        && name.toLowerCase().endsWith('.zip')) {
        if (names.length >= MAX_NEARBY_ZIP_FILES) {
          return { names: [], skipped: true };
        }
        names.push(name);
      }
    }
    return { names, skipped: false };
  } catch (error) {
    console.warn(`Could not search for resource packs beside ${folderUri.toString()}:`, error);
    return { names: [], skipped: false };
  }
};

export const listResourcePacks = async (root, folderUri) => {
  await vscode.workspace.fs.createDirectory(root);
  const entries = await vscode.workspace.fs.readDirectory(root);
  const packs = [];
  for (const [name, type] of entries) {
    if (type & vscode.FileType.SymbolicLink) {
      continue;
    }
    if (type & vscode.FileType.Directory) {
      const description = await readPackDescription(vscode.Uri.joinPath(root, name, 'pack.mcmeta'));
      if (description !== null) {
        packs.push({
          id: `storage:${name}`, name, description, kind: 'folder', origin: 'storage',
          uri: vscode.Uri.joinPath(root, name)
        });
      }
    } else if ((type & vscode.FileType.File) && name.toLowerCase().endsWith('.zip')) {
      packs.push({
        id: `storage:${name}`, name, description: '', kind: 'zip', origin: 'storage',
        uri: vscode.Uri.joinPath(root, name)
      });
    }
  }
  const nearby = await listNearbyZipPacks(folderUri);
  for (const name of nearby.names) {
    packs.push({
      id: `nearby:${name}`, name, description: '', kind: 'zip', origin: 'nearby',
      uri: vscode.Uri.joinPath(folderUri, name)
    });
  }
  packs.sort((a, b) => a.origin === b.origin
    ? a.name.localeCompare(b.name)
    : (a.origin === 'nearby' ? -1 : 1));
  return { packs, nearbySearchSkipped: nearby.skipped };
};

const collectFiles = async (uri, relativePath, webview, files) => {
  for (const [name, type] of await readDirectoryIfPresent(uri)) {
    if (type & vscode.FileType.SymbolicLink) {
      continue;
    }
    const childUri = vscode.Uri.joinPath(uri, name);
    const childPath = `${relativePath}/${name}`;
    if (type & vscode.FileType.Directory) {
      await collectFiles(childUri, childPath, webview, files);
    } else if ((type & vscode.FileType.File) && assetFilePattern.test(childPath)) {
      files.push({ path: childPath, url: webview.asWebviewUri(childUri).toString() });
    }
  }
};

export const getResourcePackSource = async (pack, webview) => {
  const packUri = pack.uri;
  if (pack.kind === 'zip') {
    return { kind: 'zip', url: webview.asWebviewUri(packUri).toString() };
  }

  const files = [];
  const assetsUri = vscode.Uri.joinPath(packUri, 'assets');
  for (const [namespace, type] of await readDirectoryIfPresent(assetsUri)) {
    if (!(type & vscode.FileType.Directory) || (type & vscode.FileType.SymbolicLink)) {
      continue;
    }
    const namespaceUri = vscode.Uri.joinPath(assetsUri, namespace);
    for (const subpath of ['blockstates', 'models', 'textures/block']) {
      await collectFiles(
        vscode.Uri.joinPath(namespaceUri, subpath),
        `assets/${namespace}/${subpath}`,
        webview,
        files
      );
    }
  }
  return { kind: 'folder', files };
};
