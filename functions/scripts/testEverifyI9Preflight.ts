#!/usr/bin/env npx ts-node
/**
 * Smoke tests: i9_case_flat preflight (no Firestore, no USCIS).
 *
 * Usage:
 *   npm run test:everify-preflight
 *
 * Env:
 *   EVERIFY_PREFLIGHT_EXTENDED_LISTA=off|warn|error
 */
import { applyRestDraftPayloadNormalization } from '../src/integrations/everify/everifyI9Provider';
import { preflightI9CreateCasePayloadAfterNormalization } from '../src/integrations/everify/everifyI9Preflight';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function base(): Record<string, unknown> {
  return {
    first_name: 'Test',
    last_name: 'User',
    date_of_birth: '1990-06-15',
    date_of_hire: '2026-01-10',
    ssn: '890123456',
    citizenship_status_code: 'US_CITIZEN',
    case_creator_name: 'Verifier',
    case_creator_email_address: 'verifier@example.com',
    case_creator_phone_number: '5551234567',
  };
}

function run(name: string, payload: Record<string, unknown>, expectPass: boolean): void {
  const data = { ...payload };
  applyRestDraftPayloadNormalization(data);
  try {
    preflightI9CreateCasePayloadAfterNormalization(data);
    if (expectPass) {
      console.log(`${GREEN}[PASS]${RESET} ${name}`);
    } else {
      console.log(`${RED}[FAIL]${RESET} ${name} (expected error)`);
      process.exitCode = 1;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!expectPass) {
      console.log(`${GREEN}[PASS]${RESET} ${name} → ${msg.slice(0, 120)}`);
    } else {
      console.log(`${RED}[FAIL]${RESET} ${name} → ${msg}`);
      process.exitCode = 1;
    }
  }
}

function main(): void {
  console.log('E-Verify I-9 preflight smoke tests\n');

  const usPass = {
    ...base(),
    document_a_type_code: 'US_PASSPORT',
    us_passport_number: '12345678',
  };
  run('US citizen + US_PASSPORT', usPass, true);

  const lpr = {
    ...base(),
    citizenship_status_code: 'LAWFUL_PERMANENT_RESIDENT',
    document_a_type_code: 'FORM_I551',
    alien_number: 'A123456789',
    i551_number: 'ABC1234567890123456',
  };
  run('LPR + FORM_I551', lpr, true);

  const ead = {
    ...base(),
    citizenship_status_code: 'ALIEN_AUTHORIZED_TO_WORK',
    document_a_type_code: 'FORM_I766',
    i766_number: 'EAD123',
  };
  run('EAD + FORM_I766', ead, true);

  const bc: Record<string, unknown> = {
    ...base(),
    document_b_type_code: 'DRIVERS_LICENSE',
    document_c_type_code: 'BIRTH_CERTIFICATE',
    document_bc_number: 'D123',
    expiration_date: '2030-01-01',
    us_state_code: 'CA',
  };
  run('List B + C (DL + birth cert)', bc, true);

  run(
    'Failure: bad SSN pattern',
    { ...usPass, ssn: '000-00-0000' },
    false,
  );

  run(
    'Failure: US_CITIZEN + FORM_I766',
    {
      ...base(),
      document_a_type_code: 'FORM_I766',
      i766_number: 'x',
    },
    false,
  );

  console.log('');
  if (process.exitCode) {
    console.log(`${RED}Some tests failed.${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}All tests passed.${RESET}`);
}

main();
