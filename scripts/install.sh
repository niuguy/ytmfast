#!/usr/bin/env bash
# Installs YTMFast, or updates it (macOS / Linux). No sudo required:
#   curl -fsSL https://raw.githubusercontent.com/niuguy/ytmfast/main/scripts/install.sh | bash
# YTMFAST_BASE_URL  where the release assets are (default: the latest GitHub release)
# Windows: irm https://raw.githubusercontent.com/niuguy/ytmfast/main/scripts/install.ps1 | iex
set -euo pipefail

BASE="${YTMFAST_BASE_URL:-https://github.com/niuguy/ytmfast/releases/latest/download}"

fail() { printf "YTMFast: %s\n" "$*" >&2; exit 1; }
sha256() { if command -v sha256sum > /dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
command -v curl > /dev/null || fail "curl is required"

case "$(uname -s)" in
  Darwin)
    # A shell under Rosetta reports x86_64 on an Apple silicon Mac, so ask the hardware.
    [ "$(sysctl -n hw.optional.arm64 2> /dev/null || true)" = 1 ] || fail "the macOS build needs Apple silicon"
    ASSET=ytmfast-macos-arm64.zip
    [ "$(sw_vers -productVersion | cut -d. -f1)" -ge 14 ] || fail "YTMFast needs macOS 14 or later" ;;
  Linux)
    [ "$(uname -m)" = x86_64 ] || fail "the Linux build needs x86_64"
    ASSET=ytmfast-linux-x86_64.tar.gz ;;
  *) fail "on Windows, run: irm https://raw.githubusercontent.com/niuguy/ytmfast/main/scripts/install.ps1 | iex" ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "Downloading $ASSET"
curl --proto '=https' --tlsv1.2 -fsSL --retry 3 "$BASE/$ASSET" -o "$WORK/$ASSET" 2> /dev/null \
  || curl -fsSL --retry 3 "$BASE/$ASSET" -o "$WORK/$ASSET" \
  || fail "could not download $ASSET (see https://github.com/niuguy/ytmfast/releases)"
curl -fsSL --retry 3 "$BASE/sha256sums" -o "$WORK/sha256sums" || fail "could not download the checksums"
EXPECTED="$(awk -v asset="$ASSET" '$2 == asset || $2 == "*" asset { print $1 }' "$WORK/sha256sums")"
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$(sha256 "$WORK/$ASSET")" ] || fail "the checksum of $ASSET does not match; nothing was installed"

if [ "$(uname -s)" = Darwin ]; then
  ditto -x -k "$WORK/$ASSET" "$WORK/unpacked"
  [ -d "$WORK/unpacked/YTMFast.app" ] || fail "$ASSET holds no YTMFast.app"
  APPS=/Applications
  if [ ! -w "$APPS" ]; then APPS="$HOME/Applications"; mkdir -p "$APPS"; fi
  rm -rf "$APPS/YTMFast.app"
  mv "$WORK/unpacked/YTMFast.app" "$APPS/YTMFast.app"
  printf "Installed %s/YTMFast.app\n\nOpen it from Launchpad or Spotlight. If it is running, quit it to use the new version.\n" "$APPS"
else
  tar -xzf "$WORK/$ASSET" -C "$WORK"
  [ -x "$WORK/YTMFast/YTMFast" ] || fail "$ASSET holds no YTMFast/YTMFast"
  DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
  DIR="$DATA/ytmfast"
  rm -rf "$DIR"
  mkdir -p "$DATA" "$DATA/applications" "$DATA/icons/hicolor/512x512/apps" "$HOME/.local/bin"
  mv "$WORK/YTMFast" "$DIR"
  ln -sf "$DIR/YTMFast" "$HOME/.local/bin/ytmfast"
  # The launcher entry and its icon, named by the app's id.
  for icon in "$DIR"/*.png; do [ -f "$icon" ] && cp "$icon" "$DATA/icons/hicolor/512x512/apps/"; done
  for entry in "$DIR"/*.desktop; do
    [ -f "$entry" ] || continue
    sed "s|^Exec=.*|Exec=\"$DIR/YTMFast\"|" "$entry" > "$DATA/applications/${entry##*/}"
  done
  command -v update-desktop-database > /dev/null && update-desktop-database "$DATA/applications" > /dev/null 2>&1 || true
  printf "Installed %s\n\nOpen YTMFast from your launcher, or run ytmfast.\n" "$DIR"
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "Add ~/.local/bin to your PATH to use the ytmfast command." ;; esac
  MISSING="$(ldd "$DIR/YTMFast" 2> /dev/null | grep 'not found' || true)"
  if [ -n "$MISSING" ]; then
    printf "\nYTMFast needs GTK 4.14 or later and glibc 2.39 or later (Ubuntu 24.04 or newer). Missing:\n%s\n" "$MISSING"
    echo "On Debian or Ubuntu: sudo apt install libgtk-4-1"
  fi
fi

# YouTube Music plays in its own web player, inside a browser you have installed.
browser=
if [ "$(uname -s)" = Darwin ]; then
  for app in "Google Chrome" Chromium "Microsoft Edge" "Brave Browser"; do
    [ -d "/Applications/$app.app" ] || [ -d "$HOME/Applications/$app.app" ] && { browser=1; break; }
  done
else
  for bin in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge microsoft-edge-stable brave brave-browser; do
    command -v "$bin" > /dev/null && { browser=1; break; }
  done
fi
[ -n "$browser" ] || printf "\nYTMFast plays through YouTube Music's web player in Chrome, Chromium, Edge or Brave; install one of them first.\n"
