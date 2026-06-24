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

const vscode = window.__MCSTOOLS_VSCODE_API
  || (typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null);
if (vscode) {
  window.__MCSTOOLS_VSCODE_API = vscode;
}
const config = window.__MCSTOOLS_VIEWER_CONFIG || {};
const reportDebugEvent = (hypothesisId, location, msg, data = {}) => {
  if (vscode) {
    vscode.postMessage({
      type: 'debugEvent',
      hypothesisId,
      location,
      msg,
      data
    });
  }
};

document.querySelector('#app').innerHTML = `
  <div class="app-shell">
    <section class="viewport-panel">
      <div class="viewport-stage" id="viewport-stage">
        <canvas id="viewer-canvas"></canvas>
        <div class="overlay" id="overlay">
          <div class="overlay-card">
            <div class="overlay-title" id="overlay-title">Loading…</div>
            <div class="overlay-message" id="overlay-message">Preparing renderer.</div>
          </div>
        </div>
      </div>
    </section>
    <aside class="sidebar">
      <section class="card">
        <h2>Summary</h2>
        <dl class="summary-grid">
          <div class="summary-wide"><dt>File</dt><dd id="summary-file">-</dd></div>
          <div><dt>Size</dt><dd id="summary-size">-</dd></div>
          <div><dt>Blocks</dt><dd id="summary-blocks">-</dd></div>
          <div><dt>Palette</dt><dd id="summary-palette">-</dd></div>
          <div><dt>Regions</dt><dd id="summary-regions">-</dd></div>
        </dl>
      </section>
      <section class="card">
        <h2>Materials</h2>
        <div class="materials-list" id="materials-list">
          <div class="empty-state">No materials loaded yet.</div>
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
let resizeObserver = null;

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
    elements.materials.innerHTML = '<div class="empty-state">No non-air materials found.</div>';
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

const buildWorld = (preview) => {
  const world = new BlockWorld([
    Math.max(1, preview.size.width),
    Math.max(1, preview.size.height),
    Math.max(1, preview.size.length)
  ]);

  for (let index = 0; index < preview.blocks.length; index += 4) {
    const x = preview.blocks[index];
    const y = preview.blocks[index + 1];
    const z = preview.blocks[index + 2];
    const paletteIndex = preview.blocks[index + 3];
    const state = preview.palette[paletteIndex];
    if (!state) {
      continue;
    }
    world.addBlock([x, y, z], state.id, state.properties || {});
  }

  return world;
};

const ensureResources = async () => {
  if (!resourcesPromise) {
    // #region debug-point B:resource-load-start
    reportDebugEvent('B', 'webview/main.js:ensureResources:start', '[DEBUG] Starting resource load', {
      resourceBase: config.resourceBase
    });
    // #endregion
    resourcesPromise = loadVsCodeThreeDBlocksResources(config.resourceBase);
  }
  return resourcesPromise;
};

const ensureRenderer = async () => {
  if (!gl) {
    gl = (
      elements.canvas.getContext('webgl2', { antialias: true, alpha: true })
      || elements.canvas.getContext('webgl', { antialias: true, alpha: true })
    );
    // #region debug-point C:webgl-context
    reportDebugEvent('C', 'webview/main.js:ensureRenderer:webgl', '[DEBUG] WebGL context result', {
      hasContext: !!gl,
      contextType: gl instanceof WebGL2RenderingContext ? 'webgl2' : (gl ? 'webgl' : 'none')
    });
    // #endregion
    if (!gl) {
      throw new Error('WebGL is not available in this VS Code webview.');
    }
  }

  if (!renderer) {
    const resources = await ensureResources();
    // #region debug-point B:resource-load-complete
    reportDebugEvent('B', 'webview/main.js:ensureRenderer:resourcesReady', '[DEBUG] Resources loaded before renderer init', {
      hasResources: !!resources
    });
    // #endregion
    renderer = new ThreeDBlocksRenderer(
      gl,
      new BlockWorld([1, 1, 1]),
      resources,
      {
        atlasMipmaps: false,
        deferInitialBuild: true,
        lazyUpload: false,
        maxPixelRatio: 1.25,
        projectionFovDeg: 45,
        versionTag: 'mcstools-vscode-viewer'
      }
    );
  }

  if (!interactiveCanvas) {
    interactiveCanvas = new InteractiveCanvas(
      elements.canvas,
      undefined,
      (view) => {
        const [r, g, b] = getThemeClearColor();
        gl.clearColor(r, g, b, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        renderer.drawStructure(view);
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

const renderPreview = async (preview) => {
  // #region debug-point D:render-preview-start
  reportDebugEvent('D', 'webview/main.js:renderPreview:start', '[DEBUG] renderPreview received preview', {
    fileName: preview.fileName,
    blockCount: preview.stats?.blockCount,
    paletteSize: preview.stats?.paletteSize,
    size: preview.size
  });
  // #endregion
  updateSummary(preview);
  showOverlay('Loading resources', 'Preparing block models and textures.');

  const world = buildWorld(preview);
  // #region debug-point D:world-built
  reportDebugEvent('D', 'webview/main.js:renderPreview:worldBuilt', '[DEBUG] Block world built', {
    worldSize: world.getSize(),
    blockCount: world.getBlocks().length
  });
  // #endregion
  const currentRenderer = await ensureRenderer();

  showOverlay('Meshing structure', 'Building chunk meshes for the preview.');
  await currentRenderer.setStructureProgressiveAsync(world, 5000, undefined, (built, total) => {
    if (total > 0) {
      showOverlay('Meshing structure', `Built ${built}/${total} chunks.`);
    }
  });

  fitCameraToPreview(preview);
  // #region debug-point D:camera-fit
  reportDebugEvent('D', 'webview/main.js:renderPreview:cameraFit', '[DEBUG] Camera fit complete', {
    canvasWidth: elements.canvas.clientWidth,
    canvasHeight: elements.canvas.clientHeight
  });
  // #endregion
  interactiveCanvas?.redraw();
  hideOverlay();
  // #region debug-point D:render-complete
  reportDebugEvent('D', 'webview/main.js:renderPreview:complete', '[DEBUG] Render preview completed', {
    fileName: preview.fileName
  });
  // #endregion

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

  if (message?.type === 'setPreview') {
    const preview = message.previewStr ? JSON.parse(message.previewStr) : message.preview;
    // #region debug-point A:webview-receive-preview
    reportDebugEvent('A', 'webview/main.js:message:setPreview', '[DEBUG] Webview received setPreview', {
      hasPreview: !!preview,
      fileName: preview?.fileName
    });
    // #endregion
    try {
      await renderPreview(preview);
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      // #region debug-point B:webview-render-error
      reportDebugEvent('B', 'webview/main.js:message:setPreview:catch', '[DEBUG] renderPreview failed', {
        message: description
      });
      // #endregion
      showOverlay('Preview failed', description, 'error');
    }
    return;
  }

  if (message?.type === 'setError') {
    // #region debug-point A:webview-receive-error
    reportDebugEvent('A', 'webview/main.js:message:setError', '[DEBUG] Webview received setError', {
      message: message.message || 'Unknown error.'
    });
    // #endregion
    showOverlay('Preview failed', message.message || 'Unknown error.', 'error');
  }
});

// #region debug-point A:webview-boot
reportDebugEvent('A', 'webview/main.js:boot', '[DEBUG] Webview booted', {
  hasAcquireVsCodeApi: !!vscode
});
// #endregion
showOverlay('Waiting for preview', 'Open a .litematic or .schem file to render it here.');

// Signal the extension host that the message listener is registered, so it can
// (re)send the preview. This avoids a race where the preview is posted before
// the webview is listening.
vscode?.postMessage({ type: 'ready' });
