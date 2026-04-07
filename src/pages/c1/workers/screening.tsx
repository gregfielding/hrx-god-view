/**
 * Worker-facing screening / compliance status (read-only).
 * Payroll setup and I-9 uploads live under Employment (profile list + my-employment detail).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { Timestamp, collection, getDocs, limit, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

import { db } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import { useAuth } from '../../../contexts/AuthContext';
import ProfileTabPointerAlert from '../../../components/profile/ProfileTabPointerAlert';
import type { BackgroundCheckRecord } from '../../../types/backgroundCheck';
import type { WorkerComplianceItem } from '../../../types/compliance';
import { getComplianceStatusDisplayLabel, getComplianceTypeLabel } from '../../../types/compliance';

const PAGE_LIMIT = 100;

const everifyCasesCol = (tenantId: string) => collection(db, 'tenants', tenantId, 'everify_cases');
const userEmploymentsCol = (tenantId: string) => collection(db, 'tenants', tenantId, 'user_employments');

const SCREENING_COMPLIANCE_TYPES = new Set(['background_check', 'drug_screen', 'tb_test']);

function formatBgStatus(hrxStatus: string | undefined): string {
  const s = String(hrxStatus || 'unknown');
  const map: Record<string, string> = {
    completed: 'Completed',
    report_ready: 'Report ready',
    drug_report_ready: 'Drug report ready',
    in_progress: 'In progress',
    awaiting_applicant: 'Awaiting you',
    submitted: 'Submitted',
    queued: 'Queued',
    draft: 'Draft',
    canceled: 'Canceled',
    cancelled: 'Canceled',
    error: 'Error',
  };
  return map[s] || s.replace(/_/g, ' ');
}

const WorkerScreeningPage: React.FC = () => {
  const { user, tenantId: authTenantId, activeTenant } = useAuth();
  const navigate = useNavigate();
  const tenantId = authTenantId || activeTenant?.id || null;
  const uid = user?.uid ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [screeningRows, setScreeningRows] = useState<BackgroundCheckRecord[]>([]);
  const [everifyRows, setEverifyRows] = useState<Array<{ id: string; data: Record<string, unknown> }>>([]);
  const [employmentCount, setEmploymentCount] = useState(0);
  const [complianceItems, setComplianceItems] = useState<(WorkerComplianceItem & { id: string })[]>([]);

  const loadAll = useCallback(async () => {
    if (!tenantId || !uid) {
      setScreeningRows([]);
      setEverifyRows([]);
      setEmploymentCount(0);
      setComplianceItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [evSnap, bgSnap, empSnap, compSnap] = await Promise.all([
        getDocs(query(everifyCasesCol(tenantId), where('userId', '==', uid))),
        getDocs(
          query(
            collection(db, 'backgroundChecks'),
            where('candidateId', '==', uid),
            where('tenantId', '==', tenantId),
            limit(PAGE_LIMIT)
          )
        ),
        getDocs(query(userEmploymentsCol(tenantId), where('userId', '==', uid))),
        getDocs(query(collection(db, p.workerComplianceItems(tenantId)), where('userId', '==', uid), limit(PAGE_LIMIT))),
      ]);
      const evList = evSnap.docs
        .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
        .sort((a, b) => {
          const ta = (a.data.updatedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
          const tb = (b.data.updatedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
          return tb - ta;
        });
      setEverifyRows(evList);
      const bg = bgSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as BackgroundCheckRecord)
        .filter((r) => !r.tenantId || r.tenantId === tenantId)
        .sort((a, b) => {
          const ta = (a.updatedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
          const tb = (b.updatedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
          return tb - ta;
        });
      setScreeningRows(bg);
      setEmploymentCount(empSnap.size);
      const compList = compSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as WorkerComplianceItem & { id: string }),
      );
      setComplianceItems(compList);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load screening data');
      setScreeningRows([]);
      setEverifyRows([]);
      setEmploymentCount(0);
      setComplianceItems([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, uid]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const screeningComplianceItems = useMemo(
    () =>
      complianceItems.filter((item) => {
        const t = String(item.type || '');
        return SCREENING_COMPLIANCE_TYPES.has(t);
      }),
    [complianceItems],
  );

  const showEmploymentPointer = employmentCount > 0;

  if (!uid) {
    return (
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Alert severity="info">Sign in to view screening status.</Alert>
      </Container>
    );
  }

  if (!tenantId) {
    return (
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Alert severity="info">Select a workspace to view screening.</Alert>
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
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
          Screening
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Background checks, employment verification, and related screening for your assignments. This page is read-only;
          your hiring team may contact you with next steps.
        </Typography>

        {showEmploymentPointer ? (
          <ProfileTabPointerAlert
            message="Payroll setup and I-9 documents are in Employment."
            onNavigate={() => navigate('/c1/workers/profile')}
          />
        ) : null}

        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}

        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              Identity verification
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.45 }}>
              If your hiring team asked you to complete identity verification (IDV), use the link or app they sent you.
              Status updates will appear here when they are recorded in HRX.
            </Typography>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
              Background screening orders
            </Typography>
            {screeningRows.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No background screening orders on file for this account.
              </Typography>
            ) : (
              <Stack spacing={1.25} divider={<Divider flexItem />}>
                {screeningRows.map((r) => (
                  <Stack key={r.id} spacing={0.5}>
                    <Typography variant="body2" fontWeight={600}>
                      {r.requestedPackageName?.trim() || 'Screening order'}
                    </Typography>
                    <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
                      <Chip size="small" variant="outlined" label={formatBgStatus(r.hrxStatus)} />
                      {r.hrxStatus === 'awaiting_applicant' ? (
                        <Typography variant="caption" color="text.secondary">
                          Check your email for instructions from the screening provider.
                        </Typography>
                      ) : null}
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
              Drug screen & clinic steps
            </Typography>
            {screeningRows.some((r) => /drug/i.test(String(r.requestedPackageName || r.hrxStatus || ''))) ? (
              <Typography variant="body2" color="text.secondary">
                If a drug screen is part of your package, follow the instructions from the screening provider or your hiring
                team (clinic location, scheduling, and chain-of-custody).
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">
                When a drug screen is required, instructions will come from your hiring team or the screening provider.
              </Typography>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
              E-Verify (work authorization)
            </Typography>
            {everifyRows.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No E-Verify cases on file under your account.
              </Typography>
            ) : (
              <Stack spacing={1} divider={<Divider flexItem />}>
                {everifyRows.slice(0, 8).map(({ id, data }) => {
                  const st = String(data.status || data.caseStatus || '—').replace(/_/g, ' ');
                  return (
                    <Stack key={id} direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                      <Typography variant="body2" color="text.secondary">
                        Case {id.slice(0, 8)}…
                      </Typography>
                      <Chip size="small" label={st} variant="outlined" />
                    </Stack>
                  );
                })}
              </Stack>
            )}
          </CardContent>
        </Card>

        {screeningComplianceItems.length > 0 ? (
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                Assigned screening tasks
              </Typography>
              <Stack spacing={1}>
                {screeningComplianceItems.map((item) => (
                  <Stack
                    key={item.id}
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    flexWrap="wrap"
                    gap={0.5}
                  >
                    <Typography variant="body2">{item.title || getComplianceTypeLabel(item.type)}</Typography>
                    <Chip size="small" variant="outlined" label={getComplianceStatusDisplayLabel(item.status)} />
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        ) : null}
      </Stack>
    </Container>
  );
};

export default WorkerScreeningPage;
