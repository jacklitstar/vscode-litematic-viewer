import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { createPreviewData } from './nbtPreview.js';

const VIEW_TYPE = 'mcstools.schematicViewer';
const DEBUG_ENV_PATH = '.dbg/blank-litematic-viewer.env';
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
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);
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
        message: 'The schematic file was deleted from disk.'
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

  getHtml(webview) {
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
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource} http://127.0.0.1:7777; font-src ${webview.cspSource};"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>McSTools Schematic Viewer</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}">
      window.__MCSTOOLS_VIEWER_CONFIG = {
        resourceBase: ${JSON.stringify(resourceBase.toString())}
      };
      try {
        const vscode = acquireVsCodeApi();
        window.__MCSTOOLS_VSCODE_API = vscode;
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
    vscode.commands.registerCommand('mcstools.schematicViewer.openActiveFile', async () => {
      const activeUri = vscode.window.activeTextEditor?.document?.uri;
      if (!activeUri) {
        vscode.window.showInformationMessage('No active file is available to preview.');
        return;
      }

      await vscode.commands.executeCommand('vscode.openWith', activeUri, VIEW_TYPE);
    })
  );
}

export function deactivate() {}
