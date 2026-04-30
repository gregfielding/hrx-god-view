/**
 * Validator for Everee embed `eventHandlerName` values.
 *
 * Pinned cases here are not theoretical: the literal placeholder string below
 * was once written into a production entity doc, which caused a silent EMB-102
 * because the server told the iframe to look up
 * `window['REPLACE_WITH_NAME_EVEREE_GAVE_YOU']` — which the host bridge had
 * never registered. The validator's job is to make that footgun impossible to
 * fire again.
 */

import { expect } from 'chai';

import {
  isValidEvereeEmbedHandlerName,
  sanitizeEvereeEmbedHandlerName,
} from '../../integrations/everee/evereeConfig';

describe('Everee embed handler-name validator', () => {
  describe('isValidEvereeEmbedHandlerName', () => {
    it('accepts the stable default', () => {
      expect(isValidEvereeEmbedHandlerName('hrx_default')).to.equal(true);
    });

    it('accepts conventional snake_case names', () => {
      expect(isValidEvereeEmbedHandlerName('hrx_select_handler')).to.equal(true);
      expect(isValidEvereeEmbedHandlerName('c1_events_v2')).to.equal(true);
    });

    it('accepts mixed-case identifiers (in case Everee hands one back)', () => {
      expect(isValidEvereeEmbedHandlerName('hrxProductionHandler')).to.equal(true);
      expect(isValidEvereeEmbedHandlerName('handler-name-v1')).to.equal(true);
    });

    it('rejects the literal placeholder that caused the original outage', () => {
      expect(isValidEvereeEmbedHandlerName('REPLACE_WITH_NAME_EVEREE_GAVE_YOU')).to.equal(false);
    });

    it('rejects other obvious instruction-style placeholders', () => {
      expect(isValidEvereeEmbedHandlerName('PLACEHOLDER')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('your_handler_here')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('TODO_set_this')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('xxx')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('FIXME')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('insert_handler_name')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('enter_value_here')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('example_handler')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('TBD')).to.equal(false);
    });

    it('rejects empty / whitespace-only strings', () => {
      expect(isValidEvereeEmbedHandlerName('')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('   ')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('\n\t')).to.equal(false);
    });

    it('rejects names that start with a digit or invalid character', () => {
      expect(isValidEvereeEmbedHandlerName('1handler')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('_leading_underscore')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('-leading-hyphen')).to.equal(false);
    });

    it('rejects names containing whitespace, quotes, or angle brackets', () => {
      expect(isValidEvereeEmbedHandlerName('hrx default')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('"hrx_default"')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('<your handler>')).to.equal(false);
      expect(isValidEvereeEmbedHandlerName('{handlerName}')).to.equal(false);
    });

    it('rejects names longer than 64 chars', () => {
      const tooLong = 'a' + 'b'.repeat(64);
      expect(tooLong.length).to.equal(65);
      expect(isValidEvereeEmbedHandlerName(tooLong)).to.equal(false);
    });

    it('rejects non-string values', () => {
      expect(isValidEvereeEmbedHandlerName(undefined)).to.equal(false);
      expect(isValidEvereeEmbedHandlerName(null)).to.equal(false);
      expect(isValidEvereeEmbedHandlerName(123)).to.equal(false);
      expect(isValidEvereeEmbedHandlerName({})).to.equal(false);
      expect(isValidEvereeEmbedHandlerName([])).to.equal(false);
    });
  });

  describe('sanitizeEvereeEmbedHandlerName', () => {
    it('returns the trimmed value when valid', () => {
      expect(sanitizeEvereeEmbedHandlerName('  hrx_default  ')).to.equal('hrx_default');
    });

    it('returns undefined for the placeholder that caused the original outage', () => {
      expect(sanitizeEvereeEmbedHandlerName('REPLACE_WITH_NAME_EVEREE_GAVE_YOU')).to.equal(
        undefined,
      );
    });

    it('returns undefined (not throw) for null / undefined / empty inputs', () => {
      expect(sanitizeEvereeEmbedHandlerName(undefined)).to.equal(undefined);
      expect(sanitizeEvereeEmbedHandlerName(null)).to.equal(undefined);
      expect(sanitizeEvereeEmbedHandlerName('')).to.equal(undefined);
      expect(sanitizeEvereeEmbedHandlerName('   ')).to.equal(undefined);
    });

    it('returns undefined for invalid format', () => {
      expect(sanitizeEvereeEmbedHandlerName('hrx default')).to.equal(undefined);
      expect(sanitizeEvereeEmbedHandlerName('1handler')).to.equal(undefined);
    });

    it('does not throw when source context is omitted', () => {
      expect(() => sanitizeEvereeEmbedHandlerName('PLACEHOLDER_VALUE')).not.to.throw();
    });
  });
});
