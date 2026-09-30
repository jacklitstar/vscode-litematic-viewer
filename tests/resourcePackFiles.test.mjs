import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import {
  loadResourcePackFiles,
  parseResourcePackAssetPath,
  readResourcePackJson
} from '../webview/resourcePackFiles.mjs';

test('recognizes Minecraft block resource paths', () => {
  assert.deepEqual(parseResourcePackAssetPath('assets/minecraft/textures/block/stone.png'), {
    namespace: 'minecraft', category: 'textures', name: 'block/stone'
  });
  assert.deepEqual(parseResourcePackAssetPath('assets/example/models/block/custom.json'), {
    namespace: 'example', category: 'models', name: 'block/custom'
  });
  assert.equal(parseResourcePackAssetPath('assets/minecraft/textures/item/stick.png'), null);
  assert.equal(parseResourcePackAssetPath('assets/minecraft/sounds/music.ogg'), null);
  assert.equal(parseResourcePackAssetPath('assets/minecraft/textures/block/../../stone.png'), null);
});

test('reads only supported files from a ZIP resource pack', async () => {
  const archive = zipSync({
    'pack.mcmeta': strToU8('{"pack":{"pack_format":34}}'),
    'assets/minecraft/models/block/stone.json': strToU8('{"parent":"block/cube_all"}'),
    'assets/minecraft/textures/block/stone.png': Uint8Array.of(1, 2, 3),
    'assets/minecraft/sounds/music.ogg': Uint8Array.of(4, 5)
  });
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.fetch = async () => new Response(Buffer.from(archive));
  globalThis.createImageBitmap = async (blob) => new Uint8Array(await blob.arrayBuffer());
  try {
    const files = await loadResourcePackFiles({ kind: 'zip', url: 'pack.zip' });
    assert.deepEqual(files.map((file) => file.path).sort(), [
      'assets/minecraft/models/block/stone.json',
      'assets/minecraft/textures/block/stone.png'
    ]);
    assert.deepEqual(await files.find((file) => file.path.endsWith('.json')).json(), {
      parent: 'block/cube_all'
    });
    assert.deepEqual(await files.find((file) => file.path.endsWith('.png')).image(), Uint8Array.of(1, 2, 3));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('reads assets from an extracted resource pack manifest', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.fetch = async (url) => {
    if (url === 'model.json') {
      return Response.json({ textures: { all: 'minecraft:block/stone' } });
    }
    return new Response(Uint8Array.of(6, 7, 8));
  };
  globalThis.createImageBitmap = async (blob) => new Uint8Array(await blob.arrayBuffer());
  try {
    const files = await loadResourcePackFiles({
      kind: 'folder',
      files: [
        { path: 'assets/minecraft/models/block/stone.json', url: 'model.json' },
        { path: 'assets/minecraft/textures/block/stone.png', url: 'stone.png' },
        { path: 'assets/minecraft/textures/item/stick.png', url: 'stick.png' }
      ]
    });
    assert.equal(files.length, 2);
    assert.deepEqual(await files[0].json(), { textures: { all: 'minecraft:block/stone' } });
    assert.deepEqual(await files[1].image(), Uint8Array.of(6, 7, 8));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('skips a malformed blockstate without discarding valid pack assets', async () => {
  const archive = zipSync({
    'pack.mcmeta': strToU8('{"pack":{"pack_format":7}}'),
    'assets/minecraft/blockstates/nether_wart.json': strToU8('{"variants":{}}}'),
    'assets/minecraft/models/block/stone.json': strToU8('{"parent":"block/cube_all"}')
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from(archive));
  try {
    const files = await loadResourcePackFiles({ kind: 'zip', url: 'greenfield.zip' });
    const warnings = [];
    const values = await Promise.all(files.map((file) => readResourcePackJson(file, (warning) => warnings.push(warning))));
    assert.deepEqual(values.find((value) => value?.parent), { parent: 'block/cube_all' });
    assert.equal(values.filter((value) => value === null).length, 1);
    assert.match(warnings[0], /assets\/minecraft\/blockstates\/nether_wart\.json/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects a ZIP without root pack.mcmeta', async () => {
  const archive = zipSync({
    'nested/pack.mcmeta': strToU8('{}'),
    'assets/minecraft/models/block/stone.json': strToU8('{}')
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from(archive));
  try {
    await assert.rejects(
      loadResourcePackFiles({ kind: 'zip', url: 'invalid.zip' }),
      /pack\.mcmeta at its root/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
