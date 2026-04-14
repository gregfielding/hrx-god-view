import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { getPolicyWhyDisplayLabel, type PolicyImpactCandidateRow } from '../../../utils/userGroupHiringPipeline';

export type UserGroupCandidatesPolicyImpactSectionProps = {
  rows: PolicyImpactCandidateRow[];
  loading: boolean;
  /** Same count as pipeline metrics total (group-scoped applications query). */
  applicationCount: number;
  /** Shown in empty state — this table only lists applications with this `groupId`. */
  groupId: string;
};

function decisionChipColor(decision: string): 'success' | 'error' | 'warning' | 'primary' | 'default' {
  const d = decision.toLowerCase();
  if (d === 'accepted' || d === 'advanced') return 'success';
  if (d === 'rejected') return 'error';
  if (d === 'withdrawn') return 'default';
  if (d === 'waitlisted' || d === 'on hold') return 'warning';
  return 'primary';
}

/**
 * Lists applications for this user group with how the **current effective** hiring policy applies to each row.
 */
const UserGroupCandidatesPolicyImpactSection: React.FC<UserGroupCandidatesPolicyImpactSectionProps> = ({
  rows,
  loading,
  applicationCount,
  groupId,
}) => {
  const navigate = useNavigate();

  const whySummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const label = getPolicyWhyDisplayLabel(r.why);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);

  const openRow = (r: PolicyImpactCandidateRow) => {
    if (r.userId) {
      navigate(`/workforce/users/${r.userId}`);
    }
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider' }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="subtitle1" fontWeight={800} gutterBottom>
          Candidates affected by current policy
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
          Rows load from applications where <strong>groupId</strong> equals this user group. Decision = current status
          from the application / automation; Why = policy reason; Next action = suggested recruiter step.
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          Group ID: <Box component="code">{groupId}</Box>
        </Typography>

        {loading ? (
          <Box sx={{ py: 1 }}>
            <LinearProgress />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Loading applications…
            </Typography>
          </Box>
        ) : applicationCount === 0 ? (
          <Paper
            variant="outlined"
            sx={{
              p: 3,
              textAlign: 'center',
              borderRadius: 2,
              borderStyle: 'dashed',
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              No current applicants for this group
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1, maxWidth: 520, mx: 'auto' }}>
              This list only includes applications linked to this user group. Firestore documents must have{' '}
              <Box component="code" sx={{ fontSize: '0.85em' }}>groupId</Box> set to{' '}
              <Box component="code" sx={{ fontSize: '0.85em' }}>{groupId}</Box>. When applicants apply through
              flows that attach this group, they will appear here.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              No applicants are currently affected by this policy — there are no matching application records yet.
            </Typography>
          </Paper>
        ) : (
          <>
            {whySummary.length > 0 ? (
              <Paper variant="outlined" sx={{ p: 1.25, mb: 1.5, borderRadius: 1.5, bgcolor: 'action.hover' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ display: 'block', mb: 0.75 }}>
                  By policy reason
                </Typography>
                <Stack direction="row" flexWrap="wrap" gap={0.75} useFlexGap>
                  {whySummary.map(([label, n]) => (
                    <Chip
                      key={label}
                      size="small"
                      variant="outlined"
                      label={`${label}: ${n}`}
                      sx={{ fontSize: '0.75rem' }}
                    />
                  ))}
                </Stack>
              </Paper>
            ) : null}

            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
              <Table size="small" aria-label="Candidates affected by hiring policy">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800 }}>Candidate</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Stage</TableCell>
                    <TableCell sx={{ fontWeight: 800 }} align="right">
                      Interview score
                    </TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Decision</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Why</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Next action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => {
                    const clickable = Boolean(r.userId);
                    const whyShown = getPolicyWhyDisplayLabel(r.why);
                    return (
                      <TableRow
                        key={r.id}
                        hover={clickable}
                        onClick={clickable ? () => openRow(r) : undefined}
                        title={clickable ? 'Open worker profile' : undefined}
                        sx={{
                          cursor: clickable ? 'pointer' : 'default',
                          ...(clickable ? { '&:hover': { bgcolor: 'action.hover' } } : {}),
                        }}
                        tabIndex={clickable ? 0 : undefined}
                        onKeyDown={
                          clickable
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  openRow(r);
                                }
                              }
                            : undefined
                        }
                        aria-label={clickable ? `Open workforce profile for ${r.candidateName}` : undefined}
                      >
                        <TableCell>{r.candidateName}</TableCell>
                        <TableCell>{r.stage}</TableCell>
                        <TableCell align="right">{r.interviewScore === null ? '—' : r.interviewScore}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={r.decision}
                            color={decisionChipColor(r.decision)}
                            variant="filled"
                            sx={{ fontWeight: 700, maxWidth: 200, '& .MuiChip-label': { px: 1 } }}
                          />
                        </TableCell>
                        <TableCell sx={{ maxWidth: 240 }}>
                          <Chip
                            size="small"
                            label={whyShown}
                            variant="outlined"
                            color="default"
                            sx={{
                              fontWeight: 500,
                              borderColor: 'divider',
                              bgcolor: 'background.paper',
                              height: 'auto',
                              py: 0.25,
                              '& .MuiChip-label': { whiteSpace: 'normal', textAlign: 'left' },
                            }}
                          />
                        </TableCell>
                        <TableCell sx={{ maxWidth: 180 }}>{r.nextAction}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default UserGroupCandidatesPolicyImpactSection;
