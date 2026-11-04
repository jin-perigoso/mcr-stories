#!/bin/sh
# Gera os 6 Stories do dia a partir de dados.js: saida/AAAA-MM-DD/1.jpg ... 6.jpg (1080x1920)
#   sh render.sh            só gera
#   sh render.sh --fila     gera e copia para ../fila/AAAA-MM-DD/ (entra na publicação automática)
cd "$(dirname "$0")"
DATA=$(sed -n "s/.*data: '\([0-9-]*\)'.*/\1/p" dados.js | head -1)
OUT="saida/$DATA"
mkdir -p "$OUT"
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
for n in 1 2 3 4 5 6; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1080,1920 --virtual-time-budget=4000 \
    --screenshot="$(cygpath -w "$PWD/$OUT/$n.png")" "file:///$(cygpath -m "$PWD")/story.html?n=$n" 2>/dev/null
done
python -c "
import sys
from PIL import Image
pasta = sys.argv[1]
for n in range(1, 7):
    img = Image.open(f'{pasta}/{n}.png').convert('RGB')
    assert img.size == (1080, 1920), img.size
    img.save(f'{pasta}/{n}.jpg', quality=92, optimize=True)
print('ok', pasta)
" "$OUT" && rm -f "$OUT"/*.png
if [ "$1" = "--fila" ]; then
  mkdir -p "../fila/$DATA" && cp "$OUT"/*.jpg "../fila/$DATA/" && echo "copiado para fila/$DATA"
fi
