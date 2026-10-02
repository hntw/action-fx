#!/bin/zsh
# usage: shot.sh out.png "query" width height
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --allow-file-access-from-files --screenshot="$1" --window-size="$3,$4" "file://$HOME/action-fx/review/sheet.html?$2" 2>/dev/null
