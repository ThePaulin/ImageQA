# Image QA

A free image editor that runs both removal tools in your browser using ONNX Runtime Web and WebAssembly. [LocalRemove](https://localremove.com/editor) inspired the two-tool workflow.

## Run locally

Requires Node.js 20.19+ on the 20.x line, or Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open the address printed by Vite. Initial setup downloads and verifies about 67 MB of model weights in `public/models/`. Once the dependencies and models are installed, the local editor can run without internet access.

- Open a JPG, PNG, or WebP, drop one onto the canvas, or try the bundled balloon photo. The editor accepts files up to 30 MB and 24 megapixels, with a maximum of 12,000 pixels per side.
- For **Remove watermark**, brush over the entire mark with a little margin, then run the tool. The sample has a white **SAMPLE** mark in the lower-right sky. To paint with the keyboard, focus the image, move the brush with the arrow keys, and press Space to paint.
- For **Remove background**, run the tool to isolate the main subject. You can run both tools on the same image.
- Use **Original** and **Result** to compare, then select **Download PNG** to export at the original dimensions with transparency preserved.

## Models and privacy

- **Watermark removal** uses the 62 MB [512 × 512 quantized LaMa export](https://huggingface.co/g-ronimo/lama) to fill the painted region from nearby pixels. The brush selects the region manually.
- **Background removal** uses the 4.6 MB [U²-Net Lite export](https://huggingface.co/nfa04/u2netp-onnx) to produce an alpha matte. Fine edges can be soft because inference runs at 320 × 320.

A browser worker handles inference. Files, brush strokes, and edits stay in tab memory. The app uses no analytics, accounts, remote inference, upload endpoint, or persistent image storage. Fonts, the sample, WASM, and model weights are served alongside the app. Only the tools’ model files load on demand, and the active model session is reused until you run a different tool or close the tab.

Run `npm run build` to produce the standalone static site in `dist/` and `npm run preview` to serve it locally. Serve it over HTTPS or localhost. For multithreaded WASM, use `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` as in the local configuration. Without cross-origin isolation, the app uses one WASM thread.

See [third-party model notices](public/models/NOTICE.txt).

## Bundled sample

[Balloon photo](public/assets/balloon.jpg), generated with the built-in ImageGen tool. Image QA draws the removable `SAMPLE` mark when opening the photo.

> Generate one landscape 3:2 photographic image for a sample in an image editor. A single large sunny burnt-orange and ochre striped hot-air balloon with a small wicker basket, clearly isolated against a pale powder-blue sky, over a low horizon of muted lavender desert ridges and golden sandy terrain. Editorial travel photography, natural warm morning light and fine details. Center the balloon, with the envelope filling about half of the image height, and with plenty of distinct blue sky around it. Keep the lower right area visually quiet so the app can draw a sample watermark there. No text, no logos, no other balloons.
