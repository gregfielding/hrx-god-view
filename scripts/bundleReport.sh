#!/usr/bin/env bash
set -euo pipefail

echo "Running CRA build for bundle analysis (approx)..."
npm run build --silent >/dev/null 2>&1 || true

if [ -d build/static/js ]; then
  echo "Top JS bundles (gzipped):"
  ls -S build/static/js/*.js | head -n 10 | xargs -I{} bash -c 'printf "%8s  %s\n" $(gzip -c {} | wc -c) {}' | sort -nr | head -n 10
else
  echo "build/static/js not found; ensure app builds locally."
fi


