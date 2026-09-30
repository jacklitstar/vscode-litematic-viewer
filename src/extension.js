import path from 'node:path';
import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { createPreviewData } from './nbtPreview.js';
import { getResourcePacksRoot, getResourcePackSource, listResourcePacks } from './resourcePacks.js';

const VIEW_TYPE = 'minecraftSchematicViewer.viewer';
const DEFAULT_LOCALE = 'en';
const PREVIEW_BLOCK_CHUNK_SIZE = 100_000;
const PREVIEW_PROCESS_FILE_SIZE_THRESHOLD = 1_000_000;
const LOCALE_STRINGS = {
  en: {
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
    readingFile: 'Reading schematic file.',
    parsingStructure: 'Parsing structure data.',
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
    fileDeleted: 'The schematic file was deleted from disk.',
    noActiveFile: 'No active file is available to preview.'
  },
  'zh-cn': {
    editorTitle: '我的世界投影查看器',
    summary: '摘要',
    materials: '材料',
    resourcePacks: '资源包',
    vanillaResourcePack: '原版',
    openResourcePacksFolder: '打开资源包文件夹',
    refreshResourcePacks: '刷新',
    resourcePacksHint: '使用当前文件夹中的 ZIP 或资源包文件夹中的资源包。',
    nearbyPackSearchSkipped: '当前文件夹中的 ZIP 文件超过 1,000 个，已跳过附近 ZIP 搜索。',
    file: '文件',
    size: '尺寸',
    blocks: '方块数量',
    palette: '方块种类',
    regions: '区域',
    noMaterialsLoaded: '尚未加载方块。',
    noNonAirMaterials: '未找到非空气方块。',
    loadingTitle: '加载中…',
    preparingRenderer: '正在准备渲染器。',
    readingFile: '正在读取蓝图文件。',
    parsingStructure: '正在解析结构数据。',
    loadingResourcesTitle: '正在加载资源',
    loadingResourcesMessage: '正在准备方块模型和纹理。',
    meshingTitle: '正在生成网格',
    meshingMessage: '正在为预览构建区块网格。',
    meshingProgress: '已构建 {built}/{total} 个区块。',
    previewFailedTitle: '预览失败',
    unknownError: '未知错误。',
    waitingTitle: '等待预览',
    waitingMessage: '打开 .litematic、.schem、.nbt、.mcstructure 或受支持的 .json 蓝图文件以在此处渲染。',
    webglUnavailable: '此 VS Code Webview 中无法使用 WebGL。',
    fileDeleted: '结构文件已从磁盘中删除。',
    noActiveFile: '当前没有可预览的活动文件。'
  },
  ja: {
    editorTitle: 'Minecraft スキーマティックビューアー',
    summary: '概要',
    materials: '素材',
    resourcePacks: 'リソースパック',
    vanillaResourcePack: 'バニラ',
    openResourcePacksFolder: 'パックフォルダーを開く',
    refreshResourcePacks: '更新',
    resourcePacksHint: 'このファイルと同じフォルダーの ZIP、またはパックフォルダー内のパック。',
    nearbyPackSearchSkipped: 'このフォルダーには 1,000 件を超える ZIP ファイルがあるため、検索を省略しました。',
    file: 'ファイル',
    size: 'サイズ',
    blocks: 'ブロック数',
    palette: 'ブロック種類',
    regions: '領域',
    noMaterialsLoaded: '素材はまだ読み込まれていません。',
    noNonAirMaterials: '空気以外の素材が見つかりません。',
    loadingTitle: '読み込み中…',
    preparingRenderer: 'レンダラーを準備しています。',
    readingFile: '設計図ファイルを読み込んでいます。',
    parsingStructure: '構造データを解析しています。',
    loadingResourcesTitle: 'リソースを読み込み中',
    loadingResourcesMessage: 'ブロックモデルとテクスチャを準備しています。',
    meshingTitle: '構造をメッシュ化中',
    meshingMessage: 'プレビュー用のチャンクメッシュを構築しています。',
    meshingProgress: '{built}/{total} チャンクを構築しました。',
    previewFailedTitle: 'プレビューに失敗しました',
    unknownError: '不明なエラーです。',
    waitingTitle: 'プレビュー待機中',
    waitingMessage: '.litematic、.schem、.nbt、.mcstructure、または対応する .json 設計図ファイルを開くとここに表示されます。',
    webglUnavailable: 'この VS Code Webview では WebGL を利用できません。',
    fileDeleted: 'スキーマティックファイルがディスクから削除されました。',
    noActiveFile: 'プレビューできるアクティブファイルがありません。'
  },
  fr: {
    editorTitle: 'Visionneuse de schémas Minecraft',
    summary: 'Résumé',
    materials: 'Matériaux',
    resourcePacks: 'Pack de ressources',
    vanillaResourcePack: 'Vanilla',
    openResourcePacksFolder: 'Ouvrir le dossier',
    refreshResourcePacks: 'Actualiser',
    resourcePacksHint: 'ZIP à côté du fichier ou packs dans le dossier des packs.',
    nearbyPackSearchSkipped: 'Recherche des ZIP ignorée : ce dossier contient plus de 1 000 fichiers ZIP.',
    file: 'Fichier',
    size: 'Taille',
    blocks: 'Nombre de blocs',
    palette: 'Types de blocs',
    regions: 'Régions',
    noMaterialsLoaded: 'Aucun matériau chargé pour le moment.',
    noNonAirMaterials: 'Aucun matériau non-air trouvé.',
    loadingTitle: 'Chargement…',
    preparingRenderer: 'Préparation du moteur de rendu.',
    readingFile: 'Lecture du fichier de schéma.',
    parsingStructure: 'Analyse des données de structure.',
    loadingResourcesTitle: 'Chargement des ressources',
    loadingResourcesMessage: 'Préparation des modèles de blocs et des textures.',
    meshingTitle: 'Maillage de la structure',
    meshingMessage: 'Construction des maillages de chunks pour l’aperçu.',
    meshingProgress: '{built}/{total} chunks construits.',
    previewFailedTitle: 'Échec de l’aperçu',
    unknownError: 'Erreur inconnue.',
    waitingTitle: 'En attente de l’aperçu',
    waitingMessage: 'Ouvrez un fichier .litematic, .schem, .nbt, .mcstructure ou un schéma .json pris en charge pour l’afficher ici.',
    webglUnavailable: 'WebGL n’est pas disponible dans cette Webview VS Code.',
    fileDeleted: 'Le fichier du schéma a été supprimé du disque.',
    noActiveFile: 'Aucun fichier actif disponible pour l’aperçu.'
  },
  de: {
    editorTitle: 'Minecraft-Schemaanzeige',
    summary: 'Zusammenfassung',
    materials: 'Materialien',
    resourcePacks: 'Ressourcenpaket',
    vanillaResourcePack: 'Vanilla',
    openResourcePacksFolder: 'Paketordner öffnen',
    refreshResourcePacks: 'Aktualisieren',
    resourcePacksHint: 'ZIPs neben dieser Datei oder Pakete im Paketordner.',
    nearbyPackSearchSkipped: 'ZIP-Suche übersprungen: Dieser Ordner enthält mehr als 1.000 ZIP-Dateien.',
    file: 'Datei',
    size: 'Größe',
    blocks: 'Blöcke',
    palette: 'Blöckentypen',
    regions: 'Regionen',
    noMaterialsLoaded: 'Noch keine Materialien geladen.',
    noNonAirMaterials: 'Keine Nicht-Luft-Materialien gefunden.',
    loadingTitle: 'Wird geladen…',
    preparingRenderer: 'Renderer wird vorbereitet.',
    readingFile: 'Schemadatei wird gelesen.',
    parsingStructure: 'Strukturdaten werden analysiert.',
    loadingResourcesTitle: 'Ressourcen werden geladen',
    loadingResourcesMessage: 'Blockmodelle und Texturen werden vorbereitet.',
    meshingTitle: 'Struktur wird vermascht',
    meshingMessage: 'Chunk-Meshes für die Vorschau werden erstellt.',
    meshingProgress: '{built}/{total} Chunks erstellt.',
    previewFailedTitle: 'Vorschau fehlgeschlagen',
    unknownError: 'Unbekannter Fehler.',
    waitingTitle: 'Warten auf Vorschau',
    waitingMessage: 'Öffnen Sie eine .litematic-, .schem-, .nbt-, .mcstructure- oder unterstützte .json-Datei, um sie hier darzustellen.',
    webglUnavailable: 'WebGL ist in dieser VS Code-Webview nicht verfügbar.',
    fileDeleted: 'Die Schemadatei wurde vom Datenträger gelöscht.',
    noActiveFile: 'Keine aktive Datei zur Vorschau verfügbar.'
  },
  es: {
    editorTitle: 'Visor de esquemas de Minecraft',
    summary: 'Resumen',
    materials: 'Materiales',
    resourcePacks: 'Paquete de recursos',
    vanillaResourcePack: 'Original',
    openResourcePacksFolder: 'Abrir carpeta',
    refreshResourcePacks: 'Actualizar',
    resourcePacksHint: 'ZIP junto a este archivo o paquetes en la carpeta de paquetes.',
    nearbyPackSearchSkipped: 'Búsqueda de ZIP omitida: esta carpeta tiene más de 1.000 archivos ZIP.',
    file: 'Archivo',
    size: 'Tamaño',
    blocks: 'Bloques',
    palette: 'Tipos de bloques',
    regions: 'Regiones',
    noMaterialsLoaded: 'Aún no se han cargado materiales.',
    noNonAirMaterials: 'No se encontraron materiales distintos del aire.',
    loadingTitle: 'Cargando…',
    preparingRenderer: 'Preparando el renderizador.',
    readingFile: 'Leyendo el archivo esquemático.',
    parsingStructure: 'Analizando los datos de la estructura.',
    loadingResourcesTitle: 'Cargando recursos',
    loadingResourcesMessage: 'Preparando modelos de bloques y texturas.',
    meshingTitle: 'Generando malla de la estructura',
    meshingMessage: 'Construyendo mallas de chunks para la vista previa.',
    meshingProgress: 'Se han construido {built}/{total} chunks.',
    previewFailedTitle: 'Error en la vista previa',
    unknownError: 'Error desconocido.',
    waitingTitle: 'Esperando vista previa',
    waitingMessage: 'Abre un archivo .litematic, .schem, .nbt, .mcstructure o un esquema .json compatible para renderizarlo aquí.',
    webglUnavailable: 'WebGL no está disponible en esta Webview de VS Code.',
    fileDeleted: 'El archivo esquemático fue eliminado del disco.',
    noActiveFile: 'No hay ningún archivo activo disponible para previsualizar.'
  }
};
const resolveLocaleKey = (language = DEFAULT_LOCALE) => {
  const normalized = String(language || DEFAULT_LOCALE).toLowerCase();
  if (LOCALE_STRINGS[normalized]) {
    return normalized;
  }
  const prefix = normalized.split('-')[0];
  return Object.prototype.hasOwnProperty.call(LOCALE_STRINGS, prefix) ? prefix : DEFAULT_LOCALE;
};
const getLocaleStrings = (language = DEFAULT_LOCALE) => {
  const localeKey = resolveLocaleKey(language);
  return { localeKey, strings: LOCALE_STRINGS[localeKey] || LOCALE_STRINGS[DEFAULT_LOCALE] };
};
const getNonce = () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
};

const killActiveWorker = (worker) => {
  if (!worker) {
    return;
  }
  if (typeof worker.kill === 'function') {
    worker.kill();
    return;
  }
  if (typeof worker.terminate === 'function') {
    worker.terminate().catch(() => {});
  }
};

const startPreviewProcess = (extensionFsPath, fileName) => {
  const processPath = path.join(extensionFsPath, 'src', 'previewProcess.mjs');
  const modulePath = path.join(extensionFsPath, 'src', 'nbtPreview.js');
  const worker = spawn(process.execPath, [processPath], {
    env: {
      ...process.env,
      PREVIEW_FILE_NAME: fileName,
      PREVIEW_MODULE_PATH: modulePath
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';

  worker.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  worker.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const result = new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeAllListeners();
    };

    worker.once('error', (error) => {
      cleanup();
      reject(error);
    });

    worker.once('close', (code) => {
      cleanup();

      if (stdout) {
        try {
          const message = JSON.parse(stdout);
          if (message?.type === 'result') {
            resolve(message.preview);
            return;
          }
          reject(new Error(message?.message || 'Preview worker failed.'));
          return;
        } catch (error) {
          reject(new Error(`Preview worker emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
          return;
        }
      }

      if (code !== 0) {
        reject(new Error(stderr.trim() || `Preview worker exited with code ${code}.`));
        return;
      }

      reject(new Error('Preview worker exited without a result payload.'));
    });
  });

  return { worker, result };
};

class SchematicViewerProvider {
  constructor(context) {
    this.extensionUri = context.extensionUri;
    this.context = context;
    this.resourcePacksRoot = getResourcePacksRoot(context);
    this.packPanelsByFolder = new Map();
  }

  async openResourcePacksFolder() {
    await vscode.workspace.fs.createDirectory(this.resourcePacksRoot);
    await vscode.commands.executeCommand('revealFileInOS', this.resourcePacksRoot);
  }

  async openCustomDocument(uri) {
    return {
      uri,
      dispose() {}
    };
  }

  async resolveCustomEditor(document, webviewPanel, _token) {
    const { localeKey, strings } = getLocaleStrings(vscode.env.language);
    const folderUri = document.uri.with({
      path: path.posix.dirname(document.uri.path),
      query: '',
      fragment: ''
    });
    const folderKey = folderUri.toString();
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'resources'),
        this.resourcePacksRoot,
        folderUri
      ]
    };
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview, localeKey, strings);
    webviewPanel.title = path.basename(document.uri.fsPath);

    const baseName = path.basename(document.uri.fsPath);
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folderUri, baseName)
    );

    let latestPreview = null;
    let isWebviewReady = false;
    let isPanelVisible = webviewPanel.visible;
    let activeLoadPromise = null;
    let activeLoadId = 0;
    let activeWorker = null;
    let pendingStatus = null;
    let disposed = false;
    let packStateRequestId = 0;

    const postResourcePackState = async () => {
      const requestId = ++packStateRequestId;
      try {
        const { packs, nearbySearchSkipped } = await listResourcePacks(this.resourcePacksRoot, folderUri);
        const savedId = this.context.globalState.get(`resourcePack:${folderKey}`, '');
        const selectedPack = packs.find((pack) => pack.id === savedId)
          || packs.find((pack) => pack.origin === 'storage' && pack.name === savedId);
        const source = selectedPack
          ? await getResourcePackSource(selectedPack, webviewPanel.webview)
          : null;
        if (disposed || requestId !== packStateRequestId) {
          return;
        }
        await webviewPanel.webview.postMessage({
          type: 'resourcePacks',
          packs: packs.map(({ id, name, kind, origin, description }) => ({ id, name, kind, origin, description })),
          selectedId: selectedPack?.id || '',
          source,
          nearbySearchSkipped,
          folderPath: this.resourcePacksRoot.fsPath
        });
      } catch (error) {
        if (disposed || requestId !== packStateRequestId) {
          return;
        }
        await webviewPanel.webview.postMessage({
          type: 'resourcePacks',
          packs: [],
          selectedId: '',
          source: null,
          folderPath: this.resourcePacksRoot.fsPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    const folderPanels = this.packPanelsByFolder.get(folderKey) || new Set();
    folderPanels.add(postResourcePackState);
    this.packPanelsByFolder.set(folderKey, folderPanels);

    const postStatus = async (title, message) => {
      pendingStatus = { title, message };

      if (!isWebviewReady || disposed || !isPanelVisible) {
        return;
      }

      await webviewPanel.webview.postMessage({
        type: 'setStatus',
        title,
        message
      });
    };

    const postPreviewChunks = async (preview, loadId) => {
      if (!isWebviewReady || disposed || !isPanelVisible || loadId !== activeLoadId) {
        return;
      }

      const { blocks, ...previewMeta } = preview;
      const totalBlocks = Array.isArray(blocks) ? blocks.length : 0;
      const totalChunks = Math.max(1, Math.ceil(totalBlocks / PREVIEW_BLOCK_CHUNK_SIZE));

      await webviewPanel.webview.postMessage({
        type: 'previewStart',
        requestId: loadId,
        preview: previewMeta,
        totalBlocks,
        totalChunks
      });

      for (let offset = 0, chunkIndex = 0; offset < totalBlocks; offset += PREVIEW_BLOCK_CHUNK_SIZE, chunkIndex += 1) {
        if (disposed || loadId !== activeLoadId) {
          return;
        }

        await webviewPanel.webview.postMessage({
          type: 'previewChunk',
          requestId: loadId,
          chunkIndex,
          totalChunks,
          blocks: blocks.slice(offset, offset + PREVIEW_BLOCK_CHUNK_SIZE)
        });
      }

      if (disposed || loadId !== activeLoadId) {
        return;
      }

      await webviewPanel.webview.postMessage({
        type: 'previewEnd',
        requestId: loadId
      });
    };

    const cancelActiveLoad = () => {
      activeLoadId += 1;
      if (activeWorker) {
        killActiveWorker(activeWorker);
        activeWorker = null;
      }
      activeLoadPromise = null;
    };

    const postPreview = async () => {
      const loadId = ++activeLoadId;
      latestPreview = null;

      if (activeWorker) {
        killActiveWorker(activeWorker);
        activeWorker = null;
      }

      try {
        await postStatus(strings.loadingTitle, strings.readingFile);
        const bytes = await vscode.workspace.fs.readFile(document.uri);
        if (disposed || !isPanelVisible || loadId !== activeLoadId) {
          return;
        }
        await postStatus(strings.loadingTitle, strings.parsingStructure);
        const preview = await (bytes.byteLength > PREVIEW_PROCESS_FILE_SIZE_THRESHOLD
          ? (() => {
              const workerJob = startPreviewProcess(this.extensionUri.fsPath, document.uri.fsPath);
              activeWorker = workerJob.worker;
              return workerJob.result;
            })()
          : createPreviewData(document.uri.fsPath, bytes));
        if (disposed || loadId !== activeLoadId) {
          killActiveWorker(activeWorker);
          activeWorker = null;
          return;
        }

        killActiveWorker(activeWorker);
        activeWorker = null;
        webviewPanel.title = preview.fileName;
        latestPreview = preview;
        pendingStatus = null;
        await postPreviewChunks(preview, loadId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (disposed || loadId !== activeLoadId) {
          return;
        }

        latestPreview = null;
        killActiveWorker(activeWorker);
        activeWorker = null;
        pendingStatus = null;
        await webviewPanel.webview.postMessage({
          type: 'setError',
          message
        });
      } finally {
        if (loadId === activeLoadId) {
          activeLoadPromise = null;
        }
      }
    };

    const ensurePreviewPosted = () => {
      if (activeLoadPromise) {
        return activeLoadPromise;
      }
      activeLoadPromise = postPreview();
      return activeLoadPromise;
    };

    watcher.onDidChange(() => {
      void ensurePreviewPosted();
    });
    watcher.onDidCreate(() => {
      void ensurePreviewPosted();
    });
    watcher.onDidDelete(async () => {
      latestPreview = null;
      await webviewPanel.webview.postMessage({
        type: 'setError',
        message: strings.fileDeleted
      });
    });

    webviewPanel.onDidChangeViewState((event) => {
      isPanelVisible = event.webviewPanel.visible;
      if (!isWebviewReady || disposed) {
        return;
      }

      void webviewPanel.webview.postMessage({
        type: 'setVisibility',
        visible: isPanelVisible
      });

      if (!isPanelVisible) {
        cancelActiveLoad();
        return;
      }

      if (pendingStatus) {
        void postStatus(pendingStatus.title, pendingStatus.message);
      } else if (latestPreview === null) {
        void ensurePreviewPosted();
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      cancelActiveLoad();
      watcher.dispose();
      folderPanels.delete(postResourcePackState);
      if (folderPanels.size === 0) {
        this.packPanelsByFolder.delete(folderKey);
      }
    });

    webviewPanel.webview.onDidReceiveMessage((message) => {
      if (message.type === 'ready') {
        isWebviewReady = true;
        void postResourcePackState();
        void webviewPanel.webview.postMessage({
          type: 'setVisibility',
          visible: isPanelVisible
        });
        if (latestPreview !== null) {
          void postPreviewChunks(latestPreview, activeLoadId);
        } else if (pendingStatus) {
          void postStatus(pendingStatus.title, pendingStatus.message);
        } else if (!activeLoadPromise) {
          void ensurePreviewPosted();
        }
      } else if (message.type === 'selectResourcePack') {
        void (async () => {
          const { packs } = await listResourcePacks(this.resourcePacksRoot, folderUri);
          const requestedId = typeof message.id === 'string' ? message.id : '';
          if (requestedId && !packs.some((pack) => pack.id === requestedId)) {
            await postResourcePackState();
            return;
          }
          await this.context.globalState.update(`resourcePack:${folderKey}`, requestedId);
          for (const updatePanel of folderPanels) {
            void updatePanel();
          }
        })().catch((error) => {
          vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
          void postResourcePackState();
        });
      } else if (message.type === 'refreshResourcePacks') {
        for (const updatePanel of folderPanels) {
          void updatePanel();
        }
      } else if (message.type === 'openResourcePacksFolder') {
        void this.openResourcePacksFolder().catch((error) => {
          vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        });
      }
    });

    void ensurePreviewPosted();
  }

  getHtml(webview, localeKey, strings) {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'viewer.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'viewer.css')
    );
    const resourceBase = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources')
    );

    return `<!DOCTYPE html>
<html lang="${localeKey}">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource} http://127.0.0.1:7777; font-src ${webview.cspSource};"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>${strings.editorTitle}</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}">
      window.__MINECRAFT_SCHEMATIC_VIEWER_CONFIG = {
        resourceBase: ${JSON.stringify(resourceBase.toString())},
        locale: ${JSON.stringify(localeKey)},
        strings: ${JSON.stringify(strings)}
      };
      try {
        const vscode = acquireVsCodeApi();
        window.__MINECRAFT_SCHEMATIC_VIEWER_VSCODE_API = vscode;
      } catch (e) {}
    </script>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

export function activate(context) {
  const provider = new SchematicViewerProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minecraftSchematicViewer.openActiveFile', async () => {
      const activeUri = vscode.window.activeTextEditor?.document?.uri;
      if (!activeUri) {
        const { strings } = getLocaleStrings(vscode.env.language);
        vscode.window.showInformationMessage(strings.noActiveFile);
        return;
      }

      await vscode.commands.executeCommand('vscode.openWith', activeUri, VIEW_TYPE);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minecraftSchematicViewer.openResourcePacksFolder', () =>
      provider.openResourcePacksFolder())
  );
}

export function deactivate() {}
