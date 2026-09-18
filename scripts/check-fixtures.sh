#!/usr/bin/env bash
# Installs packed tarballs into throwaway apps, so resolution and types are
# exercised the way a consumer sees them rather than through workspace links.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/.fixture-tarballs"
rm -rf "$out" && mkdir -p "$out"

# `pnpm pack` names each tarball after its version. The fixtures' manifests
# pin the tarballs by path, so they are renamed to a version-free name and
# stay valid across releases. A glob would be wrong here: `pylo-auth-*` also
# matches `pylo-auth-nextjs`, so the name is built exactly.
tarball() {
  echo "$out/pylo-$1.tgz"
}

for pkg in auth auth-nextjs core node react expo nextjs; do
  ver="$(node -p "require('$root/$pkg/package.json').version")"
  (cd "$root/$pkg" && pnpm pack --pack-destination "$out" >/dev/null)
  mv "$out/pylo-$pkg-$ver.tgz" "$(tarball "$pkg")"
done

install_into() {
  local fixture="$1"; shift
  (
    cd "$fixture"
    rm -rf node_modules package-lock.json
    npm install --no-audit --no-fund

    # The packed tarballs go in by hand. Handing them to npm re-runs resolution
    # against local file: specs, which has left sibling dependencies half
    # written. Peer dependencies are already in place from the install above,
    # and what these fixtures test is resolution out of node_modules.
    for p in "$@"; do
      target="node_modules/@pylo/$p"
      rm -rf "$target" && mkdir -p "$target"
      tar -xzf "$(tarball "$p")" -C "$target" --strip-components=1
    done

    npm run check
  )
}

only="${1:-}"
run() { [ -z "$only" ] || [ "$only" = "$1" ]; }

run node       && { echo "==> node";       install_into "$root/fixtures/node" auth core node; }
run vite-react && { echo "==> vite-react"; install_into "$root/fixtures/vite-react" auth core react; }
run nextjs     && { echo "==> nextjs";     install_into "$root/fixtures/nextjs" auth auth-nextjs core react nextjs; }
run expo       && { echo "==> expo";       install_into "$root/fixtures/expo" auth core react expo; }

echo "all fixtures passed"
