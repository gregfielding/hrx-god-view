/**
 * **ShiftLogEntry** — one card in the /shifts/log feed.
 *
 * Per Greg's Slice 4 spec: shows what the system WOULD do if Slice 5
 * (the apply path) were active. No HRX shift/JO/assignment mutation
 * happens from this view — the only writes are to the
 * `external_shift_requests` doc itself (status/decision fields).
 *
 * Color coding matches the spec mock:
 *   - ➕ ADD (new_request)     → green stripe
 *   - ✏️ EDIT (change_*)        → blue stripe
 *   - ⚠️ SUBTRACT (cancel_*)   → red stripe + ack checkbox
 *   - ⚠️ NOTE (no_show)         → red stripe + ack checkbox
 *   - 📋 DIGEST (digest_*)      → grey stripe (info-only)
 *   - ❓ NEEDS REVIEW (no match) → amber stripe
 */

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import {
  AddCircleOutline,
  EditOutlined,
  RemoveCircleOutline,
  ReportProblemOutlined,
  ListAltOutlined,
  HelpOutline,
  ExpandMore,
  ExpandLess,
} from '@mui/icons-material';

import type {
  ExternalShiftRequest,
  IndeedFlexEvent,
} from '../../shared/indeedFlex/types';

interface Props {
  request: ExternalShiftRequest;
  /** Called with status='applied' when recruiter clicks "Mark applied",
   *  status='rejected' on "Reject". Reason is the optional free-form note. */
  onDecide?: (decision: 'applied' | 'rejected', reason?: string) => Promise<void>;
  /** True while the parent is mutating the doc; disables buttons. */
  pending?: boolean;
}

interface KindMeta {
  kind: 'add' | 'edit' | 'subtract' | 'note' | 'digest' | 'review';
  label: string;
  icon: React.ReactNode;
  stripeColor: string;
  destructive: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Visual classification
// ─────────────────────────────────────────────────────────────────────

function classify(req: ExternalShiftRequest): KindMeta {
  const t = req.eventType;
  if (req.matchConfidence === 'none' || req.matchConfidence === 'multiple') {
    return {
      kind: 'review',
      label: 'NEEDS REVIEW',
      icon: <HelpOutline />,
      stripeColor: '#F59E0B', // amber
      destructive: false,
    };
  }
  switch (t) {
    case 'new_request':
      return {
        kind: 'add',
        label: 'ADD',
        icon: <AddCircleOutline />,
        stripeColor: '#10B981', // green
        destructive: false,
      };
    case 'change_time':
    case 'change_headcount':
      return {
        kind: 'edit',
        label: 'EDIT',
        icon: <EditOutlined />,
        stripeColor: '#3B82F6', // blue
        destructive: false,
      };
    case 'cancel_booking':
      return {
        kind: 'subtract',
        label: 'SUBTRACT',
        icon: <RemoveCircleOutline />,
        stripeColor: '#EF4444', // red
        destructive: true,
      };
    case 'no_show':
      return {
        kind: 'note',
        label: 'NO-SHOW',
        icon: <ReportProblemOutlined />,
        stripeColor: '#EF4444', // red
        destructive: true,
      };
    case 'daily_digest_expired':
      return {
        kind: 'digest',
        label: 'DIGEST',
        icon: <ListAltOutlined />,
        stripeColor: '#6B7280', // grey
        destructive: false,
      };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Action description per event type
// ─────────────────────────────────────────────────────────────────────

function ActionDescription({
  event,
  matchedShiftId,
  matchedJobOrderId,
  matchedAssignmentIds,
}: {
  event: IndeedFlexEvent;
  matchedShiftId?: string;
  matchedJobOrderId?: string;
  matchedAssignmentIds?: string[];
}): React.ReactElement {
  switch (event.type) {
    case 'new_request':
      return (
        <Stack spacing={0.5}>
          <Typography variant="body2" fontWeight={600}>
            WOULD CREATE shift under JO {matchedJobOrderId ?? '(unmatched)'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            • date <code>{event.workDate ?? '?'}</code>, time{' '}
            <code>
              {event.startTime ?? '?'}–{event.endTime ?? '?'}
            </code>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            • headcount <code>{event.headcount}</code>
            {event.payRateUsd != null && (
              <>
                {' '}
                · pay <code>${event.payRateUsd}/hr</code>
              </>
            )}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            • <code>poNumber=&quot;{event.jobId}&quot;</code> (Indeed Job ID)
          </Typography>
        </Stack>
      );

    case 'change_time':
      return (
        <Stack spacing={0.5}>
          <Typography variant="body2" fontWeight={600}>
            WOULD UPDATE shift {matchedShiftId ?? '(unmatched)'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            • <code>defaultStartTime</code>:{' '}
            <code>{event.previousStartTime ?? '?'}</code> →{' '}
            <code>{event.newStartTime ?? '?'}</code>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            • <code>defaultEndTime</code>:{' '}
            <code>{event.previousEndTime ?? '?'}</code> →{' '}
            <code>{event.newEndTime ?? '?'}</code>
          </Typography>
        </Stack>
      );

    case 'change_headcount':
      return (
        <Stack spacing={0.5}>
          <Typography variant="body2" fontWeight={600}>
            WOULD UPDATE shift {matchedShiftId ?? '(unmatched)'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            • <code>workersNeeded</code>:{' '}
            <code>{event.previousHeadcount ?? '?'}</code> →{' '}
            <code>{event.newHeadcount}</code>
          </Typography>
        </Stack>
      );

    case 'cancel_booking': {
      const names = event.workerNames;
      const ids = matchedAssignmentIds ?? [];
      return (
        <Stack spacing={0.5}>
          <Typography variant="body2" fontWeight={600}>
            WOULD CANCEL {names.length} assignment{names.length === 1 ? '' : 's'} on shift{' '}
            {matchedShiftId ?? '(unmatched)'}
          </Typography>
          {names.map((name, i) => (
            <Typography key={i} variant="body2" color="text.secondary">
              • <code>{ids[i] || '(no match)'}</code> — {name}
            </Typography>
          ))}
          {event.reason && (
            <Typography variant="body2" color="text.secondary">
              Reason: {event.reason}
            </Typography>
          )}
        </Stack>
      );
    }

    case 'no_show': {
      const ids = matchedAssignmentIds ?? [];
      return (
        <Stack spacing={0.5}>
          <Typography variant="body2" fontWeight={600}>
            WOULD STAMP no_show on assignment {ids[0] || '(no match)'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Worker: <strong>{event.workerName}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Side effects: reliability score drop, auto-placement gate.
          </Typography>
        </Stack>
      );
    }

    case 'daily_digest_expired': {
      const jobs = event.expiredJobs;
      return (
        <Stack spacing={0.5}>
          <Typography variant="body2" fontWeight={600}>
            DIGEST — {jobs.length} expired Indeed job
            {jobs.length === 1 ? '' : 's'} (info only)
          </Typography>
          {jobs.slice(0, 10).map((j, i) => (
            <Typography key={i} variant="body2" color="text.secondary">
              • <code>{j.jobId ?? '?'}</code>
              {j.venueName ? ` — ${j.venueName}` : ''}
            </Typography>
          ))}
          {jobs.length > 10 && (
            <Typography variant="body2" color="text.secondary">
              … and {jobs.length - 10} more
            </Typography>
          )}
        </Stack>
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────────────

export default function ShiftLogEntry({ request, onDecide, pending }: Props): React.ReactElement {
  const kind = classify(request);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const needsAck = kind.destructive && request.status === 'needs_review';

  const handleApply = async (): Promise<void> => {
    if (!onDecide) return;
    if (needsAck && !acknowledged) return;
    await onDecide('applied');
  };
  const handleReject = async (): Promise<void> => {
    if (!onDecide) return;
    await onDecide('rejected');
  };

  return (
    <Box
      sx={{
        display: 'flex',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1.5,
        overflow: 'hidden',
        backgroundColor: 'background.paper',
      }}
    >
      {/* Left stripe */}
      <Box sx={{ width: 8, backgroundColor: kind.stripeColor, flexShrink: 0 }} />

      <Box sx={{ flex: 1, p: 2 }}>
        {/* Header line */}
        <Stack direction="row" alignItems="center" spacing={1} mb={1} flexWrap="wrap">
          <Box sx={{ color: kind.stripeColor, display: 'flex' }}>{kind.icon}</Box>
          <Typography variant="subtitle2" fontWeight={700}>
            {kind.label}
          </Typography>
          <Chip label={request.eventType} size="small" variant="outlined" />
          <Chip
            label={`match: ${request.matchConfidence ?? 'pending'}`}
            size="small"
            color={
              request.matchConfidence === 'exact' || request.matchConfidence === 'fuzzy'
                ? 'success'
                : request.matchConfidence === 'multiple'
                  ? 'warning'
                  : request.matchConfidence === 'none'
                    ? 'error'
                    : 'default'
            }
          />
          {request.recommendedAction && (
            <Chip
              label={request.recommendedAction}
              size="small"
              variant="outlined"
              color={
                request.recommendedAction === 'auto'
                  ? 'success'
                  : request.recommendedAction === 'review'
                    ? 'primary'
                    : 'error'
              }
            />
          )}
          <Box flex={1} />
          <Typography variant="caption" color="text.secondary">
            {request.createdAt ? new Date(request.createdAt).toLocaleString() : ''}
          </Typography>
        </Stack>

        {/* Action description */}
        <Box sx={{ mb: 1 }}>
          <ActionDescription
            event={request.event}
            matchedShiftId={request.matchedShiftId}
            matchedJobOrderId={request.matchedJobOrderId}
            matchedAssignmentIds={request.matchedAssignmentIds}
          />
        </Box>

        {request.matchNotes && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mb: 1, fontStyle: 'italic' }}
          >
            Match notes: {request.matchNotes}
          </Typography>
        )}

        {/* Destructive-action ack banner */}
        {needsAck && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                id={`ack-${request.id}`}
                disabled={pending}
              />
              <Typography variant="body2" component="label" htmlFor={`ack-${request.id}`}>
                I acknowledge this affects scheduled workers
              </Typography>
            </Stack>
          </Alert>
        )}

        {/* Details disclosure */}
        <Button
          size="small"
          onClick={() => setDetailsOpen((o) => !o)}
          startIcon={detailsOpen ? <ExpandLess /> : <ExpandMore />}
        >
          {detailsOpen ? 'Hide details' : 'Show details'}
        </Button>
        <Collapse in={detailsOpen}>
          <Box sx={{ mt: 1.5, p: 1.5, backgroundColor: 'grey.50', borderRadius: 1 }}>
            <DetailRow
              label="Source ingest"
              value={request.sourceIngestEventHash.slice(0, 16) + '…'}
            />
            <DetailRow label="Parse source" value={request.parseSource} />
            <DetailRow label="Parser confidence" value={request.confidence} />
            {request.parseNotes && <DetailRow label="Parse notes" value={request.parseNotes} />}
            {request.matchedAt && (
              <DetailRow label="Matched at" value={new Date(request.matchedAt).toLocaleString()} />
            )}
            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" component="pre" sx={{ fontFamily: 'monospace', m: 0 }}>
              {JSON.stringify(request.event, null, 2)}
            </Typography>
          </Box>
        </Collapse>

        {/* Action buttons */}
        {request.status === 'needs_review' && onDecide && (
          <Stack direction="row" spacing={1} mt={1.5}>
            <Button
              variant="contained"
              size="small"
              disabled={pending || (needsAck && !acknowledged)}
              onClick={handleApply}
            >
              Mark applied
            </Button>
            <Button
              variant="outlined"
              color="error"
              size="small"
              disabled={pending}
              onClick={handleReject}
            >
              Reject
            </Button>
          </Stack>
        )}
        {request.status !== 'needs_review' && (
          <Chip
            label={`${request.status} · ${
              request.decidedBy?.slice(0, 8) ?? 'system'
            } · ${request.decidedAt ? new Date(request.decidedAt).toLocaleDateString() : ''}`}
            size="small"
            sx={{ mt: 1.5 }}
            variant="outlined"
          />
        )}
      </Box>
    </Box>
  );
}

function DetailRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <Stack direction="row" spacing={1}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 140 }}>
        {label}:
      </Typography>
      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
        {value}
      </Typography>
    </Stack>
  );
}
