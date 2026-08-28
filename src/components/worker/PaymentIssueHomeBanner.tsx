/**
 * Home-tab money-stuck banner (2026-08-28).
 *
 * Same alert as `PaymentIssueBanner`, but sourced from the payment-issue
 * sweep's Firestore queue (`tenants/{t}/payroll_payment_issues`, worker
 * reads own rows) instead of live Everee pay history — Home is the
 * highest-traffic tab and must not pay for per-employer Everee callable
 * round trips on every load. The sweep refreshes the queue every ~6h,
 * which is fresh enough for a fix-your-deposit prompt; the Payroll tab's
 * banner stays live-sourced.
 */
import React, { useEffect, useState } from 'react';
import { Alert, AlertTitle, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { t } from '../../i18n';

interface OpenIssueRow {
  issue: string;
  evereeTenantId: string;
}

const PaymentIssueHomeBanner: React.FC<{ tenantId: string | null; uid: string | undefined }> = ({
  tenantId,
  uid,
}) => {
  const navigate = useNavigate();
  const [row, setRow] = useState<OpenIssueRow | null>(null);

  useEffect(() => {
    if (!tenantId || !uid) return;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'tenants', tenantId, 'payroll_payment_issues'),
            where('uid', '==', uid),
            where('status', '==', 'open'),
            limit(1),
          ),
        );
        const d = snap.docs[0];
        if (!cancelled && d) {
          setRow({
            issue: String(d.get('issue') ?? ''),
            evereeTenantId: String(d.get('evereeTenantId') ?? ''),
          });
        }
      } catch {
        /* banner is best-effort — Home renders fine without it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, uid]);

  if (!row) return null;
  const isSetupIssue = row.issue === 'missing_tin';
  return (
    <Alert
      severity="error"
      action={
        <Button
          color="inherit"
          size="small"
          onClick={() =>
            navigate(
              isSetupIssue
                ? `/c1/workers/earnings/${encodeURIComponent(row.evereeTenantId)}`
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
      {isSetupIssue ? t('earnings.issueSetupBody') : t('earnings.issueDepositBody')}
    </Alert>
  );
};

export default PaymentIssueHomeBanner;
