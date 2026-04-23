/**
 * EvereeMyPayPanel — worker-facing "My Pay" surface (HRX Everee Master Plan §7).
 *
 * Shows historical pay statements sourced from Everee via the backend callables
 * `evereeGetPayHistory` and `evereeGetPayStatement`. Statement PDFs come back as
 * short-lived signed URLs — they are opened in a new tab and never cached
 * client-side (PII, HIPAA-adjacent).
 *
 * Transport differences vs. the onboarding embed:
 *   - No iframe / MessagePort. Everee does not ship a first-party "my pay"
 *     embed; we proxy the REST data through our backend so the UI can keep
 *     the HRX look-and-feel consistent and so we can enforce role checks
 *     (`canSelfOrManageEveree`).
 *   - Statements are fetched on-demand. History is fetched once per mount
 *     and can be reloaded via a "Refresh" button.
 *
 * Flutter parity — `lib/features/employment/presentation/widgets/
 * everee_my_pay_sheet.dart` renders an identical list + detail flow on mobile.
 *
 * Backend shape normalization
 * ---------------------------
 * The HRX backend currently stubs out these endpoints. The service layer
 * (`functions/src/integrations/everee/evereeService.ts`) returns
 * `EvereePayHistoryItem[]` with Everee's original field names (`id`,
 * `payPeriodStart`, `payPeriodEnd`, `grossPay`, `netPay`). The web callable
 * types in `services/everee/evereeCallables.ts` declare the richer
 * `{ items, nextCursor }` envelope + normalized field names (`statementId`,
 * `periodStart`, `gross`, `net`). We tolerate both here so this component
 * keeps working through the stub → live transition.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import {
  evereeGetPayHistory,
  evereeGetPayStatement,
  type EvereeGetPayHistoryResult,
  type EvereePayHistoryItem,
  type EvereePayStatement,
} from '../../services/everee/evereeCallables';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';

export interface EvereeMyPayPanelProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  entityId: string;
  /** Omit / leave empty to default to the caller's UID on the backend. */
  userId?: string;
  /** Accessibility / copy override. */
  title?: string;
}

/** Normalized row used by the UI — flattens both backend shapes. */
interface NormalizedPayRow {
  statementId: string;
  periodStart: string | null;
  periodEnd: string | null;
  payDate: string | null;
  gross: number | null;
  net: number | null;
  currency: string | null;
  status: string | null;
}

/** Normalized detail used by the statement drawer. */
interface NormalizedPayStatement extends NormalizedPayRow {
  pdfUrl: string | null;
  earnings: Array<{ label: string; amount: number | null }>;
  deductions: Array<{ label: string; amount: number | null }>;
  taxes: Array<{ label: string; amount: number | null }>;
}

type ListPhase =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'loaded'; rows: NormalizedPayRow[] }
  | { state: 'error'; message: string };

type StatementPhase =
  | { state: 'closed' }
  | { state: 'loading'; statementId: string }
  | { state: 'loaded'; statement: NormalizedPayStatement }
  | { state: 'error'; statementId: string; message: string };

/**
 * Accepts either `{ items: [...] }` or `[...]`. Older callable implementations
 * and the backend stub return a bare array; the typed client declares the
 * envelope. Normalize both here so the UI does not care.
 */
function extractHistoryItems(
  data: EvereeGetPayHistoryResult | EvereePayHistoryItem[] | null | undefined,
): EvereePayHistoryItem[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray((data as EvereeGetPayHistoryResult).items)) {
    return (data as EvereeGetPayHistoryResult).items ?? [];
  }
  return [];
}

/**
 * Tolerant field-name reader. Web type uses camelCase `gross`; backend stub
 * uses `grossPay`. Only returns a number when the value is finite — strips
 * stringified numbers from the sandbox.
 */
function readNumber(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string' && c.trim() !== '') {
      const n = Number(c);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function readString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c.trim();
  }
  return null;
}

function normalizeRow(raw: Record<string, unknown>): NormalizedPayRow {
  return {
    statementId: readString(raw.statementId, raw.id) ?? '',
    periodStart: readString(raw.periodStart, raw.payPeriodStart),
    periodEnd: readString(raw.periodEnd, raw.payPeriodEnd),
    payDate: readString(raw.payDate),
    gross: readNumber(raw.gross, raw.grossPay),
    net: readNumber(raw.net, raw.netPay),
    currency: readString(raw.currency) ?? 'USD',
    status: readString(raw.status),
  };
}

function normalizeStatement(raw: EvereePayStatement | Record<string, unknown> | null | undefined): NormalizedPayStatement | null {
  if (!raw || typeof raw !== 'object') return null;
  const base = normalizeRow(raw as Record<string, unknown>);
  if (!base.statementId) return null;
  const earnings = Array.isArray((raw as Record<string, unknown>).earnings)
    ? ((raw as Record<string, unknown>).earnings as Array<Record<string, unknown>>).map((e) => ({
        label: readString(e.label, e.name) ?? '',
        amount: readNumber(e.amount, e.value),
      }))
    : [];
  const deductions = Array.isArray((raw as Record<string, unknown>).deductions)
    ? ((raw as Record<string, unknown>).deductions as Array<Record<string, unknown>>).map((e) => ({
        label: readString(e.label, e.name) ?? '',
        amount: readNumber(e.amount, e.value),
      }))
    : [];
  const taxes = Array.isArray((raw as Record<string, unknown>).taxes)
    ? ((raw as Record<string, unknown>).taxes as Array<Record<string, unknown>>).map((e) => ({
        label: readString(e.label, e.name) ?? '',
        amount: readNumber(e.amount, e.value),
      }))
    : [];
  return {
    ...base,
    pdfUrl: readString(
      (raw as Record<string, unknown>).pdfUrl,
      (raw as Record<string, unknown>).downloadUrl,
    ),
    earnings,
    deductions,
    taxes,
  };
}

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'USD').toUpperCase(),
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Unknown currency code — fall back to bare number.
    return amount.toFixed(2);
  }
}

function formatDate(raw: string | null): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

function formatPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return '—';
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  return formatDate(start ?? end);
}

const EvereeMyPayPanel: React.FC<EvereeMyPayPanelProps> = ({
  open,
  onClose,
  tenantId,
  entityId,
  userId,
  title = 'My Pay',
}) => {
  const [listPhase, setListPhase] = useState<ListPhase>({ state: 'idle' });
  const [stmtPhase, setStmtPhase] = useState<StatementPhase>({ state: 'closed' });

  const loadHistory = useCallback(async () => {
    if (!tenantId || !entityId) {
      setListPhase({ state: 'error', message: 'Missing tenant or entity context.' });
      return;
    }
    setListPhase({ state: 'loading' });
    try {
      const resp = await evereeGetPayHistory({
        tenantId,
        entityId,
        userId: userId?.trim() || undefined,
      });
      const items = extractHistoryItems(resp.data as EvereeGetPayHistoryResult | EvereePayHistoryItem[] | null | undefined);
      const rows = items
        .map((it) => normalizeRow(it as unknown as Record<string, unknown>))
        .filter((r) => r.statementId);
      setListPhase({ state: 'loaded', rows });
    } catch (e: unknown) {
      setListPhase({
        state: 'error',
        message: formatFirebaseHttpsError(e) || 'Could not load pay history.',
      });
    }
  }, [tenantId, entityId, userId]);

  useEffect(() => {
    if (!open) {
      setListPhase({ state: 'idle' });
      setStmtPhase({ state: 'closed' });
      return;
    }
    void loadHistory();
  }, [open, loadHistory]);

  const handleOpenStatement = useCallback(
    async (row: NormalizedPayRow) => {
      if (!row.statementId) return;
      setStmtPhase({ state: 'loading', statementId: row.statementId });
      try {
        const resp = await evereeGetPayStatement({
          tenantId,
          entityId,
          userId: userId?.trim() || undefined,
          statementId: row.statementId,
        });
        const normalized = normalizeStatement(resp.data as EvereePayStatement | null);
        if (!normalized) {
          setStmtPhase({
            state: 'error',
            statementId: row.statementId,
            message: 'Statement is not available.',
          });
          return;
        }
        setStmtPhase({ state: 'loaded', statement: normalized });
      } catch (e: unknown) {
        setStmtPhase({
          state: 'error',
          statementId: row.statementId,
          message: formatFirebaseHttpsError(e) || 'Could not load statement.',
        });
      }
    },
    [tenantId, entityId, userId],
  );

  const closeStatement = useCallback(() => {
    setStmtPhase({ state: 'closed' });
  }, []);

  const listBody = useMemo(() => {
    if (listPhase.state === 'loading') {
      return (
        <Stack alignItems="center" spacing={1.25} sx={{ py: 6 }}>
          <CircularProgress size={28} />
          <Typography variant="body2" color="text.secondary">
            Loading your pay history…
          </Typography>
        </Stack>
      );
    }
    if (listPhase.state === 'error') {
      return (
        <Box sx={{ p: 3 }}>
          <Alert severity="error" sx={{ mb: 2 }}>
            {listPhase.message}
          </Alert>
          <Button variant="outlined" onClick={() => void loadHistory()}>
            Try again
          </Button>
        </Box>
      );
    }
    if (listPhase.state === 'loaded') {
      if (listPhase.rows.length === 0) {
        return (
          <Stack alignItems="center" spacing={1} sx={{ py: 6, textAlign: 'center', px: 3 }}>
            <ReceiptLongIcon color="disabled" sx={{ fontSize: 40 }} />
            <Typography variant="subtitle2">No pay statements yet</Typography>
            <Typography variant="body2" color="text.secondary">
              Once your first payroll run completes, your statements will appear here.
            </Typography>
          </Stack>
        );
      }
      return (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Pay period</TableCell>
              <TableCell>Pay date</TableCell>
              <TableCell align="right">Gross</TableCell>
              <TableCell align="right">Net</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Statement</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {listPhase.rows.map((row) => (
              <TableRow key={row.statementId} hover>
                <TableCell>{formatPeriod(row.periodStart, row.periodEnd)}</TableCell>
                <TableCell>{formatDate(row.payDate)}</TableCell>
                <TableCell align="right">{formatMoney(row.gross, row.currency)}</TableCell>
                <TableCell align="right">{formatMoney(row.net, row.currency)}</TableCell>
                <TableCell sx={{ textTransform: 'capitalize' }}>{row.status ?? '—'}</TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => void handleOpenStatement(row)}
                    sx={{ textTransform: 'none' }}
                    disabled={stmtPhase.state === 'loading' && stmtPhase.statementId === row.statementId}
                  >
                    {stmtPhase.state === 'loading' && stmtPhase.statementId === row.statementId
                      ? 'Opening…'
                      : 'View'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    }
    return null;
  }, [listPhase, loadHistory, stmtPhase, handleOpenStatement]);

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullWidth
        maxWidth="md"
        aria-labelledby="everee-my-pay-title"
        PaperProps={{ sx: { height: { xs: '100%', sm: '85vh' } } }}
      >
        <DialogTitle
          id="everee-my-pay-title"
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}
        >
          <Typography component="span" variant="h6" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <IconButton
              aria-label="refresh"
              onClick={() => void loadHistory()}
              disabled={listPhase.state === 'loading'}
              edge="end"
            >
              <RefreshIcon />
            </IconButton>
            <IconButton aria-label="close" onClick={onClose} edge="end">
              <CloseIcon />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {listBody}
        </DialogContent>
      </Dialog>
      <EvereePayStatementDialog
        phase={stmtPhase}
        onClose={closeStatement}
        onRetry={(statementId) => {
          const row = listPhase.state === 'loaded' ? listPhase.rows.find((r) => r.statementId === statementId) : null;
          if (row) void handleOpenStatement(row);
        }}
      />
    </>
  );
};

interface EvereePayStatementDialogProps {
  phase: StatementPhase;
  onClose: () => void;
  onRetry: (statementId: string) => void;
}

const EvereePayStatementDialog: React.FC<EvereePayStatementDialogProps> = ({ phase, onClose, onRetry }) => {
  const open = phase.state !== 'closed';
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="everee-statement-title">
      <DialogTitle
        id="everee-statement-title"
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}
      >
        <Typography component="span" variant="subtitle1" sx={{ fontWeight: 700 }}>
          Pay statement
        </Typography>
        <IconButton aria-label="close" onClick={onClose} edge="end">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {phase.state === 'loading' ? (
          <Stack alignItems="center" spacing={1.25} sx={{ py: 4 }}>
            <CircularProgress size={24} />
            <Typography variant="body2" color="text.secondary">
              Fetching statement…
            </Typography>
          </Stack>
        ) : null}
        {phase.state === 'error' ? (
          <Stack spacing={2}>
            <Alert severity="error">{phase.message}</Alert>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" onClick={() => onRetry(phase.statementId)}>
                Try again
              </Button>
              <Button onClick={onClose}>Close</Button>
            </Stack>
          </Stack>
        ) : null}
        {phase.state === 'loaded' ? <EvereePayStatementBody statement={phase.statement} /> : null}
      </DialogContent>
    </Dialog>
  );
};

const EvereePayStatementBody: React.FC<{ statement: NormalizedPayStatement }> = ({ statement }) => {
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="overline" color="text.secondary">
          Pay period
        </Typography>
        <Typography variant="body1">{formatPeriod(statement.periodStart, statement.periodEnd)}</Typography>
      </Box>
      <Stack direction="row" spacing={3}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Pay date
          </Typography>
          <Typography variant="body1">{formatDate(statement.payDate)}</Typography>
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Status
          </Typography>
          <Typography variant="body1" sx={{ textTransform: 'capitalize' }}>
            {statement.status ?? '—'}
          </Typography>
        </Box>
      </Stack>
      <Divider />
      <Stack direction="row" spacing={3}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Gross
          </Typography>
          <Typography variant="h6">{formatMoney(statement.gross, statement.currency)}</Typography>
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Net
          </Typography>
          <Typography variant="h6">{formatMoney(statement.net, statement.currency)}</Typography>
        </Box>
      </Stack>

      {statement.earnings.length > 0 ? (
        <DetailGroup title="Earnings" items={statement.earnings} currency={statement.currency} />
      ) : null}
      {statement.deductions.length > 0 ? (
        <DetailGroup title="Deductions" items={statement.deductions} currency={statement.currency} />
      ) : null}
      {statement.taxes.length > 0 ? (
        <DetailGroup title="Taxes" items={statement.taxes} currency={statement.currency} />
      ) : null}

      {statement.pdfUrl ? (
        <Box>
          <Link
            href={statement.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            <OpenInNewIcon fontSize="small" />
            Open PDF statement
          </Link>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Link is short-lived and tied to your account — do not share.
          </Typography>
        </Box>
      ) : (
        <Alert severity="info" variant="outlined">
          PDF for this statement is not available right now. Try again later.
        </Alert>
      )}
    </Stack>
  );
};

const DetailGroup: React.FC<{
  title: string;
  items: Array<{ label: string; amount: number | null }>;
  currency: string | null;
}> = ({ title, items, currency }) => {
  if (items.length === 0) return null;
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        {title}
      </Typography>
      <Stack spacing={0.25}>
        {items.map((it, idx) => (
          <Stack key={`${it.label}-${idx}`} direction="row" justifyContent="space-between">
            <Typography variant="body2">{it.label || '—'}</Typography>
            <Typography variant="body2">{formatMoney(it.amount, currency)}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
};

export default EvereeMyPayPanel;
