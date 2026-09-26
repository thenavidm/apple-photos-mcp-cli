#!/usr/bin/env bash
# Build the .mcpb bundle Claude Desktop installs on a double click.
#
# It is a zip holding the compiled server, its production dependencies and the
# manifest. Dependencies are vendored because Desktop does not run npm: whatever
# is in the zip is what runs.
#
# The Python engine ships inside it too. What is NOT vendored is uv, which
# fetches osxphotos and photoscript on first run; those pull in pyobjc and only
# build on macOS, so bundling them would make a zip that is wrong on any other
# machine and enormous on this one.
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="$(node -p "require('./package.json').version")"
OUT="desktop-extension/apple-photos-${VERSION}.mcpb"
BUILD="desktop-extension/build"

# The manifest version has to track package.json, or Claude Desktop reports one
# number while the server answers another.
node -e "
  const fs = require('fs');
  const p = 'desktop-extension/manifest.json';
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (m.version !== '$VERSION') {
    m.version = '$VERSION';
    fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
    console.log('manifest version -> $VERSION');
  }
"

npm run build

rm -rf "$BUILD"
mkdir -p "$BUILD/server"

cp -R lib/* "$BUILD/server/"
# The engine, and the metadata uv needs to resolve it.
mkdir -p "$BUILD/src"
cp -R src/apple_photos_mcp "$BUILD/src/"
find "$BUILD/src" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
cp pyproject.toml "$BUILD/"
cp desktop-extension/manifest.json "$BUILD/manifest.json"
cp README.md LICENSE "$BUILD/"

node -e "
const pkg = require('./package.json');
require('fs').writeFileSync('$BUILD/package.json', JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  type: 'module',
  dependencies: pkg.dependencies,
}, null, 2));
"

( cd "$BUILD" && npm install --omit=dev --no-audit --no-fund --silent )

rm -f "$OUT"
( cd "$BUILD" && zip -qr "../../$OUT" . -x '*.DS_Store' )

echo "$OUT  $(du -h "$OUT" | cut -f1)"
