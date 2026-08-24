/**
 * Worker-facing "My Employment" list.
 * Profile → My Employment. One card per entity employment.
 */
import React from 'react';
import {
  Alert,
  Box,
  Button,
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
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';
import WorkerPageHeader from '../../../components/worker/WorkerPageHeader';
import { useWorkerMyEmploymentList } from '../../../hooks/useWorkerMyEmploymentList';
import { buildWorkerMyEmploymentListRowModel } from '../../../utils/workerMyEmploymentListRowModel';

const MyEmploymentPage: React.FC = () => {
  const { user, tenantId: authTenantId, activeTenant } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const tenantId = authTenantId || activeTenant?.id || null;
  const uid = user?.uid ?? null;

  const { loading, records, assignmentsByEntityKey, stepCounts, i9EmployeeSectionVerifiedByPipelineId } =
    useWorkerMyEmploymentList(tenantId, uid);

  if (!uid) {
    return (
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Stack spacing={2}>
          <Alert severity="info">{t('workerEmploymentHub.myEmploymentSignIn')}</Alert>
          <Button
            variant="contained"
            sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
            onClick={() => navigate('/login', { state: { from: location } })}
          >
            {t('workerEmploymentHub.signInButton')}
          </Button>
        </Stack>
      </Container>
    );
  }

  if (!tenantId) {
    return (
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Alert severity="info">{t('workerEmploymentHub.myEmploymentNeedEntity')}</Alert>
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
    <Box>
      <Stack spacing={2}>
        <WorkerPageHeader
          title={t('workerEmploymentHub.myEmploymentTitle')}
          backTo="/c1/workers/profile"
          description={t('workerEmploymentHub.myEmploymentSubtitleShort')}
        />

        {records.length === 0 ? (
          <Alert severity="info">{t('workerEmploymentHub.myEmploymentEmptyList')}</Alert>
        ) : (
          <Stack spacing={1.5}>
            {records.map((rec) => {
              const row = buildWorkerMyEmploymentListRowModel(rec, stepCounts, assignmentsByEntityKey, {
                i9EmployeeSectionComplete: Boolean(
                  rec.onboardingPipelineId && i9EmployeeSectionVerifiedByPipelineId[rec.onboardingPipelineId],
                ),
                tr: t,
              });

              return (
                <Card
                  key={rec.id}
                  variant="outlined"
                  sx={{
                    
                    borderColor: 'divider',
                    boxShadow: 'none',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                  onClick={() => navigate(`/c1/workers/my-employment/${encodeURIComponent(rec.id)}`)}
                >
                  <CardContent sx={{ py: 1.5, px: 2 }}>
                    {/* Name owns the first line (chips were crushing it to
                        "C1 Eve…" on phones); chips wrap onto their own row. */}
                    <Stack direction="row" alignItems="flex-start" spacing={1}>
                      <WorkIcon sx={{ color: 'text.secondary', fontSize: 22, mt: 0.25 }} />
                      <Box minWidth={0} flex={1}>
                        <Typography variant="subtitle1" noWrap>
                          {row.entityDisplayName}
                        </Typography>
                        {row.nextStepLine ? (
                          <Typography variant="caption" color="text.secondary" display="block" noWrap title={row.nextStepLine}>
                            {row.nextStepLine}
                          </Typography>
                        ) : null}
                        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.75 }} flexWrap="wrap" useFlexGap>
                          {row.workerTypeLabel && (
                            <Chip label={row.workerTypeLabel} size="small" variant="outlined" />
                          )}
                          <Chip
                            label={row.statusChipLabel}
                            size="small"
                            color={row.listChipColor}
                            variant={row.listHistoricalChip ? 'outlined' : 'filled'}
                          />
                        </Stack>
                      </Box>
                      <ChevronRightIcon color="action" sx={{ fontSize: 20, alignSelf: 'center' }} />
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Box>
  );
};

export default MyEmploymentPage;
