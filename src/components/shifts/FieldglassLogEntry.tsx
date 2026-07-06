/**
 * FieldglassLogEntry — one Fieldglass (Sodexo) order card in the
 * /shifts/log feed.
 *
 * Fieldglass rows share the `external_shift_requests` collection with
 * Indeed Flex but have a different event shape (`new_job_posting`), so
 * they get their own renderer — the Indeed Flex `<ShiftLogEntry />`
 * switches exhaustively over its own event union and would crash on a
 * Fieldglass row.
 *
 * The key action here is **Create site + account** (FG Slice 3): runs
 * the idempotent site → CRM location → child account chain and stamps
 * `siteResolution` on the row. Once stamped, the card shows the
 * resolved account as a green "Site ready" chip. JO creation from the
 * resolved account is the next slice.
 */

import React, { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import {
  WorkOutline,
  ExpandMore,
  ExpandLess,
  CheckCircleOutline,
  AddBusinessOutlined,
} from '@mui/icons-material';

/** Local view of a fieldglass row in `external_shift_requests`. Kept
 *  here (not in the byte-mirrored shared/indeedFlex types) on purpose —
 *  see functions/src/integrations/fieldglass/types.ts for the server
 *  source of truth. */
export interface FieldglassRequestRow {
  id: string;
  provider: 'fieldglass';
  eventType: string;
  status: 'needs_review' | 'approved' | 'applied' | 'rejected' | 'superseded';
  confidence?: 'high' | 'medium' | 'low';
  parseSource?: string;
  parseNotes?: string;
  sourceIngestEventHash?: string;
  createdAt?: string;
  updatedAt?: string;
  decidedBy?: string;
  decidedAt?: string;
  event?: {
    jobPostingId?: string;
    title?: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    businessUnit?: string;
    siteName?: string;
    locationName?: string;
    commentsToSupplier?: string;
    payRate?: number;
    billRateDerived?: number;
    detailUrl?: string;
  };
  /** Stamped by fieldglassEnsureSite once the site chain is ensured. */
  siteResolution?: {
    siteName?: string;
    siteCode?: string | null;
    locationId?: string;
    childAccountId?: string;
    resolvedAt?: string;
    resolvedBy?: string;
  };
  /** Stamped by the FG7 orchestrator once the JO stack is auto-created. */
  jobOrderId?: string;
  jobPostDocId?: string;
  /** Stamped by fieldglassEnrichmentIngest (Chrome extension sync). */
  enrichment?: {
    positionsRequested?: number;
    maxSubmissions?: number;
    payRateSt?: number;
    payRateOt?: number;
    payRateDt?: number;
    billRateSt?: number;
    billRateOt?: number;
    billRateDt?: number;
    scheduleText?: string;
    hiringManagerName?: string;
    hiringManagerEmail?: string;
    uniform?: string;
    candidateInMind?: boolean;
    candidateInMindNote?: string;
    capturedAt?: string;
  };
}

interface Props {
  request: FieldglassRequestRow;
  pending?: boolean;
  onDecide?: (decision: 'applied' | 'rejected') => Promise<void>;
  /** Opens the Create site + account dialog for this row. */
  onCreateSite?: (request: FieldglassRequestRow) => void;
}

const STRIPE = '#8B5CF6'; // violet — distinct from every Indeed Flex kind

export default function FieldglassLogEntry({
  request,
  pending,
  onDecide,
  onCreateSite,
}: Props): React.ReactElement {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const ev = request.event ?? {};
  const resolved = !!request.siteResolution?.childAccountId;
  const enr = request.enrichment;

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
      <Box sx={{ width: 8, backgroundColor: STRIPE, flexShrink: 0 }} />

      <Box sx={{ flex: 1, p: 2 }}>
        {/* Header line */}
        <Stack direction="row" alignItems="center" spacing={1} mb={1} flexWrap="wrap">
          <Box sx={{ color: STRIPE, display: 'flex' }}>
            <WorkOutline />
          </Box>
          <Typography variant="subtitle2" fontWeight={700}>
            FIELDGLASS ORDER
          </Typography>
          <Chip label="Sodexo" size="small" variant="outlined" />
          {request.confidence && (
            <Chip
              label={`parse: ${request.confidence}`}
              size="small"
              color={request.confidence === 'high' ? 'success' : 'warning'}
            />
          )}
          {resolved ? (
            <Chip
              icon={<CheckCircleOutline />}
              label="Site ready"
              size="small"
              color="success"
            />
          ) : (
            <Chip label="site not set up" size="small" color="warning" variant="outlined" />
          )}
          {enr ? (
            <Chip label="details synced" size="small" color="success" variant="outlined" />
          ) : (
            <Chip label="details pending" size="small" variant="outlined" />
          )}
          {request.jobOrderId && (
            <Chip
              label="JO created"
              size="small"
              color="success"
              component="a"
              href={`/jobs/job-orders/${request.jobOrderId}`}
              clickable
            />
          )}
          {enr?.candidateInMind && (
            <Chip label="⚠ candidate in mind" size="small" color="error" />
          )}
          <Box flex={1} />
          <Typography variant="caption" color="text.secondary">
            {request.createdAt ? new Date(request.createdAt).toLocaleString() : ''}
          </Typography>
        </Stack>

        {/* Order summary */}
        <Stack spacing={0.5} sx={{ mb: 1 }}>
          <Typography variant="body2" fontWeight={600}>
            {ev.title ?? '(no title parsed)'} — <code>{ev.jobPostingId ?? '?'}</code>
          </Typography>
          {ev.siteName && (
            <Typography variant="body2" color="text.secondary">
              • site: <code>{ev.siteName}</code>
              {ev.locationName && ev.locationName !== ev.siteName && <> · {ev.locationName}</>}
            </Typography>
          )}
          {(ev.startDate || ev.endDate) && (
            <Typography variant="body2" color="text.secondary">
              • dates: <code>{ev.startDate ?? '?'}</code> → <code>{ev.endDate ?? '?'}</code>
            </Typography>
          )}
          {ev.payRate != null && (
            <Typography variant="body2" color="text.secondary">
              • pay <code>${ev.payRate.toFixed(2)}/hr</code>
              {ev.billRateDerived != null && (
                <>
                  {' '}
                  · bill <code>${ev.billRateDerived.toFixed(2)}/hr</code>{' '}
                  <Typography component="span" variant="caption">
                    (1.56× rate card)
                  </Typography>
                </>
              )}
            </Typography>
          )}
          {enr?.candidateInMind && (
            <Typography variant="body2" sx={{ color: 'error.main', fontWeight: 600 }}>
              ⚠ Buyer already has a candidate in mind
              {enr.candidateInMindNote ? ` — "${enr.candidateInMindNote}"` : ''} (likely wired
              for another agency — deprioritize)
            </Typography>
          )}
          {enr?.positionsRequested != null && (
            <Typography variant="body2" color="text.secondary">
              • positions: <code>{enr.positionsRequested}</code>
              {enr.maxSubmissions != null && (
                <>
                  {' '}
                  · max submissions <code>{enr.maxSubmissions}</code>
                </>
              )}
            </Typography>
          )}
          {enr?.payRateSt != null && (
            <Typography variant="body2" color="text.secondary">
              • rates: pay{' '}
              <code>
                ${enr.payRateSt.toFixed(2)}
                {enr.payRateOt != null ? ` / $${enr.payRateOt.toFixed(2)}` : ''}
                {enr.payRateDt != null ? ` / $${enr.payRateDt.toFixed(2)}` : ''}
              </code>
              {enr.billRateSt != null && (
                <>
                  {' '}
                  · bill{' '}
                  <code>
                    ${enr.billRateSt.toFixed(2)}
                    {enr.billRateOt != null ? ` / $${enr.billRateOt.toFixed(2)}` : ''}
                    {enr.billRateDt != null ? ` / $${enr.billRateDt.toFixed(2)}` : ''}
                  </code>
                </>
              )}{' '}
              <Typography component="span" variant="caption">
                (ST/OT/DT)
              </Typography>
            </Typography>
          )}
          {enr?.scheduleText && (
            <Typography variant="body2" color="text.secondary">
              • schedule: {enr.scheduleText}
            </Typography>
          )}
          {enr?.hiringManagerName && (
            <Typography variant="body2" color="text.secondary">
              • hiring manager: {enr.hiringManagerName}
              {enr.hiringManagerEmail ? ` (${enr.hiringManagerEmail})` : ''}
            </Typography>
          )}
          {resolved && (
            <Typography variant="body2" color="text.secondary">
              • account: <code>{request.siteResolution?.childAccountId}</code>
              {request.siteResolution?.siteCode && (
                <>
                  {' '}
                  · site code <code>{request.siteResolution.siteCode}</code>
                </>
              )}
            </Typography>
          )}
          {ev.detailUrl && (
            <Typography variant="body2" color="text.secondary">
              •{' '}
              <Link href={ev.detailUrl} target="_blank" rel="noopener noreferrer">
                Open in Fieldglass
              </Link>{' '}
              <Typography component="span" variant="caption">
                (supplier login required)
              </Typography>
            </Typography>
          )}
        </Stack>

        {/* Details disclosure — comments + parse metadata */}
        <Button
          size="small"
          onClick={() => setDetailsOpen((o) => !o)}
          startIcon={detailsOpen ? <ExpandLess /> : <ExpandMore />}
        >
          {detailsOpen ? 'Hide details' : 'Show details'}
        </Button>
        <Collapse in={detailsOpen}>
          <Box sx={{ mt: 1.5, p: 1.5, backgroundColor: 'grey.50', borderRadius: 1 }}>
            {ev.commentsToSupplier ? (
              <>
                <Typography variant="caption" color="text.secondary" fontWeight={700}>
                  Comments to supplier
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ whiteSpace: 'pre-wrap', mb: 1, fontSize: '0.8rem' }}
                >
                  {ev.commentsToSupplier}
                </Typography>
                <Divider sx={{ my: 1 }} />
              </>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                No supplier comments on this posting — check the detail page for the wage.
              </Typography>
            )}
            {request.parseNotes && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Parse notes: {request.parseNotes}
              </Typography>
            )}
            <Typography variant="caption" component="pre" sx={{ fontFamily: 'monospace', m: 0 }}>
              {JSON.stringify(ev, null, 2)}
            </Typography>
          </Box>
        </Collapse>

        {/* Actions */}
        {request.status === 'needs_review' ? (
          <Stack direction="row" spacing={1} mt={1.5}>
            {onCreateSite && (
              <Button
                variant={resolved ? 'outlined' : 'contained'}
                size="small"
                startIcon={<AddBusinessOutlined />}
                disabled={pending}
                onClick={() => onCreateSite(request)}
              >
                {resolved ? 'Re-check site' : 'Create site + account'}
              </Button>
            )}
            {onDecide && (
              <>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={pending}
                  onClick={() => void onDecide('applied')}
                >
                  Mark handled
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  disabled={pending}
                  onClick={() => void onDecide('rejected')}
                >
                  Reject
                </Button>
              </>
            )}
          </Stack>
        ) : (
          <Chip
            label={`${request.status} · ${request.decidedBy?.slice(0, 8) ?? 'system'} · ${
              request.decidedAt ? new Date(request.decidedAt).toLocaleDateString() : ''
            }`}
            size="small"
            sx={{ mt: 1.5 }}
            variant="outlined"
          />
        )}
      </Box>
    </Box>
  );
}
