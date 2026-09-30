import './styles.css';

import {
  BlockWorld,
  InteractiveCanvas,
  ThreeDBlocksRenderer,
  createAabbFromSize,
  fitOrbitCameraToAabb,
  DEFAULT_ORBIT_X_ROTATION,
  DEFAULT_ORBIT_Y_ROTATION
} from '../vendor/3DBLOCKS/index.ts';
import { loadVsCodeThreeDBlocksResources } from './loadResources.js';

const vscode = window.__MINECRAFT_SCHEMATIC_VIEWER_VSCODE_API
  || (typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null);
if (vscode) {
  window.__MINECRAFT_SCHEMATIC_VIEWER_VSCODE_API = vscode;
}
const config = window.__MINECRAFT_SCHEMATIC_VIEWER_CONFIG || {};
const strings = {
  editorTitle: 'Minecraft Schematic Viewer',
  summary: 'Summary',
  materials: 'Materials',
  resourcePacks: 'Resource Pack',
  vanillaResourcePack: 'Vanilla',
  openResourcePacksFolder: 'Open Packs Folder',
  refreshResourcePacks: 'Refresh',
  resourcePacksHint: 'ZIPs beside this file or packs in Packs Folder.',
  nearbyPackSearchSkipped: 'Nearby ZIP search skipped: this folder has more than 1,000 ZIP files.',
  file: 'File',
  size: 'Size',
  blocks: 'Blocks',
  palette: 'Palette',
  regions: 'Regions',
  noMaterialsLoaded: 'No materials loaded yet.',
  noNonAirMaterials: 'No non-air materials found.',
  loadingTitle: 'Loading…',
  preparingRenderer: 'Preparing renderer.',
  loadingResourcesTitle: 'Loading resources',
  loadingResourcesMessage: 'Preparing block models and textures.',
  meshingTitle: 'Meshing structure',
  meshingMessage: 'Building chunk meshes for the preview.',
  meshingProgress: 'Built {built}/{total} chunks.',
  previewFailedTitle: 'Preview failed',
  unknownError: 'Unknown error.',
  waitingTitle: 'Waiting for preview',
  waitingMessage: 'Open a .litematic, .schem, .nbt, .mcstructure, or supported .json schematic file to render it here.',
  webglUnavailable: 'WebGL is not available in this VS Code webview.',
  ...config.strings
};
const formatString = (template, values = {}) => String(template).replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));

document.querySelector('#app').innerHTML = `
  <div class="app-shell">
    <section class="viewport-panel">
      <div class="viewport-stage" id="viewport-stage">
        <canvas id="viewer-canvas"></canvas>
        <div class="overlay" id="overlay">
          <div class="overlay-card">
            <div class="overlay-title" id="overlay-title">${strings.loadingTitle}</div>
            <div class="overlay-message" id="overlay-message">${strings.preparingRenderer}</div>
          </div>
        </div>
      </div>
    </section>
    <aside class="sidebar">
      <section class="card summary-card">
        <h2>${strings.summary}</h2>
        <dl class="summary-grid">
          <div class="summary-wide"><dt>${strings.file}</dt><dd id="summary-file">-</dd></div>
          <div><dt>${strings.size}</dt><dd id="summary-size">-</dd></div>
          <div><dt>${strings.blocks}</dt><dd id="summary-blocks">-</dd></div>
          <div><dt>${strings.palette}</dt><dd id="summary-palette">-</dd></div>
          <div><dt>${strings.regions}</dt><dd id="summary-regions">-</dd></div>
        </dl>
        <section class="resource-pack-section">
          <h3>${strings.resourcePacks}</h3>
          <select id="resource-pack-select" aria-label="${strings.resourcePacks}" disabled>
            <option value="">${strings.vanillaResourcePack}</option>
          </select>
          <div class="resource-pack-actions">
            <button id="open-resource-packs-folder" type="button">${strings.openResourcePacksFolder}</button>
            <button id="refresh-resource-packs" type="button">${strings.refreshResourcePacks}</button>
          </div>
          <div class="resource-pack-hint" id="resource-pack-hint">${strings.resourcePacksHint}</div>
        </section>
      </section>
      <section class="card">
        <h2>${strings.materials}</h2>
        <div class="materials-list" id="materials-list">
          <div class="empty-state">${strings.noMaterialsLoaded}</div>
        </div>
      </section>
    </aside>
  </div>
`;

const elements = {
  canvas: document.querySelector('#viewer-canvas'),
  materials: document.querySelector('#materials-list'),
  overlay: document.querySelector('#overlay'),
  overlayMessage: document.querySelector('#overlay-message'),
  overlayTitle: document.querySelector('#overlay-title'),
  openResourcePacksFolder: document.querySelector('#open-resource-packs-folder'),
  refreshResourcePacks: document.querySelector('#refresh-resource-packs'),
  resourcePackHint: document.querySelector('#resource-pack-hint'),
  resourcePackSelect: document.querySelector('#resource-pack-select'),
  stage: document.querySelector('#viewport-stage'),
  summaryBlocks: document.querySelector('#summary-blocks'),
  summaryFile: document.querySelector('#summary-file'),
  summaryPalette: document.querySelector('#summary-palette'),
  summaryRegions: document.querySelector('#summary-regions'),
  summarySize: document.querySelector('#summary-size')
};

let gl = null;
let renderer = null;
let interactiveCanvas = null;
let resourcesPromise = null;
let rendererPromise = null;
let resizeObserver = null;
let pendingPreview = null;
let latestCompletedPreview = null;
let activeRenderController = null;
let renderRevision = 0;
let lastRenderedRequestId = null;
let isPanelVisible = true;
let resourcesReady = false;
let selectedPackSource = null;
let packGeneration = 0;
let resolvePackStateReady;
const packStateReady = new Promise((resolve) => { resolvePackStateReady = resolve; });

const abortForPackChange = () => new DOMException('Resource pack changed.', 'AbortError');

elements.resourcePackSelect.addEventListener('change', () => {
  elements.resourcePackSelect.disabled = true;
  vscode?.postMessage({ type: 'selectResourcePack', id: elements.resourcePackSelect.value });
});
elements.openResourcePacksFolder.addEventListener('click', () => {
  vscode?.postMessage({ type: 'openResourcePacksFolder' });
});
elements.refreshResourcePacks.addEventListener('click', () => {
  vscode?.postMessage({ type: 'refreshResourcePacks' });
});

const parseCssRgb = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const rgbMatch = value.match(/rgba?\(([^)]+)\)/i);
  if (rgbMatch) {
    const [r = 0, g = 0, b = 0] = rgbMatch[1]
      .split(',')
      .slice(0, 3)
      .map((part) => Number.parseFloat(part.trim()));
    return [r / 255, g / 255, b / 255];
  }

  const hexMatch = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    return [
      Number.parseInt(hex.slice(0, 2), 16) / 255,
      Number.parseInt(hex.slice(2, 4), 16) / 255,
      Number.parseInt(hex.slice(4, 6), 16) / 255
    ];
  }

  return null;
};

const getThemeClearColor = () => (
  parseCssRgb(getComputedStyle(document.body).backgroundColor)
  || [0.08, 0.1, 0.14]
);

const showOverlay = (title, message, kind = 'loading') => {
  elements.overlay.className = `overlay overlay-${kind}`;
  elements.overlay.hidden = false;
  elements.overlayTitle.textContent = title;
  elements.overlayMessage.textContent = message;
};

const hideOverlay = () => {
  elements.overlay.hidden = true;
};

const updateMaterials = (preview) => {
  if (!preview.materials.length) {
    elements.materials.innerHTML = `<div class="empty-state">${strings.noNonAirMaterials}</div>`;
    return;
  }

  elements.materials.innerHTML = preview.materials
    .slice(0, 128)
    .map((material) => `
      <div class="material-row">
        <span class="material-name">${material.id}</span>
        <span class="material-count">${material.count.toLocaleString()}</span>
      </div>
    `)
    .join('');
};

const updateSummary = (preview) => {
  elements.summaryFile.textContent = preview.fileName;
  elements.summarySize.textContent = `${preview.size.width} x ${preview.size.height} x ${preview.size.length}`;
  elements.summaryBlocks.textContent = preview.stats.blockCount.toLocaleString();
  elements.summaryPalette.textContent = preview.stats.paletteSize.toLocaleString();
  elements.summaryRegions.textContent = (preview.stats.regionCount || 1).toLocaleString();
  updateMaterials(preview);
};

const positionKey = (x, y, z) => `${x},${y},${z}`;

const resolveStateProperties = (state, x, y, z, stateByPosition) => {
  const properties = { ...(state.properties || {}) };
  if (!/_door$/.test(String(state.id)) || properties.half) {
    return properties;
  }

  const above = stateByPosition.get(positionKey(x, y + 1, z));
  const below = stateByPosition.get(positionKey(x, y - 1, z));
  if (above?.id === state.id) {
    properties.half = 'lower';
  } else if (below?.id === state.id) {
    properties.half = 'upper';
  }
  return properties;
};

const buildWorld = (preview) => {
  const world = new BlockWorld([
    Math.max(1, preview.size.width),
    Math.max(1, preview.size.height),
    Math.max(1, preview.size.length)
  ]);
  const hasDoors = Array.isArray(preview.palette)
    && preview.palette.some((state) => /_door$/.test(String(state?.id || '')));
  const stateByPosition = hasDoors ? new Map() : null;

  if (stateByPosition) {
    for (let index = 0; index < preview.blocks.length; index += 4) {
      const x = preview.blocks[index];
      const y = preview.blocks[index + 1];
      const z = preview.blocks[index + 2];
      const paletteIndex = preview.blocks[index + 3];
      const state = preview.palette[paletteIndex];
      if (state) {
        stateByPosition.set(positionKey(x, y, z), state);
      }
    }
  }

  for (let index = 0; index < preview.blocks.length; index += 4) {
    const x = preview.blocks[index];
    const y = preview.blocks[index + 1];
    const z = preview.blocks[index + 2];
    const paletteIndex = preview.blocks[index + 3];
    const state = preview.palette[paletteIndex];
    if (!state) {
      continue;
    }
    world.addBlock(
      [x, y, z],
      state.id,
      stateByPosition ? resolveStateProperties(state, x, y, z, stateByPosition) : (state.properties || {})
    );
  }

  return world;
};

const getBlocksPerSlice = (preview) => {
  const blockCount = preview?.stats?.blockCount ?? 0;
  if (blockCount >= 1_000_000) {
    return 50_000;
  }
  if (blockCount >= 250_000) {
    return 20_000;
  }
  return 5_000;
};

const isAbortError = (error) => (
  error instanceof DOMException
  ? error.name === 'AbortError'
  : String(error?.name || '') === 'AbortError'
);

const cancelActiveRender = () => {
  renderRevision += 1;
  if (activeRenderController) {
    activeRenderController.abort();
    activeRenderController = null;
  }
};

const ensureResources = async () => {
  await packStateReady;
  const generation = packGeneration;
  if (!resourcesPromise) {
    resourcesPromise = loadVsCodeThreeDBlocksResources(
      config.resourceBase,
      selectedPackSource,
      gl?.getParameter(gl.MAX_TEXTURE_SIZE) || 16384
    );
  }
  const resources = await resourcesPromise;
  if (generation !== packGeneration) {
    throw abortForPackChange();
  }
  resourcesReady = true;
  return resources;
};

const ensureRenderer = async () => {
  if (!gl) {
    gl = (
      elements.canvas.getContext('webgl2', { antialias: true, alpha: true })
      || elements.canvas.getContext('webgl', { antialias: true, alpha: true })
    );
    if (!gl) {
      throw new Error(strings.webglUnavailable);
    }
  }

  if (renderer) {
    return renderer;
  }
  if (rendererPromise) {
    return rendererPromise;
  }

  const generation = packGeneration;
  const pending = (async () => {
    const resources = await ensureResources();
    if (generation !== packGeneration) {
      throw abortForPackChange();
    }
    const nextRenderer = new ThreeDBlocksRenderer(
      gl,
      new BlockWorld([1, 1, 1]),
      resources,
      {
        atlasMipmaps: false,
        deferInitialBuild: true,
        lazyUpload: false,
        maxPixelRatio: 1.25,
        projectionFovDeg: 45,
        versionTag: 'minecraft-schematic-viewer'
      }
    );
    if (generation !== packGeneration) {
      nextRenderer.dispose();
      throw abortForPackChange();
    }
    renderer = nextRenderer;

    if (!interactiveCanvas) {
      interactiveCanvas = new InteractiveCanvas(
        elements.canvas,
        undefined,
        (view) => {
          const [r, g, b] = getThemeClearColor();
          gl.clearColor(r, g, b, 1);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          renderer?.drawStructure(view);
        }
      );
    }

    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        interactiveCanvas?.redraw();
      });
      resizeObserver.observe(elements.stage);
    }

    return renderer;
  })();
  rendererPromise = pending;
  try {
    return await pending;
  } finally {
    if (rendererPromise === pending) {
      rendererPromise = null;
    }
  }
};

const fitCameraToPreview = (preview) => {
  if (!interactiveCanvas) {
    return;
  }

  const fitted = fitOrbitCameraToAabb(
    createAabbFromSize([preview.size.width, preview.size.height, preview.size.length]),
    {
      aspect: Math.max(elements.canvas.clientWidth, 1) / Math.max(elements.canvas.clientHeight, 1),
      fovYDeg: 45,
      xRotation: DEFAULT_ORBIT_X_ROTATION,
      yRotation: DEFAULT_ORBIT_Y_ROTATION
    }
  );

  interactiveCanvas.setOrbitView(
    fitted.xRotation,
    fitted.yRotation,
    fitted.viewDist,
    fitted.focus
  );
};

const warmRenderer = () => {
  void ensureRenderer().catch(() => {});
};

const renderPreview = async (preview, requestId = null) => {
  cancelActiveRender();
  const revision = renderRevision;
  const generation = packGeneration;
  updateSummary(preview);

  if (!renderer || !resourcesReady) {
    showOverlay(strings.loadingResourcesTitle, strings.loadingResourcesMessage);
  }

  const worldPromise = Promise.resolve().then(() => buildWorld(preview));
  const rendererPromise = ensureRenderer();
  const [world, currentRenderer] = await Promise.all([worldPromise, rendererPromise]);
  if (generation !== packGeneration || revision !== renderRevision) {
    throw abortForPackChange();
  }
  const blocksPerSlice = getBlocksPerSlice(preview);
  const renderController = new AbortController();
  activeRenderController = renderController;

  showOverlay(strings.meshingTitle, strings.meshingMessage);
  await currentRenderer.setStructureProgressiveAsync(world, blocksPerSlice, renderController.signal, (built, total) => {
    if (total > 0) {
      showOverlay(strings.meshingTitle, formatString(strings.meshingProgress, { built, total }));
    }
  });
  if (generation !== packGeneration || revision !== renderRevision) {
    throw abortForPackChange();
  }
  if (activeRenderController === renderController) {
    activeRenderController = null;
  }

  fitCameraToPreview(preview);
  interactiveCanvas?.redraw();
  hideOverlay();
  lastRenderedRequestId = requestId;

  vscode?.setState({
    fileName: preview.fileName,
    format: preview.format
  });
};

window.addEventListener('resize', () => {
  interactiveCanvas?.redraw();
});

window.addEventListener('message', async (event) => {
  const message = event.data;

  if (message?.type === 'resourcePacks') {
    packGeneration += 1;
    cancelActiveRender();
    renderer?.dispose();
    renderer = null;
    rendererPromise = null;
    resourcesPromise = null;
    resourcesReady = false;
    lastRenderedRequestId = null;
    selectedPackSource = message.source || null;

    elements.resourcePackSelect.replaceChildren();
    for (const pack of [
      { id: '', name: strings.vanillaResourcePack },
      ...(Array.isArray(message.packs) ? message.packs : [])
    ]) {
      const option = document.createElement('option');
      option.value = pack.id;
      option.textContent = pack.name;
      elements.resourcePackSelect.append(option);
    }
    elements.resourcePackSelect.value = message.selectedId || '';
    elements.resourcePackSelect.disabled = false;
    elements.resourcePackHint.textContent = message.error
      || (message.nearbySearchSkipped ? strings.nearbyPackSearchSkipped : strings.resourcePacksHint);
    elements.resourcePackHint.title = message.folderPath || '';

    resolvePackStateReady();
    if (latestCompletedPreview && isPanelVisible) {
      try {
        await renderPreview(latestCompletedPreview.preview, latestCompletedPreview.requestId);
      } catch (error) {
        if (!isAbortError(error)) {
          showOverlay(strings.previewFailedTitle, error instanceof Error ? error.message : String(error), 'error');
        }
      }
    }
    return;
  }

  if (message?.type === 'setVisibility') {
    isPanelVisible = Boolean(message.visible);
    if (!isPanelVisible) {
      cancelActiveRender();
      return;
    }

    if (latestCompletedPreview && latestCompletedPreview.requestId !== lastRenderedRequestId) {
      try {
        await renderPreview(latestCompletedPreview.preview, latestCompletedPreview.requestId);
      } catch (error) {
        if (!isAbortError(error)) {
          const description = error instanceof Error ? error.message : String(error);
          showOverlay(strings.previewFailedTitle, description, 'error');
        }
      }
    } else {
      interactiveCanvas?.redraw();
    }
    return;
  }

  if (message?.type === 'setStatus') {
    showOverlay(message.title || strings.loadingTitle, message.message || strings.preparingRenderer);
    return;
  }

  if (message?.type === 'previewStart') {
    cancelActiveRender();
    latestCompletedPreview = null;
    lastRenderedRequestId = null;
    warmRenderer();
    pendingPreview = {
      requestId: message.requestId,
      preview: {
        ...(message.preview || {}),
        blocks: []
      },
      totalChunks: Math.max(1, Number(message.totalChunks) || 1)
    };
    showOverlay(strings.loadingTitle, strings.preparingRenderer);
    return;
  }

  if (message?.type === 'previewChunk') {
    if (!pendingPreview || pendingPreview.requestId !== message.requestId) {
      return;
    }

    const blocks = Array.isArray(message.blocks) ? message.blocks : [];
    for (let index = 0; index < blocks.length; index += 1) {
      pendingPreview.preview.blocks.push(blocks[index]);
    }
    return;
  }

  if (message?.type === 'previewEnd') {
    if (!pendingPreview || pendingPreview.requestId !== message.requestId) {
      return;
    }

    const preview = pendingPreview.preview;
    const requestId = pendingPreview.requestId;
    pendingPreview = null;
    latestCompletedPreview = { requestId, preview };
    if (!isPanelVisible) {
      showOverlay(strings.loadingTitle, strings.preparingRenderer);
      return;
    }
    try {
      await renderPreview(preview, requestId);
    } catch (error) {
      if (!isAbortError(error)) {
        const description = error instanceof Error ? error.message : String(error);
        showOverlay(strings.previewFailedTitle, description, 'error');
      }
    }
    return;
  }

  if (message?.type === 'setPreview') {
    const preview = message.previewStr ? JSON.parse(message.previewStr) : message.preview;
    latestCompletedPreview = { requestId: null, preview };
    try {
      await renderPreview(preview, null);
    } catch (error) {
      if (!isAbortError(error)) {
        const description = error instanceof Error ? error.message : String(error);
        showOverlay(strings.previewFailedTitle, description, 'error');
      }
    }
    return;
  }

  if (message?.type === 'setError') {
    cancelActiveRender();
    pendingPreview = null;
    latestCompletedPreview = null;
    lastRenderedRequestId = null;
    showOverlay(strings.previewFailedTitle, message.message || strings.unknownError, 'error');
  }
});

showOverlay(strings.waitingTitle, strings.waitingMessage);

// Signal the extension host that the message listener is registered, so it can
// (re)send the preview. This avoids a race where the preview is posted before
// the webview is listening.
vscode?.postMessage({ type: 'ready' });
warmRenderer();
