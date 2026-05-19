/**
 * Slice 2 unit tests — email body normalizer.
 *
 * Covers tag stripping, entity decoding, footer trimming, reply-chain
 * trimming, and the full pipeline against representative inputs.
 */

import { expect } from 'chai';

import {
  collapseWhitespace,
  decodeEntities,
  normalizeEmailBody,
  stripHtml,
  trimFooter,
  trimQuotedReplies,
} from '../../../../integrations/indeedFlex/parser/normalizeEmail';

describe('decodeEntities', () => {
  it('decodes common named entities', () => {
    expect(decodeEntities('Tom &amp; Jerry')).to.equal('Tom & Jerry');
    expect(decodeEntities('a &lt; b &gt; c')).to.equal('a < b > c');
    expect(decodeEntities('Mary&apos;s shift')).to.equal("Mary's shift");
    expect(decodeEntities('hard&nbsp;space')).to.equal('hard space');
  });

  it('decodes numeric entities', () => {
    expect(decodeEntities('caf&#233;')).to.equal('café');
    expect(decodeEntities('&#x2014; dash')).to.equal('— dash');
  });

  it('leaves unknown entities alone', () => {
    expect(decodeEntities('&fakeEntity;')).to.equal('&fakeEntity;');
  });
});

describe('stripHtml', () => {
  it('drops simple tags', () => {
    expect(stripHtml('<b>Hello</b> <i>world</i>')).to.equal('Hello world');
  });

  it('converts <br> to newlines', () => {
    expect(stripHtml('a<br>b<br/>c')).to.equal('a\nb\nc');
  });

  it('preserves structure across </p> / </td>', () => {
    expect(stripHtml('<p>Line A</p><p>Line B</p>')).to.match(/Line A\s*\n+\s*Line B/);
    expect(stripHtml('<table><tr><td>cell1</td><td>cell2</td></tr></table>')).to.contain('cell1');
    expect(stripHtml('<table><tr><td>cell1</td><td>cell2</td></tr></table>')).to.contain('cell2');
  });

  it('drops <style> and <script> blocks entirely', () => {
    const html = '<style>body { color: red; }</style><p>Real content</p>';
    expect(stripHtml(html)).not.to.contain('color: red');
    expect(stripHtml(html)).to.contain('Real content');
  });

  it('tolerates malformed HTML', () => {
    expect(stripHtml('<p>open <em>no close</p>')).to.contain('open');
    expect(stripHtml('<p>open <em>no close</p>')).to.contain('no close');
  });
});

describe('trimFooter', () => {
  it('trims at "Indeed Flex Limited" marker', () => {
    const body = `Body line 1
Body line 2

Indeed Flex Limited, Registered Office, London`;
    expect(trimFooter(body)).to.equal('Body line 1\nBody line 2\n');
  });

  it('trims at "unsubscribe" marker', () => {
    const body = `Real content
unsubscribe from these notifications here`;
    expect(trimFooter(body)).to.equal('Real content');
  });

  it('is case-insensitive', () => {
    expect(trimFooter('keep\nUNSUBSCRIBE FROM THESE NOTIFICATIONS\ndrop')).to.equal('keep');
  });

  it('leaves text without a marker unchanged', () => {
    expect(trimFooter('no marker here')).to.equal('no marker here');
  });
});

describe('trimQuotedReplies', () => {
  it('trims at "> " lines', () => {
    expect(trimQuotedReplies('Keep\n> quoted reply\n> more reply')).to.equal('Keep');
  });

  it('trims at "From:" headers', () => {
    expect(trimQuotedReplies('Keep\nFrom: someone@x.com\nSubject: re: x')).to.equal('Keep');
  });

  it('trims at "On <date> ... wrote:" headers', () => {
    expect(trimQuotedReplies('Keep\nOn Wed, May 1 2026, x@x.com wrote:\n> quoted')).to.equal('Keep');
  });
});

describe('collapseWhitespace', () => {
  it('collapses run-length spaces', () => {
    expect(collapseWhitespace('a    b\tc')).to.equal('a b c');
  });

  it('folds 3+ consecutive blank lines to 2', () => {
    expect(collapseWhitespace('a\n\n\n\nb')).to.equal('a\n\nb');
  });

  it('trims each line', () => {
    expect(collapseWhitespace('  a  \n  b  ')).to.equal('a\nb');
  });
});

describe('normalizeEmailBody — full pipeline', () => {
  it('prefers HTML when present', () => {
    const out = normalizeEmailBody({
      text: 'plain text version',
      html: '<p>html version</p>',
    });
    expect(out).to.contain('html version');
    expect(out).not.to.contain('plain text version');
  });

  it('falls back to text when no HTML', () => {
    const out = normalizeEmailBody({ text: 'just text' });
    expect(out).to.contain('just text');
  });

  it('strips footer + entities + whitespace in one pass', () => {
    const out = normalizeEmailBody({
      html: '<p>Job <b>509668</b></p><p>Venue: Caf&eacute; Lavash</p><hr>Indeed Flex Limited',
    });
    expect(out).to.contain('Job 509668');
    expect(out).not.to.contain('Indeed Flex Limited');
  });

  it('returns empty string for empty inputs', () => {
    expect(normalizeEmailBody({})).to.equal('');
    expect(normalizeEmailBody({ text: '', html: '' })).to.equal('');
  });
});
