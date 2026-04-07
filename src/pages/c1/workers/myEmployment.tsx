/**
 * Worker-facing "My Employment" list.
 * Profile → My Employment. One card per entity employment.
 */
import React from 'react';
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
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../../contexts/AuthContext';
import { useWorkerMyEmploymentList } from '../../../hooks/useWorkerMyEmploymentList';
import { buildWorkerMyEmploymentListRowModel } from '../../../utils/workerMyEmploymentListRowModel';

const MyEmploymentPage: React.FC = () => {
  const { user, tenantId: authTenantId, activeTenant } = useAuth();
  const navigate = useNavigate();
  const tenantId = authTenantId || activeTenant?.id || null;
  const uid = user?.uid ?? null;

  const { loading, records, assignmentsByEntityKey, stepCounts } = useWorkerMyEmploymentList(tenantId, uid);

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
              const row = buildWorkerMyEmploymentListRowModel(rec, stepCounts, assignmentsByEntityKey);

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
                            {row.entityDisplayName}
                          </Typography>
                          {row.progressText && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              {row.progressText}
                            </Typography>
                          )}
                        </Box>
                      </Stack>
                      <Stack direction="row" alignItems="center" spacing={0.75} flexShrink={0}>
                        {row.workerTypeLabel && (
                          <Chip
                            label={row.workerTypeLabel}
                            size="small"
                            variant="outlined"
                            sx={{ fontWeight: 500 }}
                          />
                        )}
                        <Chip
                          label={row.statusChipLabel}
                          size="small"
                          color={row.listChipColor}
                          variant={row.listHistoricalChip ? 'outlined' : 'filled'}
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
