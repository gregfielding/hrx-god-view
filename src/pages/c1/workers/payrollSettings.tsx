/**
 * Direct deposit — /c1/workers/payroll-settings (2026-08-28).
 *
 * Worker-facing bank account management, now that bank capture moved out of
 * the Everee widget: one card per employer showing the deposit account on
 * file (bank + ••last-4, live from Everee, TIN-scrubbed server-side) with an
 * Add/Replace dialog (shared with the admin panel — ABA-validated, in
 * transit only, never stored). SSN + tax forms stay in the Everee widget by
 * design; the profile menu links there separately.
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
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import { t } from '../../../i18n';
import { useAuth } from '../../../contexts/AuthContext';
import WorkerPageHeader from '../../../components/worker/WorkerPageHeader';
import {
  useWorkerEmployerLinkages,
  type WorkerEmployerLinkage,
} from '../../../hooks/useWorkerPayHistory';
import {
  evereeAdminGetWorker,
  type EvereeAdminGetWorkerResult,
} from '../../../services/everee/evereeCallables';
import ReplaceBankAccountDialog from '../../../components/everee/ReplaceBankAccountDialog';

interface BankOnFile {
  bankName: string;
  accountType: string;
  last4: string;
  depositsBlocked: boolean;
}

function pickBankAccounts(raw: unknown): BankOnFile[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  const worker =
    (r.worker as Record<string, unknown> | undefined) ||
    (r.data as Record<string, unknown> | undefined) ||
    r;
  const list = Array.isArray(worker.bankAccounts) ? worker.bankAccounts : [];
  return list
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    .map((b) => ({
      bankName: String(b.bankName ?? '').trim(),
      accountType: String(b.accountType ?? '').trim(),
      last4: String(b.accountNumberLast4 ?? '')
        .replace(/[^\d]/g, '')
        .slice(-4),
      depositsBlocked: b.depositsBlocked === true,
    }));
}

const EmployerBankCard: React.FC<{
  tenantId: string;
  uid: string;
  linkage: WorkerEmployerLinkage;
  onSavedSnack: () => void;
}> = ({ tenantId, uid, linkage, onSavedSnack }) => {
  const [accounts, setAccounts] = useState<BankOnFile[] | null>(null);
  const [error, setError] = useState<string>('');
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await evereeAdminGetWorker({
          tenantId,
          entityId: linkage.entityId,
          evereeWorkerId: linkage.evereeWorkerId,
          userId: uid,
        });
        if (cancelled) return;
        setAccounts(pickBankAccounts((res.data as EvereeAdminGetWorkerResult | undefined)?.response));
      } catch {
        if (!cancelled) setError(t('payrollSettings.loadError'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, uid, linkage.entityId, linkage.evereeWorkerId]);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="subtitle1">{linkage.label}</Typography>
          {error ? (
            <Alert severity="warning">{error}</Alert>
          ) : accounts === null ? (
            <Box sx={{ display: 'flex', py: 1 }}>
              <CircularProgress size={20} />
            </Box>
          ) : accounts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('payrollSettings.noAccount')}
            </Typography>
          ) : (
            accounts.map((a, i) => (
              <Stack key={`${a.last4}-${i}`} direction="row" spacing={1} alignItems="center">
                <Typography variant="body2">
                  {a.bankName || t('payrollSettings.bankFallback')} ·{' '}
                  {a.accountType === 'SAVINGS'
                    ? t('bankDialog.savings')
                    : t('bankDialog.checking')}{' '}
                  {a.last4 ? `•••• ${a.last4}` : ''}
                </Typography>
                {a.depositsBlocked ? (
                  <Chip size="small" color="error" label={t('payrollSettings.blocked')} />
                ) : null}
              </Stack>
            ))
          )}
          <Box>
            <Button size="small" variant="outlined" onClick={() => setDialogOpen(true)} disabled={accounts === null && !error}>
              {accounts && accounts.length > 0
                ? t('bankDialog.replaceTitle')
                : t('bankDialog.addTitle')}
            </Button>
          </Box>
        </Stack>
      </CardContent>
      <ReplaceBankAccountDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        tenantId={tenantId}
        entityId={linkage.entityId}
        evereeWorkerId={linkage.evereeWorkerId}
        userId={uid}
        hasExistingAccount={Boolean(accounts && accounts.length > 0)}
        onSaved={(resp) => {
          setAccounts(pickBankAccounts(resp));
          onSavedSnack();
        }}
      />
    </Card>
  );
};

const WorkerPayrollSettings: React.FC = () => {
  const { user, tenantId, tenantIds } = useAuth();
  const scopeTenantId = tenantId || tenantIds[0];
  const uid = user?.uid ?? '';
  const { linkages, loading } = useWorkerEmployerLinkages(scopeTenantId, uid || undefined);
  const [snackOpen, setSnackOpen] = useState(false);

  const usable = linkages.filter((l) => l.evereeWorkerId);

  return (
    <Box>
      <WorkerPageHeader title={t('payrollSettings.title')} backTo="/c1/workers/profile" />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('payrollSettings.intro')}
      </Typography>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={26} />
        </Box>
      ) : usable.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('payrollSettings.empty')}
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {usable.map((l) => (
            <EmployerBankCard
              key={l.entityId}
              tenantId={scopeTenantId}
              uid={uid}
              linkage={l}
              onSavedSnack={() => setSnackOpen(true)}
            />
          ))}
        </Stack>
      )}
      <Snackbar
        open={snackOpen}
        autoHideDuration={6000}
        onClose={() => setSnackOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackOpen(false)} severity="success" variant="filled" sx={{ width: '100%' }}>
          {t('payrollSettings.saved')}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default WorkerPayrollSettings;
