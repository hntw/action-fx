#!/bin/zsh
# Render the header loop: 10 frames per page (header.html?t=&n=&dt=), cut into frames, then encode.
#   media/anim.sh       header.gif  1280x640, one loop, two-pass palette
#   media/anim.sh mp4   header.mp4  2560x1280 H.264, the loop played 3 times (about 11 s)
# One Chrome at a time; parallel headless Chromes hang on exit.
cd "${0:A:h}"
MODE=${1:-gif} FPS=25 N=90 B=10 F=$(mktemp -d)   # 90 frames at 25 fps = the 3.6 s LOOP in header.html
Z=$([[ $MODE == mp4 ]] && echo 2 || echo 1)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for (( s = 0; s < N; s += B )); do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --virtual-time-budget=8000 \
    --force-device-scale-factor=$Z --screenshot="$F/sheet$(printf %03d $s).png" --window-size=1280,$((640 * B)) \
    "file://$PWD/header.html?z=$Z&t=$(( s / ${FPS}.0 ))&n=$B&dt=$(( 1 / ${FPS}.0 ))" 2>/dev/null
  ffmpeg -loglevel error -y -i "$F/sheet$(printf %03d $s).png" -vf "untile=1x$B" -start_number $s "$F/f%03d.png"
done
if [[ $MODE == mp4 ]]; then
  ffmpeg -loglevel error -y -stream_loop 2 -framerate $FPS -i "$F/f%03d.png" \
    -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -movflags +faststart header.mp4
else
  ffmpeg -loglevel error -y -framerate $FPS -i "$F/f%03d.png" \
    -vf "split[a][b];[a]palettegen=max_colors=48:stats_mode=full[p];[b][p]paletteuse=dither=none" -loop 0 header.gif
fi
rm -rf "$F"
