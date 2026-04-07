#!/usr/bin/env npx ts-node
/**
 * Local smoke test: Document AI extraction for I-9 supporting docs (same routing + mapper as
 * onWorkerI9SupportingDocumentExtract; no Firestore / no trigger changes).
 *
 * Usage:
 *   npm run test:i9-extraction
 *   npm run test:i9-extraction -- list_b_drivers_license /path/to/dl.jpg list_a_ead ./ead.jpg
 */
import * as fs from 'fs';
import * as path from 'path';
import { config as loadEnv } from 'dotenv';
import { DocumentProcessorServiceClient, protos } from '@google-cloud/documentai';
import {
  mapDocumentAiToExtractedFields,
  resolveExtractionRouting,
} from '../src/onboarding/i9SupportingDocumentExtractionMapper';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const DEFAULT_TEST_CASES: Array<{ type: string; file: string }> = [
  { type: 'list_c_ssn_card', file: 'ssn_card.jpg' },
  { type: 'list_b_drivers_license', file: 'drivers_license.jpg' },
  { type: 'list_a_pr_card', file: 'green_card.jpg' },
  { type: 'list_a_ead', file: 'ead.jpg' },
  { type: 'list_a_us_passport', file: 'passport.jpg' },
  { type: 'list_b_gov_id', file: 'state_id.jpg' },
  { type: 'list_c_birth_certificate', file: 'birth_certificate.jpg' },
];

const TEST_DATA_DIR = path.join(__dirname, '../test-data/i9');

function loadProcessEnv(): void {
  loadEnv({ path: path.join(__dirname, '../../.env') });
  loadEnv({ path: path.join(__dirname, '../.env') });
}

function mimeForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/pdf';
}

function shortLabel(documentType: string): string {
  const t = documentType.replace(/^list_[abc]_/, '');
  return t || documentType;
}

function parseArgs(argv: string[]): Array<{ type: string; filePath: string }> {
  const rest = argv.filter((a) => a !== '--');
  if (rest.length === 0) {
    return DEFAULT_TEST_CASES.map((c) => ({
      type: c.type,
      filePath: path.join(TEST_DATA_DIR, c.file),
    }));
  }
  if (rest.length % 2 !== 0) {
    console.error(
      `${RED}Expected pairs: <documentType> <filePath> [...]. Got ${rest.length} argument(s).${RESET}`,
    );
    console.error(`Example: npm run test:i9-extraction -- list_b_drivers_license ./my.jpg`);
    process.exit(2);
  }
  const out: Array<{ type: string; filePath: string }> = [];
  for (let i = 0; i < rest.length; i += 2) {
    out.push({ type: String(rest[i]).trim(), filePath: path.resolve(rest[i + 1]) });
  }
  return out;
}

async function runOne(
  documentType: string,
  filePath: string,
): Promise<{
  ok: boolean;
  processorType: string;
  status: string;
  documentNumber: string;
  fullName: string;
  expirationDate: string;
  warnings: string[];
  errorDetail?: string;
}> {
  const routing = resolveExtractionRouting(documentType, process.env);

  if (routing.type === 'unsupported') {
    return {
      ok: false,
      processorType: '(none)',
      status: 'extraction_unsupported',
      documentNumber: '',
      fullName: '',
      expirationDate: '',
      warnings: [],
      errorDetail: 'No extractor configured for this documentType.',
    };
  }

  if (routing.type === 'missing_env') {
    return {
      ok: false,
      processorType: routing.processorType,
      status: 'missing_processor_env',
      documentNumber: '',
      fullName: '',
      expirationDate: '',
      warnings: [],
      errorDetail: routing.message,
    };
  }

  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      processorType: routing.kind,
      status: 'file_missing',
      documentNumber: '',
      fullName: '',
      expirationDate: '',
      warnings: [],
      errorDetail: `File not found: ${filePath}`,
    };
  }

  const buf = fs.readFileSync(filePath);
  const mimeType = mimeForPath(filePath);
  const client = new DocumentProcessorServiceClient();

  const request: protos.google.cloud.documentai.v1.IProcessRequest = {
    name: routing.resourceName,
    rawDocument: {
      content: buf,
      mimeType,
    },
  };

  try {
    const [result] = await client.processDocument(request);
    const mapped = mapDocumentAiToExtractedFields(result.document, routing.kind);
    const ef = mapped.extractedFields || {};
    const warnings = mapped.extractionWarnings || [];
    return {
      ok: true,
      processorType: routing.kind,
      status: 'extraction_complete',
      documentNumber: String(ef.documentNumber || '').trim(),
      fullName: String(ef.fullName || '').trim(),
      expirationDate: String(ef.expirationDate || '').trim(),
      warnings,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      processorType: routing.kind,
      status: 'extraction_failed',
      documentNumber: '',
      fullName: '',
      expirationDate: '',
      warnings: [],
      errorDetail: msg,
    };
  }
}

function printResult(
  documentType: string,
  r: Awaited<ReturnType<typeof runOne>>,
): void {
  const label = shortLabel(documentType);
  const pass = r.ok && r.status === 'extraction_complete';
  const tag = pass ? `${GREEN}[PASS]${RESET}` : `${RED}[FAIL]${RESET}`;
  console.log('');
  console.log(`${tag} ${label}`);
  console.log(`  documentType: ${documentType}`);
  console.log(`  processor: ${r.processorType}`);
  console.log(`  status: ${r.status}`);
  console.log(`  documentNumber: ${r.documentNumber || '(empty)'}`);
  console.log(`  fullName: ${r.fullName || '(empty)'}`);
  console.log(`  expirationDate: ${r.expirationDate || '(empty)'}`);
  console.log(`  warnings: ${JSON.stringify(r.warnings)}`);
  if (r.errorDetail) {
    console.log(`  ${RED}detail: ${r.errorDetail}${RESET}`);
  }
}

async function main(): Promise<void> {
  loadProcessEnv();

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`I-9 Document AI smoke test (read-only; no Firestore).

Default: runs cases from ${TEST_DATA_DIR} (see README there).

Custom: npm run test:i9-extraction -- <documentType> <filePath> [...]

Env: DOCUMENT_AI_PROJECT_ID, DOCUMENT_AI_LOCATION, and per-type processor vars
(see i9SupportingDocumentExtractionMapper PROCESSOR_ENV_KEY).
`);
    process.exit(0);
  }

  const cases = parseArgs(process.argv.slice(2));
  let failed = 0;

  for (const { type, filePath } of cases) {
    const r = await runOne(type, filePath);
    printResult(type, r);
    if (!r.ok || r.status !== 'extraction_complete') failed += 1;
  }

  console.log('');
  if (failed) {
    console.log(`${RED}${failed} case(s) failed.${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}All cases passed.${RESET}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
