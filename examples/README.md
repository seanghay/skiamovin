# Examples

Run everything from the repository root after building (`npm run build:native && npm run build:ts`). The
examples use Metal and VideoToolbox, so they need macOS.

```sh
examples/make-assets.sh          # generate the media the examples use (needs ffmpeg)
node examples/render-all.ts      # render the ten examples into examples/output/ and time them
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
| `launch/` | A 48-second product film with a generated score |
| `web-studio/` | A Vite app: live preview, editable props and MP4 export in the browser |
