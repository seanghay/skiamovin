#!/bin/sh
# Generates the media files the examples use. Everything is synthetic, made with ffmpeg test sources.
set -e
cd "$(dirname "$0")"
mkdir -p assets output
cd assets
ffmpeg -y -loglevel error -f lavfi \
  -i "aevalsrc='0.25*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.5*t))+0.2*sin(2*PI*330*t)+0.5*exp(-12*mod(t,0.5))*sin(2*PI*60*t)+0.15*exp(-30*mod(t+0.25,0.5))*(random(0)-0.5)':s=48000:d=12" \
  -ac 2 -c:a libmp3lame -b:a 192k music.mp3
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=12" -f lavfi -i "sine=frequency=523:duration=12" \
  -c:v libx264 -preset fast -pix_fmt yuv420p -bf 2 -c:a aac -shortest clip.mp4
ffmpeg -y -loglevel error -f lavfi -i "mandelbrot=size=1600x900:rate=1" -frames:v 1 photo1.jpg
ffmpeg -y -loglevel error -f lavfi -i "gradients=size=1600x900:n=5:seed=7" -frames:v 1 photo2.jpg
ffmpeg -y -loglevel error -f lavfi -i "life=size=320x180:mold=10:ratio=0.3,scale=1600:900:flags=neighbor" -frames:v 1 photo3.jpg
cd ..
node launch/score.ts
echo "Assets written to examples/assets. Run 'node examples/render-all.ts' next."
