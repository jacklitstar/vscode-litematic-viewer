# McSTools Litematic Viewer

This VS Code extension previews Minecraft `.litematic` and WorldEdit `.schem` files directly in an editor tab.

## What it reuses from `research/McSTools`

- The format understanding follows the active McSTools parser paths for `.litematic` and `.schem`.
- The 3D rendering uses McSTools' `3DBLOCKS` renderer and Minecraft resource data.
- Deprecated viewer code paths are intentionally ignored.

## Behavior

- Clicking a `*.litematic` or `*.schem` file opens a custom read-only preview tab.
- The preview renders the structure in a VS Code webview.
- The sidebar shows dimensions, block counts, palette size, and material counts.
- Saving or changing the file on disk refreshes the preview automatically.

## Build

Run these commands from `research/McSTools/vscode-litematic-viewer`:

```bash
npm run build
```

This expects the parent `research/McSTools` workspace dependencies to already be installed.

## Packaging Notes

- The extension bundle is emitted to `dist/`.
- Minecraft renderer resources are expected under `resources/minecraft`.
