/**
 * **R.5** — Open the FAN (Further Action Notice) printable HTML view.
 *
 * Per Q-R5-3 we deliberately render the notice as plain HTML in a new
 * tab/window with `window.print()` ready. This avoids the overhead of
 * server-rendered PDF + Cloud Storage upload + signed URL handling for a
 * recruiter-paper workflow that's read-aloud-and-handed-over today.
 *
 * The audit event (`NOTICE_PACKET_GENERATED`) is recorded by the caller
 * via `everifyRecordNoticeGenerated`; this file is the rendering shim
 * only. Future PDF / e-sign work can swap the implementation without
 * touching call sites.
 *
 * Note on printing: we trigger `window.print()` on a 250ms delay so the
 * fonts have a chance to load. Most modern browsers will close the print
 * dialog and leave the tab open; recruiters can print again from the
 * page if the dialog is dismissed.
 */

interface OpenEverifyTncNoticePrintableArgs {
  tenantId: string;
  caseId: string;
  caseNumber?: string;
  eligibilityStatement?: string;
  /** Firestore Timestamp-ish; safe for `toMillis()`. */
  tncResponseDueAt?: { toMillis?: () => number } | unknown;
  referralDueAt?: { toMillis?: () => number } | unknown;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(v: unknown): string {
  if (!v) return '________________';
  if (typeof v === 'object' && v !== null) {
    const t = v as { toMillis?: () => number };
    if (typeof t.toMillis === 'function') {
      return new Date(t.toMillis()).toLocaleDateString();
    }
  }
  return '________________';
}

export function openEverifyTncNoticePrintable(args: OpenEverifyTncNoticePrintableArgs): void {
  const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100');
  if (!win) {
    // Pop-up blocked. We swallow this — caller already records the event;
    // a no-op here surfaces to the recruiter via the existing alert flow
    // they see when nothing happens, which is enough for R.5.
    return;
  }

  const caseRef = args.caseNumber ?? args.caseId;
  const tncDueLine = fmtDate(args.tncResponseDueAt);
  const referralDueLine = fmtDate(args.referralDueAt);
  const eligibility = (args.eligibilityStatement ?? '').trim();

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>E-Verify Further Action Notice (FAN)</title>
  <style>
    @media print {
      body { margin: 0; }
      .no-print { display: none !important; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 760px;
      margin: 36px auto;
      padding: 0 28px 64px;
      color: #1a1a1a;
      line-height: 1.55;
      font-size: 14px;
    }
    h1 {
      font-size: 22px;
      margin: 0 0 4px;
    }
    h2 {
      font-size: 15px;
      margin: 28px 0 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #ccc;
    }
    .subtitle {
      color: #555;
      margin: 0 0 24px;
      font-size: 13px;
    }
    .case-meta {
      background: #f5f5f5;
      padding: 12px 16px;
      border-radius: 4px;
      margin-bottom: 24px;
      font-size: 13px;
    }
    .case-meta dt {
      font-weight: 600;
      display: inline-block;
      min-width: 140px;
    }
    .case-meta dd {
      display: inline;
      margin: 0;
    }
    .case-meta div + div { margin-top: 4px; }
    ol li { margin-bottom: 8px; }
    .deadlines {
      margin: 16px 0;
      padding: 12px 16px;
      border-left: 4px solid #f59e0b;
      background: #fffaf0;
      font-size: 13px;
    }
    .signatures {
      margin-top: 32px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px 24px;
    }
    .sig-line {
      border-top: 1px solid #555;
      margin-top: 32px;
      padding-top: 4px;
      font-size: 12px;
      color: #555;
    }
    .actions {
      position: fixed;
      top: 12px;
      right: 12px;
      display: flex;
      gap: 8px;
    }
    .actions button {
      font-family: inherit;
      font-size: 13px;
      padding: 6px 12px;
      cursor: pointer;
      border: 1px solid #888;
      background: #fff;
      border-radius: 4px;
    }
    .actions button.primary {
      background: #1976d2;
      color: #fff;
      border-color: #1976d2;
    }
  </style>
</head>
<body>
  <div class="actions no-print">
    <button class="primary" onclick="window.print()">Print</button>
    <button onclick="window.close()">Close</button>
  </div>

  <h1>E-Verify Further Action Notice (FAN)</h1>
  <p class="subtitle">Tentative Nonconfirmation — Employer / Employee Information Sheet</p>

  <div class="case-meta">
    <div><dt>E-Verify case #:</dt><dd>${escapeHtml(caseRef)}</dd></div>
    ${eligibility ? `<div><dt>Eligibility statement:</dt><dd>${escapeHtml(eligibility)}</dd></div>` : ''}
    <div><dt>Notice generated:</dt><dd>${escapeHtml(new Date().toLocaleString())}</dd></div>
  </div>

  <div class="deadlines">
    <strong>Deadlines</strong><br />
    <div><strong>Contact decision due:</strong> ${escapeHtml(tncDueLine)} (10 federal working days from notification).</div>
    <div><strong>Referral due (if contesting):</strong> ${escapeHtml(referralDueLine)}.</div>
  </div>

  <h2>What this notice means</h2>
  <p>
    The E-Verify system has issued a <strong>Tentative Nonconfirmation (TNC)</strong> on this case.
    A TNC means the information you provided does not currently match Department of Homeland Security (DHS) or
    Social Security Administration (SSA) records. <strong>This is not a final decision about your work
    eligibility.</strong> You have the right to contest this finding without losing your job offer or current
    employment.
  </p>

  <h2>Your options</h2>
  <ol>
    <li>
      <strong>Contest the TNC.</strong> If you choose to contest, your employer will refer the case to DHS or
      SSA, and you must contact the appropriate agency within <strong>8 federal working days</strong> from the
      referral date. You may continue working during this period.
    </li>
    <li>
      <strong>Decline to contest.</strong> If you choose not to contest, the case will close as a Final
      Nonconfirmation (FNC), which will result in termination of your employment with this employer.
    </li>
  </ol>

  <h2>What happens next</h2>
  <p>
    Indicate your decision on the form below and return it to your employer (HR / recruiter) by the
    contact decision date listed above. If you do not respond by that date, the system will treat your
    silence as a decline-to-contest.
  </p>

  <h2>Decision</h2>
  <p>
    <label><input type="checkbox" disabled /> I will contest the Tentative Nonconfirmation.</label><br />
    <label><input type="checkbox" disabled /> I decline to contest the Tentative Nonconfirmation and understand the consequences.</label>
  </p>

  <div class="signatures">
    <div>
      <div class="sig-line">Employee signature / date</div>
    </div>
    <div>
      <div class="sig-line">Employer representative / date</div>
    </div>
  </div>

  <h2>Resources</h2>
  <ul>
    <li>E-Verify Employee Hotline: 888-897-7781 (TTY 877-875-6028)</li>
    <li>SSA Hotline: 800-772-1213 (TTY 800-325-0778)</li>
    <li>https://www.e-verify.gov/employees</li>
  </ul>

  <script>
    setTimeout(() => { try { window.print(); } catch (e) {} }, 250);
  </script>
</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
}
