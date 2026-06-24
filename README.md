# Minecraft Schematic Viewer

This VS Code extension previews Minecraft `.litematic` and WorldEdit `.schem` files directly in an editor tab.


## Implementation Notes

- The format understanding follows the current parser paths for `.litematic` and `.schem`.
- The 3D rendering uses the bundled `3DBLOCKS` renderer and Minecraft resource data.
- Deprecated viewer code paths are intentionally ignored.

## Behavior

- Clicking a `*.litematic` or `*.schem` file opens a custom read-only preview tab.
- The preview renders the structure in a VS Code webview.
- The sidebar shows dimensions, block counts, palette size, and material counts.
- Saving or changing the file on disk refreshes the preview automatically.

## Build

Run these commands from the extension project folder:

```bash
npm run build
```

This expects the project dependencies to already be installed.

## Packaging Notes

- The extension bundle is emitted to `dist/`.
- Minecraft renderer resources are expected under `resources/minecraft`.

## License

This project is licensed under `AGPL-3.0`.

## Disclaimer

This extension is an independent, unofficial project. It is not affiliated with, endorsed by, sponsored by, or otherwise related to Minecraft®, Mojang Studios, Microsoft, or any of their affiliates.


## Notice

See [NOTICE](file:///C:/Users/Jack/Documents/Github/Prometheus/research/McSTools/vscode-litematic-viewer/NOTICE) for attribution and upstream reference information, including `https://github.com/guapi-exe/McSTools`.
