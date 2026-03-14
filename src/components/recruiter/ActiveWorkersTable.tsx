/**
 * Reusable Active Workers table: Career/Gig toggle + table of workers assigned to
 * and working a shift for job orders in the given scope (account or location).
 * Active = current date on or after assignment startDate and (no endDate or current date on or before endDate).
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  Box,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
} from '@mui/material';
import { collection, getDocs, getDoc, doc, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';

export type ActiveWorkerMode = 'career' | 'gig';

export interface ActiveWorkerRow {
  id: string;
  assignmentId: string;
  tenantId: string;
  jobOrderId: string;
  jobOrderName: string;
  firstName: string;
  lastName: string;
  startDate: string;
  endDate: string | null;
  status: string;
}

export interface ActiveWorkersTableProps {
  tenantId: string | null;
  /** Job order IDs to include (e.g. account's job orders or location's job orders). */
  jobOrderIds: string[];
  /** Optional title above the toggle. */
  title?: string;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return null;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const ActiveWorkersTable: React.FC<ActiveWorkersTableProps> = ({
  tenantId,
  jobOrderIds,
  title = 'Active Workers',
}) => {
  const [mode, setMode] = useState<ActiveWorkerMode>('career');
  const [loading, setLoading] = useState(false);
  const [assignments, setAssignments] = useState<Array<Record<string, unknown>>>([]);
  const [jobOrderMeta, setJobOrderMeta] = useState<Record<string, { name: string; jobType: string }>>({});

  const today = useMemo(() => toDateOnly(new Date()), []);

  useEffect(() => {
    if (!tenantId || jobOrderIds.length === 0) {
      setAssignments([]);
      setJobOrderMeta({});
      return;
    }
    setLoading(true);
    const assignmentsRef = collection(db, p.assignments(tenantId));
    const chunks: string[][] = [];
    for (let i = 0; i < jobOrderIds.length; i += 10) {
      chunks.push(jobOrderIds.slice(i, i + 10));
    }
    Promise.all([
      Promise.all(chunks.map((chunk) => getDocs(query(assignmentsRef, where('jobOrderId', 'in', chunk))))),
      Promise.all(jobOrderIds.map((id) => getDoc(doc(db, p.jobOrder(tenantId, id))))),
    ])
      .then(([querySnaps, jobOrderSnaps]) => {
        const list: Array<Record<string, unknown>> = [];
        querySnaps.forEach((snap) => {
          snap.docs.forEach((d) => list.push({ id: d.id, ...d.data() } as Record<string, unknown>));
        });
        const meta: Record<string, { name: string; jobType: string }> = {};
        jobOrderSnaps.forEach((snap, idx) => {
          const id = jobOrderIds[idx];
          const data = snap.exists() ? snap.data() : null;
          const jobType = (data?.jobType ?? data?.jobOrderType ?? 'gig') as string;
          const name = (data?.jobOrderName ?? data?.title ?? data?.jobTitle ?? id) as string;
          meta[id] = { name, jobType: jobType.toLowerCase() };
        });
        setAssignments(list);
        setJobOrderMeta(meta);
      })
      .catch(() => {
        setAssignments([]);
        setJobOrderMeta({});
      })
      .finally(() => setLoading(false));
  }, [tenantId, jobOrderIds.join(',')]);

  const rows: ActiveWorkerRow[] = useMemo(() => {
    return assignments
      .filter((a) => {
        const status = String(a.status || '').toLowerCase();
        if (status !== 'active') return false;
        const jobOrderId = a.jobOrderId as string;
        const type = jobOrderMeta[jobOrderId]?.jobType ?? (a.jobOrderType as string)?.toLowerCase();
        if (type !== mode) return false;
        const start = parseDate(a.startDate);
        const end = a.endDate != null ? parseDate(a.endDate) : null;
        if (!start) return false;
        const startStr = toDateOnly(start);
        if (today < startStr) return false;
        if (end != null && today > toDateOnly(end)) return false;
        return true;
      })
      .map((a) => {
        const jobOrderId = a.jobOrderId as string;
        const start = parseDate(a.startDate);
        const end = a.endDate != null ? parseDate(a.endDate) : null;
        return {
          id: `${a.id}-${jobOrderId}`,
          assignmentId: a.id as string,
          tenantId: a.tenantId as string,
          jobOrderId,
          jobOrderName: jobOrderMeta[jobOrderId]?.name ?? (a.jobOrderName as string) ?? jobOrderId,
          firstName: (a.firstName as string) ?? '',
          lastName: (a.lastName as string) ?? '',
          startDate: start ? toDateOnly(start) : '—',
          endDate: end ? toDateOnly(end) : null,
          status: (a.status as string) ?? '—',
        };
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));
  }, [assignments, jobOrderMeta, mode, today]);

  return (
    <Box>
      {title && (
        <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
          {title}
        </Typography>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Show:
        </Typography>
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={(_, v) => v != null && setMode(v)}
          size="small"
        >
          <ToggleButton value="career" aria-label="Career">
            Career
          </ToggleButton>
          <ToggleButton value="gig" aria-label="Gig">
            Gig
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={32} />
        </Box>
      ) : rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No active {mode} workers in this scope.
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell sx={{ fontWeight: 600 }}>Worker</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Job order</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Start date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>End date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {[row.firstName, row.lastName].filter(Boolean).join(' ') || '—'}
                  </TableCell>
                  <TableCell>{row.jobOrderName}</TableCell>
                  <TableCell>{row.startDate}</TableCell>
                  <TableCell>{row.endDate ?? '—'}</TableCell>
                  <TableCell>{row.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default ActiveWorkersTable;
