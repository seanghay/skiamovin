# Skiamovin Studio (Vite example)

A small editor: live preview, editable props, and MP4 export, all rendered with Skiamovin in Web Workers.

```sh
npm install
npm run dev          # http://localhost:5173
npm run build && npm run preview
node e2e.mjs preview # headless Chrome check: preview, prop edits, playback, 1080p export (or `dev`)
```

| File | What it does |
|---|---|
| `src/promo.ts` | The composition: SkSL aurora background, spring-animated title, particles. Props: title, subtitle, accent, particles |
| `src/promo.worker.ts` | `serveComposition(promo)`: renders previews and exports off the main thread |
| `src/main.ts` | `Player` for the preview, `Render` for the export, both given the same worker factory |
| `vite.config.ts` | `optimizeDeps.exclude: ['skiamovin']` and `worker.format: 'es'` are what an app needs. `fs.allow` and `dedupe` are only there because this example links the package from the repo |

Fonts are Inter (SIL Open Font License), from `@expo-google-fonts/inter`.
