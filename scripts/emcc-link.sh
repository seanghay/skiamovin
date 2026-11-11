#!/bin/sh
# Linker wrapper for wasm32-unknown-emscripten. rustc always passes -fwasm-exceptions, but the prebuilt Skia
# archives use emscripten-style setjmp/longjmp (libpng), which emcc can't combine with wasm exceptions.
# Skiamovin builds with panic=abort, so the flag is dropped and SUPPORT_LONGJMP=emscripten is used.
args=""
for a in "$@"; do
  if [ "$a" = "-fwasm-exceptions" ]; then continue; fi
  args="$args '$(printf "%s" "$a" | sed "s/'/'\\\\''/g")'"
done
eval exec emcc $args
