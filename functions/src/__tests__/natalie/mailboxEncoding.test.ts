import { normalizeReplySubject, repairMojibake } from '../../sales/mimeHeaders';
import { composePersonaEmailRaw } from '../../natalie/natalieMailbox';

/** The bug: UTF-8 bytes read back as Latin-1 characters — once per bad hop. */
const garble = (s: string) => Buffer.from(s, 'utf8').toString('latin1');

describe('repairMojibake', () => {
  it('fixes the documented Sodexo subject', () => {
    expect(repairMojibake('One shift, zero risk Ã¢Â€Â” Bethune Cookman University')).toBe('One shift, zero risk — Bethune Cookman University');
  });
  it('fixes the Windows-1252 form of an em dash', () => {
    expect(repairMojibake('Resume text â€” Brandon Wilson')).toBe('Resume text — Brandon Wilson');
  });
  it('peels several stacked layers (every Re: added one)', () => {
    const original = 'Resume text — Brandon Wilson (ready to paste into Word)';
    expect(repairMojibake(garble(garble(garble(original))))).toBe(original);
  });
  it('leaves clean text alone, including Spanish and real dashes', () => {
    for (const ok of ['¿Cuándo es mi turno? — José Ñandú', 'Re: Resume text — Brandon Wilson', 'Plain ASCII subject', 'Pâte à choux']) {
      expect(repairMojibake(ok)).toBe(ok);
    }
  });
});

describe('normalizeReplySubject', () => {
  it('one Re:, repaired', () => {
    expect(normalizeReplySubject('Re: Re: RE: Resume text â€” Brandon Wilson')).toBe('Re: Resume text — Brandon Wilson');
    expect(normalizeReplySubject('Weekend crew')).toBe('Re: Weekend crew');
    expect(normalizeReplySubject('')).toBe('Re: (no subject)');
  });
});

describe('composePersonaEmailRaw', () => {
  const decodeRaw = (raw: string) => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const headerBlock = (msg: string) => msg.split('\r\n\r\n')[0];
  const decodeEncodedWords = (v: string) => v.replace(/\r\n /g, '').replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b64) => Buffer.from(b64, 'base64').toString('utf8'));

  it('headers are pure ASCII and the subject decodes back to the original', () => {
    const msg = decodeRaw(composePersonaEmailRaw('marco', { to: 'r.govea@c1staffing.com', subject: 'Re: Turno del sábado — COTA', body: 'Hola Rosa' }, { inReplyTo: '<a@mail.gmail.com>', references: '<a@mail.gmail.com>' }));
    const headers = headerBlock(msg);
    expect(/^[\x00-\x7F]*$/.test(headers)).toBe(true);
    const subjectLine = headers.split('\r\n').reduce<string[]>((acc, line) => (line.startsWith(' ') ? [...acc.slice(0, -1), `${acc[acc.length - 1]}\r\n${line}`] : [...acc, line]), []).find((l) => l.startsWith('Subject: '))!;
    expect(decodeEncodedWords(subjectLine.slice('Subject: '.length))).toBe('Re: Turno del sábado — COTA');
    expect(headers).toContain('From: Marco Gomez <m.gomez@c1staffing.com>');
    expect(headers).toContain('In-Reply-To: <a@mail.gmail.com>');
    expect(msg).toContain('Hola Rosa\r\n\r\n—\r\nMarco Gomez\r\nRecruiting Assistant, C1 Staffing\r\nm.gomez@c1staffing.com');
  });

  it('a garbled subject passed in is repaired before it is encoded', () => {
    const msg = decodeRaw(composePersonaEmailRaw('natalie', { to: 'd.waltermyer@c1staffing.com', subject: `Re: Resume text ${garble(garble('—'))} Brandon Wilson`, body: 'Hi Deborah' }));
    expect(decodeEncodedWords(headerBlock(msg).match(/Subject: ([\s\S]*?)\r\n(?! )/)![1])).toBe('Re: Resume text — Brandon Wilson');
  });
});
