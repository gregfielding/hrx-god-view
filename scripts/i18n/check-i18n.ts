/**
 * i18n check: fail if (1) a key exists in en.json but is missing in es.json,
 * or (2) code uses t("some.key") with a key not found in en.json.
 * Run: npm run i18n:check
 */

import * as fs from 'fs';
import * as path from 'path';

import { WORKER_AI_PRESCREEN_STEPS } from '../../src/constants/workerAiPrescreenQuestions';

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

  // (3) Worker AI prescreen uses dynamic t(`workerAiPrescreen.steps.${id}.prompt`) — ensure every core step id exists in en + es.
  for (const step of WORKER_AI_PRESCREEN_STEPS) {
    const promptKey = `workerAiPrescreen.steps.${step.id}.prompt`;
    if (!enKeySet.has(promptKey)) {
      console.error(`[i18n] en.json missing (required for prescreen UI): ${promptKey}`);
      failed = true;
    }
    if (!esKeySet.has(promptKey)) {
      console.error(`[i18n] es.json missing (required for prescreen UI): ${promptKey}`);
      failed = true;
    }
  }
  const openMapsKey = 'workerAiPrescreen.openInMaps';
  if (!enKeySet.has(openMapsKey)) {
    console.error(`[i18n] en.json missing: ${openMapsKey}`);
    failed = true;
  }
  if (!esKeySet.has(openMapsKey)) {
    console.error(`[i18n] es.json missing: ${openMapsKey}`);
    failed = true;
  }

  // (4) Job-specific dynamic prescreen steps use t(promptKey) on the client — keep JSON aligned with `buildDynamicPrescreenQuestions.ts`.
  const DYNAMIC_PRESCREEN_I18N_KEYS = [
    'workerAiPrescreen.dynamicOpts.yes',
    'workerAiPrescreen.dynamicOpts.no',
    'workerAiPrescreen.dynamicOpts.not_sure',
    'workerAiPrescreen.dynamic.dyn_shift_punctuality',
    'workerAiPrescreen.dynamic.dyn_worksite_commute',
    'workerAiPrescreen.dynamic.dyn_job_drug_screen',
    'workerAiPrescreen.dynamic.dyn_job_background_check',
    'workerAiPrescreen.dynamic.dyn_physical_job_fit',
    'workerAiPrescreen.dynamic.dyn_cert_have',
    'workerAiPrescreen.dynamic.dyn_cert_willing',
    'workerAiPrescreen.dynamic.dyn_uniform_available',
    'workerAiPrescreen.dynamic.dyn_gig_path_willing',
  ];
  for (const k of DYNAMIC_PRESCREEN_I18N_KEYS) {
    if (!enKeySet.has(k)) {
      console.error(`[i18n] en.json missing (dynamic prescreen): ${k}`);
      failed = true;
    }
    if (!esKeySet.has(k)) {
      console.error(`[i18n] es.json missing (dynamic prescreen): ${k}`);
      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log('[i18n] check OK: en/es keys aligned, referenced keys present.');
}

main();
