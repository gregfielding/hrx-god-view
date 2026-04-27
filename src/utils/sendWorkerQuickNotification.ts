/**
 * Fire-and-forget worker notifications (same HTTP endpoints as MessageDrawer).
 */

const functionsBaseUrl =
  process.env.REACT_APP_FUNCTIONS_URL || 'https://us-central1-hrx1-d3beb.cloudfunctions.net';

function stripToPlain(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendBulkSmsToWorkerUsers(params: {
  idToken: string;
  tenantId: string;
  initiatedByUserId: string;
  recipientUserIds: string[];
  body: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const bodyPlain = stripToPlain(params.body);
  if (!bodyPlain) {
    return { ok: false, error: 'Message is empty.' };
  }
  if (bodyPlain.length > 1600) {
    return { ok: false, error: `Message is too long for SMS (${bodyPlain.length}/1600 characters).` };
  }

  const res = await fetch(`${functionsBaseUrl}/bulkSendSmsApi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.idToken}`,
    },
    body: JSON.stringify({
      tenantId: params.tenantId,
      initiatedByUserId: params.initiatedByUserId,
      recipientUserIds: params.recipientUserIds,
      body: bodyPlain,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    sent?: number;
    failed?: number;
    errors?: Array<{ error?: string }>;
  };

  if (!res.ok) {
    return { ok: false, error: data.error?.message || 'SMS send failed.' };
  }

  const failed = data.failed ?? 0;
  if (failed > 0) {
    const first = Array.isArray(data.errors) && data.errors.length > 0 ? data.errors[0].error : undefined;
    return {
      ok: false,
      error: first || `SMS could not be delivered (${data.sent ?? 0} sent, ${failed} failed).`,
    };
  }

  return { ok: true };
}

export async function sendNewEmailFromRecruiter(params: {
  tenantId: string;
  recruiterUserId: string;
  toEmails: string[];
  subject: string;
  bodyPlain: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const plain = stripToPlain(params.bodyPlain) || params.bodyPlain.trim();
  if (!plain) {
    return { ok: false, error: 'Message is empty.' };
  }
  const subj = params.subject.trim();
  if (!subj) {
    return { ok: false, error: 'Subject is required.' };
  }

  const bodyHtml = `<p>${escapeHtml(plain).replace(/\n/g, '<br/>')}</p>`;

  const res = await fetch(`${functionsBaseUrl}/sendNewEmailApi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: params.tenantId,
      userId: params.recruiterUserId,
      to: params.toEmails,
      subject: subj,
      bodyHtml,
      bodyPlain: plain,
      senderIdentity: 'gmail',
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: { message?: string; code?: string };
  };

  if (!res.ok || !data.success) {
    return {
      ok: false,
      error: data.error?.message || 'Email send failed.',
    };
  }

  return { ok: true };
}
