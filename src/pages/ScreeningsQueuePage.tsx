/**
 * Tenant-wide AccuSource screening orders — uses the same normalized row model as BackgroundsComplianceTab.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import PageHeader from '../components/PageHeader';
import type { BackgroundCheckRecord } from '../types/backgroundCheck';
import { normalizeScreeningRow } from './UserProfile/components/backgroundsComplianceModel';

const PAGE_LIMIT = 200;

function formatUpdated(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toLocaleString();
    } catch {
      return '—';
    }
  }
  return '—';
}

const ScreeningsQueuePage: React.FC = () => {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id;
  const [rows, setRows] = useState<BackgroundCheckRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = query(
        collection(db, 'backgroundChecks'),
        where('tenantId', '==', tenantId),
        orderBy('updatedAt', 'desc'),
        limit(PAGE_LIMIT)
      );
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as BackgroundCheckRecord);
      setRows(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load screenings');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const normalized = useMemo(() => rows.map(normalizeScreeningRow), [rows]);

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">Select a tenant to view the screenings queue.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, maxWidth: 1400, mx: 'auto' }}>
      <PageHeader title="Screenings queue" />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        AccuSource background checks for the active tenant (latest {PAGE_LIMIT} by update time). Same status model as the user profile
        Backgrounds tab.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Worker</TableCell>
                <TableCell>Package</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Updated</TableCell>
                <TableCell>Job order</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <CircularProgress size={28} sx={{ my: 2 }} />
                  </TableCell>
                </TableRow>
              )}
              {!loading && normalized.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography variant="body2" color="text.secondary">
                      No screening orders for this tenant yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                normalized.map((row) => {
                  const r = row.screening!;
                  const cid = String(r.candidateId || '');
                  return (
                    <TableRow key={row.key}>
                      <TableCell>
                        {cid ? (
                          <Link component={RouterLink} to={`/users/${cid}`} underline="hover">
                            {r.candidateName || cid}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>{row.packageLabel}</TableCell>
                      <TableCell>
                        <Chip size="small" label={row.statusPrimary} color={row.statusTone} variant="outlined" />
                      </TableCell>
                      <TableCell>{row.actionNeeded || '—'}</TableCell>
                      <TableCell>{formatUpdated(r.updatedAt)}</TableCell>
                      <TableCell>{r.jobOrderId || '—'}</TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
};

export default ScreeningsQueuePage;
