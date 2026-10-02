#!/bin/zsh
# Render media/header.gif: the header loop drawn 10 frames per page (header.html?t=&n=&dt=), cut into frames,
# then a two-pass palette GIF. One Chrome at a time; parallel headless Chromes hang on exit.
cd "${0:A:h}"
FPS=25 N=90 B=10 F=$(mktemp -d)   # 90 frames at 25 fps = the 3.6 s LOOP in header.html
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for (( s = 0; s < N; s += B )); do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --virtual-time-budget=8000 \
    --screenshot="$F/sheet$(printf %03d $s).png" --window-size=1280,$((640 * B)) \
    "file://$PWD/header.html?z=1&t=$(( s / ${FPS}.0 ))&n=$B&dt=$(( 1 / ${FPS}.0 ))" 2>/dev/null
  ffmpeg -loglevel error -y -i "$F/sheet$(printf %03d $s).png" -vf "untile=1x$B" -start_number $s "$F/f%03d.png"
done
ffmpeg -loglevel error -y -framerate $FPS -i "$F/f%03d.png" \
  -vf "split[a][b];[a]palettegen=max_colors=48:stats_mode=full[p];[b][p]paletteuse=dither=none" -loop 0 header.gif
rm -rf "$F"
