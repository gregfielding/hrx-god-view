/**
 * Employment separation letter generator (Greg 2026-08-20): workers ask
 * for termination letters to document job separation for unemployment
 * and public-benefit (SNAP) eligibility. Opens a print-ready letter in a
 * new window (browser print → PDF) — same pattern as the OnTrac
 * attestation. Factual and neutral: employer identity, employment dates,
 * separation date and type. No internal fields (rehire eligibility,
 * notes) ever appear on the letter.
 */

export interface TerminationLetterInput {
  workerName: string;
  /** Optional mailing address lines for the worker. */
  workerAddress?: string | null;
  entityName: string;
  lastDay: string;
  separationType: string; // voluntary_notice | voluntary_no_notice | involuntary
  /** Optional — shown when known. */
  jobTitle?: string | null;
  startDate?: string | null;
}

const TYPE_SENTENCE: Record<string, string> = {
  voluntary_notice: 'The separation was a voluntary resignation by the employee.',
  voluntary_no_notice: 'The separation was a voluntary resignation by the employee.',
  involuntary: 'The separation was initiated by the employer.',
};

export function openTerminationLetter(input: TerminationLetterInput): void {
  const esc = (s: string) => s.replace(/</g, '&lt;');
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fmt = (iso: string | null | undefined): string => {
    if (!iso) return '';
    const t = Date.parse(`${iso}T12:00:00Z`);
    return Number.isFinite(t)
      ? new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
      : iso;
  };
  const typeSentence = TYPE_SENTENCE[input.separationType] ?? 'The employment has ended.';
  const employedClause = [
    `was employed by C1 Staffing, LLC${input.entityName && input.entityName !== 'C1 Staffing, LLC' ? ` (${esc(input.entityName)})` : ''}`,
    input.jobTitle ? `as ${esc(input.jobTitle)}` : null,
    input.startDate ? `from ${fmt(input.startDate)}` : null,
    `through ${fmt(input.lastDay)}`,
  ]
    .filter(Boolean)
    .join(' ');

  const html = `
<title>Employment Separation Letter — ${esc(input.workerName)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 13.5px; color: #000; max-width: 680px; margin: 48px auto; line-height: 1.6; }
  .header { border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 28px; }
  .company { font-size: 18px; font-weight: bold; letter-spacing: 0.5px; }
  .addr { font-size: 11.5px; color: #333; }
  .date { margin: 22px 0; }
  .re { font-weight: bold; margin: 18px 0; }
  .sig { margin-top: 56px; }
  .sigline { border-top: 1px solid #000; width: 280px; padding-top: 4px; font-size: 11.5px; margin-top: 40px; }
  @media print { body { margin: 32px; } }
</style>
<div class="header">
  <div class="company">C1 STAFFING, LLC</div>
  <div class="addr">1309 Coffeen Avenue, Suite 1200 · Sheridan, WY 82801</div>
</div>
<div class="date">${today}</div>
${input.workerAddress ? `<div>${esc(input.workerName)}<br/>${esc(input.workerAddress)}</div>` : ''}
<div class="re">RE: Verification of Employment Separation — ${esc(input.workerName)}</div>
<p>To Whom It May Concern:</p>
<p>This letter confirms that ${esc(input.workerName)} ${employedClause}. The employee's last day of
employment was ${fmt(input.lastDay)}, and ${esc(input.workerName)} has not been employed by, nor received
wages from, C1 Staffing, LLC after that date.</p>
<p>${typeSentence}</p>
<p>This letter is provided at the employee's request for verification purposes, including eligibility
determinations by unemployment and public-benefit agencies. Please direct any verification inquiries to
C1 Staffing, LLC at the address above.</p>
<p>Sincerely,</p>
<div class="sig">
  <div class="sigline">Signature</div>
  <div class="sigline">Print Name &amp; Title</div>
</div>
<script>window.print();</script>`;
  const w = window.open('', '_blank', 'width=780,height=900');
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}
