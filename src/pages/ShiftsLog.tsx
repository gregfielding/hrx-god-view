/**
 * ShiftsLog — log-view tab body for /shifts/log.
 *
 * Shows the live feed of Indeed Flex `external_shift_requests`. Two
 * kinds of action per row:
 *   - "Apply in HRX" (cancel_booking rows with matcher-resolved
 *     assignments): calls the indeedFlexApplyShiftRequest callable,
 *     which DOES mutate HRX — cancels + hard-deletes the matched
 *     assignments and stamps the row applied. Shipped 2026-07-17;
 *     before that this feed was dry-run-only.
 *   - "Mark applied" / "Reject": record-keeping only — status flips on
 *     the `external_shift_requests` doc itself, no schedule changes.
 *
 * The feed groups by date desc, with filters for status, confidence,
 * and date range. Each row renders via `<ShiftLogEntry />` which
 * encapsulates the action-description per event type.
 */

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { serverTimestamp, updateDoc, doc as fsDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import ShiftLogEntry from '../components/shifts/ShiftLogEntry';
import FieldglassLogEntry, {
  type FieldglassRequestRow,
} from '../components/shifts/FieldglassLogEntry';
import FieldglassEnsureSiteDialog from '../components/shifts/FieldglassEnsureSiteDialog';
import LinkVenueToAccountDialog from '../components/shifts/LinkVenueToAccountDialog';
import { useAuth } from '../contexts/AuthContext';
import { useExternalShiftRequests } from '../hooks/useExternalShiftRequests';
import { db, functions } from '../firebase';
import type { ExternalShiftRequest } from '../shared/indeedFlex/types';

/** Fieldglass rows share the collection but have their own shape —
 *  detect via the provider field the server stamps on every row. */
function isFieldglassRow(r: ExternalShiftRequest): boolean {
  return (r as unknown as { provider?: string }).provider === 'fieldglass';
}

type StatusFilter = 'needs_review' | 'applied' | 'rejected' | 'all';
type ConfidenceFilter = 'all' | 'exact-or-fuzzy' | 'needs-attention';

const ShiftsLog: React.FC = () => {
  const { tenantId, user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('needs_review');
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Active "Link to account" target — when set, the alias dialog is open
   *  for this log entry's venueName. */
  const [linkVenueRequest, setLinkVenueRequest] = useState<ExternalShiftRequest | null>(
    null,
  );
  /** Active "Create site + account" target (Fieldglass rows). */
  const [ensureSiteRequest, setEnsureSiteRequest] = useState<FieldglassRequestRow | null>(
    null,
  );
  const [ensureSiteSuccess, setEnsureSiteSuccess] = useState<string | null>(null);

  const { rows, loading, error } = useExternalShiftRequests(tenantId, {
    status: statusFilter,
  });

  // Client-side confidence filter (the hook query is keyed on status
  // only; confidence is a secondary lens).
  const filtered = useMemo(() => {
    if (confidenceFilter === 'all') return rows;
    if (confidenceFilter === 'exact-or-fuzzy') {
      return rows.filter(
        (r) => r.matchConfidence === 'exact' || r.matchConfidence === 'fuzzy',
      );
    }
    // 'needs-attention'
    return rows.filter(
      (r) => r.matchConfidence === 'multiple' || r.matchConfidence === 'none',
    );
  }, [rows, confidenceFilter]);

  // Group the feed by ISO date for visual scanning.
  const groups = useMemo(() => {
    const byDate = new Map<string, ExternalShiftRequest[]>();
    for (const r of filtered) {
      const key = (r.createdAt ?? '').slice(0, 10) || 'unknown';
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(r);
    }
    return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  /** Server-side apply for cancel_booking rows: the callable cancels the
   *  matched assignments in HRX (notify → hard-delete) and stamps the row
   *  'applied' itself, so no client-side status write is needed. */
  const handleApplyInHrx = async (req: ExternalShiftRequest): Promise<void> => {
    if (!tenantId) return;
    setPendingId(req.id);
    setActionError(null);
    try {
      const fn = httpsCallable(functions, 'indeedFlexApplyShiftRequest');
      const res = await fn({ tenantId, requestId: req.id });
      const data = (res.data ?? {}) as {
        cancelled?: number;
        skipped?: Array<{ id: string; reason: string }>;
      };
      const skippedCount = data.skipped?.length ?? 0;
      if (skippedCount > 0) {
        setActionError(
          `Applied — ${data.cancelled ?? 0} cancelled, ${skippedCount} skipped: ${data.skipped!
            .map((s) => s.reason)
            .join('; ')}`,
        );
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  };

  const handleDecide = async (
    req: ExternalShiftRequest,
    decision: 'applied' | 'rejected',
  ): Promise<void> => {
    if (!tenantId || !user?.uid) return;
    setPendingId(req.id);
    setActionError(null);
    try {
      const ref = fsDoc(db, 'tenants', tenantId, 'external_shift_requests', req.id);
      await updateDoc(ref, {
        status: decision,
        decidedBy: user.uid,
        decidedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      {/* Header + filters */}
      <Stack direction="row" alignItems="center" spacing={2} mb={2}>
        <Typography variant="h6">Indeed Flex inbox</Typography>
        <Chip
          size="small"
          label={`${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}`}
          variant="outlined"
        />
        <Box flex={1} />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Status</InputLabel>
          <Select
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <MenuItem value="needs_review">Needs review</MenuItem>
            <MenuItem value="applied">Applied</MenuItem>
            <MenuItem value="rejected">Rejected</MenuItem>
            <MenuItem value="all">All</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Confidence</InputLabel>
          <Select
            label="Confidence"
            value={confidenceFilter}
            onChange={(e) => setConfidenceFilter(e.target.value as ConfidenceFilter)}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="exact-or-fuzzy">Exact or fuzzy</MenuItem>
            <MenuItem value="needs-attention">Needs attention</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      {/* Info banner — plain-language explanation of what the buttons do.
          (Historical note: this feed was dry-run-only until 2026-07-17,
          when the Apply path shipped for cancellations.) */}
      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2">
          Updates from the portals land here. A red <strong>Apply in HRX</strong> button means
          HRX can make the change for you — one click and it&apos;s done.
          &quot;Mark applied&quot; means you already handled it yourself; &quot;Reject&quot; means
          ignore this update. Neither of those changes any schedules.
        </Typography>
      </Alert>

      {actionError && (
        <Alert severity="error" onClose={() => setActionError(null)} sx={{ mb: 2 }}>
          {actionError}
        </Alert>
      )}

      {ensureSiteSuccess && (
        <Alert severity="success" onClose={() => setEnsureSiteSuccess(null)} sx={{ mb: 2 }}>
          {ensureSiteSuccess}
        </Alert>
      )}

      {/* Loading / error / empty */}
      {loading && (
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      )}
      {error && (
        <Alert severity="error">
          Failed to load Indeed Flex inbox: {error.message}
        </Alert>
      )}
      {!loading && filtered.length === 0 && (
        <Box
          sx={{
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 1,
            p: 4,
            textAlign: 'center',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            No entries match the current filters. New requests appear here within seconds of an
            Indeed Flex email landing.
          </Typography>
        </Box>
      )}

      {/* Feed grouped by date */}
      <Stack spacing={3}>
        {groups.map(([date, entries]) => (
          <Box key={date}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ fontWeight: 700, display: 'block', mb: 1 }}
            >
              {date === 'unknown' ? 'Date unknown' : date}
            </Typography>
            <Stack spacing={1.5}>
              {entries.map((req) =>
                isFieldglassRow(req) ? (
                  <FieldglassLogEntry
                    key={req.id}
                    request={req as unknown as FieldglassRequestRow}
                    pending={pendingId === req.id}
                    onDecide={(decision) => handleDecide(req, decision)}
                    onCreateSite={(r) => setEnsureSiteRequest(r)}
                  />
                ) : (
                  <ShiftLogEntry
                    key={req.id}
                    request={req}
                    pending={pendingId === req.id}
                    onDecide={(decision) => handleDecide(req, decision)}
                    onLinkVenue={(r) => setLinkVenueRequest(r)}
                    onApplyInHrx={handleApplyInHrx}
                  />
                ),
              )}
            </Stack>
          </Box>
        ))}
      </Stack>

      {/* Manual refresh hint — listener is live but a button helps when
       *  in doubt. */}
      <Stack direction="row" justifyContent="flex-end" sx={{ mt: 3 }}>
        <Button size="small" onClick={() => window.location.reload()}>
          Hard refresh
        </Button>
      </Stack>

      {/* Link-venue dialog. Mounted at the page level so the listener
          on `external_shift_requests` picks up the re-match update and
          the row re-renders without a manual refresh. */}
      {/* Create site + account dialog (Fieldglass rows). Page-level so the
          live listener picks up the siteResolution stamp and the row's
          "Site ready" chip appears without a refresh. */}
      {tenantId && ensureSiteRequest && (
        <FieldglassEnsureSiteDialog
          open={!!ensureSiteRequest}
          onClose={() => setEnsureSiteRequest(null)}
          onSuccess={(result) => {
            const loc = result.location;
            const child = result.childAccount;
            setEnsureSiteSuccess(
              `Site ready — location ${loc.status === 'created' ? 'created' : 'reused'} (${loc.name}), ` +
                `account ${child.status === 'created' ? 'created' : child.status === 'linked' ? 'linked' : 'reused'} (${child.name}).`,
            );
          }}
          tenantId={tenantId}
          initialSiteName={ensureSiteRequest.event?.siteName ?? ''}
          requestId={ensureSiteRequest.id}
        />
      )}

      {tenantId && linkVenueRequest && (
        <LinkVenueToAccountDialog
          open={!!linkVenueRequest}
          onClose={() => setLinkVenueRequest(null)}
          onSuccess={() => {
            // Listener will re-fire when the doc updates; nothing else needed.
            setLinkVenueRequest(null);
          }}
          tenantId={tenantId}
          venueName={linkVenueRequest.event?.venueName ?? ''}
          requestId={linkVenueRequest.id}
          suggestedAccountIds={(linkVenueRequest.candidateAccounts ?? [])
            .map((c) => c.id)
            .filter((id): id is string => !!id)}
        />
      )}
    </Box>
  );
};

export default ShiftsLog;
