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
 * The workbook is InSource's REVISED Mass PN template (Eddie 2026-09-08,
 * "going forward please use the new one") — sheet content comes from the
 * shared spec in src/shared/massPnTemplate.ts, which the client's Export /
 * Submit-to-Eddie (WcCoveragePage) assembles from too, so the two paths
 * stay byte-identical by construction. Suggested REAL class codes (never
 * 8040; unknown stays blank per their instructions).
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import * as XLSX from 'xlsx';

import { buildWcCoverageReport } from './coverageGaps';
import { assembleMassPnWorkbook, MassPnSheetRow, XlsxLike } from '../shared/massPnTemplate';
import { gmailClientFor } from '../sales/sodexoReplies';

export const INSOURCE_COVERAGE_CONTACT = { name: 'Eddie', email: 'eddiem@insourcees.com' };

interface MassPnRowLike extends MassPnSheetRow {
  entityId: string;
}

export function buildMassPnXlsxBase64(
  rows: MassPnRowLike[],
  startDate: string,
  endDate: string,
): string {
  const wb = assembleMassPnWorkbook(XLSX as unknown as XlsxLike, rows, startDate, endDate);
  return XLSX.write(wb as XLSX.WorkBook, { type: 'base64', bookType: 'xlsx' }) as string;
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
