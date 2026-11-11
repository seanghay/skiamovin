#!/bin/sh
# Downloads the openly licensed fonts and music some examples use, into examples/assets.
#   Inter, JetBrains Mono, Google Sans (which covers Khmer): SIL Open Font License 1.1, from the Google Fonts
#   repository.
#   Instrument Serif: SIL Open Font License 1.1, from the Google Fonts repository.
#   "Infinite Wonder" and "Arpent" by Kevin MacLeod, from FreePD: CC0 1.0 (public domain). FreePD is offline; this
#   is a mirror that keeps its files and license text.
#   Skies from Poly Haven (polyhaven.com): CC0 1.0.
#   A 7-second shot from "Tears of Steel" (Blender Foundation, mango.blender.org): CC BY 3.0, credited in the film.
#   Needs ffmpeg.
set -e
cd "$(dirname "$0")"
mkdir -p assets
cd assets
curl -sSfL -o Inter.ttf "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf"
curl -sSfL -o GoogleSans.ttf "https://github.com/google/fonts/raw/main/ofl/googlesans/GoogleSans%5BGRAD,opsz,wght%5D.ttf"
curl -sSfL -o JetBrainsMono.ttf "https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf"
curl -sSfL -o infinite-wonder.mp3 "https://a.ocv.me/pub/stuff/music/freepd/chill/Infinite%20Wonder.mp3"
curl -sSfL -o InstrumentSerif.ttf "https://github.com/google/fonts/raw/main/ofl/instrumentserif/InstrumentSerif-Regular.ttf"
curl -sSfL -o InstrumentSerif-Italic.ttf "https://github.com/google/fonts/raw/main/ofl/instrumentserif/InstrumentSerif-Italic.ttf"
curl -sSfL -o arpent.mp3 "https://a.ocv.me/pub/stuff/music/freepd/electronic/Arpent.mp3"
for sky in lilienstein the_sky_is_on_fire venice_sunset; do
  curl -sSfL -o "$sky-full.jpg" "https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/$sky.jpg"
  # Poly Haven skies are 360° panoramas: keep a 16:9 window around the horizon, which reads as a normal photo.
  ffmpeg -y -loglevel error -i "$sky-full.jpg" -vf "crop=iw*0.32:iw*0.18:iw*0.39:ih*0.33,scale=1920:-1" -q:v 3 "$sky.jpg"
  rm "$sky-full.jpg"
done
# One request that seeks into the film, so only the needed part is downloaded.
ffmpeg -y -loglevel error -ss 328.2 -i "https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov" -t 6 -an \
  -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p tears-of-steel.mp4
echo "Assets written to examples/assets."
