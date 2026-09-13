#!/usr/bin/env bash
#
# liteCodeAgent bootstrap.
#
#   bash install.sh
#
# Idempotent: running it again updates an existing install instead of failing.
# Override the location with LITECODE_HOME=/somewhere bash install.sh

set -euo pipefail

REPO="${LITECODE_REPO:-woueziou/liteCodeAgent}"
HOME_DIR="${LITECODE_HOME:-$HOME/.litecode}"

red() { printf '\033[31m%s\033[0m\n' "$1" >&2; }
dim() { printf '\033[2m%s\033[0m\n' "$1"; }
ok()  { printf '\033[32m%s\033[0m %s\n' "✓" "$1"; }

command -v bun >/dev/null 2>&1 || {
  red "bun is required but not installed."
  red "  curl -fsSL https://bun.sh/install | bash"
  exit 1
}

if [ -d "$HOME_DIR/.git" ]; then
  dim "Updating $HOME_DIR"
  git -C "$HOME_DIR" pull --ff-only --quiet
else
  dim "Cloning $REPO into $HOME_DIR"
  if command -v gh >/dev/null 2>&1; then
    # `gh` carries your GitHub auth, so this works for a private repo.
    gh repo clone "$REPO" "$HOME_DIR" -- --quiet
  else
    git clone --quiet "git@github.com:$REPO.git" "$HOME_DIR"
  fi
fi

dim "Installing dependencies"
(cd "$HOME_DIR" && bun install --silent)

dim "Linking the litecode command"
(cd "$HOME_DIR" && bun link >/dev/null 2>&1)

BIN="$(cd "$HOME_DIR" && bun pm bin -g 2>/dev/null || echo "$HOME/.bun/bin")"

if ! command -v litecode >/dev/null 2>&1; then
  red "litecode was linked into $BIN, which is not on your PATH."
  red "Add this to your shell profile, then restart your shell:"
  red "  export PATH=\"$BIN:\$PATH\""
  exit 1
fi

ok "litecode installed ($(cd "$HOME_DIR" && git rev-parse --short HEAD))"
echo
echo "Next, in the repo you want the pipeline in:"
echo "  litecode init --packs core,web"
echo "  \$EDITOR litecode.config.json"
echo "  litecode install --apply"
