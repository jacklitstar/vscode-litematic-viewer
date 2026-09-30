import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { scanNearbyZipPacks } from '../src/nearbyPackScan.mjs';

test('counts only immediate ZIP files toward the nearby pack limit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'litematic-packs-'));
  try {
    await Promise.all([
      writeFile(join(directory, 'one.zip'), ''),
      writeFile(join(directory, 'TWO.ZIP'), ''),
      writeFile(join(directory, 'notes.txt'), ''),
      mkdir(join(directory, 'nested.zip'))
    ]);
    assert.deepEqual(
      (await scanNearbyZipPacks(directory, 2)).names.sort(),
      ['one.zip', 'TWO.ZIP'].sort()
    );
    assert.deepEqual(await scanNearbyZipPacks(directory, 1), { names: [], skipped: true });
  } finally {
    const resolved = resolve(directory);
    const tempRoot = resolve(tmpdir());
    assert.ok(resolved.startsWith(`${tempRoot}${sep}`) && basename(resolved).startsWith('litematic-packs-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
