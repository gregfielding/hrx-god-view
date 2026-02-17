/**
 * i18n check: fail if (1) a key exists in en.json but is missing in es.json,
 * or (2) code uses t("some.key") with a key not found in en.json.
 * Run: npm run i18n:check
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const LOCALES_DIR = path.join(ROOT, 'i18n', 'locales');
const SRC_DIR = path.join(ROOT, 'src');

function allKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value != null && typeof value === 'object' && !Array.isArray(value) && typeof (value as any) === 'object') {
      keys.push(...allKeys(value as Record<string, unknown>, fullKey));
    } else if (typeof value === 'string') {
      keys.push(fullKey);
    }
  }
  return keys;
}

function loadJson(filePath: string): Record<string, unknown> {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function extractTKeysFromFile(content: string): string[] {
  const keys: string[] = [];
  // t("key") or t('key') or t(`key`)
  const regex = /t\s*\(\s*["'`]([^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

function extractTKeysFromDir(dir: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules') {
      const sub = extractTKeysFromDir(full);
      sub.forEach((keys, file) => map.set(file, keys));
    } else if (e.isFile() && /\.(tsx?|jsx?)$/.test(e.name)) {
      const content = fs.readFileSync(full, 'utf-8');
      const keys = extractTKeysFromFile(content);
      if (keys.length) map.set(path.relative(ROOT, full), keys);
    }
  }
  return map;
}

function main(): void {
  const enPath = path.join(LOCALES_DIR, 'en.json');
  const esPath = path.join(LOCALES_DIR, 'es.json');
  if (!fs.existsSync(enPath)) {
    console.error('Missing i18n/locales/en.json');
    process.exit(1);
  }
  if (!fs.existsSync(esPath)) {
    console.error('Missing i18n/locales/es.json');
    process.exit(1);
  }

  const en = loadJson(enPath);
  const es = loadJson(esPath);
  const enKeySet = new Set(allKeys(en));
  const esKeySet = new Set(allKeys(es));

  let failed = false;

  // (1) Every key in en must exist in es
  for (const key of enKeySet) {
    if (!esKeySet.has(key)) {
      console.error(`[i18n] es.json missing key: ${key}`);
      failed = true;
    }
  }

  // (2) Every t("area.key") in src (worker i18n) must exist in en. Only check keys that look like our i18n (dot path).
  const I18N_KEY_REGEX = /^[a-z]+\.[a-zA-Z0-9.]+$/;
  if (fs.existsSync(SRC_DIR)) {
    const fileToKeys = extractTKeysFromDir(SRC_DIR);
    for (const [file, keys] of fileToKeys) {
      for (const key of keys) {
        if (!I18N_KEY_REGEX.test(key)) continue; // skip t("hex"), t("\n"), etc.
        if (!enKeySet.has(key)) {
          console.error(`[i18n] Unknown key in ${file}: ${key}`);
          failed = true;
        }
      }
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log('[i18n] check OK: en/es keys aligned, referenced keys present.');
}

main();
