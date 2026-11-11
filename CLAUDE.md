# Skiamovin

A library for making videos with code: Skia drawing, Taffy layout and a scene layer, on Node (native addon)
and in the browser (WebAssembly), built to work with Mediabunny.

This is a serious project. Treat every change as something real users will depend on.

## Rules

1. **Git authorship.** Commits are authored by the repository owner only. Never add yourself as author or
   co-author: no `Co-Authored-By` trailers, no "Generated with" lines, in commits or pull requests.
2. **Comments.** Write few. Only explain *why* something non-obvious is done (a workaround, a platform quirk, a
   safety rule). Don't restate the code, narrate history, or leave notes about debugging. One short sentence is
   usually enough.
3. **Plain writing.** In comments, docs, commit messages and error messages: simple words, short sentences, no
   jargon or marketing language. Say what something does, not how impressive it is.
4. **Formatting and linting.** Biome formats and lints JS, TS, JSON, HTML and CSS. rustfmt and Clippy cover
   Rust. Run `npm run format` before committing and make sure `npm run lint` passes. Don't silence a lint rule
   without a reason written next to it.
5. **Keep it tidy.** No stray scripts, temporary files, debug output or commented-out code. Delete what isn't
   used. Generated media and build output stay out of git (see `.gitignore`).
6. **Honest docs.** `docs/status.md` must match what the build actually does. Don't document a feature as
   working until it's implemented and tested.
7. **Tests and CI.** Add or update tests with every change. CI must stay green on macOS, Linux, Windows and
   WebAssembly.

## Layout

| Path | What it is |
|---|---|
| `crates/skiamovin-core` | The Rust API shared by both builds (`src/api/*.rs`) |
| `crates/skiamovin-node` | Node addon (napi-rs) |
| `crates/skiamovin-wasm` | WebAssembly build (emscripten) |
| `crates/skiamovin-codecs` | Hardware video and audio codecs (VideoToolbox and AudioToolbox on macOS) |
| `packages/skiamovin` | The npm package (TypeScript) and its tests |
| `scripts/gen-bindings.mjs` | Generates the Node, WASM and TypeScript bindings from `crates/skiamovin-core/src/api/*.rs` |
| `examples/` | Example videos, the launch film and a Vite app (`examples/web-studio`) |
| `docs/` | User documentation |

Files named `generated.*` and `crates/skiamovin-wasm/exports.txt` are written by `scripts/gen-bindings.mjs`.
Don't edit them by hand; change the Rust API and rerun the script.

## Commands

```sh
npm run build:native       # Node addon -> packages/skiamovin/native/
npm run build:wasm         # WebAssembly -> packages/skiamovin/wasm/ (needs emscripten 4.0.7)
npm run build:ts           # TypeScript -> packages/skiamovin/dist/
npm test                   # Rust codec tests, Node tests and headless Chrome tests (macOS)
npm run lint               # Biome, rustfmt and Clippy
npm run format             # Biome and rustfmt, writing fixes
```

The full test suite needs macOS (Metal and VideoToolbox), Google Chrome and ffmpeg. On Linux and Windows run
`npm run test:portable` in `packages/skiamovin`.
