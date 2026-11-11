#!/bin/sh
# Takes one still from each rendered example. The launch film uses them. Run after examples/render-all.ts.
set -e
cd "$(dirname "$0")/.."
mkdir -p assets/frames
for name in 01-intro 03-kinetic-type 04-bar-chart 05-shader-gallery 07-audio-visualizer 08-logo-reveal 09-slideshow 10-vertical-social; do
  ffmpeg -y -loglevel error -ss 2 -i "output/$name.mp4" -frames:v 1 -vf "scale=640:-2" "assets/frames/$name.jpg"
done
echo "Stills written to examples/assets/frames."
