# Implementation status

This page tracks what the current build implements versus what the rest of the docs describe as the target
design. Everything listed as **implemented** is covered by the test suite (`npm test`). What comes next is in the [roadmap](roadmap.md).

## Implemented

| Area | Notes |
|---|---|
| Core Skia bindings (`skiamovin`) | About 330 functions generated from one Rust definition: surfaces, canvas, paint, paths and path ops, contour measure, images and codecs (incl. animated GIF/WebP frames), gradients and noise, SkSL runtime effects (shaders, color filters, blenders), image/color/mask filters, path effects, blenders, fonts, text blobs, SkParagraph, SVG, pictures, PDF |
| Node build | Native addon, built and tested in CI for macOS arm64, Linux x64 and arm64, and Windows x64. On Linux and Windows it draws on the CPU |
| Web build | WebAssembly (emscripten), single-threaded, 12.9 MB of WASM, 3.8 MB with Brotli (built for size; includes Rapier and RaTeX) |
| GPU | **Metal** on Node (macOS), **WebGL2** in the browser, CPU raster everywhere |
| Native codecs on Node | VideoToolbox H.264/HEVC encode and decode (hardware), HEVC with alpha; AudioToolbox AAC encode, AAC and MP3 decode. All registered with Mediabunny's custom coder API |
| `skiamovin/media` | `registerNativeCodecs`, `SurfaceSource`, `ImageSink`, `videoSampleFromSurface`, `videoSampleFromImage`, `imageFromVideoSample` |
| `skiamovin/taffy` | `TaffyTree` with Flexbox, Grid (incl. `repeat()`, `minmax()`, `fr`, spans, template areas) and Block; JS measure functions |
| `skiamovin/scene` | `Composition`, `CompositionModule`, all nodes except `lottie`, assets from Mediabunny `Source`s, `interpolate`, `interpolateColor`, `spring`, `Easing`, `Timeline`, `random`, `noise`, `Render` (incl. multi-worker `concurrency` on Node and in the browser), `CompositionSink`, `CompositionAudioSink`, `analyzeAudio`, `Player` |
| Animation helpers | `stagger`, `keyframes`, `wiggle`, `loopTime`; easing including `smooth`, `piecewise`, `custom` (from an SVG path) and `irregular`; timelines with percent offsets, repeat, yoyo, `timeScale`, keyframes, nesting and `all`/`chain`/`sequence`/`delay`; named `events` on compositions |
| Physics-based motion | SwiftUI-style springs (`response`, `bounce`, presets), starting speed, retargeting (`springPath`), momentum (`decay`, `fling` with snapping and edges), `rubberBand`, `fall`, scripted gestures and ready-made iOS motions |
| Transitions | `transition()` and `series` transitions from gl-transitions (all 214 compile and render), `listTransitions()` with parameters and licenses |
| Effects and glass | `effects` (`grain`, `glow`, `vignette`, `chromaticAberration`, `halftone`, `pixelate`, `sharpen`), `glass` on any node, `backgrounds` presets (`mesh`, `aurora`, `noise`, `dots`, `grid`) |
| Compositing | Alpha and luminance mattes (with inverted modes), `clipTo` clipping masks, `adjustmentLayer`, `isolate`, Photoshop-style `layerStyle`, text `warp` and `Path.warp` |
| Utility classes | A `class` prop on every node with Tailwind-style utilities and Tailwind's default theme; `tw()`, `tailwindTheme` |
| Color grading | `grade` on any node: `lut` (`.cube`, LUT images, Hald; tetrahedral, checked against ffmpeg), `adjust`, `curves`, `levels`, `gradeWheels`, `cdl`, `gradientMap`, `channelMixer`, `posterize`, `threshold`, `blendGrades`, each with `strength` |
| Layout motion | `layoutId` layout animation and shared elements (pure in time), `states()`, sequence `exit` and `time`, video `speed` ramps, `Composition.withSize()` |
| 2D physics | `physics()` with Rapier in the Rust core: bodies, joints, contacts, simulated once and looked up by time; identical on Node and WebAssembly |
| Math | `math()`: LaTeX typeset in Rust with RaTeX and the KaTeX fonts (OFL), pixel-identical across builds, with a `write` draw-on animation |
| Graphs and camera | `axes()`, `plot`, `numberLine()`, `vectorField`, a panning and zooming `camera()`, and `create`, `fadeIn` and `indicate` reveals |
| Diagrams | `diagram()`: Mermaid laid out by Pele, measured with the composition's fonts and drawn as scene nodes, with themes, a draw-on reveal and styles by id; same on Node and WebAssembly |
| Code blocks | `code()`: Shiki highlighting with VS Code themes, line numbers, line highlights, and animation between versions token by token |
| Captions | `captions()` with subtitle, karaoke, pop and word presets; `parseCaptions()` for SRT and WebVTT with word timings; `cuesFromWords()` for speech recognition output |
| Type as shapes | `textPaths()` per character, word or line; `variableText()` with font axes per character; `fitText()` to fill a width with a variable axis |
| Rhythm and MIDI | `analyzeAudio()` also finds onsets, tempo and beats (steady tempo); `pulse()` and `beatAt()`; `parseMidi()` for Standard MIDI Files with tempo changes |
| Motion blur | `motionBlur: { shutter, samples }` on a composition: averages moments within the shutter in half-float linear light |
| Film camera | `shot()` sizes with rule-of-thirds placement, `cameraMove()`, `handheld()`, `edit()` between cameras, and 'dissolve', 'fade' and 'wipe' transition names |
| Loudness and delivery | `audio.loudness` in `Render` normalizes the mix to a LUFS target (BS.1770 / EBU R128, gated); `deliveryPresets` for YouTube, Instagram, TikTok and broadcast |
| Sound mix | Audio roles (dialogue, music, effects); music ducks under dialogue clips; stems by role in `Render` and `CompositionAudioSink` |
| Hand-drawn strokes | `stroke()`: variable-width, tapered strokes from points with pressure or along a path, drawn on over time |
| Scattering | `scatter()` in an area, along a path or on a grid, seeded; `lookAt()` |
| 3D space | `space3d()`: flat nodes with 3D placement and a perspective camera, sorted back to front, with backface hiding and camera angle presets; `transform: { matrix }` |
| 3D meshes | `meshScene()` with boxes, spheres, tori and extruded shapes, lit with a highlight, back-face culled and sorted back to front, or drawn with a CPU depth buffer (`depth: true`) |
| Ray-marched 3D | `sdfScene()`: spheres, boxes, tori, capsules and floors in generated SkSL, with soft shadows, ambient occlusion, fog and smooth blending |
| Keyframes and actions | `curve()` with Bézier handles, `strips()` for actions placed on a timeline, `shapeKeys()` |
| Modifiers and drawing | `modify()` with repeat, mirror, round corners, offset, noise and wave; `hold()` for animating on twos; `radial()` symmetry; `cleanShape()` |
| Looks and titles | `softShadow()`, `looks` grade presets (golden hour, blue hour, polarizer, film and more), `titleCard()`, `lowerThird()`, `credits()` |
| Paths | `path()` nodes with stroke, fill, trimming by length and arrowheads; `morphPath`; `alongPath` |
| Animated text | `split` text by characters, words or lines; `textAnimator` range selectors; `scramble`, `counter`, `graphemeCount` |
| Same output on Node and the web | Text is drawn from glyph outlines by default; `test/golden.test.ts` checks shapes, paths and layout match exactly between the Node addon and WebAssembly, and text and shaders within 4/255 |
| Audio | Mixing of `audio()` and `video()` sources, trims, loops, playback rate, volume automation, soft limiter |
| Web Workers in the browser | `serveComposition()` serves a composition from a worker. `Player` previews and `Render` exports run there (`worker` option); `Render` can split an export across several workers (`concurrency`) |
| GPU frames in the browser | Frames stay on the GPU from drawing to the encoder (`Render`) or the screen (`Player`) |
| GPU frames on macOS | Frames stay on the GPU from drawing to the hardware encoder, and decoded video goes straight to the GPU. Drawing the next frame overlaps encoding the last one |

## Not yet implemented

| Area | Status |
|---|---|
| GPU on Linux and Windows (Vulkan, D3D12), Graphite, WebGPU | `gpu.directContexts.makeVulkan()` / `makeD3D()` return `null` (or throw with `strict`). The web build uses WebGL2 |
| Video codecs on Node outside macOS, and software codecs (VP8/VP9/AV1/OpenH264, Opus) | Not bundled. On Node, MP4/MOV with H.264/HEVC + AAC works; WebM output needs a browser |
| Skottie / `lottie()` / `LottieAsset` | The prebuilt Skia binaries for macOS and WebAssembly don't include Skottie. `LottieAsset` throws a clear error |
| Threaded WASM build | Only the single-threaded build exists |
| Bundled fallback fonts on the web | The web font manager is empty. Load fonts with `FontAsset` (or `FontMgr.newFromData`) |
| `calc()` in Taffy styles | Not supported |
| `npx skiamovin` CLI | Not implemented |
| HDR output | The working color space can be set, but frames are encoded as 8-bit BT.709 |
| `textlayout.Paragraph.updateForegroundPaint` / `updateFontSize`, `svg` node lookup by id | Not available in this `skia-safe` version. For SVG, use the scene layer's `attributes` override |

## Known limitations

- **WebAssembly and corrupt PNGs.** The prebuilt Skia's libpng reports decode errors with `longjmp`, and the
  build links it in emscripten setjmp mode with `panic=abort`. Corrupt PNG data may abort the module instead of
  throwing.
- **Bold text without a bold font.** `fontWeight: 'bold'` only changes the result when a bold face (or a
  variable font with a `wght` axis) is registered. There's no synthetic bold.
