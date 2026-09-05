import fsp from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const fileName = process.env.PREVIEW_FILE_NAME || '';
const modulePath = process.env.PREVIEW_MODULE_PATH || '';

try {
  const mod = await import(pathToFileURL(modulePath).href);
  const bytes = await fsp.readFile(fileName);
  const preview = await mod.createPreviewData(fileName, bytes, { yieldInterval: 0 });
  process.stdout.write(JSON.stringify({ type: 'result', preview }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    type: 'error',
    name: error?.name ?? null,
    message: error instanceof Error ? error.message : String(error),
    stack: error?.stack ?? null
  }));
}
