/**
 * **`eventHash` unit tests (Slice 1).**
 *
 * Pure-function tests. No Firestore, no Firebase imports. If a future
 * change makes the function depend on IO, push the IO to the caller
 * and keep this file pure.
 */

import { expect } from 'chai';

import {
  BODY_PREVIEW_HASH_CAP,
  computeEventHash,
  extractDateHeader,
  extractMessageId,
} from '../../../integrations/indeedFlex/eventHash';

describe('computeEventHash', () => {
  describe('Message-ID path', () => {
    it('returns a 64-char hex digest', () => {
      const hash = computeEventHash({ messageId: '<abc@indeedflex.com>' });
      expect(hash).to.match(/^[0-9a-f]{64}$/);
    });

    it('is stable across calls', () => {
      const a = computeEventHash({ messageId: '<abc@indeedflex.com>' });
      const b = computeEventHash({ messageId: '<abc@indeedflex.com>' });
      expect(a).to.equal(b);
    });

    it('produces distinct hashes for distinct Message-IDs', () => {
      const a = computeEventHash({ messageId: '<a@indeedflex.com>' });
      const b = computeEventHash({ messageId: '<b@indeedflex.com>' });
      expect(a).to.not.equal(b);
    });

    it('trims surrounding whitespace on Message-ID', () => {
      const a = computeEventHash({ messageId: '<abc@indeedflex.com>' });
      const b = computeEventHash({ messageId: '   <abc@indeedflex.com>\n' });
      expect(a).to.equal(b);
    });

    it('ignores from/subject/body when Message-ID is present', () => {
      const a = computeEventHash({
        messageId: '<abc@indeedflex.com>',
        from: 'one@indeedflex.com',
        subject: 'one',
        bodyPreview: 'one',
      });
      const b = computeEventHash({
        messageId: '<abc@indeedflex.com>',
        from: 'two@indeedflex.com',
        subject: 'two',
        bodyPreview: 'two',
      });
      expect(a).to.equal(b);
    });
  });

  describe('Fallback (no Message-ID) path', () => {
    const baseInput = {
      from: 'notifications@indeedflex.com',
      subject: 'New job request',
      date: 'Fri, 16 May 2026 09:00:00 -0400',
      bodyPreview: 'CORT, ATL - Savannah, May 16, 2026...',
    };

    it('returns a 64-char hex digest', () => {
      const hash = computeEventHash(baseInput);
      expect(hash).to.match(/^[0-9a-f]{64}$/);
    });

    it('is stable across calls', () => {
      expect(computeEventHash(baseInput)).to.equal(computeEventHash(baseInput));
    });

    it('produces a different hash than the Message-ID path for the same input', () => {
      const fallback = computeEventHash(baseInput);
      const mid = computeEventHash({ ...baseInput, messageId: '<x@y.com>' });
      expect(fallback).to.not.equal(mid);
    });

    it('treats from case-insensitively', () => {
      const a = computeEventHash({ ...baseInput, from: 'a@indeedflex.com' });
      const b = computeEventHash({ ...baseInput, from: 'A@INDEEDFLEX.COM' });
      expect(a).to.equal(b);
    });

    it('produces a different hash when subject differs', () => {
      const a = computeEventHash({ ...baseInput, subject: 'New job request' });
      const b = computeEventHash({ ...baseInput, subject: 'Booking changed' });
      expect(a).to.not.equal(b);
    });

    it('produces a different hash when body differs (within preview cap)', () => {
      const a = computeEventHash({ ...baseInput, bodyPreview: 'ATL Savannah' });
      const b = computeEventHash({ ...baseInput, bodyPreview: 'CHI Woodridge' });
      expect(a).to.not.equal(b);
    });

    it('only considers the first BODY_PREVIEW_HASH_CAP body chars', () => {
      const head = 'X'.repeat(BODY_PREVIEW_HASH_CAP);
      const a = computeEventHash({ ...baseInput, bodyPreview: head + 'extra1' });
      const b = computeEventHash({ ...baseInput, bodyPreview: head + 'extra2-different' });
      expect(a).to.equal(b);
    });

    it('handles all-missing input without crashing', () => {
      const hash = computeEventHash({});
      expect(hash).to.match(/^[0-9a-f]{64}$/);
    });
  });

  describe('Message-ID falls through to fallback when malformed', () => {
    it('rejects Message-IDs without angle brackets', () => {
      const baseInput = {
        messageId: 'abc@indeedflex.com', // missing < >
        from: 'a@b.com',
        subject: 's',
        date: 'd',
        bodyPreview: 'body',
      };
      const withMid = computeEventHash(baseInput);
      const withoutMid = computeEventHash({ ...baseInput, messageId: undefined });
      expect(withMid).to.equal(withoutMid);
    });

    it('rejects Message-IDs without an @', () => {
      const baseInput = {
        messageId: '<no-at-sign>',
        from: 'a@b.com',
        subject: 's',
        date: 'd',
        bodyPreview: 'body',
      };
      const withMid = computeEventHash(baseInput);
      const withoutMid = computeEventHash({ ...baseInput, messageId: undefined });
      expect(withMid).to.equal(withoutMid);
    });

    it('rejects empty-string Message-ID', () => {
      const baseInput = {
        messageId: '',
        from: 'a@b.com',
        subject: 's',
        date: 'd',
        bodyPreview: 'body',
      };
      const withMid = computeEventHash(baseInput);
      const withoutMid = computeEventHash({ ...baseInput, messageId: undefined });
      expect(withMid).to.equal(withoutMid);
    });
  });
});

describe('extractMessageId', () => {
  it('returns undefined for empty/nullish input', () => {
    expect(extractMessageId('')).to.equal(undefined);
    expect(extractMessageId(undefined)).to.equal(undefined);
    expect(extractMessageId(null)).to.equal(undefined);
  });

  it('extracts a simple Message-ID from a header blob', () => {
    const headers = [
      'From: notifications@indeedflex.com',
      'To: indeed-flex@ingest.hrxone.com',
      'Subject: New job request',
      'Message-ID: <abc.def@indeedflex.com>',
      'Date: Fri, 16 May 2026 09:00:00 -0400',
    ].join('\r\n');
    expect(extractMessageId(headers)).to.equal('<abc.def@indeedflex.com>');
  });

  it('is case-insensitive on the header name', () => {
    const headers = 'message-id: <abc@indeedflex.com>\r\nFrom: x';
    expect(extractMessageId(headers)).to.equal('<abc@indeedflex.com>');
  });

  it('handles MESSAGE-ID with all caps', () => {
    const headers = 'MESSAGE-ID: <abc@indeedflex.com>';
    expect(extractMessageId(headers)).to.equal('<abc@indeedflex.com>');
  });

  it('unfolds continuation lines per RFC5322 §2.2.3', () => {
    const headers = [
      'Message-ID: <abc',
      '  .def@indeedflex.com>',
      'From: x',
    ].join('\r\n');
    expect(extractMessageId(headers)).to.equal('<abc .def@indeedflex.com>');
  });

  it('stops at the next non-continuation header', () => {
    const headers = [
      'Message-ID: <abc@indeedflex.com>',
      'From: notifications@indeedflex.com',
    ].join('\r\n');
    expect(extractMessageId(headers)).to.equal('<abc@indeedflex.com>');
  });

  it('returns the first occurrence when multiple are present', () => {
    const headers = [
      'Message-ID: <first@indeedflex.com>',
      'Message-ID: <second@indeedflex.com>',
    ].join('\r\n');
    expect(extractMessageId(headers)).to.equal('<first@indeedflex.com>');
  });
});

describe('extractDateHeader', () => {
  it('extracts a Date header', () => {
    const headers = 'Date: Fri, 16 May 2026 09:00:00 -0400\r\nFrom: x';
    expect(extractDateHeader(headers)).to.equal('Fri, 16 May 2026 09:00:00 -0400');
  });

  it('returns undefined when Date is missing', () => {
    const headers = 'From: x\r\nSubject: s';
    expect(extractDateHeader(headers)).to.equal(undefined);
  });
});
