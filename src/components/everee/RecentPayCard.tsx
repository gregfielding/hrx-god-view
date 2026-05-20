/**
 * **RecentPayCard** — recruiter-facing "Recent Pay" surface on the
 * user profile Overview tab.
 *
 * Answers the everyday question "where's my last paycheck?" without
 * the recruiter needing to log into Everee. Shows up to 3 most-recent
 * pay-run summary rows with color-coded status chips and a "View all"
 * button that opens the existing `EvereeMyPayPanel` for full history
 * + statement detail.
 *
 * **Multi-entity handling.** A worker can have employment relationships
 * with multiple C1 entities (Select / Events / Workforce). For v1 the
 * card picks the first Everee-enabled entity the worker has an
 * employment record on. When multi-entity becomes common we can swap
 * in an entity chip selector at the top.
 *
 * **Gating.** Visibility is controlled by the parent (Overview tab
 * passes the prop). The server-side callable enforces
 * `canSelfOrManageEveree` so even if a non-recruiter saw the card,
 * the call would fail with permission-denied.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PaymentsIcon from '@mui/icons-material/Payments';

import EvereeMyPayPanel from './EvereeMyPayPanel';
import { useAuth } from '../../contexts/AuthContext';
import { useEntityEmploymentOverview } from '../../hooks/useEntityEmploymentOverview';
import {
  evereeGetPayHistory,
  type EvereePayHistoryItem,
} from '../../services/everee/evereeCallables';

export interface RecentPayCardProps {
  /** uid of the user being viewed. */
  uid: string;
  /** Override the per-page limit. Defaults to 3. */
  limit?: number;
}

interface ResolvedEntity {
  entityId: string;
  entityLabel: string;
}

const RecentPayCard: React.FC<RecentPayCardProps> = ({ uid, limit = 3 }) => {
  const { tenantId } = useAuth();
  const { byEntityKey, loading: employmentLoading } = useEntityEmploymentOverview({
    userId: uid,
    tenantId,
  });

  // Pick first Everee-enabled entity the worker has employment on.
  const entity = useMemo<ResolvedEntity | null>(() => {
    if (!byEntityKey) return null;
    for (const key of ['select', 'events', 'workforce'] as const) {
      const overview = byEntityKey[key];
      const settings = overview?.entitySettings;
      const entityId = settings?.entityFirestoreId;
      const evereeOn = settings?.evereeEnabled === true;
      const hasEmployment = Boolean(overview?.entityEmployment);
      if (entityId && evereeOn && hasEmployment) {
        return { entityId, entityLabel: settings?.entityName || overview.headerEntityName || entityId };
      }
    }
    return null;
  }, [byEntityKey]);

  const [items, setItems] = useState<EvereePayHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (!tenantId || !entity?.entityId || !uid) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await evereeGetPayHistory({
          tenantId,
          entityId: entity.entityId,
          userId: uid,
        });
        if (cancelled) return;
        const list = res.data?.items ?? [];
        setItems(list.slice(0, limit));
      } catch (e: unknown) {
        if (cancelled) return;
        const code = (e as { code?: string })?.code ?? '';
        // Don't show permission-denied as a scary banner — just hide.
        if (code === 'functions/permission-denied' || code === 'permission-denied') {
          setError(null);
          setItems([]);
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, entity?.entityId, uid, limit]);

  // Layout shell — always render the card so the recruiter knows where
  // to look. Inner content varies with state.
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: 2,
        backgroundColor: 'background.paper',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
        <PaymentsIcon fontSize="small" color="action" />
        <Typography variant="subtitle2" fontWeight={700}>
          Recent Pay
        </Typography>
        {entity && (
          <Chip
            label={entity.entityLabel}
            size="small"
            variant="outlined"
            sx={{ ml: 0.5 }}
          />
        )}
        <Box flex={1} />
        {entity && items.length > 0 && (
          <Button
            size="small"
            endIcon={<OpenInNewIcon fontSize="small" />}
            onClick={() => setPanelOpen(true)}
          >
            View all
          </Button>
        )}
      </Stack>

      {/* Body */}
      {(employmentLoading || loading) && (
        <Stack spacing={1}>
          <Skeleton variant="rectangular" height={40} />
          <Skeleton variant="rectangular" height={40} />
          <Skeleton variant="rectangular" height={40} />
        </Stack>
      )}

      {!employmentLoading && !entity && (
        <Typography variant="body2" color="text.secondary">
          No Everee-enabled employment found for this worker.
        </Typography>
      )}

      {error && (
        <Alert severity="warning" sx={{ mt: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!loading && !error && entity && items.length === 0 && (
        <Box
          sx={{
            p: 2,
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 1,
            textAlign: 'center',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            No pay history yet. New pay runs appear here once the first batch is submitted to Everee.
          </Typography>
        </Box>
      )}

      {!loading && items.length > 0 && (
        <Stack spacing={1} divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
          {items.map((item) => (
            <PayRow key={item.statementId} item={item} />
          ))}
        </Stack>
      )}

      {/* Full panel for "View all" */}
      {entity && (
        <EvereeMyPayPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          tenantId={tenantId || ''}
          entityId={entity.entityId}
          userId={uid}
          title={`Pay history — ${entity.entityLabel}`}
        />
      )}
    </Box>
  );
};

export default RecentPayCard;

// ─────────────────────────────────────────────────────────────────────
// Per-row rendering
// ─────────────────────────────────────────────────────────────────────

interface PayRowProps {
  item: EvereePayHistoryItem;
}

const PayRow: React.FC<PayRowProps> = ({ item }) => {
  const dateLabel =
    formatDate(item.payDate) ??
    formatDate(item.periodEnd) ??
    'Pending';
  const periodLabel = formatPeriod(item.periodStart, item.periodEnd);
  const amount = item.gross ?? item.net ?? 0;
  const currency = item.currency || 'USD';

  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ py: 0.5 }}>
      <Box sx={{ minWidth: 90 }}>
        <Typography variant="body2" fontWeight={600}>
          {dateLabel}
        </Typography>
        {periodLabel && (
          <Typography variant="caption" color="text.secondary">
            {periodLabel}
          </Typography>
        )}
      </Box>
      <Box flex={1}>
        <Typography variant="body2" fontWeight={600}>
          {formatMoney(amount, currency)}
        </Typography>
      </Box>
      <StatusChip status={item.status ?? null} />
    </Stack>
  );
};

const StatusChip: React.FC<{ status: string | null }> = ({ status }) => {
  if (!status) return <Chip label="—" size="small" variant="outlined" />;
  const upper = status.toUpperCase();
  const color: 'default' | 'success' | 'warning' | 'error' | 'info' =
    upper === 'PAID'
      ? 'success'
      : upper === 'ERROR' || upper === 'RETURNED' || upper === 'UNPAYABLE_WORKER'
        ? 'error'
        : upper === 'SUBMITTED' || upper === 'IN_PROGRESS' || upper === 'SCHEDULED'
          ? 'info'
          : upper === 'PENDING'
            ? 'warning'
            : 'default';
  return <Chip label={prettify(upper)} size="small" color={color} variant="outlined" />;
};

// ─────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatPeriod(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string | null {
  const s = formatDate(startIso);
  const e = formatDate(endIso);
  if (!s || !e) return s || e || null;
  if (s === e) return s;
  return `${s} – ${e}`;
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function prettify(status: string): string {
  // PAID → "Paid", IN_PROGRESS → "In progress", UNPAYABLE_WORKER → "Unpayable"
  if (status === 'UNPAYABLE_WORKER') return 'Unpayable';
  return status
    .split('_')
    .map((word, i) =>
      i === 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase(),
    )
    .join(' ');
}
