/**
 * Worker-facing "your payment bounced" banner (2026-08-28).
 *
 * Scans recent pay-history rows for a worker-fixable payment problem (the
 * server mapper stamps `issue` from Everee's error/deposit signals — see
 * functions/src/integrations/everee/payHistory/mapPayments.ts) and renders
 * one actionable alert:
 *  - bank_invalid / deposit_returned → "double-check your routing and
 *    account number" → Direct deposit page.
 *  - missing_tin → "finish payroll setup" → the employer's Earnings step.
 * Shown on the Earnings index and Pay history pages.
 */
import React from 'react';
import { Alert, AlertTitle, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { t } from '../../i18n';
import type { PayHistoryRow } from '../../hooks/useWorkerPayHistory';

/** Only alert on problems recent enough to still be the worker's reality. */
const MAX_AGE_DAYS = 60;

export function findRecentPaymentIssue(rows: PayHistoryRow[]): PayHistoryRow | null {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  for (const r of rows) {
    if (!r.issue) continue;
    if (r.payDate && r.payDate < cutoff) continue;
    return r;
  }
  return null;
}

const PaymentIssueBanner: React.FC<{ rows: PayHistoryRow[] }> = ({ rows }) => {
  const navigate = useNavigate();
  const hit = findRecentPaymentIssue(rows);
  if (!hit) return null;

  const isSetupIssue = hit.issue === 'missing_tin';
  return (
    <Alert
      severity="error"
      sx={{ mb: 2 }}
      action={
        <Button
          color="inherit"
          size="small"
          onClick={() =>
            navigate(
              isSetupIssue
                ? `/c1/workers/earnings/${encodeURIComponent(hit.evereeTenantId)}`
                : '/c1/workers/payroll-settings',
            )
          }
        >
          {isSetupIssue ? t('earnings.issueFinishSetupCta') : t('earnings.issueFixDepositCta')}
        </Button>
      }
    >
      <AlertTitle>
        {isSetupIssue ? t('earnings.issueSetupTitle') : t('earnings.issueDepositTitle')}
      </AlertTitle>
      {isSetupIssue
        ? t('earnings.issueSetupBody')
        : t('earnings.issueDepositBody')}
    </Alert>
  );
};

export default PaymentIssueBanner;
