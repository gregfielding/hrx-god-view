/**
 * Build the Assignment Details confirmation email (subject + HTML body).
 * Mirrors the worker Assignment Details page so the email contains the same fields.
 * See: docs/assignment-details-fields-for-confirmation-email.md
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

const PLACEHOLDER = '—';
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_LABELS: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

function toDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (typeof v === 'string' || typeof v === 'number') return new Date(v);
  return undefined;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** HH:mm → "9:00 AM" */
function formatTime(t: string | undefined): string {
  if (!t || typeof t !== 'string') return '';
  const [h, m] = t.trim().split(':');
  const hh = Math.max(0, Math.min(23, parseInt(h, 10) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(m, 10) || 0));
  const d = new Date(2000, 0, 1, hh, mm);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function looksLikeDocId(s: unknown): boolean {
  if (typeof s !== 'string' || !s) return false;
  const t = s.trim();
  return t.length >= 15 && t.length <= 30 && /^[a-zA-Z0-9_-]+$/.test(t);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(s: string): string {
  return escapeHtml(s).replace(/\n/g, '<br>\n');
}

export interface AssignmentDetailsEmailResult {
  subject: string;
  html: string;
}

/**
 * Load assignment and related data, then build subject and HTML for the confirmation email.
 * Subject format: "JOB TITLE - Assignment Details"
 */
export async function buildAssignmentDetailsEmail(
  tenantId: string,
  assignmentId: string
): Promise<AssignmentDetailsEmailResult | null> {
  try {
    const assignmentRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
    const assignmentSnap = await assignmentRef.get();
    if (!assignmentSnap.exists) {
      logger.warn(`buildAssignmentDetailsEmail: assignment not found ${tenantId}/${assignmentId}`);
      return null;
    }
    const a = assignmentSnap.data() || {};
    const jobTitle = (a.jobTitle || 'Assignment').trim();
    const subject = `${jobTitle} - Assignment Details`;

    // Resolve company name
    let resolvedCompanyName: string | null = null;
    const companyId = a.companyId;
    if (companyId && (!a.companyName || looksLikeDocId(a.companyName))) {
      const companySnap = await db.doc(`tenants/${tenantId}/crm_companies/${companyId}`).get();
      if (companySnap.exists) {
        const d = companySnap.data() || {};
        const name = (d.name || d.companyName) as string | undefined;
        if (name && !looksLikeDocId(name)) resolvedCompanyName = name;
      }
    }
    const companyName = resolvedCompanyName ?? a.companyName ?? PLACEHOLDER;

    // Resolve worksite name and address
    let resolvedWorksiteName: string | null = null;
    let resolvedWorksiteAddress: string | null = null;
    const worksiteId = a.worksiteId || a.locationId;
    if (worksiteId) {
      const needLookup =
        !a.worksiteName &&
        !a.location ||
        looksLikeDocId(a.worksiteName) ||
        looksLikeDocId(a.location);
      const wa = a.worksiteAddress || {};
      const needAddress = !wa.street && !wa.address && !wa.city && !wa.state && !wa.zipCode;
      if (needLookup || needAddress) {
        let locSnap = companyId
          ? await db.doc(`tenants/${tenantId}/crm_companies/${companyId}/locations/${worksiteId}`).get()
          : null;
        if (!locSnap?.exists) {
          locSnap = await db.doc(`tenants/${tenantId}/locations/${worksiteId}`).get();
        }
        if (locSnap?.exists) {
          const loc = locSnap.data() || {};
          if (needLookup) {
            const name = (loc.nickname || loc.title || loc.name || loc.locationName) as string | undefined;
            if (name && !looksLikeDocId(name)) resolvedWorksiteName = name;
          }
          if (needAddress) {
            const street = (loc.address || loc.street) as string | undefined;
            const zip = (loc.zipCode ?? loc.zipcode) as string | undefined;
            const parts = [street, loc.city, loc.state, zip].filter(Boolean) as string[];
            if (parts.length) resolvedWorksiteAddress = parts.join(', ');
          }
        }
      }
    }
    const worksiteName = resolvedWorksiteName ?? a.worksiteName ?? a.location ?? PLACEHOLDER;
    let worksiteAddressStr = resolvedWorksiteAddress || '';
    if (!worksiteAddressStr && (a.worksiteAddress || a.address)) {
      const wa = a.worksiteAddress || a.address;
      const parts = [wa.street || wa.address, wa.city, wa.state, wa.zipCode].filter(Boolean);
      worksiteAddressStr = parts.join(', ');
    }
    if (!worksiteAddressStr) worksiteAddressStr = PLACEHOLDER;

    const startDate = toDate(a.startDate);
    const endDate = toDate(a.endDate);
    const payRate = a.payRate != null ? `$${Number(a.payRate)}/hr` : PLACEHOLDER;
    const uniformText = [a.uniformRequirements, a.customUniformRequirements].filter(Boolean).join('\n\n') || PLACEHOLDER;
    const ppeText = a.ppeRequirements || PLACEHOLDER;

    // Shift (schedule)
    let scheduleShift: {
      shiftMode?: string;
      weeklySchedule?: Record<string, { enabled?: boolean; startTime?: string; endTime?: string }>;
      defaultStartTime?: string;
      defaultEndTime?: string;
      endDate?: string;
      shiftDescription?: string;
      emailIntro?: string;
    } | null = null;
    if (a.jobOrderId && a.shiftId) {
      const shiftSnap = await db
        .doc(`tenants/${tenantId}/job_orders/${a.jobOrderId}/shifts/${a.shiftId}`)
        .get();
      if (shiftSnap.exists) {
        const d = shiftSnap.data() || {};
        scheduleShift = {
          shiftMode: d.shiftMode,
          weeklySchedule: d.weeklySchedule,
          defaultStartTime: d.defaultStartTime,
          defaultEndTime: d.defaultEndTime,
          endDate: d.endDate,
          shiftDescription: d.shiftDescription,
          emailIntro: d.emailIntro,
        };
      }
    }

    const jobOrderType = a.jobOrderType === 'gig' || a.jobOrderType === 'career' ? a.jobOrderType : undefined;

    // Recruiters
    const recruiters: Array<{ displayName: string; email?: string; phone?: string }> = [];
    if (a.jobOrderId) {
      const jobOrderSnap = await db.doc(`tenants/${tenantId}/job_orders/${a.jobOrderId}`).get();
      const ids: string[] = [];
      if (jobOrderSnap.exists) {
        const jo = jobOrderSnap.data() || {};
        const assigned = jo.assignedRecruiters as string[] | undefined;
        const legacyId = jo.recruiterId as string | undefined;
        if (Array.isArray(assigned) && assigned.length) ids.push(...assigned);
        else if (legacyId) ids.push(legacyId);
      }
      const uniq = Array.from(new Set(ids));
      for (const uid of uniq) {
        const userSnap = await db.doc(`users/${uid}`).get();
        if (userSnap.exists) {
          const u = userSnap.data() || {};
          const firstName = (u.firstName as string) || '';
          const lastName = (u.lastName as string) || '';
          const displayName =
            `${firstName} ${lastName}`.trim() ||
            (u.displayName as string) ||
            (u.email as string) ||
            'Recruiter';
          const phone = (u.phone || u.phoneNumber || u.phoneE164) as string | undefined;
          recruiters.push({
            displayName,
            email: u.email as string | undefined,
            phone: phone && String(phone).trim() ? String(phone).trim() : undefined,
          });
        } else {
          recruiters.push({ displayName: 'Recruiter' });
        }
      }
    }

    // Build HTML sections
    const sections: string[] = [];

    // Assignment Info
    sections.push(`
<h2 style="margin:0 0 8px 0; font-size:18px; font-weight:700;">Assignment Info</h2>
<table style="border-collapse:collapse; width:100%; max-width:560px;">
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Job Title</td></tr>
<tr><td style="padding:0 0 12px 0; font-weight:600;">${escapeHtml((a.jobTitle as string) || PLACEHOLDER)}</td></tr>
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Start Date</td></tr>
<tr><td style="padding:0 0 12px 0;">${startDate ? formatDate(startDate) : PLACEHOLDER}</td></tr>
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Pay Rate</td></tr>
<tr><td style="padding:0 0 12px 0; font-weight:600;">${escapeHtml(String(payRate))}</td></tr>
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Company Name</td></tr>
<tr><td style="padding:0 0 12px 0;">${escapeHtml(companyName)}</td></tr>
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Worksite name</td></tr>
<tr><td style="padding:0 0 12px 0;">${escapeHtml(worksiteName)}</td></tr>
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Worksite address</td></tr>
<tr><td style="padding:0 0 12px 0;">${worksiteAddressStr !== PLACEHOLDER ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(worksiteAddressStr)}" style="color:#1976d2;">${escapeHtml(worksiteAddressStr)}</a>` : PLACEHOLDER}</td></tr>
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Required uniform</td></tr>
<tr><td style="padding:0 0 12px 0; white-space:pre-wrap;">${nl2br(String(uniformText))}</td></tr>
<tr><td style="padding:4px 12px 4px 0; color:#666; font-size:12px;">Required PPE</td></tr>
<tr><td style="padding:0 0 16px 0;">${escapeHtml(String(ppeText))}</td></tr>
</table>`);

    // My Schedule
    const weeklySchedule = scheduleShift?.shiftMode === 'multi' && scheduleShift?.weeklySchedule && Object.keys(scheduleShift.weeklySchedule).length > 0;
    let scheduleHtml = '<h2 style="margin:0 0 8px 0; font-size:18px; font-weight:700;">My Schedule</h2>';
    if (weeklySchedule && scheduleShift?.weeklySchedule) {
      const lines: string[] = [];
      for (const dow of DOW_ORDER) {
        const entry = scheduleShift.weeklySchedule[String(dow)];
        if (!entry?.enabled) continue;
        const start = formatTime(entry.startTime);
        const end = formatTime(entry.endTime);
        lines.push(`${DOW_LABELS[dow]}: ${start} – ${end}`);
      }
      if (lines.length) {
        scheduleHtml += `<p style="margin:0 0 4px 0; color:#666; font-size:12px;">Weekly schedule</p><ul style="margin:0 0 12px 0; padding-left:20px;">${lines.map((l) => `<li style="margin:4px 0;">${escapeHtml(l)}</li>`).join('')}</ul>`;
      }
      if (startDate) {
        scheduleHtml += `<p style="margin:0 0 4px 0; color:#666; font-size:12px;">Start date</p><p style="margin:0 0 12px 0;">${formatDate(startDate)}</p>`;
      }
      if (jobOrderType === 'gig' && (endDate || scheduleShift.endDate)) {
        const endVal = endDate ? formatDate(endDate) : (scheduleShift.endDate ? formatDate(new Date(scheduleShift.endDate)) : PLACEHOLDER);
        scheduleHtml += `<p style="margin:0 0 4px 0; color:#666; font-size:12px;">End date</p><p style="margin:0 0 12px 0;">${endVal}</p>`;
      }
      if (jobOrderType === 'career' && !endDate && !scheduleShift.endDate) {
        scheduleHtml += `<p style="margin:0 0 4px 0; color:#666; font-size:12px;">Duration</p><p style="margin:0 0 12px 0;">Ongoing</p>`;
      }
    } else {
      if (startDate) {
        scheduleHtml += `<p style="margin:0 0 4px 0; color:#666; font-size:12px;">Date</p><p style="margin:0 0 12px 0;">${formatDate(startDate)}</p>`;
      }
      const startT = a.startTime || scheduleShift?.defaultStartTime;
      const endT = a.endTime || scheduleShift?.defaultEndTime;
      if (startT || endT) {
        const timeStr = [formatTime(startT), formatTime(endT)].filter(Boolean).join(' – ');
        scheduleHtml += `<p style="margin:0 0 4px 0; color:#666; font-size:12px;">Time</p><p style="margin:0 0 12px 0;">${escapeHtml(timeStr)}</p>`;
      }
      if (endDate) {
        scheduleHtml += `<p style="margin:0 0 4px 0; color:#666; font-size:12px;">End date</p><p style="margin:0 0 12px 0;">${formatDate(endDate)}</p>`;
      }
      if (!startDate && !startT && !endT && !scheduleShift?.defaultStartTime) {
        scheduleHtml += `<p style="margin:0 0 12px 0; color:#666;">No schedule details available.</p>`;
      }
    }
    if (scheduleShift?.shiftDescription?.trim()) {
      scheduleHtml += `<p style="margin:12px 0 4px 0; color:#666; font-size:12px;">Shift-Specific Details or Job Description</p><p style="margin:0 0 12px 0; white-space:pre-wrap;">${nl2br(scheduleShift.shiftDescription)}</p>`;
    }
    if (scheduleShift?.emailIntro?.trim()) {
      scheduleHtml += `<p style="margin:12px 0 4px 0; color:#666; font-size:12px;">Shift Info to Email Staff</p><p style="margin:0 0 12px 0; white-space:pre-wrap;">${nl2br(scheduleShift.emailIntro)}</p>`;
    }
    sections.push(scheduleHtml);

    // Staff Instructions
    const staffSections: Array<{ title: string; text: string; files: any[] }> = [
      { title: 'First Day Instructions', text: (a.staffInstructions?.firstDay?.text ?? '').trim(), files: a.staffInstructions?.firstDay?.files ?? [] },
      { title: 'Parking Instructions', text: (a.staffInstructions?.parking?.text ?? '').trim(), files: a.staffInstructions?.parking?.files ?? [] },
      { title: 'Check-In Instructions', text: ((a.staffInstructions?.checkIn?.text || a.checkInInstructions) ?? '').trim(), files: a.staffInstructions?.checkIn?.files ?? [] },
      { title: 'Uniform Instructions', text: (a.staffInstructions?.uniform?.text ?? '').trim(), files: a.staffInstructions?.uniform?.files ?? [] },
      { title: 'Credential Instructions', text: (a.staffInstructions?.credentials?.text ?? '').trim(), files: a.staffInstructions?.credentials?.files ?? [] },
      { title: 'Other Instructions', text: (a.staffInstructions?.other?.text ?? '').trim(), files: a.staffInstructions?.other?.files ?? [] },
      { title: 'Other Attachments', text: '', files: a.staffInstructions?.attachments?.files ?? [] },
    ];
    for (const sec of staffSections) {
      if (sec.text || (Array.isArray(sec.files) && sec.files.length > 0)) {
        let block = `<h2 style="margin:16px 0 8px 0; font-size:18px; font-weight:700;">${escapeHtml(sec.title)}</h2>`;
        if (sec.text) block += `<p style="margin:0 0 8px 0; color:#444; white-space:pre-wrap;">${nl2br(sec.text)}</p>`;
        if (Array.isArray(sec.files) && sec.files.length > 0) {
          block += '<p style="margin:8px 0 0 0;">' + sec.files.map((f: any) => {
            const label = f.label || f.name || 'View File';
            const url = f.url || '#';
            return `<a href="${escapeHtml(url)}" style="margin-right:8px; color:#1976d2;">${escapeHtml(label)}</a>`;
          }).join('') + '</p>';
        }
        sections.push(block);
      }
    }

    // Additional Notes
    if (a.notes && String(a.notes).trim()) {
      sections.push(`<h2 style="margin:16px 0 8px 0; font-size:18px; font-weight:700;">Additional Notes</h2><p style="margin:0 0 12px 0; color:#444; white-space:pre-wrap;">${nl2br(String(a.notes))}</p>`);
    }

    // Metadata
    const createdAt = toDate(a.createdAt);
    const updatedAt = toDate(a.updatedAt);
    if (createdAt || updatedAt) {
      let meta = '<p style="margin:16px 0 0 0; color:#666; font-size:12px;">';
      if (createdAt) meta += `Created: ${formatDateTime(createdAt)}<br>`;
      if (updatedAt) meta += `Last Updated: ${formatDateTime(updatedAt)}`;
      meta += '</p>';
      sections.push(meta);
    }

    // My Recruiter
    let recruiterHtml = '<h2 style="margin:16px 0 8px 0; font-size:18px; font-weight:700;">My Recruiter</h2>';
    if (recruiters.length > 0) {
      recruiterHtml += recruiters.map((r) => {
        let line = `<p style="margin:0 0 4px 0; font-weight:600;">${escapeHtml(r.displayName)}</p>`;
        if (r.phone) line += `<p style="margin:0 0 4px 0;"><a href="sms:${encodeURIComponent((r.phone || '').replace(/[^\d+]/g, ''))}" style="color:#1976d2;">${escapeHtml(r.phone)}</a></p>`;
        if (r.email) line += `<p style="margin:0 0 8px 0;"><a href="mailto:${encodeURIComponent(r.email)}" style="color:#1976d2;">${escapeHtml(r.email)}</a></p>`;
        return `<div style="margin-bottom:12px;">${line}</div>`;
      }).join('');
    } else {
      recruiterHtml += '<p style="margin:0 0 12px 0; color:#666;">No recruiter assigned to this job order. Reach out via Inbox if you need support.</p>';
    }
    sections.push(recruiterHtml);

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: #333; max-width: 600px; margin: 0 auto; padding: 24px;">
${sections.join('')}
<p style="margin-top:24px; font-size:12px; color:#666;">View this assignment in the app for the latest updates.</p>
</body>
</html>`;
    return { subject, html };
  } catch (err: any) {
    logger.error('buildAssignmentDetailsEmail failed', { tenantId, assignmentId, error: err?.message });
    return null;
  }
}
