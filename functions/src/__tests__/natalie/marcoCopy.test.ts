import { composeCheckpointText, composeDoneText, type OnboardingSnapshot } from '../../natalie/natalieOnboarding';
import { composeOffer, composeOfferConfirmation, portalLinkText, type ShiftRef } from '../../natalie/natalieFill';
import { tokenFor } from '../../natalie/personas';

const snap: OnboardingSnapshot = {
  assignmentId: 'a1',
  hiringEntityId: 'c1_events_llc',
  entityLabel: 'C1 Events',
  steps: [],
  workerTodo: ['Everee payroll setup (direct deposit)', 'tax forms (W-4)', 'AccuSource background form (Basic)'],
  recruiterTodo: [],
  background: { ordered: true, checkId: 'b1', packageName: 'Basic', formDone: false, portalLink: 'https://portal.test/form', hrxStatus: 'awaiting_applicant', failed: false },
  drug: { ordered: false, name: '', lab: '', status: 'none' },
  everee: { inviteSent: true, complete: false },
  allWorkerDone: false,
};
const worker = { firstName: 'Ana', jobTitle: 'Usher' };

describe('onboarding checkpoint copy per persona', () => {
  it("Natalie's English text is unchanged by the persona refactor", () => {
    const text = composeCheckpointText(worker, snap, 'h24');
    expect(text.startsWith("Hi Ana, it's Natalie with C1 Staffing. Quick check on your onboarding for Usher.")).toBe(true);
    expect(text).toContain('Still open with us: your Everee onboarding (direct deposit and tax forms)');
    expect(text.endsWith('— Natalie, C1 Staffing')).toBe(true);
  });
  it('Marco texts Spanish-preferring workers in Spanish, signed as himself', () => {
    const text = composeCheckpointText(worker, snap, 'h24', { persona: 'marco', lang: 'es' });
    expect(text.startsWith('Hola Ana, soy Marco de C1 Staffing.')).toBe(true);
    expect(text).toContain('tu registro en Everee (depósito directo y formularios de impuestos)');
    expect(text).toContain('https://portal.test/form');
    expect(text).not.toContain('Still open');
    expect(text.endsWith('— Marco, C1 Staffing')).toBe(true);
  });
  it('Marco in English keeps the English copy with his name', () => {
    const text = composeCheckpointText(worker, snap, 'h1', { persona: 'marco', lang: 'en' });
    expect(text.startsWith("Hi Ana, it's Marco with C1 Staffing — welcome aboard for Usher!")).toBe(true);
    expect(text.endsWith('— Marco, C1 Staffing')).toBe(true);
  });
  it('done text', () => {
    expect(composeDoneText(worker)).toBe("Hi Ana, Natalie with C1 Staffing — you're all set on your onboarding paperwork for Usher. Thank you! — Natalie, C1 Staffing");
    expect(composeDoneText(worker, { persona: 'marco', lang: 'es' })).toContain('Hola Ana, Marco de C1 Staffing');
  });
});

describe('offer copy per persona', () => {
  const ref: ShiftRef = { jobOrderId: 'j', shiftId: 's', date: '2026-09-13', startTime: '17:30', endTime: '23:00', title: 'Usher', site: 'COTA', address: 'Austin, TX', payRate: 18, poNumber: null, needed: 10, assigned: 2 };
  it("Natalie's offer is unchanged", () => {
    const text = composeOffer('Ana', ref);
    expect(text.startsWith('Hi Ana — Natalie with C1 Staffing. We have a Usher shift at COTA (Austin, TX) on')).toBe(true);
    expect(text).toContain('$18.00/hr');
    expect(text.endsWith("Reply YES and I'll get you set up, or NO if not. — Natalie, C1 Staffing")).toBe(true);
  });
  it("Marco's Spanish offer asks for SÍ and pays per hora", () => {
    const text = composeOffer('Ana', ref, undefined, { persona: 'marco', lang: 'es' });
    expect(text.startsWith('Hola Ana — soy Marco de C1 Staffing. Tenemos un turno de Usher en COTA')).toBe(true);
    expect(text).toContain('$18.00/hora');
    expect(text).toContain('Responde SÍ');
    expect(text.endsWith('— Marco, C1 Staffing')).toBe(true);
  });
  it('confirmation text', () => {
    const offer = { title: 'Usher', site: 'COTA', date: '2026-09-13', startTime: '17:30' };
    expect(composeOfferConfirmation(offer).endsWith('Thank you! — Natalie, C1 Staffing')).toBe(true);
    expect(composeOfferConfirmation(offer, { persona: 'marco', lang: 'es' })).toContain('quedas confirmado para Usher en COTA');
  });
});

describe('background form link copy', () => {
  it("Natalie's wording is unchanged; Marco's Spanish version is his", () => {
    expect(portalLinkText('Ana', 'https://l', 'Basic', true).endsWith("Reply here if you get stuck. — Natalie")).toBe(true);
    expect(portalLinkText('Ana', 'https://l', 'Basic').endsWith('Reply if you have any trouble. — Natalie, C1 Staffing')).toBe(true);
    const es = portalLinkText('Ana', 'https://l', 'Basic', false, { persona: 'marco', lang: 'es' });
    expect(es.startsWith('Hola Ana, C1 Staffing pidió tu verificación de antecedentes (Basic)')).toBe(true);
    expect(es.endsWith('— Marco, C1 Staffing')).toBe(true);
  });
});

describe('tokenFor', () => {
  const tokens = { natalie: 'xoxp-n', marco: 'xoxp-m' };
  it("posts Marco's work as Marco only while he is live", () => {
    expect(tokenFor({ ...tokens, runtime: { marcoEnabled: true, marcoChannel: 'C1' } }, 'marco')).toEqual({ persona: 'marco', token: 'xoxp-m' });
    expect(tokenFor({ ...tokens, runtime: { marcoEnabled: false, marcoChannel: 'C1' } }, 'marco')).toEqual({ persona: 'natalie', token: 'xoxp-n' });
    expect(tokenFor({ natalie: 'xoxp-n', runtime: { marcoEnabled: true, marcoChannel: 'C1' } }, 'marco')).toEqual({ persona: 'natalie', token: 'xoxp-n' });
    expect(tokenFor({ ...tokens, runtime: { marcoEnabled: true, marcoChannel: 'C1' } }, undefined)).toEqual({ persona: 'natalie', token: 'xoxp-n' });
  });
});
