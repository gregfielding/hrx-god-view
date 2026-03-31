/**
 * Worker-facing "My Employment" list.
 * Profile → My Employment. One card per entity employment.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import WorkIcon from '@mui/icons-material/Work';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import type { EmploymentAssignmentSummary, EmploymentEntityKey } from '../../../pages/UserProfile/components/employment-v2/employmentV2Types';
import { normalizeEntityKey } from '../../../utils/employmentEntityPresentation';
import {
  computeHasOpenOnboardingDemand,
  deriveEmploymentHeaderStateWorkerListFallback,
  employmentHeaderStateLabel,
} from '../../../utils/deriveEmploymentHeaderState';
import { loadWorkerAssignmentsByEntityKey } from '../../../utils/loadWorkerAssignmentsByEntityKey';
import { countPipelineProgressForEntity } from '../../../utils/onboardingPipelineProgress';

interface EntityEmploymentRecord {
  id: string;
  userId: string;
  entityKey: string;
  entityName: string;
  workerType: string;
  status: string;
  onboardingPipelineId: string;
  onboardingPhase?: string | null;
  onboardingCompletedAt?: { toDate: () => Date } | null;
}

const HEADER_LIST_COLOR: Record<string, 'default' | 'warning' | 'success' | 'error' | 'info'> = {
  not_started: 'default',
  in_progress: 'warning',
  action_required: 'warning',
  waiting_on_company: 'info',
  ready: 'success',
  on_assignment: 'success',
  terminated: 'error',
  inactive: 'default',
};

const MyEmploymentPage: React.FC = () => {
  const { user, tenantId: authTenantId, activeTenant } = useAuth();
  const navigate = useNavigate();
  const tenantId = authTenantId || activeTenant?.id || null;
  const uid = user?.uid ?? null;

  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<EntityEmploymentRecord[]>([]);
  const [assignmentsByEntityKey, setAssignmentsByEntityKey] = useState<Record<
    EmploymentEntityKey,
    EmploymentAssignmentSummary[]
  > | null>(null);
  const [stepCounts, setStepCounts] = useState<Record<string, { complete: number; total: number }>>({});

  useEffect(() => {
    if (!tenantId || !uid) {
      setRecords([]);
      setAssignmentsByEntityKey(null);
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const ref = collection(db, 'tenants', tenantId, 'entity_employments');
        const q = query(ref, where('userId', '==', uid));
        const [snap, byKey] = await Promise.all([getDocs(q), loadWorkerAssignmentsByEntityKey(tenantId, uid)]);
        const list: EntityEmploymentRecord[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<EntityEmploymentRecord, 'id'>),
        }));
        setRecords(list);
        setAssignmentsByEntityKey(byKey);
      } catch {
        setRecords([]);
        setAssignmentsByEntityKey({ select: [], workforce: [], events: [] });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [tenantId, uid]);

  useEffect(() => {
    if (!tenantId || records.length === 0) {
      setStepCounts({});
      return;
    }
    const loadCounts = async () => {
      const counts: Record<string, { complete: number; total: number }> = {};
      await Promise.all(
        records.map(async (rec) => {
          if (!rec.onboardingPipelineId) return;
          try {
            const pipelineRef = doc(db, 'tenants', tenantId!, 'worker_onboarding', rec.onboardingPipelineId);
            const snap = await getDoc(pipelineRef);
            const data = snap.data();
            const steps = Array.isArray(data?.steps) ? data.steps : [];
            counts[rec.onboardingPipelineId] = countPipelineProgressForEntity(steps, rec.entityKey);
          } catch {
            counts[rec.onboardingPipelineId] = { complete: 0, total: 0 };
          }
        })
      );
      setStepCounts(counts);
    };
    loadCounts();
  }, [tenantId, records]);

  if (!uid) {
    return (
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Alert severity="info">Sign in to view your employment.</Alert>
      </Container>
    );
  }

  if (!tenantId) {
    return (
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Alert severity="info">
          Your employment records will appear here once you’re linked to a C1 entity (for example, after accepting a role).
        </Alert>
      </Container>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          My Employment
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Your status with each C1 entity you work with.
        </Typography>

        {records.length === 0 ? (
          <Alert severity="info">
            You don’t have any employment records yet. Records are created when you’re confirmed for a role or start onboarding with an entity.
          </Alert>
        ) : (
          <Stack spacing={1.5}>
            {records.map((rec) => {
              const counts = stepCounts[rec.onboardingPipelineId];
              const isComplete = rec.status === 'active' || rec.onboardingCompletedAt != null;
              const entityKey = normalizeEntityKey(rec.entityKey);
              const rowAssignments =
                assignmentsByEntityKey != null && entityKey ? assignmentsByEntityKey[entityKey] : undefined;
              const hasOpenOnboardingDemand = computeHasOpenOnboardingDemand({
                assignments: rowAssignments,
                entityEmploymentStatus: rec.status,
              });
              const pipelineIncomplete = Boolean(counts && counts.total > 0 && counts.complete < counts.total);
              const progressText = (() => {
                if (isComplete) return 'Onboarding complete';
                if (!hasOpenOnboardingDemand) {
                  if (counts && counts.total > 0) {
                    return `Prior relationship path on file (${counts.complete} of ${counts.total} steps)`;
                  }
                  return 'No current assignment onboarding';
                }
                if (counts && counts.total > 0) return `${counts.complete} of ${counts.total} steps complete`;
                return null;
              })();
              const headerState = deriveEmploymentHeaderStateWorkerListFallback({
                onboardingPhase: rec.onboardingPhase,
                entityEmploymentStatus: rec.status,
                pipelineIncomplete,
                hasOpenOnboardingDemand,
              });
              const statusLabel = employmentHeaderStateLabel(headerState);
              const terminalList = headerState === 'terminated' || headerState === 'inactive';
              const listHistoricalChip =
                !hasOpenOnboardingDemand && !terminalList;
              const listChipColor =
                listHistoricalChip &&
                (HEADER_LIST_COLOR[headerState] === 'success' || HEADER_LIST_COLOR[headerState] === 'info')
                  ? 'default'
                  : HEADER_LIST_COLOR[headerState] || 'default';

              return (
                <Card
                  key={rec.id}
                  variant="outlined"
                  sx={{
                    borderRadius: 2,
                    borderColor: 'divider',
                    boxShadow: 'none',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                  onClick={() => navigate(`/c1/workers/my-employment/${encodeURIComponent(rec.id)}`)}
                >
                  <CardContent sx={{ py: 1.5, px: 2 }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                      <Stack direction="row" alignItems="center" spacing={1} flex={1} minWidth={0}>
                        <WorkIcon sx={{ color: 'text.secondary', fontSize: 22 }} />
                        <Box minWidth={0}>
                          <Typography variant="subtitle1" fontWeight={600} noWrap>
                            {rec.entityName || rec.entityKey || 'Entity'}
                          </Typography>
                          {progressText && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              {progressText}
                            </Typography>
                          )}
                        </Box>
                      </Stack>
                      <Stack direction="row" alignItems="center" spacing={0.75} flexShrink={0}>
                        {(rec.workerType === 'w2' || rec.workerType === '1099') && (
                          <Chip
                            label={rec.workerType === '1099' ? '1099' : 'W-2'}
                            size="small"
                            variant="outlined"
                            sx={{ fontWeight: 500 }}
                          />
                        )}
                        <Chip
                          label={listHistoricalChip ? `Record · ${statusLabel}` : statusLabel}
                          size="small"
                          color={listChipColor}
                          variant={listHistoricalChip ? 'outlined' : 'filled'}
                        />
                        <ChevronRightIcon color="action" sx={{ fontSize: 20 }} />
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Container>
  );
};

export default MyEmploymentPage;
