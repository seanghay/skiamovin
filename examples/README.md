# Examples

Run everything from the repository root after building (`npm run build:native && npm run build:ts`). The
examples use Metal and VideoToolbox, so they need macOS.

```sh
examples/make-assets.sh          # generate the media the examples use (needs ffmpeg)
node examples/render-all.ts      # render every numbered example into examples/output/ and time them
npx skiamovin render examples/16-3d-showcase.ts examples/output/16-3d-showcase.mp4   # render one
examples/launch/stills.sh        # take stills from those videos for the launch film
node examples/launch/render.ts   # render the launch film
```

| File | What it shows |
|---|---|
| `01-intro.ts` | SkSL background, spring animation and a timeline |
| `02-lower-third.ts` | A news-style lower third over video |
| `03-kinetic-type.ts` | Animated text |
| `04-bar-chart.ts` | An animated chart |
| `05-shader-gallery.ts` | Several SkSL shaders |
| `06-video-grid.ts` | Four video streams decoded at once |
| `07-audio-visualizer.ts` | Bars driven by the audio |
| `08-logo-reveal.ts` | A logo animation |
| `09-slideshow.ts` | Photos with transitions |
| `10-vertical-social.ts` | A 9:16 video for social media |
| `11-explainer.ts` | A short math explainer: a diagram, a formula, a graph and a camera move |
| `12-product-launch.ts` | Aurora background, a glass card that springs in, a title card and motion blur |
| `13-code-walkthrough.ts` | A code block refactored step by step, with highlighted lines and lower thirds |
| `14-podcast-clip.ts` | A vertical clip with pop captions from WebVTT word timings and bars that follow the audio |
| `15-data-story.ts` | A pipeline diagram drawn on, then a growth curve with a counter |
| `16-3d-showcase.ts` | A ray-marched studio scene, then lit meshes with an extruded star |
| `17-physics-letters.ts` | Letters fall and settle with Rapier, flashing when they land |
| `18-kinetic-poster.ts` | Outlined letters drawn on, a wave of font weight, fit-to-width text and a hand-drawn underline |
| `19-film-gallery.ts` | Photos as 3D cards with a focus pull, handheld drift, a film grade and grain |
| `20-beat-visualizer.ts` | Detected beats pulse radial petals and scattered sparks |
| `21-math-lesson.ts` | A vector field, a formula written on and a camera that zooms to a point |
| `launch/` | A 48-second product film with a generated score |
| `web-studio/` | A Vite app: live preview, editable props and MP4 export in the browser |
