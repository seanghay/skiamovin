#!/bin/sh
# Downloads the openly licensed fonts and music some examples use, into examples/assets.
#   Inter, JetBrains Mono, Google Sans (which covers Khmer): SIL Open Font License 1.1, from the Google Fonts
#   repository.
#   "Infinite Wonder" by Kevin MacLeod, from FreePD: CC0 1.0 (public domain). FreePD is offline; this is a mirror
#   that keeps its files and license text.
set -e
cd "$(dirname "$0")"
mkdir -p assets
cd assets
curl -sSfL -o Inter.ttf "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf"
curl -sSfL -o GoogleSans.ttf "https://github.com/google/fonts/raw/main/ofl/googlesans/GoogleSans%5BGRAD,opsz,wght%5D.ttf"
curl -sSfL -o JetBrainsMono.ttf "https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf"
curl -sSfL -o infinite-wonder.mp3 "https://a.ocv.me/pub/stuff/music/freepd/chill/Infinite%20Wonder.mp3"
echo "Assets written to examples/assets."
