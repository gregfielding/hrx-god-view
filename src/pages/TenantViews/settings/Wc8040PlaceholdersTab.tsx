/**
 * 8040 Placeholders tab (Greg 2026-08-14) — everywhere the $2.35 stand-in
 * WC code is in live use, split into:
 *   - "Coverage needed": no real code exists on the policy for that
 *     state/title — these rows ARE the carrier ask list.
 *   - "Replace now": the matrix already has a real code for the state —
 *     the fix is on our side (reclassify via the WC report / dialogs).
 * Data: live assignments coded 8040 + last-60-day timesheet entries.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../firebase';

interface PlaceholderRow {
  hiringEntityId: string;
  state: string;
  jobOrderId: string;
  jobOrderName: string;
  jobOrderNumber: number | null;
  accountName: string;
  worksiteName: string;
  jobTitle: string;
  workers: number;
  liveAssignments: number;
  entryCount: number;
  recentGross: number;
  lastUsed: string | null;
  status: 'replace_now' | 'coverage_needed';
  suggestion: { code: string; rate: number } | null;
}

interface PlaceholderPayload {
  rows: PlaceholderRow[];
  totals: {
    groups: number;
    workers: number;
    recentGross: number;
    coverageNeeded: number;
    replaceNow: number;
    sinceDate: string;
  };
}

const ENTITY_LABEL: Record<string, string> = {
  c1_select_llc: 'C1 Select',
  c1_events_llc: 'C1 Events',
  c1_workforce_llc: 'C1 Workforce',
};

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const Wc8040PlaceholdersTab: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [data, setData] = useState<PlaceholderPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fn = httpsCallable(functions, 'getWcPlaceholderUsage');
    fn({ tenantId })
      .then((res) => {
        if (!cancelled) setData(res.data as PlaceholderPayload);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (loading || (!data && !error)) {
    return (
      <Stack alignItems="center" sx={{ py: 6 }}>
        <CircularProgress size={28} />
      </Stack>
    );
  }
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return null;

  const { rows, totals } = data;

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Every job running on the 8040 placeholder ($2.35 stand-in). “Coverage needed” rows are the
        carrier ask list; “Replace now” rows already have a real code on the policy — reclassify
        them from the Workers&apos; Comp report. Gross covers entries since {totals.sinceDate}.
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <Chip label={`${totals.workers} worker${totals.workers === 1 ? '' : 's'} on placeholder`} />
        <Chip label={`${money(totals.recentGross)} recent gross at $2.35`} />
        <Chip
          color="warning"
          label={`${totals.coverageNeeded} coverage ask${totals.coverageNeeded === 1 ? '' : 's'}`}
        />
        <Chip color="info" label={`${totals.replaceNow} replace-now`} />
      </Stack>
      {rows.length === 0 ? (
        <Alert severity="success">No live 8040 usage — every job carries a real carrier code.</Alert>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>State</TableCell>
              <TableCell>Entity</TableCell>
              <TableCell>Account · Job order</TableCell>
              <TableCell>Title</TableCell>
              <TableCell align="right">Workers</TableCell>
              <TableCell align="right">Recent gross</TableCell>
              <TableCell>Last used</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.hiringEntityId}_${r.state}_${r.jobOrderId}`} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>
                    {r.state || '??'}
                  </Typography>
                </TableCell>
                <TableCell>{ENTITY_LABEL[r.hiringEntityId] ?? r.hiringEntityId ?? '—'}</TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {r.accountName || '—'}
                    {' · '}
                    {r.jobOrderId ? (
                      <Link href={`/jobs/job-orders/${r.jobOrderId}`} underline="hover">
                        {r.jobOrderName}
                        {r.jobOrderNumber != null ? ` #${r.jobOrderNumber}` : ''}
                      </Link>
                    ) : (
                      r.jobOrderName
                    )}
                  </Typography>
                  {r.worksiteName && r.worksiteName !== r.jobOrderName && (
                    <Typography variant="caption" color="text.secondary">
                      {r.worksiteName}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>{r.jobTitle || '—'}</TableCell>
                <TableCell align="right">{r.workers}</TableCell>
                <TableCell align="right">{r.recentGross > 0 ? money(r.recentGross) : '—'}</TableCell>
                <TableCell>{r.lastUsed ?? '—'}</TableCell>
                <TableCell>
                  {r.status === 'coverage_needed' ? (
                    <Chip size="small" color="warning" label="Coverage needed" />
                  ) : (
                    <Chip
                      size="small"
                      color="info"
                      label={`Replace now → ${r.suggestion?.code}${
                        r.suggestion?.rate ? ` @ $${r.suggestion.rate}` : ''
                      }`}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
};

export default Wc8040PlaceholdersTab;
