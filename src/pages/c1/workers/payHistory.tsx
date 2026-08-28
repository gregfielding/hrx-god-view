/**
 * Pay history — /c1/workers/pay-history (Earnings v2, Greg 2026-08-24).
 *
 * Full native payment list across employers with per-employer filter
 * chips, and a statement detail view at /:evereeTenantId/:statementId
 * (gross/net, period, earnings/deductions/taxes line items, and Everee's
 * short-lived signed PDF when available) via `evereeGetPayStatement` —
 * self-access already allowed server-side.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';
import WorkerPageHeader from '../../../components/worker/WorkerPageHeader';
import PaymentIssueBanner from '../../../components/worker/PaymentIssueBanner';
import {
  USD,
  useWorkerEmployerLinkages,
  useWorkerPayHistory,
  type PayHistoryRow,
} from '../../../hooks/useWorkerPayHistory';

interface StatementLine {
  label: string;
  amount: number | null;
}

interface StatementDetail {
  statementId: string;
  payDate?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  gross?: number | null;
  net?: number | null;
  status?: string | null;
  pdfUrl?: string | null;
  earnings?: StatementLine[] | null;
  deductions?: StatementLine[] | null;
  taxes?: StatementLine[] | null;
}

function statusChip(t: (k: string) => string, status: string | null | undefined): React.ReactNode {
  if (status === 'PAID') return <Chip size="small" color="success" label={t('earnings.statusPaid')} />;
  if (status === 'ERROR' || status === 'RETURNED')
    return <Chip size="small" color="error" label={t('earnings.statusIssue')} />;
  return <Chip size="small" variant="outlined" label={t('earnings.statusPending')} />;
}

const LineSection: React.FC<{ title: string; lines: StatementLine[] | null | undefined }> = ({
  title,
  lines,
}) => {
  if (!lines || lines.length === 0) return null;
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      <Stack divider={<Divider />}>
        {lines.map((l, i) => (
          <Stack key={`${l.label}-${i}`} direction="row" justifyContent="space-between" sx={{ py: 0.75 }}>
            <Typography variant="body2" color="text.secondary">
              {l.label}
            </Typography>
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {l.amount != null ? USD.format(l.amount) : '—'}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
};

const WorkerPayHistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const t = useT();
  const { user, tenantId, tenantIds } = useAuth();
  const scopeTenantId = tenantId || tenantIds[0];
  const { evereeTenantId, statementId } = useParams<{ evereeTenantId?: string; statementId?: string }>();

  const { linkages, loading: linkagesLoading } = useWorkerEmployerLinkages(scopeTenantId, user?.uid);
  const { rows, loading: rowsLoading } = useWorkerPayHistory(scopeTenantId, linkages, 200);

  const [employerFilter, setEmployerFilter] = useState<string>('all');
  const [detail, setDetail] = useState<StatementDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const isDetail = Boolean(evereeTenantId && statementId);

  // Statement detail fetch.
  useEffect(() => {
    if (!isDetail || !scopeTenantId) {
      setDetail(null);
      return;
    }
    const linkage = linkages.find((l) => l.evereeTenantId === evereeTenantId);
    if (!linkage) return; // linkages still loading
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    void (async () => {
      try {
        const fn = httpsCallable(getFunctions(), 'evereeGetPayStatement');
        const res = await fn({
          tenantId: scopeTenantId,
          entityId: linkage.entityId,
          statementId,
        });
        if (!cancelled) setDetail((res.data as StatementDetail) ?? null);
      } catch {
        if (!cancelled) setDetailError(t('earnings.statementError'));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDetail, scopeTenantId, evereeTenantId, statementId, linkages.map((l) => l.entityId).join('|')]);

  const filteredRows = useMemo(
    () => (employerFilter === 'all' ? rows : rows.filter((r) => r.evereeTenantId === employerFilter)),
    [rows, employerFilter],
  );

  // Row from the already-loaded list — fallback header data while detail loads.
  const listRow: PayHistoryRow | undefined = useMemo(
    () => rows.find((r) => r.statementId === statementId),
    [rows, statementId],
  );

  // ——— Statement detail view ———
  if (isDetail) {
    const employerLabel =
      linkages.find((l) => l.evereeTenantId === evereeTenantId)?.label ?? listRow?.employerLabel ?? '';
    const gross = detail?.gross ?? listRow?.gross ?? null;
    const payDate = detail?.payDate ?? listRow?.payDate ?? null;
    const periodStart = detail?.periodStart ?? listRow?.periodStart ?? null;
    const periodEnd = detail?.periodEnd ?? listRow?.periodEnd ?? null;
    const status = detail?.status ?? listRow?.status ?? null;
    return (
      <Box>
        <WorkerPageHeader title={t('earnings.statementTitle')} backTo="/c1/workers/pay-history" />
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Stack spacing={0.5} alignItems="flex-start">
              <Typography variant="h5" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {gross != null ? USD.format(gross) : '—'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {[payDate, employerLabel].filter(Boolean).join(' · ')}
              </Typography>
              {(periodStart || periodEnd) && (
                <Typography variant="caption" color="text.secondary">
                  {t('earnings.period')}: {periodStart ?? '?'} – {periodEnd ?? '?'}
                </Typography>
              )}
              <Box sx={{ mt: 0.5 }}>{statusChip(t, status)}</Box>
            </Stack>
          </CardContent>
        </Card>

        {detailLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : detailError ? (
          <Alert severity="error">{detailError}</Alert>
        ) : detail ? (
          <Stack spacing={2}>
            {(detail.earnings?.length || detail.deductions?.length || detail.taxes?.length) ? (
              <Card variant="outlined">
                <CardContent>
                  <Stack spacing={2}>
                    <LineSection title={t('earnings.earningsSection')} lines={detail.earnings} />
                    <LineSection title={t('earnings.taxes')} lines={detail.taxes} />
                    <LineSection title={t('earnings.deductions')} lines={detail.deductions} />
                  </Stack>
                </CardContent>
              </Card>
            ) : null}
            {detail.pdfUrl ? (
              <Button
                variant="contained"
                endIcon={<OpenInNewIcon />}
                onClick={() => window.open(detail.pdfUrl as string, '_blank', 'noopener,noreferrer')}
                sx={{ alignSelf: 'flex-start', px: 3 }}
              >
                {t('earnings.viewPdf')}
              </Button>
            ) : (
              <Typography variant="caption" color="text.secondary">
                {t('earnings.noPdf')}
              </Typography>
            )}
          </Stack>
        ) : (
          <Alert severity="info">{t('earnings.statementError')}</Alert>
        )}
      </Box>
    );
  }

  // ——— Full list view ———
  const loading = linkagesLoading || rowsLoading;
  return (
    <Box>
      <WorkerPageHeader title={t('earnings.payHistoryTitle')} backTo="/c1/workers/earnings" />
      <PaymentIssueBanner rows={rows} />

      {linkages.length > 1 && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} useFlexGap flexWrap="wrap">
          <Chip
            label={t('earnings.allEmployers')}
            size="small"
            color={employerFilter === 'all' ? 'primary' : 'default'}
            variant={employerFilter === 'all' ? 'filled' : 'outlined'}
            onClick={() => setEmployerFilter('all')}
          />
          {linkages.map((l) => (
            <Chip
              key={l.evereeTenantId}
              label={l.label}
              size="small"
              color={employerFilter === l.evereeTenantId ? 'primary' : 'default'}
              variant={employerFilter === l.evereeTenantId ? 'filled' : 'outlined'}
              onClick={() => setEmployerFilter(l.evereeTenantId)}
            />
          ))}
        </Stack>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : filteredRows.length === 0 ? (
        <Alert severity="info">{t('earnings.noPayments')}</Alert>
      ) : (
        <Card variant="outlined">
          <Stack divider={<Divider />}>
            {filteredRows.map((r) => (
              <Stack
                key={r.statementId}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                spacing={1}
                sx={{ px: 2, py: 1.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                onClick={() =>
                  navigate(
                    `/c1/workers/pay-history/${encodeURIComponent(r.evereeTenantId)}/${encodeURIComponent(r.statementId)}`,
                  )
                }
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body1" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {r.net != null ? USD.format(r.net) : r.gross != null ? USD.format(r.gross) : '—'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap display="block">
                    {[
                      r.payDate,
                      r.employerLabel,
                      // Workers reconcile against their bank, so net leads; show
                      // gross only when it actually differs (2026-08-28).
                      r.net != null && r.gross != null && r.net !== r.gross
                        ? `${t('earnings.grossShort')} ${USD.format(r.gross)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </Box>
                {statusChip(t, r.status)}
              </Stack>
            ))}
          </Stack>
        </Card>
      )}
    </Box>
  );
};

export default WorkerPayHistoryPage;
