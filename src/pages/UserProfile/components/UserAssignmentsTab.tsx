import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Snackbar,
  Alert,
  Stack,
  Typography,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';

import { db } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import type { BackgroundCheckRecord } from '../../../types/backgroundCheck';
import {
  buildAssignmentReadinessPanelRows,
  assignmentReadinessRecruiterChipColor,
} from '../../../utils/assignmentReadinessPanelModel';
import { enrichUserAssignmentRow } from '../../../utils/enrichAssignmentRowForDisplay';

const UserAssignmentsTab: React.FC<{ userId: string; tenantId?: string | null }> = ({
  userId,
  tenantId,
}) => {
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Record<string, unknown>[]>([]);
  const [backgroundChecks, setBackgroundChecks] = useState<BackgroundCheckRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAssignments();
    // eslint-disable-next-line
  }, [userId, tenantId]);

  const fetchAssignments = async () => {
    setLoading(true);
    setError('');
    if (!tenantId) {
      setAssignments([]);
      setBackgroundChecks([]);
      setLoading(false);
      setError('Select a tenant context to load assignments.');
      return;
    }
    try {
      const col = collection(db, p.assignments(tenantId));
      const bgQ = query(
        collection(db, 'backgroundChecks'),
        where('candidateId', '==', userId),
        where('tenantId', '==', tenantId),
        limit(120)
      );
      const [byUser, byCandidate, bgSnap] = await Promise.all([
        getDocs(query(col, where('userId', '==', userId), orderBy('startDate', 'desc'))),
        getDocs(query(col, where('candidateId', '==', userId))),
        getDocs(bgQ),
      ]);
      const byId = new Map<string, QueryDocumentSnapshot<DocumentData>>();
      byUser.docs.forEach((d) => byId.set(d.id, d));
      byCandidate.docs.forEach((d) => {
        if (!byId.has(d.id)) byId.set(d.id, d);
      });
      const merged = Array.from(byId.values()).sort((a, b) => {
        const sa = String((a.data() as { startDate?: string }).startDate || '');
        const sb = String((b.data() as { startDate?: string }).startDate || '');
        return sb.localeCompare(sa);
      });
      const assignmentsWithNames = await Promise.all(merged.map((d) => enrichUserAssignmentRow(tenantId, d)));
      setAssignments(assignmentsWithNames);
      const bgList: BackgroundCheckRecord[] = bgSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<BackgroundCheckRecord, 'id'>),
      }));
      setBackgroundChecks(bgList);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch assignments';
      setError(msg);
    }
    setLoading(false);
  };

  const panelRows = useMemo(
    () => buildAssignmentReadinessPanelRows(assignments, backgroundChecks),
    [assignments, backgroundChecks]
  );

  return (
    <Box sx={{ p: { xs: 1, sm: 2 }, width: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2} sx={{ mb: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" fontWeight={800} sx={{ mb: 0.5 }}>
            Assignments &amp; readiness
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
            Each row is one placement. Readiness combines persisted assignment readiness (assignmentReadinessV1), linked
            screening orders, package sections, and blocking requirements. Raw screening history also appears under{' '}
            <strong>Backgrounds</strong>; credentials under <strong>Certifications</strong>.
          </Typography>
        </Box>
        <Button
          size="small"
          startIcon={<RefreshIcon />}
          onClick={() => void fetchAssignments()}
          disabled={loading || !tenantId}
        >
          Refresh
        </Button>
      </Stack>
      {loading ? (
        <Typography variant="body2" color="text.secondary">
          Loading assignments…
        </Typography>
      ) : panelRows.length === 0 ? (
        <Alert severity="info">This user has no assignments yet.</Alert>
      ) : (
        // Table layout matching the Applications tab (Greg 2026-09-04:
        // "make Assignments look like the Applications tab"). Row click
        // opens the assignment; readiness detail lives there.
        <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 0 }}>
          <Table>
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                <TableCell sx={{ fontWeight: 600 }}>Job Title</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Worksite</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Start</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>End</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Readiness</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {panelRows.map((row) => (
                <TableRow
                  key={row.assignmentId}
                  hover
                  sx={{ cursor: 'pointer', '&:hover': { backgroundColor: 'action.hover' } }}
                  onClick={() =>
                    navigate(`/assignments/${encodeURIComponent(row.assignmentId)}`)
                  }
                >
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {row.title || 'Untitled assignment'}
                    </Typography>
                    {row.companyDisplay ? (
                      <Typography variant="caption" color="text.secondary">
                        {row.companyDisplay}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {row.worksiteDisplay || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {row.startDate || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {row.endDate || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {row.assignmentStatus || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip
                        size="small"
                        label={row.readinessLabel}
                        color={assignmentReadinessRecruiterChipColor(row)}
                      />
                      {row.startDateContext.label &&
                      row.startDateContext.tone !== 'default' ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={row.startDateContext.label}
                          color={row.startDateContext.tone}
                        />
                      ) : null}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default UserAssignmentsTab;
