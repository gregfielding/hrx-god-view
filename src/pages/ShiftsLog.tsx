/**
 * ShiftsLog — log-view tab body for /shifts/log.
 *
 * Shows the live feed of Indeed Flex `external_shift_requests` — what
 * the system WOULD do if the apply path (Slice 5) were active. The
 * tab is read-mostly: the only Firestore writes from this view are
 * status flips on the `external_shift_requests` doc itself
 * (`needs_review` → `applied | rejected`). It NEVER mutates
 * shifts / job orders / assignments.
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

import ShiftLogEntry from '../components/shifts/ShiftLogEntry';
import { useAuth } from '../contexts/AuthContext';
import { useExternalShiftRequests } from '../hooks/useExternalShiftRequests';
import { db } from '../firebase';
import type { ExternalShiftRequest } from '../shared/indeedFlex/types';

type StatusFilter = 'needs_review' | 'applied' | 'rejected' | 'all';
type ConfidenceFilter = 'all' | 'exact-or-fuzzy' | 'needs-attention';

const ShiftsLog: React.FC = () => {
  const { tenantId, user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('needs_review');
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

      {/* Info banner — this is dry-run */}
      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2">
          <strong>Dry-run feed</strong>. Each entry shows what the system WOULD do if the apply
          path were live. &quot;Mark applied&quot; / &quot;Reject&quot; only updates this entry&apos;s
          status — it does NOT mutate shifts, job orders, or assignments.
        </Typography>
      </Alert>

      {actionError && (
        <Alert severity="error" onClose={() => setActionError(null)} sx={{ mb: 2 }}>
          {actionError}
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
              {entries.map((req) => (
                <ShiftLogEntry
                  key={req.id}
                  request={req}
                  pending={pendingId === req.id}
                  onDecide={(decision) => handleDecide(req, decision)}
                />
              ))}
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
    </Box>
  );
};

export default ShiftsLog;
