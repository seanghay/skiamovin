# Roadmap

This is the plan for what comes next. Nothing here is implemented yet; see [status](status.md) for what works
today. The ideas come from tools people already love for motion work: animation libraries, Apple's interfaces,
editors like After Effects, Photoshop and DaVinci Resolve, and open projects like Blender and Manim. For most of them the
valuable part is a page of math or a small file format, which we can write once and test. We copy code only when
the license allows it, as listed at the end.

## Ground rules

Every feature on this list follows these rules:

- **A frame is a function of time.** Any frame can be rendered on its own, in any order, in any worker. Tools
  like GSAP and Motion Canvas run animations live or replay them from the start; we compute every value from
  the timestamp instead.
- **No hidden clocks.** No `Math.random`, no `Date.now`, no values that build up from frame to frame. Randomness
  is seeded, and shaders take `t * speed` rather than a running clock.
- **Same result on Node and in the browser.** Logic that must match exactly (layout, physics, path math, text
  shaping) lives in the Rust core so both builds share it.
- **CPU rendering is the reference.** Exports are judged against Skia's CPU renderer. Between the Node and
  WebAssembly builds, shapes and layout match exactly, and text and shaders differ by at most 4/255 per
  channel. GPU previews (Metal, WebGL2) must match the CPU within a stated tolerance, to start: at most 1% of
  pixels off by more than 16/255.
- **Heavy work happens once.** Path matching for morphs, LUT packing, physics, text shaping and diagram layout
  are computed once per input, cached and shared with workers.
- **Plain data in, pixels out.** No DOM, no CSS engine. Styles end up as `NodeStyle` values.
- **Tested.** Each feature lands with value or pixel tests and an example video.

## Phase 0: Cross-build tests (done)

`test/golden.test.ts` renders shared scenes (`test/shared/golden.js`) with the CPU renderer in the Node addon
and in WebAssembly, and compares the pixels and the Taffy layout. Text is drawn from glyph outlines by default
(`textRendering: 'outlines'`), which made it match across platforms and also made moving text faster. Every
later phase adds its scenes here.

## Phase 1: Animation basics (mostly done)

Additions to what already exists (`Timeline`, `spring`, `Easing`, `interpolate`, `random`, `noise`). Done: richer
timelines, stagger, keyframes, easing, expression helpers, flow helpers (as `Timeline.all`, `chain`, `sequence`
and `delay`), named time events, split text, text animators, text effects, path drawing, morphing and motion
along a path. Still open: `write()`, masks for split text, and editing time events in the studio.

| Idea | From | What we add |
|---|---|---|
| Richer timelines | GSAP, anime.js | `timeline.add(child, at)`, percent offsets (`'<25%'`), `repeat`, `yoyo`, `timeScale` and `reverse`. All are maps from time to time, so they stay exact at any frame. `from()` values are resolved when the timeline is built. We keep GSAP's meaning of `<` and `>` |
| Stagger | anime.js, GSAP | `stagger({ each, from: 'center' \| 'edges' \| 'random' \| index, grid, axis, ease })` for delays and values, with ranges like `[0, 100]`. Random order is seeded. `grid: 'auto'` reads positions from Taffy |
| Keyframes | GSAP, Motion, anime.js | `x: [0, 100, 50]` with optional `times` and an ease per segment. A wrong `times` length is an error |
| Easing | Motion, Manim, CSS | `steps(n)`, `cubicBezier(...)`, CSS `linear()` stops, Manim's `smooth`, `thereAndBack` and `squish`, a seeded `irregular` ease, and `customEase('M0,0 C...')` drawn from an SVG path (built in Rust as a lookup table) |
| Expression helpers | After Effects | `wiggle(freq, amount)` (seeded), `loop('cycle' \| 'pingpong')` and `valueAt(t)` |
| Flow helpers | Motion Canvas | `all`, `chain`, `sequence`, `loop` and `delay` that know their own duration, so nothing has to run to find out how long it is |
| Named time events | Motion Canvas | Events such as `'drop'` stored in `composition.meta.json` and used as times in code. In the studio they're dragged on a timeline with the audio waveform, and moving one shifts the later ones |
| Split text | GSAP SplitText, anime.js | `text()` with `split: 'chars' \| 'words' \| 'lines'` and a style function `(part, index) => style`, with optional masks. Positions come from SkParagraph clusters, so it works for any script, including Khmer and emoji |
| Text animators | After Effects | Animate a property across a range of characters, words or lines, with range shapes (square, ramp, triangle, smooth) and a seeded random order. The core of most kinetic type |
| Text effects | GSAP ScrambleText, Coldtype | Typewriter, scramble and counter helpers built on split text |
| Draw paths | GSAP DrawSVG, Motion Canvas, Manim | `drawPath(path, { start, end })` by arc length, so drawing runs at a steady speed, with start and end offsets and arrowheads. `write()` traces the outline, then fills, with Manim's timing |
| Morph paths | Manim, GSAP MorphSVG | `morphPath(a, b, t)` in Rust: match sub-paths, add points where needed, rotate the start point to the best match, then blend. Done once per pair and cached |
| Motion along a path | GSAP MotionPath, anime.js | `alongPath(path, t, { rotate: true })` returns a position and angle for any node |

**Done when:** each helper has value tests, the docs have a page per helper, and one new example uses all of
them.

## Phase 2: Apple-style physics motion (done)

Implemented in `scene/physics.ts`, except collisions between bodies, which wait for the physics engine in Phase 5.

Apple's interfaces feel physical because things move with springs and momentum and can change direction
without a jump. Product videos and app demos need the same feel. The formulas below match Apple's own SDK
source and are checked against reference values.

| Idea | From | What we add |
|---|---|---|
| Springs set by feel | SwiftUI, Core Animation | `spring({ response, bounce })`, using SwiftUI's formula: stiffness = (2π / response)², damping ratio = 1 − bounce (or 1 / (1 + bounce) when bounce is negative), mass 1. The existing `duration` option keeps its meaning: settle in exactly this time |
| Presets | SwiftUI | `springs.smooth` (0.5 s, bounce 0), `springs.snappy` (0.5 s, 0.15) and `springs.bouncy` (0.5 s, 0.3). For "system" motion, SwiftUI's default (response 0.55, no bounce). Tests check values such as `smooth` = stiffness 157.91, damping 25.13 |
| Starting speed | Core Animation, UIKit | `spring({ velocity })`, and `velocity(t)` to read the speed at any time |
| Changing the target mid-motion | UIKit, SwiftUI | `springTo(target, at)` on a timeline. By default each change adds a new spring on top of the old ones (as UIKit does), so every frame stays independent. `mode: 'merge'` restarts from the current position and speed instead |
| Momentum | `UIScrollView` | `decay({ velocity, rate: 0.998 })` (0.99 for "fast"), and `projectedEnd(velocity, rate)` to know where it stops |
| Rubber banding | iOS scroll views | `rubberBand(offset, limit)` using the widely used 0.55 constant. Apple doesn't publish it; it comes from reverse engineering |
| Snapping and paging | iOS paging | Project where a fling would stop, then spring to the nearest page or snap point |
| Simple dynamics | UIKit Dynamics | Gravity, push, attachment springs and snap now, with exact formulas and UIKit's units. Collisions come later, with the physics engine in Phase 5 |
| Scripted gestures | iOS app demos | Describe a drag or flick (path, timing, release speed) and drive any of the above with it, to show an app in use without screen recording |
| Ready-made motions | iOS system animations | Sheet slide-up, app open zoom, notification drop-in and button press as presets |

**Done when:** a 10-second app demo (a scrolled list with momentum and rubber banding, a flicked card that
snaps into place, a sheet that opens with a spring) renders identically in every worker and in both builds.

## Phase 3: Looks (done)

Implemented: utility classes, transitions, effect layers, backgrounds, glass, adjustment layers, mattes,
clipping masks, layer styles, text warps and color grading. Not yet: grading by color range or shape
(secondary correction), and our own named filter presets.

| Idea | From | What we add |
|---|---|---|
| Utility classes | Tailwind CSS (MIT) | `box({ class: 'flex items-center gap-4 p-8 rounded-2xl bg-slate-900 shadow-xl' })`. Tokens are generated from Tailwind v4's `theme.css`, with its OKLCH colors converted to sRGB at build time so both builds get the same values. Multiple shadows with spread, `dark:` and aspect-ratio variants. Classes and `style` mix, and `style` wins |
| Transitions | gl-transitions | Depend on the `gl-transitions` package, which ships tested Skia shader (SkSL) versions of all 214 transitions. `series()` items take `transition: { name: 'CrossWarp', duration: 0.6 }`. Fix or flag the 19 that render differently on GPU, and generate a notice with each transition's license and author |
| Effect layers | shaders.com | `effects([grain(), glow(), chromaticAberration(), halftone()], child)`: a stack of SkSL effects blended in order over any node. Ported only from the `shaders` package v4.0 or later, which is MIT. Effects that depend on the previous frame are left out |
| Ready-made backgrounds | shaders.com | Mesh gradients, noise fields, aurora and liquid backgrounds as `shader` presets with a few named parameters |
| Glass | Apple's Liquid Glass, OverShifted/LiquidGlass | `glass()`: blur what's behind a shape once, then one SkSL pass bends it at the edges, adds frost, a moving highlight and optional color fringing |
| Adjustment layers | After Effects, Premiere | A layer whose effects apply to everything beneath it, so one grade or blur covers a whole section |
| Mattes | After Effects | Alpha and luma mattes: any node, including text or video, can mask another |
| Clipping masks | Photoshop | A node clipped to the shape of the node below it, so a photo or gradient fills text without extra setup |
| Layer styles | Photoshop | `layerStyle({ stroke, innerShadow, outerGlow, innerGlow, bevel, gradientOverlay, colorOverlay })` on any node, each part animatable, in Photoshop's familiar order |
| Text warps | Photoshop | Arc, arch, bulge, flag, wave and rise presets that bend a text node, each with a bend amount that can be animated |

### Color grading and filters

A filter is a few color steps (curves, a lookup table, adjustments) plus a strength control, as in
[MetalFilters](https://github.com/alexiscn/MetalFilters). It runs as Skia color filters or SkSL, so it works on
any node: images, video, text or a whole scene.

| Idea | From | What we add |
|---|---|---|
| LUTs | Resolve, Premiere, photo apps | `lut(asset)` loads `.cube` files (with a strict parser), Hald images and square LUT PNGs. Lookups use tetrahedral interpolation by default (the method the `.cube` spec recommends), trilinear as an option. LUTs are stored as half-float tiles and applied to unpremultiplied color |
| Strength | MetalFilters | Every filter takes `strength` from 0 to 1, blending with the original. It can be animated, so a look can fade in |
| Adjustments | Photo apps | `adjust({ exposure, contrast, saturation, vibrance, warmth, tint, highlights, shadows, fade, vignette, grain, sharpen })` with standard formulas. Grain is seeded per frame. Sharpen, highlights and shadows need a blur, so they run as image filters |
| Curves | Photo apps | `curves({ rgb, red, green, blue })` from control points, built on Skia's table color filter |
| Gradient map, levels and more | Photoshop | `gradientMap(stops)` (color by brightness, for duotones), `levels(...)`, `channelMixer(...)`, `selectiveColor(...)`, `posterize(n)` and `threshold(v)` |
| Grading | Color grading tools | `grade({ lift, gamma, gain, offset })`, and saved grades in the ASC CDL format (slope, offset, power, saturation) |
| Secondary correction | DaVinci Resolve | Grade only one color range (keyed by hue, saturation and lightness) or one shape, which can follow a moving node |
| Grade presets | DaVinci Resolve | Grades as reusable, chainable presets that can be copied between clips |
| Looks between cuts | Video editors | Blend two filters over time, for example from a cool look to a warm one across a scene |
| Filter presets | Photo apps | Our own named looks (film, fade, noir, warm, cool and others), built from the steps above. Instagram's filters, maps and constants can't be used |

**Done when:** classes cover the utilities that make sense for video; the transition, effect and filter
galleries render in CI on both builds; and LUT output is within 1/255 of ffmpeg's `lut3d` filter.

## Phase 4: Motion that follows layout (done)

Implemented: `states()`, `layoutId` animation and shared elements, exit animations, `withSize`, speed ramps
and time mapping. Not yet: cropping video around its subject when changing aspect ratio, and crossfading
shared elements whose content differs.

| Idea | From | What we add |
|---|---|---|
| Variants | Motion | Named states on a node (`variants: { hidden: {...}, shown: {...} }`) and `state: 'shown'` switching at a time, with a transition per property |
| Layout animation | Motion, GSAP Flip | When a node's size or position changes between two moments, it animates there instead of jumping. Taffy lays out both states and vector nodes are laid out again each frame, so text and borders stay sharp. Images and video use Motion's scale correction |
| Shared elements | Motion (`layoutId`) | Two nodes with the same `layoutId` in different sequences morph into each other across a cut, using Motion's crossfade curves |
| Exit animations | Motion (`AnimatePresence`) | Animations that play after a node's end time, before it's removed |
| Responsive compositions | Premiere Auto Reframe, Final Cut Smart Conform | One composition rendered at 16:9, 9:16 and 1:1. Taffy lays the scene out again for each size, and video is cropped around its subject |
| Clip timing | Diffusion Studio | Each clip has a place on the timeline (`start`, `end`) separate from its trim of the source (`sourceIn`, `sourceOut`). Keyframes stay attached to the source when a clip is trimmed. A transition belongs to the outgoing clip and is centred on the cut |
| Connected clips | Final Cut Pro | `series()` already closes gaps. Connected clips stay attached to a point in the main sequence when things before them move |
| Speed ramps | After Effects, Premiere | Speed curves on video clips and on whole sub-compositions: slow-motion ramps, freeze frames and reverse |

**Done when:** a list that reorders, a card that expands, a shared element across a cut and a composition
rendered at three sizes all render correctly at any seek position and in parallel workers.

## Phase 5: Simulation and explainers

| Idea | From | What we add |
|---|---|---|
| 2D physics | Matter.js, Rapier | Rigid bodies, joints and collisions from `rapier2d` (Apache 2.0) in its deterministic mode, with a pinned version and a CI job for the WebAssembly build. The simulation runs once at a fixed step and the result is shared with workers, so any frame looks up body positions by time. Collisions are recorded and can be queried by time. The API uses Matter.js-style names |
| Math | Manim, KaTeX | `math('e^{i\\pi} + 1 = 0')` typeset in the Rust core with RaTeX (MIT, KaTeX-compatible, about 0.25 ms per formula), so Node and the web get the same paths. MathJax v4 is an optional fallback for wider coverage |
| Graphs | Manim | `axes()`, `plot(fn)`, `numberLine()`, `vectorField()` as scene nodes with sensible defaults |
| Explainer animations | Manim | `create`, `write`, `transform`, `transformMatchingTex`, `indicate` and `fadeIn` on top of Phase 1, with Manim's lag timing |
| Diagrams | Pele (MIT) | `diagram('flowchart LR\n A --> B')` renders Mermaid through Pele, measured with Skia's text measurement and drawn by Skiamovin, with every node and edge animatable |
| Camera | Manim | A camera frame that pans, zooms and rotates the scene, with `autoZoom` to fit a set of nodes |

**Done when:** an example explains a short math idea end to end, and physics and math match exactly between the
Node and WebAssembly builds.

## Phase 6: Type, code and sound

| Idea | From | What we add |
|---|---|---|
| OpenType features | HarfBuzz | A `fontFeatures` text prop for ligatures, stylistic sets and tabular numbers (`tnum`), so counters don't jitter as digits change. Skia already shapes text with HarfBuzz; this exposes it |
| Glyph clusters | HarfBuzz | Split text and text animators use HarfBuzz's cluster data, so a letter with combining marks (common in Khmer, Thai, Hindi and Arabic) moves as one piece and right-to-left text animates in reading order |
| Font subsetting | HarfBuzz (`hb-subset`) | Keep only the glyphs a composition uses when shipping fonts to the browser or embedding them in PDF and SVG output |
| Variable fonts over time | Coldtype (Apache 2.0) | Animate font axes (`wght`, `wdth`, custom axes) per glyph, with axes given from 0 to 1, and fit-to-width by adjusting an axis |
| Glyphs as shapes | Coldtype | `textToPaths()` so letters can be distorted, filled with shaders, morphed or set on a curve |
| Code blocks | Motion Canvas | A code node with syntax highlighting that animates between versions of the code: edits slide in and out, unchanged lines move into place |
| Captions | Diffusion Studio, Premiere | A captions node that reads SRT or VTT files with word timings, with style presets and word-by-word reveals |
| Music-driven animation | Coldtype | Read MIDI files into note events (`midi(asset).notes`) and add beat and onset detection next to `analyzeAudio` |

## Phase 7: Camera, film and finishing

The tools that make a video look filmed and finished rather than just animated.

### Camera and image quality

From photography practice ([How to Take Good Pictures](https://photographylife.com/how-to-take-good-pictures)):

| Idea | What we add |
|---|---|
| Motion blur | `shutter: 180` (degrees) renders several moments inside each frame and averages them in linear light, so fast things streak while still things stay sharp. Frames stay pure functions of time |
| Soft light by default | Shadows that look like diffused light rather than hard drop shadows, and warm and cool time-of-day grade presets |
| High-precision color | An option to draw and grade in half-float, linear color, like a Raw editor, so curves and grades don't band. A step toward HDR output |
| Polarizer look | An adjustment that deepens skies and cuts glare |
| Sharp output | Correct scaling of images and video (mipmaps or cubic when shrinking), a sensible default bitrate, and optional supersampling |
| Depth of field | Blur by depth with an animated focus pull between subjects |

### Film language

From a filmmaking primer ([How to Make a Movie](https://nothingbeatstherealthing.org.au/wp-content/uploads/2020/07/Howtomakeamovie20202.pdf),
Creative Content Australia):

| Idea | What we add |
|---|---|
| Shot sizes | `camera.frame(node, 'closeUp')` with the six standard sizes (wide, long, full, mid, close-up, extreme close-up) |
| Angles | Overhead, high, eye level, low and undershot presets |
| Camera moves | Static, dolly, pan, tilt, crane, zoom and tracking (follow a node), each with good default easing. Handheld adds seeded shake; "steadicam" smooths any move |
| Framing guides | Headroom, look room and rule of thirds, as studio overlays and as an option for `camera.frame` |
| Coverage | Several virtual cameras on one scene, plus an edit list that picks the camera over time |
| Basic transitions | Cut, dissolve, wipe and fade to and from black as built-ins |
| Matching shots | Color correction that matches brightness and white balance across clips |
| Titles and credits | Title card, lower third and scrolling credits templates |

### Editing and delivery

From Premiere Pro, Final Cut Pro and DaVinci Resolve:

| Idea | What we add |
|---|---|
| Sound mix | Music that ducks under voice-over automatically, and room tone to fill gaps |
| Loudness | Measure the final mix and normalize it to a target: −14 LUFS for YouTube, −23 LUFS for broadcast (EBU R128) |
| Audio roles and stems | Tag audio as dialogue, music or effects, and export each group as a separate file |
| Variants | Alternate versions in one slot (Final Cut's auditions), and render all variants in one batch |
| Proxies | Low-resolution copies of heavy media for smooth preview, swapped for the originals on export |
| Delivery presets | YouTube, Instagram, TikTok and broadcast presets that set size, frame rate, bitrate and loudness together |

### Drawing

From Procreate and Procreate Dreams:

| Idea | What we add |
|---|---|
| Clean shapes from rough input | Snap rough points or paths to clean lines, arcs, ellipses and polygons |
| Strokes | Variable-width strokes with smoothing and tapered ends, for hand-drawn looks and drawing animations |
| Frame-by-frame | Image-sequence animation with hold frames (on twos, on threes) |
| Symmetry | Mirror and radial-symmetry (kaleidoscope) modifiers |

### From Blender

[Blender](https://www.blender.org) is GPL-licensed, so we take ideas only:

| Idea | What we add |
|---|---|
| Keyframe curves | Keyframes with Bézier handles (auto, clamped, free), in code and as a curve editor in the studio |
| Reusable actions | Named animation clips that can be placed, repeated, layered and blended over time (Blender's NLA strips) |
| Constraints | `lookAt(target)`, `followPath(path)`, `copyTransform(node)` and `limit(...)` on nodes and cameras |
| Drivers | Link one property to another with a function, shown in the studio as a link |
| Shape keys | Named target shapes with weights that blend a path or mesh |
| 2D rigs and pins | Bones with two-bone IK, and puppet pins (After Effects) that bend images and shapes through a mesh |
| Modifier stacks | Repeat, mirror, offset, wave, noise and round corners on any path or group, each a function of time |
| Scattering | Copies on a grid, along a path or randomly over an area (seeded) |
| Compositor effects | Bloom, lens distortion and chromatic aberration |
| Tone mapping | Filmic tone mapping (in the style of AgX) from high-precision color to the screen, so highlights roll off instead of clipping |

## Phase 8: 3D

[three.js](https://threejs.org) is a full real-time 3D engine. The Rust crate `three` on docs.rs is an older
project inspired by it and is no longer maintained, so we won't depend on it. We'll grow 3D in steps:

1. **Shapes in 3D space.** Cards, images and text placed with full 3D transforms and a shared camera (Skia
   already supports this with `M44`), sorted back to front with a stable tie-break. Camera angle presets apply.
2. **Simple meshes.** Boxes, spheres, extruded paths and extruded text, drawn with Skia's `drawVertices` and
   basic lighting. Textured meshes are subdivided so perspective looks right.
3. **Shader scenes.** Ray-marched scenes in SkSL with a helper library for shapes, lights and materials, as in
   the launch film's hero shot.
4. **Depth testing on the CPU.** A software depth buffer in Rust, for scenes where sorting isn't enough.
5. **A real 3D renderer** (glTF models, shadows), only if the steps above show demand. It would render with
   wgpu into a texture that Skia composites.

## Across all phases

- **A better studio.** Grow `examples/web-studio` into a tool with:
  - a timeline with named events, the audio waveform and snapping to frames;
  - a property panel built automatically from a typed props schema (text, color, number range, media), so
    templates are safe to reuse;
  - a contact sheet of variations (props, seeds, grades) and an A/B compare of two versions;
  - scopes (waveform, vectorscope, RGB parade, histogram);
  - onion skin, and recording a live drag as keyframes;
  - composition guide overlays (thirds, title safe).
- **Render API.** `renderPartial({ workerId, workers })` for splitting a render across machines, with audio
  rendered separately and combined once at the end. A small render server. No telemetry.
- **The `npx skiamovin` CLI** for rendering stills and videos, plus inspection commands that print JSON
  (probe, filmstrip, waveform, check for black frames).
- **Docs with live examples.** Each guide page gets a small composition you can play in the browser.

## Licenses

MIT, Apache 2.0 and BSD code may be ported if we keep the notice. MPL 2.0 code may be copied only if the copied
files stay MPL 2.0. Everything else is ideas only.

| Project | License | What we may do |
|---|---|---|
| Tailwind CSS | MIT | Copy the theme tokens with the notice |
| GSAP | Proprietary, free to use, bans reverse engineering for competing products | API shapes and textbook math only. Never read or port its source |
| Motion | MIT | Port spring and layout math |
| anime.js | MIT | Port stagger, spring and SVG helpers |
| `shaders` (shaders.com) | MIT from v4.0.0; earlier versions are proprietary | Port v4 or later only. Never use older code or shaders.com presets |
| gl-transitions | MIT for 212 transitions, BSD for 2 | Depend on the package and ship a per-transition notice |
| three.js | MIT | Names and concepts |
| Rapier | Apache 2.0 | Use as a dependency |
| Matter.js | MIT | API names |
| Manim | MIT | Port alignment and timing math |
| Coldtype | Apache 2.0 | Port ideas and code with the notice |
| MetalFilters | MIT code, but its filters and shaders belong to Instagram | Structure only. No maps, constants or filter names |
| MetalPetal | MIT | Port LUT layout detection and sampling |
| Motion Canvas, Revideo | MIT | Port code-block and curve ideas |
| Pele | MIT | Use as a dependency |
| HarfBuzz | MIT ("Old MIT") | Already used through Skia; use `hb-subset` as a dependency |
| RaTeX | MIT code, fonts under OFL 1.1 | Use as a dependency and ship the font license |
| MathJax v4 | Apache 2.0 | Optional dependency; check its default font's license before bundling |
| Diffusion Studio | MPL 2.0 (its engine adds a paid watermark key) | Ideas only; don't depend on the engine |
| OverShifted/LiquidGlass, liquid-glass-react | MIT | Port the shader math |
| Blender | GPL 2.0 or later | Ideas only |
| Apple, Adobe (Photoshop, After Effects, Premiere), Procreate, Final Cut Pro, DaVinci Resolve | Proprietary | Behavior and public parameters only |
