import { escalationDmTargets } from '../../natalie/natalieOutbox';
import { normalizeCraigslistUrl } from '../../natalie/natalieCraigslist';

describe('escalationDmTargets', () => {
  it('never DMs Natalie herself (she is the assigned recruiter on OnTrac orders)', () => {
    expect(escalationDmTargets(['U0BV79X65R9'], 'U0BV79X65R9')).toEqual([]);
  });
  it('keeps the other recruiters and drops duplicates', () => {
    expect(escalationDmTargets(['U0BV79X65R9', 'UDANIEL', 'UDANIEL', ''], 'U0BV79X65R9')).toEqual(['UDANIEL']);
  });
});

describe('normalizeCraigslistUrl', () => {
  it('adds https to a pasted URL without a scheme', () => {
    expect(normalizeCraigslistUrl('www.craigslist.org/view/d/denton-warehouse-workers/abc')).toBe('https://www.craigslist.org/view/d/denton-warehouse-workers/abc');
  });
  it('keeps https and upgrades http', () => {
    expect(normalizeCraigslistUrl('https://www.craigslist.org/view/d/x/1')).toBe('https://www.craigslist.org/view/d/x/1');
    expect(normalizeCraigslistUrl('http://denver.craigslist.org/lbg/d/x/1.html')).toBe('https://denver.craigslist.org/lbg/d/x/1.html');
  });
  it('rejects blanks and non-Craigslist links', () => {
    expect(normalizeCraigslistUrl('')).toBeNull();
    expect(normalizeCraigslistUrl(undefined)).toBeNull();
    expect(normalizeCraigslistUrl('https://hrxone.com/c1/jobs-board/abc')).toBeNull();
    expect(normalizeCraigslistUrl('craigslist.org.evil.com/x')).toBeNull();
  });
});
