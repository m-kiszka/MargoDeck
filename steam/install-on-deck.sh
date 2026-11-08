#!/usr/bin/env bash
set -euo pipefail

SRC="$(ls -t "$(dirname "$0")"/MargoDeck*.AppImage 2>/dev/null | head -n1 || true)"
if [[ -z "$SRC" ]]; then
  echo "MargoDeck*.AppImage not found next to this script." >&2
  exit 1
fi

DEST_DIR="$HOME/Applications"
DEST="$DEST_DIR/MargoDeck.AppImage"
mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST"
chmod +x "$DEST"
echo "Installed to $DEST"

ICON="$HOME/.local/share/icons/hicolor/1024x1024/apps/margodeck.png"
TMP="$(mktemp -d)"
(cd "$TMP" && "$DEST" --appimage-extract 'usr/share/icons/hicolor/*/apps/margodeck.png' >/dev/null 2>&1) || true
FOUND="$(find "$TMP/squashfs-root" -type f -name margodeck.png 2>/dev/null | head -n1)"
if [[ -n "$FOUND" ]]; then
  mkdir -p "$(dirname "$ICON")"
  cp "$FOUND" "$ICON"
  echo "Icon installed to $ICON"
else
  echo "Could not extract the icon from the AppImage, using the default icon." >&2
  ICON=""
fi
rm -rf "$TMP"

OLD_DESKTOP="$HOME/.local/share/applications/margodeck.desktop"
[[ -f "$OLD_DESKTOP" ]] && rm -f "$OLD_DESKTOP"

DESKTOP="$HOME/.local/share/applications/MargoDeck.desktop"
mkdir -p "$(dirname "$DESKTOP")"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=MargoDeck
Comment=Wrapper around the Margonem web game that adds controller and Steam Deck support
Exec=$DEST --no-sandbox
Icon=${ICON:-applications-games}
StartupWMClass=MargoDeck
Categories=Game;
Terminal=false
EOF

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESKTOP")" || true

if command -v steamos-add-to-steam >/dev/null 2>&1; then
  steamos-add-to-steam "$DESKTOP"
  echo "Added to Steam. In Steam: Properties -> Controller -> set template 'Gamepad'."
else
  echo "steamos-add-to-steam not available. Add manually: Steam -> Add a Game -> Add a Non-Steam Game -> $DEST"
  echo "Launch options: --no-sandbox"
fi
