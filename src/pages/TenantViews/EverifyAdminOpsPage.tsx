/**
 * E-Verify Admin Ops: list/filter cases, retry, exception actions.
 * Admin/HRX only.
 */

import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert,
  Snackbar,
  Menu,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import RefreshIcon from '@mui/icons-material/Refresh';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import ScienceIcon from '@mui/icons-material/Science';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

interface EverifyCaseRow {
  id: string;
  userId?: string;
  userEmploymentId?: string;
  everifyCaseNumber?: string;
  status: string;
  providerStatus?: string;
  createdAt?: { toMillis?: () => number };
  lastCheckedAt?: { toMillis?: () => number };
  deadlines?: {
    tncResponseDueAt?: { toMillis?: () => number } | unknown;
    referralDueAt?: { toMillis?: () => number } | unknown;
  };
  everifyCaseActions?: {
    employeeNotifiedAt?: unknown;
    employeeContests?: boolean;
    referralInitiatedAt?: unknown;
    caseClosedAt?: unknown;
    notes?: string;
  };
}

const STATUS_OPTIONS = [
  '',
  'submitted',
  'pending',
  'employment_authorized',
  'tnc',
  'dhs_verification_in_process',
  'further_action_required',
  'final_nonconfirmation',
  'closed',
  'error',
];

const EverifyAdminOpsPage: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const { isHRX, claimsRoles } = useAuth();
  const effectiveTenantId = tenantId;
  const isAdmin = isHRX || claimsRoles?.[effectiveTenantId || '']?.role === 'Admin';

  const [cases, setCases] = useState<EverifyCaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [snack, setSnack] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);
  const [anchorEl, setAnchorEl] = useState<{ el: HTMLElement; caseRow: EverifyCaseRow } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{
    ok: boolean;
    caseNumber?: string;
    providerStatus?: string;
    eligibilityStatement?: string;
    error?: string;
  } | null>(null);

  const handlePingAuth = async () => {
    setAuthLoading(true);
    try {
      const ping = httpsCallable<unknown, { ok: boolean; error?: string }>(functions, 'everifyPingAuth');
      const res = await ping({});
      if (res.data?.ok) {
        setSnack({ message: 'E-Verify auth OK', severity: 'success' });
      } else {
        setSnack({ message: res.data?.error || 'Auth failed', severity: 'error' });
      }
    } catch (err: unknown) {
      setSnack({
        message: err instanceof Error ? err.message : 'Auth check failed',
        severity: 'error',
      });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleDryRun = async () => {
    setDryRunLoading(true);
    setDryRunResult(null);
    try {
      const dryRun = httpsCallable<unknown, {
        ok: boolean;
        caseNumber?: string;
        providerStatus?: string;
        eligibilityStatement?: string;
        rawWhitelisted?: Record<string, unknown>;
        error?: string;
      }>(functions, 'everifyDryRunCreateAndSubmit');
      const res = await dryRun({});
      if (res.data?.ok) {
        setDryRunResult({
          ok: true,
          caseNumber: res.data.caseNumber,
          providerStatus: res.data.providerStatus,
          eligibilityStatement: res.data.eligibilityStatement,
        });
        setSnack({ message: 'Dry run OK', severity: 'success' });
      } else {
        setDryRunResult({
          ok: false,
          error: res.data?.error || 'Dry run failed',
        });
        setSnack({ message: res.data?.error || 'Dry run failed', severity: 'error' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Dry run failed';
      setDryRunResult({ ok: false, error: msg });
      setSnack({ message: msg, severity: 'error' });
    } finally {
      setDryRunLoading(false);
    }
  };

  const loadCases = async () => {
    if (!effectiveTenantId) return;
    setLoading(true);
    try {
      const listCases = httpsCallable<
        { tenantId: string; status?: string; limit?: number },
        { cases: EverifyCaseRow[] }
      >(functions, 'everifyListCases');
      const res = await listCases({
        tenantId: effectiveTenantId,
        status: statusFilter || undefined,
        limit: 100,
      });
      setCases((res.data?.cases ?? []).map((c) => ({ ...c })));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load cases';
      setSnack({ message: msg, severity: 'error' });
      setCases([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCases();
  }, [effectiveTenantId, statusFilter]);

  const handleRetry = async (row: EverifyCaseRow) => {
    setAnchorEl(null);
    if (!row.userEmploymentId) {
      setSnack({ message: 'No userEmploymentId for retry', severity: 'error' });
      return;
    }
    setActionLoading(true);
    try {
      const retry = httpsCallable(functions, 'everifyRetryCase');
      await retry({ tenantId: effectiveTenantId, caseId: row.id, userEmploymentId: row.userEmploymentId });
      setSnack({ message: 'Retry enqueued', severity: 'success' });
      loadCases();
    } catch (err: unknown) {
      setSnack({
        message: err instanceof Error ? err.message : 'Retry failed',
        severity: 'error',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleExceptionAction = async (row: EverifyCaseRow, action: 'mark_manual_review' | 'close' | 'dismiss_error') => {
    setAnchorEl(null);
    setActionLoading(true);
    try {
      const exceptionAction = httpsCallable(functions, 'everifyExceptionAction');
      await exceptionAction({ tenantId: effectiveTenantId, caseId: row.id, action });
      setSnack({ message: `Action ${action} applied`, severity: 'success' });
      loadCases();
    } catch (err: unknown) {
      setSnack({
        message: err instanceof Error ? err.message : 'Action failed',
        severity: 'error',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const formatDeadline = (d: { toMillis?: () => number } | unknown): string => {
    if (!d || typeof d !== 'object') return '—';
    const m = (d as { toMillis?: () => number }).toMillis;
    if (typeof m !== 'function') return '—';
    return new Date(m()).toLocaleDateString();
  };

  const handleTncAction = async (
    row: EverifyCaseRow,
    callableName: 'everifyMarkEmployeeNotified' | 'everifyMarkContested' | 'everifyMarkReferralInitiated' | 'everifyCloseCaseManual',
    payload?: { note?: string }
  ) => {
    setActionLoading(true);
    try {
      const fn = httpsCallable(functions, callableName);
      await fn({ tenantId: effectiveTenantId, caseId: row.id, ...payload });
      setSnack({ message: 'Action recorded', severity: 'success' });
      loadCases();
    } catch (err: unknown) {
      setSnack({ message: err instanceof Error ? err.message : 'Action failed', severity: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  if (!isAdmin) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">Admin access required for E-Verify Ops.</Alert>
      </Box>
    );
  }

  const formatDate = (ts: { toMillis?: () => number } | undefined) => {
    if (!ts?.toMillis) return '—';
    return new Date(ts.toMillis()).toLocaleString();
  };

  const hasActionRequired = cases.some(
    (c) => c.status === 'tnc' || c.status === 'further_action_required'
  );

  return (
    <Box sx={{ p: 2 }}>
      {hasActionRequired && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          You have E-Verify cases requiring action (TNC or referral). Resolve in the table below or in Tasks.
        </Alert>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <VerifiedUserIcon color="primary" sx={{ fontSize: 28 }} />
        <Typography variant="h6">E-Verify Admin Ops</Typography>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Status filter</InputLabel>
          <Select
            value={statusFilter}
            label="Status filter"
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_OPTIONS.map((s) => (
              <MenuItem key={s || 'all'} value={s}>
                {s || 'All'}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button startIcon={<RefreshIcon />} onClick={loadCases} disabled={loading}>
          Refresh
        </Button>
        <Button
          startIcon={authLoading ? <CircularProgress size={16} /> : <VpnKeyIcon />}
          onClick={handlePingAuth}
          disabled={authLoading}
          variant="outlined"
          size="small"
        >
          Test auth
        </Button>
        <Button
          startIcon={dryRunLoading ? <CircularProgress size={16} /> : <ScienceIcon />}
          onClick={handleDryRun}
          disabled={dryRunLoading}
          variant="outlined"
          size="small"
        >
          Dry run create+submit
        </Button>
      </Box>

      {dryRunResult && (
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            mb: 2,
            bgcolor: dryRunResult.ok ? 'action.selected' : 'action.hover',
          }}
        >
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            Dry run result
          </Typography>
          {dryRunResult.ok ? (
            <Box component="pre" sx={{ fontSize: 12, overflow: 'auto', m: 0 }}>
              {dryRunResult.caseNumber && `Case #: ${dryRunResult.caseNumber}\n`}
              {dryRunResult.providerStatus && `Status: ${dryRunResult.providerStatus}\n`}
              {dryRunResult.eligibilityStatement && `Eligibility: ${dryRunResult.eligibilityStatement}`}
            </Box>
          ) : (
            <Typography variant="body2" color="error">
              {dryRunResult.error}
            </Typography>
          )}
        </Paper>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Case ID</TableCell>
                <TableCell>E-Verify #</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>User</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Last checked</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {cases.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    No cases found
                  </TableCell>
                </TableRow>
              ) : (
                cases.map((row) => {
                  const actionRequired = row.status === 'tnc' || row.status === 'further_action_required';
                  const deadlines = row.deadlines;
                  const actions = row.everifyCaseActions;
                  return (
                    <React.Fragment key={row.id}>
                      <TableRow>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{row.id.slice(0, 8)}…</TableCell>
                        <TableCell>{row.everifyCaseNumber || '—'}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={row.status}
                            color={
                              row.status === 'employment_authorized'
                                ? 'success'
                                : row.status === 'error'
                                  ? 'error'
                                  : 'default'
                            }
                          />
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                          {row.userId?.slice(0, 8)}…
                        </TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{formatDate(row.createdAt)}</TableCell>
                        <TableCell sx={{ fontSize: 12 }}>{formatDate(row.lastCheckedAt)}</TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            onClick={(e) => setAnchorEl({ el: e.currentTarget, caseRow: row })}
                            disabled={actionLoading}
                          >
                            <MoreVertIcon />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {actionRequired && (
                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                          <TableCell colSpan={7} sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
                              {deadlines && (
                                <Typography variant="caption" color="text.secondary">
                                  TNC due: {formatDeadline(deadlines.tncResponseDueAt)} · Referral due: {formatDeadline(deadlines.referralDueAt)}
                                </Typography>
                              )}
                              {actions?.employeeNotifiedAt && (
                                <Chip size="small" label="Notified" variant="outlined" />
                              )}
                              {actions?.employeeContests && (
                                <Chip size="small" label="Contested" variant="outlined" />
                              )}
                              {actions?.referralInitiatedAt && (
                                <Chip size="small" label="Referral" variant="outlined" />
                              )}
                              {!actions?.employeeNotifiedAt && (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  disabled={actionLoading}
                                  onClick={() => handleTncAction(row, 'everifyMarkEmployeeNotified')}
                                >
                                  Mark employee notified
                                </Button>
                              )}
                              {!actions?.employeeContests && (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  disabled={actionLoading}
                                  onClick={() => handleTncAction(row, 'everifyMarkContested')}
                                >
                                  Mark contested
                                </Button>
                              )}
                              {!actions?.referralInitiatedAt && (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  disabled={actionLoading}
                                  onClick={() => handleTncAction(row, 'everifyMarkReferralInitiated')}
                                >
                                  Mark referral initiated
                                </Button>
                              )}
                              <Button
                                size="small"
                                variant="outlined"
                                color="secondary"
                                disabled={actionLoading}
                                onClick={() => handleTncAction(row, 'everifyCloseCaseManual')}
                              >
                                Close case
                              </Button>
                            </Box>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Menu
        open={!!anchorEl}
        anchorEl={anchorEl?.el}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => anchorEl && handleRetry(anchorEl.caseRow)}
          disabled={!anchorEl?.caseRow.userEmploymentId}
        >
          <ListItemIcon>
            <RefreshIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Retry (enqueue task)</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => anchorEl && handleExceptionAction(anchorEl.caseRow, 'mark_manual_review')}>
          <ListItemText>Mark manual review</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => anchorEl && handleExceptionAction(anchorEl.caseRow, 'close')}>
          <ListItemText>Close case</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => anchorEl && handleExceptionAction(anchorEl.caseRow, 'dismiss_error')}>
          <ListItemText>Dismiss error</ListItemText>
        </MenuItem>
      </Menu>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)}>
        <Alert severity={snack?.severity} onClose={() => setSnack(null)}>
          {snack?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default EverifyAdminOpsPage;
