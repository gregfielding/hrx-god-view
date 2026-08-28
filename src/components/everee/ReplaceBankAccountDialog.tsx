/**
 * Shared Add/Replace direct-deposit account dialog (2026-08-28).
 *
 * Used by both the admin User > Payroll panel (EmployeePayrollSection) and
 * the worker-facing Direct deposit page. Values live only in this form's
 * state for the dialog's lifetime; on submit they ride the
 * `evereeAdminGetWorker` write-through (`setDefaultBankAccount`) once and
 * are cleared — never persisted or logged anywhere in HRX. Routing numbers
 * are ABA-checksum validated client-side (and again server-side).
 */
import React, { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { t } from '../../i18n';
import {
  evereeAdminGetWorker,
  type EvereeAdminGetWorkerResult,
} from '../../services/everee/evereeCallables';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';
import { isValidAbaRoutingNumber } from '../../utils/abaRouting';

export interface ReplaceBankAccountDialogProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  entityId: string;
  evereeWorkerId: string;
  /** Subject-of-record uid (worker self or the admin's target worker). */
  userId: string;
  /** Switches the title between Add and Replace. */
  hasExistingAccount: boolean;
  /** Fires with the fresh (TIN-scrubbed) worker record after a successful save. */
  onSaved: (workerResponse: unknown) => void;
}

const EMPTY_FORM = {
  bankName: '',
  accountName: '',
  accountType: 'CHECKING' as 'CHECKING' | 'SAVINGS',
  routingNumber: '',
  accountNumber: '',
  confirmAccountNumber: '',
};

const ReplaceBankAccountDialog: React.FC<ReplaceBankAccountDialogProps> = ({
  open,
  onClose,
  tenantId,
  entityId,
  evereeWorkerId,
  userId,
  hasExistingAccount,
  onSaved,
}) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    setForm(EMPTY_FORM);
    setError('');
    onClose();
  };

  const submit = async () => {
    const routing = form.routingNumber.replace(/\D/g, '');
    const account = form.accountNumber.replace(/\D/g, '');
    if (!form.bankName.trim() || !form.accountName.trim() || !routing || !account) {
      setError(t('bankDialog.requiredFields'));
      return;
    }
    if (!isValidAbaRoutingNumber(routing)) {
      setError(t('bankDialog.routingInvalid'));
      return;
    }
    if (!/^\d{4,17}$/.test(account)) {
      setError(t('bankDialog.accountInvalid'));
      return;
    }
    if (account !== form.confirmAccountNumber.replace(/\D/g, '')) {
      setError(t('bankDialog.accountMismatch'));
      return;
    }
    setError('');
    setSaving(true);
    try {
      const res = await evereeAdminGetWorker({
        tenantId,
        entityId,
        evereeWorkerId,
        userId,
        setDefaultBankAccount: {
          bankName: form.bankName.trim(),
          accountName: form.accountName.trim(),
          accountType: form.accountType,
          routingNumber: routing,
          accountNumber: account,
        },
      });
      const data = res.data as EvereeAdminGetWorkerResult;
      if (data?.bankUpdate?.ok === false) {
        setError(data.bankUpdate.error || t('bankDialog.rejected'));
        return;
      }
      onSaved(data?.response);
      close();
    } catch (err: unknown) {
      setError(
        formatFirebaseHttpsError(err) ||
          (err instanceof Error ? err.message : t('bankDialog.rejected')),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : close} fullWidth maxWidth="xs">
      <DialogTitle>
        {hasExistingAccount ? t('bankDialog.replaceTitle') : t('bankDialog.addTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label={t('bankDialog.bankName')}
            value={form.bankName}
            onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
            fullWidth
            size="small"
          />
          <TextField
            label={t('bankDialog.accountName')}
            value={form.accountName}
            onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))}
            fullWidth
            size="small"
          />
          <TextField
            select
            label={t('bankDialog.accountType')}
            value={form.accountType}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                accountType: e.target.value === 'SAVINGS' ? 'SAVINGS' : 'CHECKING',
              }))
            }
            fullWidth
            size="small"
          >
            <MenuItem value="CHECKING">{t('bankDialog.checking')}</MenuItem>
            <MenuItem value="SAVINGS">{t('bankDialog.savings')}</MenuItem>
          </TextField>
          <TextField
            label={t('bankDialog.routingNumber')}
            value={form.routingNumber}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                routingNumber: e.target.value.replace(/[^\d]/g, '').slice(0, 9),
              }))
            }
            fullWidth
            size="small"
            inputProps={{ inputMode: 'numeric', autoComplete: 'off' }}
          />
          <TextField
            label={t('bankDialog.accountNumber')}
            value={form.accountNumber}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                accountNumber: e.target.value.replace(/[^\d]/g, '').slice(0, 17),
              }))
            }
            fullWidth
            size="small"
            inputProps={{ inputMode: 'numeric', autoComplete: 'off' }}
          />
          <TextField
            label={t('bankDialog.confirmAccountNumber')}
            value={form.confirmAccountNumber}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                confirmAccountNumber: e.target.value.replace(/[^\d]/g, '').slice(0, 17),
              }))
            }
            fullWidth
            size="small"
            inputProps={{ inputMode: 'numeric', autoComplete: 'off' }}
          />
          {error ? <Alert severity="warning">{error}</Alert> : null}
          <Typography variant="caption" color="text.secondary">
            {t('bankDialog.privacy')}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={saving}>
          {t('bankDialog.cancel')}
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={saving}>
          {saving ? t('bankDialog.saving') : t('bankDialog.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReplaceBankAccountDialog;
