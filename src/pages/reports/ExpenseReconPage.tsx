/**
 * /reports/expense-recon — Expense Reconciliation (Greg 2026-09-02):
 * every QBO purchase line still on Uncategorized Expense, with a
 * history-mined suggestion, inline categorize (one-offs / checking-paid),
 * one-click "make this a rule", and the merchant-rule table with a
 * dry-run apply. Rules live in tenants/{t}/qbo_merchant_rules and run
 * daily after the Expensify write-back — only ever touching lines still
 * uncategorized, 7+ days old.
 */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
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
  IconButton,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RuleOutlinedIcon from '@mui/icons-material/RuleOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import PageHeader from '../../components/PageHeader';

const usd = (n: unknown): string =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface ReconRow {
  purchaseId: string; date: string; merchant: string; amount: number;
  cardholder: string; last4: string; source: 'card' | 'bank';
  suggestedAccount?: string; suggestionPct?: number; suggestionUses?: number;
}
interface RuleRow { id: string; pattern: string; account: string; class?: string | null; minAgeDays?: number }
interface ReconData {
  rows: ReconRow[]; rules: RuleRow[]; expenseAccounts: string[]; uncategorizedTotal: number;
}

const ExpenseReconPage: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const [startDate, setStartDate] = useState('2026-06-01');
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReconData | null>(null);
  const [tab, setTab] = useState(0);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<Record<string, string>>({});
  const [ruleDialog, setRuleDialog] = useState<{ pattern: string; account: string } | null>(null);
  const [ruleBusy, setRuleBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyNote, setApplyNote] = useState<string | null>(null);

  const call = (payload: Record<string, unknown>, timeout = 540000) =>
    httpsCallable(functions, 'savePayrollVenueMapping', { timeout })(payload);

  const load = async (): Promise<void> => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await call({ tenantId, action: 'expenseReconReport', startDate, endDate });
      setData(res.data as ReconData);
      setPicks({});
      setDone({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const categorize = async (row: ReconRow): Promise<void> => {
    if (!tenantId) return;
    const account = picks[row.purchaseId] || row.suggestedAccount;
    if (!account) return;
    setSaving((s) => ({ ...s, [row.purchaseId]: true }));
    try {
      await call({ tenantId, action: 'categorizePurchase', purchaseId: row.purchaseId, account }, 60000);
      setDone((d) => ({ ...d, [row.purchaseId]: account }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving((s) => ({ ...s, [row.purchaseId]: false }));
    }
  };

  const saveRule = async (): Promise<void> => {
    if (!tenantId || !ruleDialog?.pattern || !ruleDialog.account) return;
    setRuleBusy(true);
    try {
      await call({ tenantId, action: 'saveMerchantRule', pattern: ruleDialog.pattern, account: ruleDialog.account }, 30000);
      setRuleDialog(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRuleBusy(false);
    }
  };

  const deleteRule = async (id: string, pattern: string, account: string): Promise<void> => {
    if (!tenantId) return;
    try {
      await call({ tenantId, action: 'saveMerchantRule', id, pattern, account, delete: true }, 30000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const applyRules = async (): Promise<void> => {
    if (!tenantId) return;
    setApplying(true);
    setApplyNote(null);
    try {
      const dry = await call({ tenantId, action: 'applyMerchantRulesNow', dryRun: true });
      const d = dry.data as { applied: number };
      if (d.applied === 0) {
        setApplyNote('Rules matched nothing new.');
        return;
      }
      if (!window.confirm(`Rules would categorize ${d.applied} purchase(s). Apply now?`)) return;
      const live = await call({ tenantId, action: 'applyMerchantRulesNow', dryRun: false });
      setApplyNote(`Applied to ${(live.data as { applied: number }).applied} purchase(s).`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const pending = useMemo(() => (data ? data.rows.filter((r) => !done[r.purchaseId]) : []), [data, done]);
  const cardTotal = useMemo(() => pending.filter((r) => r.source === 'card').reduce((s, r) => s + r.amount, 0), [pending]);
  const bankTotal = useMemo(() => pending.filter((r) => r.source === 'bank').reduce((s, r) => s + r.amount, 0), [pending]);

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <IconButton onClick={() => navigate('/reports')} size="small">
          <ArrowBackIcon />
        </IconButton>
        <RuleOutlinedIcon color="primary" />
        <PageHeader title="Expense Reconciliation" showDivider={false} />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 900 }}>
        Every purchase still on Uncategorized Expense, with a suggestion mined from how that merchant was
        categorized before. Categorize one-offs inline, or turn a merchant into a standing rule — rules run
        every morning after the Expensify write-back and only touch lines nobody has categorized (7+ days old).
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center">
        <TextField
          label="Start" type="date" size="small" value={startDate}
          onChange={(e) => setStartDate(e.target.value)} InputLabelProps={{ shrink: true }}
        />
        <TextField
          label="End" type="date" size="small" value={endDate}
          onChange={(e) => setEndDate(e.target.value)} InputLabelProps={{ shrink: true }}
        />
        <Button variant="contained" onClick={() => void load()} disabled={loading || !tenantId}>
          {loading ? 'Loading…' : 'Load'}
        </Button>
        {loading && <CircularProgress size={22} />}
        {data && (
          <>
            <Chip label={`Card: ${usd(cardTotal)}`} />
            <Chip label={`Checking: ${usd(bankTotal)}`} />
            <Chip color="warning" label={`Total uncategorized: ${usd(cardTotal + bankTotal)}`} />
          </>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {applyNote && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setApplyNote(null)}>
          {applyNote}
        </Alert>
      )}

      {data && (
        <>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1 }}>
            <Tab label={`Uncategorized (${pending.length})`} />
            <Tab label={`Rules (${data.rules.length})`} />
          </Tabs>

          {tab === 0 && (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Merchant</TableCell>
                    <TableCell>Who / source</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell sx={{ minWidth: 280 }}>Account</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.rows.map((r) => {
                    const saved = done[r.purchaseId];
                    return (
                      <TableRow key={r.purchaseId} sx={saved ? { opacity: 0.5 } : undefined}>
                        <TableCell>{r.date}</TableCell>
                        <TableCell>
                          {r.merchant}{' '}
                          {r.suggestedAccount && !saved && (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={`usually ${r.suggestedAccount} (${r.suggestionPct}% of ${r.suggestionUses})`}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {r.cardholder || '—'}{' '}
                          <Chip size="small" label={r.source === 'card' ? `•${r.last4 || 'card'}` : 'checking'} />
                        </TableCell>
                        <TableCell align="right">{usd(r.amount)}</TableCell>
                        <TableCell>
                          {saved ? (
                            <Chip size="small" color="success" label={`saved → ${saved}`} />
                          ) : (
                            <Autocomplete
                              size="small"
                              options={data.expenseAccounts}
                              value={picks[r.purchaseId] ?? r.suggestedAccount ?? null}
                              onChange={(_, v) => setPicks((p) => ({ ...p, [r.purchaseId]: v ?? '' }))}
                              renderInput={(params) => <TextField {...params} placeholder="Pick account…" />}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {!saved && (
                            <Stack direction="row" spacing={1}>
                              <Button
                                size="small" variant="outlined"
                                disabled={saving[r.purchaseId] || !(picks[r.purchaseId] || r.suggestedAccount)}
                                onClick={() => void categorize(r)}
                              >
                                {saving[r.purchaseId] ? 'Saving…' : 'Save'}
                              </Button>
                              <Button
                                size="small"
                                onClick={() =>
                                  setRuleDialog({
                                    pattern: r.merchant.toLowerCase(),
                                    account: picks[r.purchaseId] || r.suggestedAccount || '',
                                  })
                                }
                              >
                                Rule…
                              </Button>
                            </Stack>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {tab === 1 && (
            <>
              <Stack direction="row" spacing={2} sx={{ mb: 1 }}>
                <Button variant="outlined" onClick={() => setRuleDialog({ pattern: '', account: '' })}>
                  New rule
                </Button>
                <Button variant="contained" disabled={applying} onClick={() => void applyRules()}>
                  {applying ? 'Applying…' : 'Run rules now (dry-run first)'}
                </Button>
              </Stack>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Merchant pattern</TableCell>
                      <TableCell>Account</TableCell>
                      <TableCell>Min age (days)</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.rules.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.pattern}</TableCell>
                        <TableCell>{r.account}</TableCell>
                        <TableCell>{r.minAgeDays ?? 7}</TableCell>
                        <TableCell>
                          <IconButton size="small" onClick={() => void deleteRule(r.id, r.pattern, r.account)}>
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </>
      )}

      <Dialog open={Boolean(ruleDialog)} onClose={() => setRuleDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>Merchant rule</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Merchant pattern (word match, case-insensitive)"
              value={ruleDialog?.pattern ?? ''}
              onChange={(e) => setRuleDialog((d) => (d ? { ...d, pattern: e.target.value } : d))}
              helperText='Matches the parsed merchant as a whole word — "apple" will not match Applebee&apos;s.'
            />
            <Autocomplete
              options={data?.expenseAccounts ?? []}
              value={ruleDialog?.account || null}
              onChange={(_, v) => setRuleDialog((d) => (d ? { ...d, account: v ?? '' } : d))}
              renderInput={(params) => <TextField {...params} label="Account" />}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRuleDialog(null)}>Cancel</Button>
          <Button variant="contained" disabled={ruleBusy || !ruleDialog?.pattern || !ruleDialog?.account} onClick={() => void saveRule()}>
            {ruleBusy ? 'Saving…' : 'Save rule'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ExpenseReconPage;
