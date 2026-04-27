/**
 * Employment tab — entity employments (Phase 1 onboarding).
 * Shows one row/card per entity employment for this user.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import {
  getWorkerPayrollAccount,
  getOrCreateWorkerPayrollAccount,
  updateWorkerPayrollAccount,
} from '../../../utils/workerPayrollAccount';
import type { PayrollSettings, WorkerPayrollAccount } from '../../../types/payroll';
import { PAYROLL_STATUS, getPayrollStatusLabel, workerPayrollAccountId } from '../../../types/payroll';
import { getWorkerReadiness, getReadinessStatusLabel, type ReadinessStatus } from '../../../utils/workerReadiness';
import type { WorkerComplianceItem } from '../../../types/compliance';
import { hasExpiredCompliance, hasExpiringSoonCompliance } from '../../../utils/complianceExpiration';
import { getEmploymentStatusLabel } from '../../../utils/employmentStatusLabel';
import { countPipelineProgressForEntity } from '../../../utils/onboardingPipelineProgress';

export interface EntityEmploymentRecord {
  id: string;
  tenantId: string;
  userId: string;
  entityId: string | null;
  entityKey: string;
  entityName: string;
  workerType: string;
  status: string;
  onboardingPipelineId: string;
  onboardingStartedAt?: { toDate: () => Date } | null;
  onboardingCompletedAt?: { toDate: () => Date } | null;
  hiredAt?: { toDate: () => Date } | null;
  terminatedAt?: { toDate: () => Date } | null;
  terminationReason?: string | null;
  everifyRequired?: boolean;
  backgroundRequired?: boolean;
  drugScreenRequired?: boolean;
  everifyStatus?: string;
  backgroundStatus?: string;
  drugScreenStatus?: string;
  updatedAt?: { toDate: () => Date } | null;
}

interface EmploymentTabProps {
  uid: string;
  tenantId: string | null;
}

const STATUS_COLOR: Record<string, 'default' | 'warning' | 'success' | 'error'> = {
  onboarding: 'warning',
  active: 'success',
  inactive: 'default',
  terminated: 'error',
};

const EMPLOYMENT_STATUSES = ['onboarding', 'active', 'inactive', 'terminated'] as const;

const EmploymentTab: React.FC<EmploymentTabProps> = ({ uid, tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<EntityEmploymentRecord[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [terminationDialog, setTerminationDialog] = useState<{ employmentId: string; status: string } | null>(null);
  const [terminationReasonInput, setTerminationReasonInput] = useState('');
  const [pipelineStepCounts, setPipelineStepCounts] = useState<Record<string, { complete: number; total: number }>>({});
  const [payrollAccountsMap, setPayrollAccountsMap] = useState<Record<string, (WorkerPayrollAccount & { id: string }) | null>>({});
  const [entityPayrollMap, setEntityPayrollMap] = useState<Record<string, { payrollSettings?: PayrollSettings | null } | null>>({});
  const [payrollUpdatingId, setPayrollUpdatingId] = useState<string | null>(null);
  const [complianceItems, setComplianceItems] = useState<(WorkerComplianceItem & { id: string })[]>([]);

  const updateStatus = async (employmentId: string, status: string, terminationReason?: string) => {
    if (!tenantId) return;
    setUpdatingId(employmentId);
    try {
      const callable = httpsCallable(functions, 'updateEntityEmploymentStatus');
      await callable({ tenantId, employmentId, status, terminationReason: terminationReason || null });
      setTerminationDialog(null);
      setTerminationReasonInput('');
    } catch (e: any) {
      setError(e?.message || 'Failed to update status');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleStatusChange = (rec: EntityEmploymentRecord, newStatus: string) => {
    if (newStatus === 'inactive' || newStatus === 'terminated') {
      setTerminationDialog({ employmentId: rec.id, status: newStatus });
      setTerminationReasonInput('');
    } else {
      updateStatus(rec.id, newStatus);
    }
  };

  const submitTerminationReason = () => {
    if (!terminationDialog) return;
    updateStatus(terminationDialog.employmentId, terminationDialog.status, terminationReasonInput.trim() || undefined);
  };

  const handlePayrollStatusChange = async (employmentId: string, payrollStatus: WorkerPayrollAccount['payrollStatus'], notes?: string | null) => {
    if (!tenantId) return;
    setPayrollUpdatingId(employmentId);
    try {
      await updateWorkerPayrollAccount(tenantId, employmentId, {
        payrollStatus,
        ...(notes !== undefined && { notes }),
        lastAdminVerifiedBy: uid,
      });
      setPayrollAccountsMap((prev) => {
        const cur = prev[employmentId];
        if (!cur) return prev;
        return { ...prev, [employmentId]: { ...cur, payrollStatus, notes: notes ?? cur.notes ?? null } };
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to update payroll status');
    } finally {
      setPayrollUpdatingId(null);
    }
  };

  useEffect(() => {
    if (!tenantId || !uid) {
      setRecords([]);
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const ref = collection(db, p.entityEmployments(tenantId));
        const q = query(ref, where('userId', '==', uid));
        const snap = await getDocs(q);
        const list: EntityEmploymentRecord[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<EntityEmploymentRecord, 'id'>),
        }));
        setRecords(list);
      } catch (e: any) {
        setError(e?.message || 'Failed to load employment records');
        setRecords([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [tenantId, uid]);

  useEffect(() => {
    if (!tenantId || records.length === 0) {
      setPipelineStepCounts({});
      return;
    }
    const loadStepCounts = async () => {
      const counts: Record<string, { complete: number; total: number }> = {};
      await Promise.all(
        records.map(async (rec) => {
          if (!rec.onboardingPipelineId) return;
          try {
            const pipelineRef = doc(db, p.workerOnboardingPipeline(tenantId!, rec.onboardingPipelineId));
            const snap = await getDoc(pipelineRef);
            const data = snap.data();
            const steps = Array.isArray(data?.steps) ? data.steps : [];
            counts[rec.onboardingPipelineId] = countPipelineProgressForEntity(steps, rec.entityKey);
          } catch {
            counts[rec.onboardingPipelineId] = { complete: 0, total: 0 };
          }
        })
      );
      setPipelineStepCounts(counts);
    };
    loadStepCounts();
  }, [tenantId, records]);

  // Phase 2B: Load payroll accounts and entity payroll settings per employment
  useEffect(() => {
    if (!tenantId || !uid || records.length === 0) {
      setPayrollAccountsMap({});
      setEntityPayrollMap({});
      return;
    }
    const load = async () => {
      const accounts: Record<string, (WorkerPayrollAccount & { id: string }) | null> = {};
      const entityPayroll: Record<string, { payrollSettings?: PayrollSettings | null } | null> = {};
      for (const rec of records) {
        const resolvedEntityId = rec.entityId ?? null;
        if (!resolvedEntityId) {
          accounts[workerPayrollAccountId(uid, rec.entityKey)] = null;
          continue;
        }
        try {
          const entityRef = doc(db, p.entity(tenantId, resolvedEntityId));
          const entitySnap = await getDoc(entityRef);
          const entityData = entitySnap.data();
          const payrollSettings = entityData?.payrollSettings ?? null;
          const payrollProvider = entityData?.payrollProvider;
          entityPayroll[resolvedEntityId] = { payrollSettings };
          // Prefer payrollSettings when present; fallback to legacy payrollProvider for Everee.
          const provider =
            payrollSettings?.provider ?? (payrollProvider === 'everee' ? 'everee' : 'manual');
          const mode = payrollSettings?.mode ?? 'portal_link_only';
          let acc = await getWorkerPayrollAccount(tenantId, uid, rec.entityKey);
          if (!acc) {
            acc = await getOrCreateWorkerPayrollAccount(
              tenantId,
              uid,
              resolvedEntityId,
              rec.entityKey,
              rec.entityName ?? '',
              (rec.workerType === '1099' ? '1099' : 'w2') as 'w2' | '1099',
              provider as WorkerPayrollAccount['payrollProvider'],
              mode as WorkerPayrollAccount['payrollMode'],
              rec.id
            );
          }
          accounts[acc.id] = acc;
        } catch {
          accounts[workerPayrollAccountId(uid, rec.entityKey)] = null;
          if (rec.entityId) entityPayroll[rec.entityId] = null;
        }
      }
      setPayrollAccountsMap(accounts);
      setEntityPayrollMap(entityPayroll);
    };
    load();
  }, [tenantId, uid, records]);

  // Compliance items for readiness and expiration warning
  useEffect(() => {
    if (!tenantId || !uid) {
      setComplianceItems([]);
      return;
    }
    const load = async () => {
      try {
        const ref = collection(db, p.workerComplianceItems(tenantId));
        const q = query(ref, where('userId', '==', uid));
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkerComplianceItem, 'id'>) })) as (WorkerComplianceItem & { id: string })[];
        setComplianceItems(list);
      } catch {
        setComplianceItems([]);
      }
    };
    load();
  }, [tenantId, uid]);

  if (!tenantId) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="info">Select a tenant to view employment records.</Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (records.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="info">
          No entity employment records yet. Onboarding will create a record when a worker is confirmed for a job tied to an entity, or when triggered from the user profile (Start Onboarding).
        </Alert>
      </Box>
    );
  }

  const payrollByKey: Record<string, { payrollStatus: string; payrollProvider?: string }> = {};
  records.forEach((rec) => {
    const key = workerPayrollAccountId(uid, rec.entityKey);
    const acc = payrollAccountsMap[key];
    if (acc) payrollByKey[key] = { payrollStatus: acc.payrollStatus, payrollProvider: acc.payrollProvider };
  });
  const readiness = getWorkerReadiness({
    employments: records.map((r) => ({
      id: r.id,
      status: r.status,
      entityKey: r.entityKey,
      onboardingPipelineId: r.onboardingPipelineId ?? undefined,
    })),
    complianceItems,
    payrollByKey,
    pipelineStepCounts,
  });
  const readinessColor: Record<ReadinessStatus, 'success' | 'info' | 'warning' | 'error' | 'default'> = {
    ready: 'success',
    onboarding: 'info',
    at_risk: 'warning',
    blocked: 'error',
    not_ready: 'default',
  };
  const showComplianceWarning = hasExpiredCompliance(complianceItems) || hasExpiringSoonCompliance(complianceItems);

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="subtitle2" color="text.secondary">
        Employment and onboarding status per entity. Open onboarding to update steps and packages.
      </Typography>
      {showComplianceWarning && (
        <Alert severity={hasExpiredCompliance(complianceItems) ? 'error' : 'warning'} variant="outlined">
          {hasExpiredCompliance(complianceItems)
            ? 'This worker has expired compliance items. '
            : ''}
          {hasExpiringSoonCompliance(complianceItems)
            ? 'Some compliance items will expire within 30 days.'
            : ''}
        </Alert>
      )}
      <Card variant="outlined" sx={{ bgcolor: 'action.hover' }}>
        <CardContent>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
            Readiness
          </Typography>
          <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1} sx={{ alignItems: 'flex-start' }}>
            <Chip label={getReadinessStatusLabel(readiness.status)} color={readinessColor[readiness.status]} size="small" />
            {readiness.reasons.length > 0 && (
              <Typography variant="body2" color="text.secondary" component="span" sx={{ flex: 1, minWidth: 0 }}>
                {readiness.reasons.join(' · ')}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>
      {records.map((rec) => (
        <Card key={rec.id} variant="outlined">
          <CardContent>
            <Stack spacing={1.25}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {rec.entityName || rec.entityKey}
                </Typography>
                <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                  <Chip label={rec.workerType === '1099' ? '1099' : 'W-2'} size="small" variant="outlined" />
                  <Chip
                    label={getEmploymentStatusLabel(rec.status, rec.workerType)}
                    size="small"
                    color={STATUS_COLOR[rec.status] || 'default'}
                  />
                </Stack>
              </Stack>
              {(() => {
                const counts = pipelineStepCounts[rec.onboardingPipelineId];
                const isComplete = rec.status === 'active' || (rec.onboardingCompletedAt != null);
                const summary = isComplete
                  ? 'Onboarding complete'
                  : counts && counts.total > 0
                    ? `${counts.complete} of ${counts.total} steps complete`
                    : null;
                return summary ? (
                  <Typography variant="body2" color="text.secondary">
                    {summary}
                  </Typography>
                ) : null;
              })()}
              <Stack direction="row" spacing={1} flexWrap="wrap">
                {String(rec.entityKey || '').toLowerCase() === 'select' && rec.everifyRequired && (
                  <Chip label="Select — E-Verify required" size="small" variant="outlined" />
                )}
                {String(rec.entityKey || '').toLowerCase() === 'select' && rec.everifyStatus && (
                  <Typography variant="caption" color="text.secondary">
                    Select — E-Verify: {rec.everifyStatus}
                  </Typography>
                )}
                {String(rec.entityKey || '').toLowerCase() === 'workforce' && (
                  <Typography variant="caption" color="text.secondary">
                    Workforce — I-9 / work authorization is managed under Backgrounds (no E-Verify).
                  </Typography>
                )}
                {String(rec.entityKey || '').toLowerCase() === 'events' && (
                  <Typography variant="caption" color="text.secondary">
                    Events — contractor track; no USCIS E-Verify in this employment relationship.
                  </Typography>
                )}
              </Stack>
              {rec.onboardingStartedAt?.toDate && (
                <Typography variant="caption" color="text.secondary" display="block">
                  Onboarding started: {rec.onboardingStartedAt.toDate().toLocaleDateString()}
                </Typography>
              )}
              {rec.onboardingCompletedAt?.toDate && (
                <Typography variant="caption" color="text.secondary" display="block">
                  Onboarding completed: {rec.onboardingCompletedAt.toDate().toLocaleDateString()}
                </Typography>
              )}
              {rec.hiredAt?.toDate && (
                <Typography variant="caption" color="text.secondary" display="block">
                  Hired: {rec.hiredAt.toDate().toLocaleDateString()}
                </Typography>
              )}
              {rec.terminatedAt?.toDate && (
                <Typography variant="caption" color="text.secondary" display="block">
                  Terminated: {rec.terminatedAt.toDate().toLocaleDateString()}
                  {rec.terminationReason ? ` — ${rec.terminationReason}` : ''}
                </Typography>
              )}
              {(() => {
                const payrollDocId = workerPayrollAccountId(uid, rec.entityKey);
                const payrollAcc = payrollAccountsMap[payrollDocId];
                const entityPayroll = rec.entityId ? entityPayrollMap[rec.entityId] : null;
                const settings = entityPayroll?.payrollSettings;
                const payrollUrl = settings?.onboardingUrl || settings?.portalUrl || null;
                if (!payrollAcc) return null;
                return (
                  <Box sx={{ pt: 0.5, borderTop: 1, borderColor: 'divider' }}>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                      Payroll
                    </Typography>
                    <Stack spacing={0.75}>
                      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={0.5}>
                        <Typography variant="body2">Provider: {payrollAcc.payrollProvider}</Typography>
                        <Chip size="small" label={getPayrollStatusLabel(payrollAcc.payrollStatus)} variant="outlined" />
                      </Stack>
                      {payrollUrl && (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<OpenInNewIcon />}
                          href={payrollUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open payroll portal
                        </Button>
                      )}
                      <FormControl size="small" sx={{ minWidth: 160 }}>
                        <InputLabel>Payroll status</InputLabel>
                        <Select
                          label="Payroll status"
                          value={payrollAcc.payrollStatus}
                          disabled={payrollUpdatingId === payrollDocId}
                          onChange={(e) =>
                            handlePayrollStatusChange(payrollDocId, e.target.value as WorkerPayrollAccount['payrollStatus'])
                          }
                        >
                          {PAYROLL_STATUS.map((s) => (
                            <MenuItem key={s} value={s}>{getPayrollStatusLabel(s)}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Stack direction="row" alignItems="flex-start" gap={0.5}>
                        <TextField
                          size="small"
                          label="Payroll notes"
                          value={payrollAcc.notes ?? ''}
                          onChange={(e) =>
                            setPayrollAccountsMap((prev) => {
                              const cur = prev[payrollDocId];
                              if (!cur) return prev;
                              return { ...prev, [payrollDocId]: { ...cur, notes: e.target.value || null } };
                            })
                          }
                          fullWidth
                          multiline
                          minRows={0}
                          placeholder="Optional notes"
                        />
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={payrollUpdatingId === payrollDocId}
                          onClick={async () => {
                            const cur = payrollAccountsMap[payrollDocId];
                            if (!cur) return;
                            await handlePayrollStatusChange(payrollDocId, cur.payrollStatus, cur.notes);
                          }}
                        >
                          Save
                        </Button>
                      </Stack>
                    </Stack>
                  </Box>
                );
              })()}
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>Employment status</InputLabel>
                  <Select
                    label="Employment status"
                    value={rec.status}
                    disabled={updatingId === rec.id}
                    onChange={(e) => handleStatusChange(rec, e.target.value)}
                  >
                    {EMPLOYMENT_STATUSES.map((s) => (
                      <MenuItem key={s} value={s}>{s}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ))}
      <Dialog open={!!terminationDialog} onClose={() => setTerminationDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {terminationDialog?.status === 'terminated' ? 'Terminate employment' : 'Set employment inactive'}
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Termination reason (optional)"
            value={terminationReasonInput}
            onChange={(e) => setTerminationReasonInput(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTerminationDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={submitTerminationReason}>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};

export default EmploymentTab;
