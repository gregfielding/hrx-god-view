/**
 * Recover original source files from a CRA/webpack source map.
 *
 * Usage:
 *   node scripts/recoverHostingSources.js <path/to/bundle.js.map> <outputDir>
 *
 * Notes:
 * - Only writes files when sourcesContent exists.
 * - Strips common webpack prefixes (webpack:///, webpack://, ./).
 */
const fs = require('fs');
const path = require('path');

function normalizeSourcePath(src) {
  if (!src) return null;
  let s = String(src);
  s = s.replace(/^webpack:\/\//, ''); // webpack://
  s = s.replace(/^\/+/, ''); // leading slashes
  s = s.replace(/^\.\//, ''); // ./...
  // Common in CRA sourcemaps: "../webpack/..." or "../node_modules/..."
  s = s.replace(/^\.\.\//, ''); // ../...

  // Drop any query/hash fragments
  s = s.split('?')[0].split('#')[0];

  // Avoid writing outside output dir
  s = s.replace(/\.\.(\/|\\)/g, '');

  return s || null;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  const [, , mapPath, outDir] = process.argv;
  if (!mapPath || !outDir) {
    console.error('Usage: node scripts/recoverHostingSources.js <path/to/bundle.js.map> <outputDir>');
    process.exit(2);
  }

  const raw = fs.readFileSync(mapPath, 'utf8');
  const map = JSON.parse(raw);

  const sources = Array.isArray(map.sources) ? map.sources : [];
  const sourcesContent = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];

  if (sources.length === 0 || sourcesContent.length === 0) {
    console.error('No sources/sourcesContent found in map; cannot recover sources.');
    process.exit(1);
  }

  ensureDir(outDir);

  let written = 0;
  let skipped = 0;

  for (let i = 0; i < sources.length; i++) {
    const src = normalizeSourcePath(sources[i]);
    const content = sourcesContent[i];

    if (!src || typeof content !== 'string') {
      skipped++;
      continue;
    }

    // Skip webpack internals and node_modules
    if (src.startsWith('webpack/') || src.startsWith('node_modules/')) {
      skipped++;
      continue;
    }

    // CRA often emits app sources as paths relative to src/, e.g. "components/Foo.tsx"
    // Normalize to a real file path under src/
    let outRel = src;
    if (
      !outRel.startsWith('src/') &&
      !outRel.startsWith('functions/') &&
      !outRel.startsWith('scripts/') &&
      !outRel.startsWith('public/')
    ) {
      outRel = path.posix.join('src', outRel);
    }

    // Only recover likely project sources (keep broad, but avoid junk)
    const allow =
      outRel.startsWith('src/') ||
      outRel.startsWith('functions/') ||
      outRel.startsWith('scripts/') ||
      outRel.startsWith('public/');

    if (!allow) {
      skipped++;
      continue;
    }

    const outPath = path.join(outDir, outRel);
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, content, 'utf8');
    written++;
  }

  console.log(`Recovered sources written: ${written}`);
  console.log(`Skipped entries: ${skipped}`);
  console.log(`Output directory: ${outDir}`);
}

main();


