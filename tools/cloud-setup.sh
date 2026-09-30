#!/usr/bin/env bash
# Provision a cloud VM (claude.ai routines / cloud sessions) for the Hurdles loop:
# npm deps (three, playwright), Playwright's Chromium headless shell, and ffmpeg.
#
#   tools/cloud-setup.sh            idempotent; each step is skipped when already done
#   tools/cloud-setup.sh --no-apt   skip apt (ffmpeg, Chromium's system libraries)
#
# tools/hurdles-cloud.sh start runs this after it takes the lock, so runs that skip
# never pay for it. It can also be pasted into the cloud environment's setup script,
# so the result is cached in the VM snapshot (see docs: cloud-environments).
#
# The Trusted network level blocks the Playwright CDN, so the headless shell comes
# from Chrome for Testing on storage.googleapis.com (allowed), at the exact version
# and revision the pinned playwright package expects, unpacked where it looks.

set -euo pipefail
cd "$(dirname "$0")/.."

apt=1; [ "${1:-}" = "--no-apt" ] && apt=0
say() { echo "cloud-setup: $*" >&2; }
SUDO=; [ "$(id -u)" -ne 0 ] && SUDO=sudo

if [ ! -d node_modules/three ] || [ ! -d node_modules/playwright ]; then
  say "npm ci"; npm ci --no-audit --no-fund >&2
fi

browsers="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
bj=node_modules/playwright-core/browsers.json
field() { jq -r --arg n "$1" ".browsers[] | select(.name == \$n) | .$2" "$bj"; }

rev=$(field chromium-headless-shell revision); ver=$(field chromium-headless-shell browserVersion)
dir="$browsers/chromium_headless_shell-$rev"
if [ ! -e "$dir/INSTALLATION_COMPLETE" ]; then
  say "chrome-headless-shell $ver -> $dir"
  tmp=$(mktemp -d)
  curl -fsSL --retry 3 -o "$tmp/shell.zip" \
    "https://storage.googleapis.com/chrome-for-testing-public/$ver/linux64/chrome-headless-shell-linux64.zip"
  mkdir -p "$dir"
  # No unzip on every box; python keeps the executable bits that zipfile drops.
  python3 - "$tmp/shell.zip" "$dir" <<'PY'
import os, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
for info in z.infolist():
    path = z.extract(info, sys.argv[2])
    mode = info.external_attr >> 16
    if mode and not info.is_dir():
        os.chmod(path, mode & 0o777)
PY
  touch "$dir/INSTALLATION_COMPLETE" "$dir/DEPENDENCIES_VALIDATED"
  rm -rf "$tmp"
fi

if [ $apt = 1 ]; then
  if ! command -v ffmpeg >/dev/null; then
    say "apt: ffmpeg"
    $SUDO apt-get update -qq >&2
    DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq --no-install-recommends ffmpeg >&2
  fi
  marker="$browsers/.hurdles-deps-$rev"
  if [ ! -e "$marker" ]; then
    say "apt: chromium system libraries"
    npx playwright install-deps chromium-headless-shell >&2 && touch "$marker"
  fi
fi

# Playwright records --video with its own ffmpeg build (also on the blocked CDN);
# the system ffmpeg understands the same arguments.
frev=$(field ffmpeg revision); fdir="$browsers/ffmpeg-$frev"
if [ ! -e "$fdir/INSTALLATION_COMPLETE" ] && command -v ffmpeg >/dev/null; then
  mkdir -p "$fdir" && ln -sf "$(command -v ffmpeg)" "$fdir/ffmpeg-linux" && touch "$fdir/INSTALLATION_COMPLETE"
fi

say "ok"
