import { parsePoSubject, parsePoNumber, matchExistingSubclass } from '../venuesmartPoClasses';

describe('parsePoSubject', () => {
  it('splits event and venue on the trailing segment', () => {
    expect(parsePoSubject('Purchase Order from VenueSmart LLC - 2026 Jimmy Eat World - Moody'))
      .toEqual({ event: '2026 Jimmy Eat World', venue: 'Moody' });
  });

  it('keeps a single-segment remainder whole', () => {
    expect(parsePoSubject('Purchase Order from VenueSmart LLC - 2026 Florida State Fair'))
      .toEqual({ event: '2026 Florida State Fair', venue: '' });
  });

  it('preserves interior dashes, splitting only the last segment off', () => {
    expect(parsePoSubject('Purchase Order from VenueSmart LLC - Jay-Z - United Center'))
      .toEqual({ event: 'Jay-Z', venue: 'United Center' });
  });

  it('rejects non-PO subjects and forwards', () => {
    expect(parsePoSubject('Invoice from VenueSmart LLC - whatever')).toBeNull();
    expect(parsePoSubject('Purchase Order from VenueSmart LLC -   ')).toBeNull();
  });

  it('is case-insensitive on the prefix', () => {
    expect(parsePoSubject('PURCHASE ORDER FROM VENUESMART LLC - Lolla')).toEqual({ event: 'Lolla', venue: '' });
  });
});

describe('parsePoNumber', () => {
  it('reads the PO number from the summary block', () => {
    expect(parsePoNumber('---- Purchase Order Summary ----\nPurchase Order # : 1247\nTotal: $1,280.00')).toBe('1247');
  });
  it('tolerates spacing variants', () => {
    expect(parsePoNumber('Purchase Order #: 2150')).toBe('2150');
    expect(parsePoNumber('purchase order # 99')).toBe('99');
  });
  it('returns empty when absent', () => {
    expect(parsePoNumber('no number here')).toBe('');
  });
});

describe('matchExistingSubclass', () => {
  const SUBS = [
    { id: '1', leaf: 'FIFA KC', fqn: 'Venue Smart:FIFA KC' },
    { id: '2', leaf: 'FIFA Dallas', fqn: 'Venue Smart:FIFA Dallas' },
    { id: '3', leaf: 'Lollapalooza', fqn: 'Venue Smart:Lollapalooza' },
    { id: '4', leaf: '2026 Innings Festival', fqn: 'Venue Smart:2026 Innings Festival' },
  ];

  it('matches when the PO event CONTAINS the class name (the FIFA KC Fan Fest case)', () => {
    expect(matchExistingSubclass('FIFA KC Fan Fest WWI', SUBS)?.id).toBe('1');
  });

  it('matches when the class name contains the PO event', () => {
    expect(matchExistingSubclass('Innings Festival', SUBS)?.id).toBe('4');
  });

  it('prefers the longest (most specific) match', () => {
    const subs = [...SUBS, { id: '5', leaf: 'FIFA KC Fan Fest', fqn: 'Venue Smart:FIFA KC Fan Fest' }];
    expect(matchExistingSubclass('FIFA KC Fan Fest WWI', subs)?.id).toBe('5');
  });

  it('returns null for genuinely new events — creation is allowed', () => {
    expect(matchExistingSubclass('2026 Jimmy Eat World', SUBS)).toBeNull();
  });

  it('ignores empty and tiny keys', () => {
    expect(matchExistingSubclass('', SUBS)).toBeNull();
    expect(matchExistingSubclass('KC', SUBS)).toBeNull();
  });
});
