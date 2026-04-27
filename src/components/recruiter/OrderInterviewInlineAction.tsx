import React, { useMemo, useState } from 'react';
import { Box, Button, CircularProgress, Tooltip, Typography } from '@mui/material';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { hasRecruiterInterviewCompletionEvidence } from '../../utils/scoreSummary';
import type { RecruiterUser } from '../../types/recruiterUserListRow';

/** Coerce Firestore timestamps / ISO strings / Date objects into a Date or null. */
function toDateLike(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof (value as any)?.toDate === 'function') {
    try {
      const d = (value as any).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  if (typeof value === 'object' && value !== null) {
    const seconds = (value as any)?.seconds ?? (value as any)?._seconds;
    if (typeof seconds === 'number') return new Date(seconds * 1000);
  }
  return null;
}

function hasUsableSmsPhone(user: Pick<RecruiterUser, 'phone'>): boolean {
  return String(user?.phone || '').replace(/\D/g, '').length >= 10;
}

export interface OrderInterviewInlineActionProps {
  user: Pick<
    RecruiterUser,
    | 'id'
    | 'phone'
    | 'scoreSummary'
    | 'hasWorkerAiPrescreenInterview'
    | 'interviewStatus'
    | 'lastInterviewCompletedAt'
    | 'recruiterOrderInterviewSmsLastSentAt'
  >;
  /** Optional override; falls back to viewer's active tenant when omitted. */
  tenantId?: string | null;
}

/**
 * Inline "Order Interview" CTA shown in recruiter list views (Users, Group Members, Applicants)
 * when a worker has not yet completed the AI pre-screen interview. Mirrors the action button used
 * on the profile Interview tab, but shown beneath the Concern column copy so recruiters can act
 * without opening the profile.
 */
const OrderInterviewInlineAction: React.FC<OrderInterviewInlineActionProps> = ({ user, tenantId }) => {
  const { activeTenant, currentClaimsSecurityLevel, securityLevel } = useAuth() as any;

  const viewerCanUseTool = useMemo(() => {
    const level = Number.parseInt(String(currentClaimsSecurityLevel || securityLevel || '0'), 10) || 0;
    return level >= 5 && level <= 7;
  }, [currentClaimsSecurityLevel, securityLevel]);

  const interviewCompleted = hasRecruiterInterviewCompletionEvidence(user.scoreSummary, {
    hasWorkerAiPrescreenInterview: user.hasWorkerAiPrescreenInterview,
    interviewStatus: user.interviewStatus,
    lastInterviewCompletedAt: user.lastInterviewCompletedAt,
  });

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localLastSentAt, setLocalLastSentAt] = useState<Date | null>(null);

  if (!viewerCanUseTool || interviewCompleted) return null;

  const effectiveTenantId = tenantId || activeTenant?.id || '';
  const phoneOk = hasUsableSmsPhone(user);
  const lastSentAt = localLastSentAt ?? toDateLike(user.recruiterOrderInterviewSmsLastSentAt);

  const handleClick = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!user.id || !effectiveTenantId || sending) return;
    setSending(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'sendWorkerOrderInterviewSms');
      const result = await fn({ uid: user.id, tenantId: effectiveTenantId });
      const data = (result as any)?.data || {};
      setLocalLastSentAt(data?.sentAt ? new Date(data.sentAt) : new Date());
    } catch (err: any) {
      const raw = err?.message || err?.details?.message || (typeof err === 'string' ? err : '');
      const cleaned = String(raw)
        .replace(/^Firebase:\s*/i, '')
        .replace(/\s*\(functions\/[^)]+\)\s*$/i, '')
        .trim();
      setError(cleaned || 'Failed to send interview invite SMS');
    } finally {
      setSending(false);
    }
  };

  const disabled = sending || !phoneOk || !effectiveTenantId;
  const disabledHint = !phoneOk
    ? 'Add a phone number for this worker (profile or verified mobile) to send the interview SMS.'
    : !effectiveTenantId
      ? 'Tenant context unavailable.'
      : '';

  const button = (
    <Button
      variant="outlined"
      size="small"
      onClick={handleClick}
      disabled={disabled}
      startIcon={sending ? <CircularProgress color="inherit" size={10} /> : undefined}
      sx={{
        borderColor: 'divider',
        px: 0.75,
        py: 0.125,
        minHeight: 22,
        fontSize: '0.68rem',
        fontWeight: 600,
        lineHeight: 1.2,
        textTransform: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      Order Interview
    </Button>
  );

  return (
    <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 }}>
      {disabledHint ? (
        <Tooltip title={disabledHint} placement="top">
          <span style={{ display: 'inline-block', cursor: 'not-allowed' }}>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      {error ? (
        <Typography sx={{ fontSize: '0.65rem', lineHeight: 1.3, color: 'error.main' }}>{error}</Typography>
      ) : lastSentAt ? (
        <Typography sx={{ fontSize: '0.65rem', lineHeight: 1.3, color: 'text.secondary' }}>
          Sent {lastSentAt.toLocaleString()}
        </Typography>
      ) : null}
    </Box>
  );
};

export default OrderInterviewInlineAction;
