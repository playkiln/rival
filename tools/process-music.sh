#!/usr/bin/env bash
# Process the Suno deliveries (asset-inbox/music/*.flac) into game-ready music.
#
#   bash tools/process-music.sh
#
# Loops: cut a stable mid-song region and make the seam seamless by
# crossfading the tail into the material that originally led INTO the region
# start — so the loop's end sounds like the natural approach to its own
# beginning. The sting: carve the opening phrase out of Suno's full-length song
# and fade it. Everything is loudness-normalized and encoded to OGG (most
# browsers) + M4A (Safari).
#
# Regions were chosen from an RMS-per-4s scan of each delivery: the race loop
# is flat for its whole length; the menu loop swells for its first ~50 s and
# then settles; the result loop is steady from 0:04 to 1:40.
set -euo pipefail
cd "$(dirname "$0")/.."

IN=asset-inbox/music
OUT=public/assets/audio/music
mkdir -p "$OUT"

XF=0.5 # seam crossfade seconds

# make_loop <input> <output-basename> <region-start> <region-end>
make_loop() {
  local src="$1" name="$2" a="$3" b="$4"
  local bodyEnd preStart
  bodyEnd=$(echo "$b - $XF" | bc)
  preStart=$(echo "$a - $XF" | bc)
  ffmpeg -y -v error -i "$src" -filter_complex "
    [0:a]atrim=start=${a}:end=${bodyEnd},asetpts=PTS-STARTPTS[body];
    [0:a]atrim=start=${bodyEnd}:end=${b},asetpts=PTS-STARTPTS[tail];
    [0:a]atrim=start=${preStart}:end=${a},asetpts=PTS-STARTPTS[pre];
    [tail][pre]acrossfade=d=${XF}:c1=tri:c2=tri[seam];
    [body][seam]concat=n=2:v=0:a=1,loudnorm=I=-16:TP=-1.5:LRA=11[out]" \
    -map '[out]' -ar 44100 "$OUT/tmp-$name.wav"
  encode "$name"
}

# make_sting <input> <output-basename> <length> <fade>
make_sting() {
  local src="$1" name="$2" len="$3" fade="$4"
  local fadeStart
  fadeStart=$(echo "$len - $fade" | bc)
  ffmpeg -y -v error -i "$src" -af \
    "atrim=end=${len},afade=t=out:st=${fadeStart}:d=${fade},loudnorm=I=-14:TP=-1.5:LRA=11" \
    -ar 44100 "$OUT/tmp-$name.wav"
  encode "$name"
}

encode() {
  local name="$1"
  ffmpeg -y -v error -i "$OUT/tmp-$name.wav" -c:a libvorbis -q:a 4 "$OUT/$name.ogg"
  ffmpeg -y -v error -i "$OUT/tmp-$name.wav" -c:a aac -b:a 128k "$OUT/$name.m4a"
  rm "$OUT/tmp-$name.wav"
  echo "  $name: $(du -h "$OUT/$name.ogg" | cut -f1) ogg / $(du -h "$OUT/$name.m4a" | cut -f1) m4a"
}

echo "Processing music -> $OUT"
make_loop  "$IN/race-loop.flac"   race-loop   20 80
make_loop  "$IN/menu-loop.flac"   menu-loop   56 120
make_loop  "$IN/result-loop.flac" result-loop 12 72
make_sting "$IN/best-sting.flac"  best-sting  4.2 0.8
echo "Done."
