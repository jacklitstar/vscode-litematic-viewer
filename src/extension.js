import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { createPreviewData } from './nbtPreview.js';

const VIEW_TYPE = 'minecraftSchematicViewer.viewer';
const DEBUG_ENV_PATH = '.dbg/blank-litematic-viewer.env';
const DEFAULT_LOCALE = 'en';
const LOCALE_STRINGS = {
  en: {
    editorTitle: 'Minecraft Schematic Viewer',
    summary: 'Summary',
    materials: 'Materials',
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
    waitingMessage: 'Open a .litematic or .schem file to render it here.',
    webglUnavailable: 'WebGL is not available in this VS Code webview.',
    fileDeleted: 'The schematic file was deleted from disk.',
    noActiveFile: 'No active file is available to preview.'
  },
  'zh-cn': {
    editorTitle: '我的世界投影查看器',
    summary: '摘要',
    materials: '材料',
    file: '文件',
    size: '尺寸',
    blocks: '方块数量',
    palette: '方块种类',
    regions: '区域',
    noMaterialsLoaded: '尚未加载方块。',
    noNonAirMaterials: '未找到非空气方块。',
    loadingTitle: '加载中…',
    preparingRenderer: '正在准备渲染器。',
    loadingResourcesTitle: '正在加载资源',
    loadingResourcesMessage: '正在准备方块模型和纹理。',
    meshingTitle: '正在生成网格',
    meshingMessage: '正在为预览构建区块网格。',
    meshingProgress: '已构建 {built}/{total} 个区块。',
    previewFailedTitle: '预览失败',
    unknownError: '未知错误。',
    waitingTitle: '等待预览',
    waitingMessage: '打开 .litematic 或 .schem 文件以在此处渲染。',
    webglUnavailable: '此 VS Code Webview 中无法使用 WebGL。',
    fileDeleted: '结构文件已从磁盘中删除。',
    noActiveFile: '当前没有可预览的活动文件。'
  },
  ja: {
    editorTitle: 'Minecraft スキーマティックビューアー',
    summary: '概要',
    materials: '素材',
    file: 'ファイル',
    size: 'サイズ',
    blocks: 'ブロック数',
    palette: 'ブロック種類',
    regions: '領域',
    noMaterialsLoaded: '素材はまだ読み込まれていません。',
    noNonAirMaterials: '空気以外の素材が見つかりません。',
    loadingTitle: '読み込み中…',
    preparingRenderer: 'レンダラーを準備しています。',
    loadingResourcesTitle: 'リソースを読み込み中',
    loadingResourcesMessage: 'ブロックモデルとテクスチャを準備しています。',
    meshingTitle: '構造をメッシュ化中',
    meshingMessage: 'プレビュー用のチャンクメッシュを構築しています。',
    meshingProgress: '{built}/{total} チャンクを構築しました。',
    previewFailedTitle: 'プレビューに失敗しました',
    unknownError: '不明なエラーです。',
    waitingTitle: 'プレビュー待機中',
    waitingMessage: '.litematic または .schem ファイルを開くとここに表示されます。',
    webglUnavailable: 'この VS Code Webview では WebGL を利用できません。',
    fileDeleted: 'スキーマティックファイルがディスクから削除されました。',
    noActiveFile: 'プレビューできるアクティブファイルがありません。'
  },
  fr: {
    editorTitle: 'Visionneuse de schémas Minecraft',
    summary: 'Résumé',
    materials: 'Matériaux',
    file: 'Fichier',
    size: 'Taille',
    blocks: 'Nombre de blocs',
    palette: 'Types de blocs',
    regions: 'Régions',
    noMaterialsLoaded: 'Aucun matériau chargé pour le moment.',
    noNonAirMaterials: 'Aucun matériau non-air trouvé.',
    loadingTitle: 'Chargement…',
    preparingRenderer: 'Préparation du moteur de rendu.',
    loadingResourcesTitle: 'Chargement des ressources',
    loadingResourcesMessage: 'Préparation des modèles de blocs et des textures.',
    meshingTitle: 'Maillage de la structure',
    meshingMessage: 'Construction des maillages de chunks pour l’aperçu.',
    meshingProgress: '{built}/{total} chunks construits.',
    previewFailedTitle: 'Échec de l’aperçu',
    unknownError: 'Erreur inconnue.',
    waitingTitle: 'En attente de l’aperçu',
    waitingMessage: 'Ouvrez un fichier .litematic ou .schem pour l’afficher ici.',
    webglUnavailable: 'WebGL n’est pas disponible dans cette Webview VS Code.',
    fileDeleted: 'Le fichier du schéma a été supprimé du disque.',
    noActiveFile: 'Aucun fichier actif disponible pour l’aperçu.'
  },
  de: {
    editorTitle: 'Minecraft-Schemaanzeige',
    summary: 'Zusammenfassung',
    materials: 'Materialien',
    file: 'Datei',
    size: 'Größe',
    blocks: 'Blöcke',
    palette: 'Blöckentypen',
    regions: 'Regionen',
    noMaterialsLoaded: 'Noch keine Materialien geladen.',
    noNonAirMaterials: 'Keine Nicht-Luft-Materialien gefunden.',
    loadingTitle: 'Wird geladen…',
    preparingRenderer: 'Renderer wird vorbereitet.',
    loadingResourcesTitle: 'Ressourcen werden geladen',
    loadingResourcesMessage: 'Blockmodelle und Texturen werden vorbereitet.',
    meshingTitle: 'Struktur wird vermascht',
    meshingMessage: 'Chunk-Meshes für die Vorschau werden erstellt.',
    meshingProgress: '{built}/{total} Chunks erstellt.',
    previewFailedTitle: 'Vorschau fehlgeschlagen',
    unknownError: 'Unbekannter Fehler.',
    waitingTitle: 'Warten auf Vorschau',
    waitingMessage: 'Öffnen Sie eine .litematic- oder .schem-Datei, um sie hier darzustellen.',
    webglUnavailable: 'WebGL ist in dieser VS Code-Webview nicht verfügbar.',
    fileDeleted: 'Die Schemadatei wurde vom Datenträger gelöscht.',
    noActiveFile: 'Keine aktive Datei zur Vorschau verfügbar.'
  },
  es: {
    editorTitle: 'Visor de esquemas de Minecraft',
    summary: 'Resumen',
    materials: 'Materiales',
    file: 'Archivo',
    size: 'Tamaño',
    blocks: 'Bloques',
    palette: 'Tipos de bloques',
    regions: 'Regiones',
    noMaterialsLoaded: 'Aún no se han cargado materiales.',
    noNonAirMaterials: 'No se encontraron materiales distintos del aire.',
    loadingTitle: 'Cargando…',
    preparingRenderer: 'Preparando el renderizador.',
    loadingResourcesTitle: 'Cargando recursos',
    loadingResourcesMessage: 'Preparando modelos de bloques y texturas.',
    meshingTitle: 'Generando malla de la estructura',
    meshingMessage: 'Construyendo mallas de chunks para la vista previa.',
    meshingProgress: 'Se han construido {built}/{total} chunks.',
    previewFailedTitle: 'Error en la vista previa',
    unknownError: 'Error desconocido.',
    waitingTitle: 'Esperando vista previa',
    waitingMessage: 'Abre un archivo .litematic o .schem para renderizarlo aquí.',
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
const reportDebugEvent = (hypothesisId, location, msg, data = {}) => {
  let url = 'http://127.0.0.1:7777/event';
  let sessionId = 'blank-litematic-viewer';
  try {
    const env = fs.readFileSync(DEBUG_ENV_PATH, 'utf8');
    url = env.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || url;
    sessionId = env.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || sessionId;
  } catch {}
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, runId: 'pre-fix', hypothesisId, location, msg, data, ts: Date.now() })
  }).catch(() => {});
};

const getNonce = () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
};

class SchematicViewerProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
  }

  async openCustomDocument(uri) {
    return {
      uri,
      dispose() {}
    };
  }

  async resolveCustomEditor(document, webviewPanel, _token) {
    const { localeKey, strings } = getLocaleStrings(vscode.env.language);
    // #region debug-point A:resolve-custom-editor
    reportDebugEvent('A', 'src/extension.js:resolveCustomEditor', '[DEBUG] resolveCustomEditor called', {
      fsPath: document.uri.fsPath,
      viewType: VIEW_TYPE
    });
    // #endregion
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'resources')
      ]
    };
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview, localeKey, strings);
    webviewPanel.title = path.basename(document.uri.fsPath);

    const baseName = path.basename(document.uri.fsPath);
    const folderUri = vscode.Uri.file(path.dirname(document.uri.fsPath));
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folderUri, baseName)
    );

    let latestPreviewStr = null;

    const postPreview = async () => {
      try {
        // #region debug-point A:read-file
        reportDebugEvent('A', 'src/extension.js:postPreview:beforeRead', '[DEBUG] Reading schematic file', {
          fsPath: document.uri.fsPath
        });
        // #endregion
        const bytes = await vscode.workspace.fs.readFile(document.uri);
        // #region debug-point A:read-file-complete
        reportDebugEvent('A', 'src/extension.js:postPreview:afterRead', '[DEBUG] Schematic file read complete', {
          byteLength: bytes.length
        });
        // #endregion
        const preview = await createPreviewData(document.uri.fsPath, bytes);
        // #region debug-point E:preview-created
        reportDebugEvent('E', 'src/extension.js:postPreview:previewCreated', '[DEBUG] Preview data created', {
          format: preview.format,
          blockCount: preview.stats?.blockCount,
          paletteSize: preview.stats?.paletteSize,
          size: preview.size
        });
        // #endregion
        webviewPanel.title = preview.fileName;
        // #region debug-point A:post-message-start
        reportDebugEvent('A', 'src/extension.js:postPreview:postMessageStart', '[DEBUG] Sending preview to webview', {
          fileName: preview.fileName
        });
        // #endregion
        const safePreview = JSON.stringify(preview);
        latestPreviewStr = safePreview;
        webviewPanel.webview.postMessage({
          type: 'setPreview',
          previewStr: safePreview
        });
        // #region debug-point A:post-message
        reportDebugEvent('A', 'src/extension.js:postPreview:postMessage', '[DEBUG] Preview posted to webview', {
          type: 'setPreview',
          fileName: preview.fileName
        });
        // #endregion
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // #region debug-point E:preview-error
        reportDebugEvent('E', 'src/extension.js:postPreview:catch', '[DEBUG] Preview generation failed', {
          message
        });
        // #endregion
        latestPreviewStr = null;
        webviewPanel.webview.postMessage({
          type: 'setError',
          message
        });
      }
    };

    watcher.onDidChange(postPreview);
    watcher.onDidCreate(postPreview);
    watcher.onDidDelete(async () => {
      await webviewPanel.webview.postMessage({
        type: 'setError',
        message: strings.fileDeleted
      });
    });

    webviewPanel.onDidDispose(() => watcher.dispose());

    webviewPanel.webview.onDidReceiveMessage((message) => {
      if (message.type === 'debugEvent') {
        reportDebugEvent(message.hypothesisId, message.location, message.msg, message.data);
        return;
      }
      if (message.type === 'ready') {
        // The webview has registered its message listener; (re)send the preview.
        if (latestPreviewStr !== null) {
          webviewPanel.webview.postMessage({
            type: 'setPreview',
            previewStr: latestPreviewStr
          });
        } else {
          postPreview();
        }
      }
    });

    // Do not await: postMessage only resolves once the webview is listening, so
    // awaiting here would block resolveCustomEditor and leave the native editor
    // stuck on its loading indicator. The 'ready' handshake delivers the preview.
    postPreview();
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
        vscode.postMessage({ type: 'debugEvent', hypothesisId: 'A', location: 'html', msg: '[DEBUG] Inline script executed' });
      } catch (e) {}
    </script>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

export function activate(context) {
  const provider = new SchematicViewerProvider(context.extensionUri);

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
}

export function deactivate() {}
