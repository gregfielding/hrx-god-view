import assert from 'assert';
import {
  buildAccusourceApplicantPortalLink,
  getAccusourceApplicantSetupBaseUrl,
} from '../../integrations/accusource/config';
import { accusourceWebhookForTests } from '../../integrations/accusource/webhooks';

const {
  mergeWebhookPayload,
  extractEventType,
  extractPartialProfileToken,
  isPartialProfileLinkEventType,
  PARTIAL_PROFILE_LINK_TYPE,
} = accusourceWebhookForTests;

describe('AccuSource applicant setup URL (config)', () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.ACCUSOURCE_APPLICANT_SETUP_BASE_URL;
    delete process.env.ACCUSOURCE_APPLICANT_SETUP_BASE_URL;
  });

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.ACCUSOURCE_APPLICANT_SETUP_BASE_URL;
    } else {
      process.env.ACCUSOURCE_APPLICANT_SETUP_BASE_URL = prev;
    }
  });

  it('uses production applicant setup base URL', () => {
    assert.strictEqual(
      getAccusourceApplicantSetupBaseUrl('production'),
      'https://myaccusourcedirect.com/setup?token=',
    );
  });

  it('uses sandbox applicant setup base URL', () => {
    assert.strictEqual(
      getAccusourceApplicantSetupBaseUrl('sandbox'),
      'https://sandbox.myaccusourcedirect.construction/setup?token=',
    );
  });

  it('builds full portal link with encoded token', () => {
    const url = buildAccusourceApplicantPortalLink('sandbox', 'TOKEN_VALUE');
    assert.strictEqual(
      url,
      'https://sandbox.myaccusourcedirect.construction/setup?token=TOKEN_VALUE',
    );
  });

  it('respects ACCUSOURCE_APPLICANT_SETUP_BASE_URL override', () => {
    process.env.ACCUSOURCE_APPLICANT_SETUP_BASE_URL = 'https://example.com/setup?token=';
    assert.strictEqual(
      getAccusourceApplicantSetupBaseUrl('sandbox'),
      'https://example.com/setup?token=',
    );
    const link = buildAccusourceApplicantPortalLink('production', 'abc');
    assert.strictEqual(link, 'https://example.com/setup?token=abc');
  });
});

describe('partial_profile_link webhook normalization', () => {
  const sample = {
    type: 'partial_profile_link',
    payload: {
      profile_id: 144815,
      last_name: 'test',
      first_name: 'test',
      status: 'Awaiting Subject',
      status_id: 63,
      client_id: null,
      partial_profile_link: 'TOKEN_VALUE',
    },
  };

  it('merges nested payload and normalizes event type', () => {
    const merged = mergeWebhookPayload(sample as Record<string, unknown>);
    assert.strictEqual(extractEventType(merged), PARTIAL_PROFILE_LINK_TYPE);
    assert.strictEqual(extractPartialProfileToken(merged), 'TOKEN_VALUE');
    assert(isPartialProfileLinkEventType(extractEventType(merged)));
  });

  it('exposes profile_id for matching when client_id is null', () => {
    const merged = mergeWebhookPayload(sample as Record<string, unknown>);
    assert.strictEqual(String(merged.profile_id), '144815');
    assert.strictEqual(merged.client_id, null);
  });
});
