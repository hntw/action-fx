#!/bin/zsh
# Render media/header.png from media/header.html (2560x1280, i.e. 1280x640 at 2x).
cd "${0:A:h}"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --allow-file-access-from-files --virtual-time-budget=8000 --force-device-scale-factor=2 \
  --screenshot="$PWD/header.png" --window-size=1280,640 "file://$PWD/header.html" 2>/dev/null
