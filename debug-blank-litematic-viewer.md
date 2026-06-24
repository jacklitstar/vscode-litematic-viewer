# Debug Session: blank-litematic-viewer

- Status: OPEN
- Symptom: The VS Code litematic viewer opens but stays blank.
- Expected: Opening a `.litematic` or `.schem` file should render a 3D preview in the webview.
- Scope: `research/McSTools/vscode-litematic-viewer`

## Hypotheses

1. The custom editor loads, but the webview never receives `setPreview` data from the extension host.
2. The webview receives preview data, but resource loading fails before the renderer initializes.
3. The renderer initializes, but WebGL context creation fails in the VS Code webview environment.
4. The structure/world is built, but camera fitting or canvas sizing leaves the scene effectively invisible.
5. The preview parser returns empty or invalid block data for the clicked `.litematic` file.

## Plan

1. Add instrumentation only to the extension host and webview message/render pipeline.
2. Reproduce the issue and collect runtime evidence.
3. Confirm or reject hypotheses from the evidence.
4. Apply the minimal fix only after the evidence identifies the root cause.

## Evidence Notes

- First evidence attempt was invalid because the debug server was interrupted before logs were collected.
- The server is now restarted in a dedicated terminal and the next reproduction should produce a valid `.dbg/trae-debug-log-blank-litematic-viewer.ndjson`.
