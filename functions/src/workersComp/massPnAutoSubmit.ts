/**
 * Automated Mass PN coverage requests to InSource (Greg 2026-09-05: "send
 * this report for both entities every 14 days"). NOT a Cloud Function of its
 * own (Cloud Run cap) — rides scheduledScoringDistribution's nightly loop and
 * fires only when the cadence has elapsed.
 *
 * Config: `tenants/{t}/settings/wcMassPnAutoSubmit`
 *   { enabled, entityIds[], cadenceDays (14), windowDays (21), lastSentAt }
 * Missing doc or enabled !== true => no-op (one doc read per tenant nightly).
 *
 * Window is 21d on a 14d cadence ON PURPOSE: paper timesheets key up to a
 * week+ late (Danny's Tuesday pass), so a strict 14/14 would permanently
 * miss hours keyed after their window closed. The overlap absorbs the lag;
 * a gap repeating across cycles just means it is still uncovered.
 *
 * The workbook mirrors the client's Export Mass PN sheet (WcCoveragePage) —
 * InSource's 24-column intake format, suggested REAL class codes (never
 * 8040). If Eddie asks for format changes, change BOTH builders.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import * as XLSX from 'xlsx';

import { buildWcCoverageReport } from './coverageGaps';
import { gmailClientFor } from '../sales/sodexoReplies';

export const INSOURCE_COVERAGE_CONTACT = { name: 'Eddie', email: 'eddiem@insourcees.com' };

const MASS_PN_HEADERS = [
  'Your Staffing Company Name  ',
  'Contact Name',
  'Email',
  'Phone',
  '',
  'Your Client/Prospect Name',
  'Address',
  'City',
  'State',
  'Zip',
  'Project/Worksite Address \n(if different than Mailing Address)',
  'Client Business Description',
  'Job Description',
  'Class Code State',
  'Class Code',
  'Annual Payroll Estimated',
  'Group Transportation          (Yes or No)',
  'Trenching or Excavation (Yes or No)',
  'Height Exposure Above Ground Level (Yes or No)',
  'Chemical Exposure (Yes or No)',
  'Machinery Exposure (Yes or No)',
  'Respirators or Dust Mask (Yes or No)',
  'Airborne/Bloodborn Exposure (Yes or No)',
  'Notes \n(COI or Endorsement Needs, Wording Specifics, etc...) ',
];

interface MassPnRowLike {
  entityId: string;
  entityName: string;
  accountName: string;
  worksiteName: string;
  worksiteAddress: string;
  state: string;
  code: string;
  jobTitles: string[];
  periodGross: number;
  workers: number;
  annualEstimate: number;
  suggestedCode?: string | null;
  suggestedBasis?: string[];
  comparableRateMin?: number | null;
  comparableRateMax?: number | null;
}

const usd = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function buildMassPnXlsxBase64(
  rows: MassPnRowLike[],
  startDate: string,
  endDate: string,
): string {
  const aoa: (string | number)[][] = [MASS_PN_HEADERS];
  rows.forEach((r, i) => {
    aoa.push([
      i === 0 ? 'C1 Staffing LLC' : '',
      i === 0 ? 'Greg Fielding' : '',
      i === 0 ? 'g.fielding@c1staffing.com' : '',
      i === 0 ? '925-448-0579' : '',
      '',
      r.accountName || '(fill in client)',
      '',
      '',
      '',
      '',
      [r.worksiteName, r.worksiteAddress].filter(Boolean).join(' — '),
      '',
      r.jobTitles.length ? r.jobTitles.join(', ') : '',
      r.state,
      r.suggestedCode || (r.code && r.code !== '8040' ? r.code : '(needs classification)'),
      r.annualEstimate,
      'No',
      'No',
      'No',
      'No',
      'No',
      'No',
      'No',
      [
        `Est. annualized from ${usd(r.periodGross)} over ${startDate}→${endDate} (${r.workers} workers, ${r.entityName})`,
        r.suggestedCode && (r.suggestedBasis?.length ?? 0) > 0
          ? `Code ${r.suggestedCode} suggested from titles rated elsewhere on our policy: ${(r.suggestedBasis ?? []).join(', ')}`
          : '',
        r.comparableRateMin != null
          ? `Comparable rate on existing policy states: ${r.comparableRateMin}${r.comparableRateMax != null && r.comparableRateMax !== r.comparableRateMin ? `–${r.comparableRateMax}` : ''}`
          : '',
      ]
        .filter(Boolean)
        .join('. '),
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = MASS_PN_HEADERS.map((h, i) => ({
    wch: Math.max(h.split('\n')[0].length, ...aoa.slice(1).map((r2) => String(r2[i] ?? '').length), 6) + 2,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mass PN');
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
}

export async function sendMassPnEmail(
  gmail: import('googleapis').gmail_v1.Gmail,
  fromEmail: string,
  entityName: string,
  filename: string,
  xlsxBase64: string,
): Promise<void> {
  const boundary = `masspn_${Date.now()}`;
  const body =
    'Eddie, please see the attached spreadsheet for new coverage requests. ' +
    'Let me know if you have any questions or need more information. Thanks!';
  const mime = [
    `From: Greg Fielding <${fromEmail}>`,
    `To: ${INSOURCE_COVERAGE_CONTACT.email}`,
    `Subject: New bulk coverage request for ${entityName}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
    '',
    `--${boundary}`,
    `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="${filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${filename}"`,
    '',
    xlsxBase64.replace(/(.{76})/g, '$1\r\n'),
    `--${boundary}--`,
  ].join('\r\n');
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    },
  });
}

export interface MassPnAutoResult {
  configured: boolean;
  due: boolean;
  sent: string[];
  skippedEmpty: string[];
  success: boolean;
  error?: string;
}

export async function runMassPnAutoSubmitForTenant(
  db: admin.firestore.Firestore,
  tenantId: string,
): Promise<MassPnAutoResult> {
  const result: MassPnAutoResult = {
    configured: false,
    due: false,
    sent: [],
    skippedEmpty: [],
    success: true,
  };
  try {
    const cfgRef = db.doc(`tenants/${tenantId}/settings/wcMassPnAutoSubmit`);
    const cfgSnap = await cfgRef.get();
    const cfg = (cfgSnap.data() ?? {}) as Record<string, unknown>;
    if (!cfgSnap.exists || cfg.enabled !== true) return result;
    result.configured = true;

    const cadenceDays = Number(cfg.cadenceDays) > 0 ? Number(cfg.cadenceDays) : 14;
    const windowDays = Number(cfg.windowDays) > 0 ? Number(cfg.windowDays) : 21;
    const lastSentAt = (cfg.lastSentAt as admin.firestore.Timestamp | undefined)?.toDate?.() ?? null;
    if (lastSentAt && Date.now() - lastSentAt.getTime() < cadenceDays * 86400000) return result;
    result.due = true;

    const entityIds = Array.isArray(cfg.entityIds) ? cfg.entityIds.map(String) : [];
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
    const report = (await buildWcCoverageReport({ tenantId, startDate, endDate })) as {
      massPn: MassPnRowLike[];
    };

    const client = await gmailClientFor(tenantId);
    if (!client) {
      throw new Error('No connected Gmail mailbox for this tenant.');
    }

    for (const entityId of entityIds) {
      const rows = report.massPn.filter((r) => r.entityId === entityId);
      if (rows.length === 0) {
        result.skippedEmpty.push(entityId);
        continue;
      }
      const entityName = rows[0].entityName;
      const filename = `Mass-Prospect-Notification_${entityName.replace(/\s+/g, '-')}_${startDate}_to_${endDate}.xlsx`;
      const xlsxBase64 = buildMassPnXlsxBase64(rows, startDate, endDate);
      await sendMassPnEmail(client.gmail, client.fromEmail, entityName, filename, xlsxBase64);
      result.sent.push(entityName);
    }

    await cfgRef.set(
      {
        lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
        lastResult: {
          at: admin.firestore.Timestamp.now(),
          window: `${startDate}→${endDate}`,
          sent: result.sent,
          skippedEmpty: result.skippedEmpty,
        },
      },
      { merge: true },
    );
    logger.info('massPnAutoSubmit: sent', { tenantId, ...result });
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('massPnAutoSubmit: failed', { tenantId, error: message });
    return { ...result, success: false, error: message };
  }
}
