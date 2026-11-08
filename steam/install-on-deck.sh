#!/usr/bin/env bash
set -euo pipefail

SRC="$(ls "$(dirname "$0")"/MargoDeck-*.AppImage 2>/dev/null | head -n1 || true)"
if [[ -z "$SRC" ]]; then
  echo "MargoDeck-*.AppImage not found next to this script." >&2
  exit 1
fi

DEST_DIR="$HOME/Applications"
DEST="$DEST_DIR/MargoDeck.AppImage"
mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST"
chmod +x "$DEST"
echo "Installed to $DEST"

DESKTOP="$HOME/.local/share/applications/margodeck.desktop"
mkdir -p "$(dirname "$DESKTOP")"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=MargoDeck
Comment=Wrapper for the margonem.pl web game with gamepad controls
Exec=$DEST --no-sandbox
Categories=Game;
Terminal=false
EOF

if command -v steamos-add-to-steam >/dev/null 2>&1; then
  steamos-add-to-steam "$DESKTOP"
  echo "Added to Steam. In Steam: Properties -> Controller -> set template 'Gamepad'."
else
  echo "steamos-add-to-steam not available. Add manually: Steam -> Add a Game -> Add a Non-Steam Game -> $DEST"
  echo "Launch options: --no-sandbox"
fi
