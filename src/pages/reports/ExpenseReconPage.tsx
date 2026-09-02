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
  Snackbar,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
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
  cardholder: string; last4: string; source: 'card' | 'bank' | 'journal';
  cls?: string; descriptor?: string;
  suggestedAccount?: string; suggestionPct?: number; suggestionUses?: number;
}
interface RuleRow { id: string; pattern: string; account: string; class?: string | null; matchDescriptor?: boolean; minAgeDays?: number; cardholder?: string; minAmount?: number; maxAmount?: number; overwriteClass?: boolean }
interface CategorizedRow {
  purchaseId: string; lineId: string; descriptor?: string;
  date: string; merchant: string; amount: number; account: string; cls: string;
  cardholder: string; source: string;
}
interface ReconData {
  rows: ReconRow[]; categorized: CategorizedRow[]; rules: RuleRow[]; expenseAccounts: string[]; classes?: string[]; uncategorizedTotal: number; categorizedTotal?: number;
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
  const [ruleDialog, setRuleDialog] = useState<{ pattern: string; account: string; cls: string; matchDescriptor: boolean; recat: boolean } | null>(null);
  const [acctSaved, setAcctSaved] = useState<Record<string, string>>({});
  const [catSearch, setCatSearch] = useState('');
  const [acctSaving, setAcctSaving] = useState<Record<string, boolean>>({});
  // class edits, keyed purchaseId (uncategorized) or purchaseId:lineId (categorized)
  const [clsSaved, setClsSaved] = useState<Record<string, string>>({});
  const [clsSaving, setClsSaving] = useState<Record<string, boolean>>({});
  const [ruleBusy, setRuleBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyNote, setApplyNote] = useState<string | null>(null);
  // toast after a rule is created: apply it to all matching rows in place
  // (the timesheet-layout pattern — Greg 2026-09-02)
  const [ruleToast, setRuleToast] = useState<{ pattern: string; count: number } | null>(null);

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

  const categorize = async (row: ReconRow, explicitAccount?: string): Promise<void> => {
    if (!tenantId) return;
    const account = explicitAccount || picks[row.purchaseId] || row.suggestedAccount;
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

  const setAccount = async (key: string, purchaseId: string, accountName: string, lineId?: string): Promise<void> => {
    if (!tenantId || !accountName) return;
    setAcctSaving((s0) => ({ ...s0, [key]: true }));
    try {
      await call({ tenantId, action: 'setExpenseAccount', purchaseId, account: accountName, lineId }, 60000);
      setAcctSaved((s0) => ({ ...s0, [key]: accountName }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAcctSaving((s0) => ({ ...s0, [key]: false }));
    }
  };

  const setClass = async (key: string, purchaseId: string, className: string, lineId?: string): Promise<void> => {
    if (!tenantId || !className) return;
    setClsSaving((s0) => ({ ...s0, [key]: true }));
    try {
      await call({ tenantId, action: 'setExpenseClass', purchaseId, class: className, lineId }, 60000);
      setClsSaved((s0) => ({ ...s0, [key]: className }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClsSaving((s0) => ({ ...s0, [key]: false }));
    }
  };

  const saveRule = async (): Promise<void> => {
    if (!tenantId || !ruleDialog?.pattern || !ruleDialog.account) return;
    setRuleBusy(true);
    try {
      const pattern = ruleDialog.pattern;
      const account = ruleDialog.account;
      const matchDescriptor = ruleDialog.matchDescriptor;
      await call({ tenantId, action: 'saveMerchantRule', pattern, account, class: ruleDialog.cls || undefined, matchDescriptor }, 30000);
      setRuleDialog(null);
      // Saving a rule applies it right away and greys the matching rows —
      // no second click (Greg 2026-09-02: "it should automatically apply
      // and save the row").
      const recat = ruleDialog.recat;
      const live = await call({ tenantId, action: 'applyMerchantRulesNow', dryRun: false, pattern, ignoreMinAge: true, recategorize: recat });
      const count = Number((live.data as { applied: number }).applied) || 0;
      markRuleApplied(pattern, matchDescriptor, account, recat);
      setRuleToast({ pattern, count });
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

  const matchesPattern = (merchant: string, pattern: string): boolean => {
    const pat = pattern.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${pat}([^a-z0-9]|$)`).test(merchant.toLowerCase());
  };
  const ruleHits = (merchant: string, descriptor: string | undefined, pattern: string, matchDescriptor: boolean): boolean =>
    matchesPattern(merchant, pattern) || (matchDescriptor && matchesPattern(descriptor ?? '', pattern));

  // mark rows/lines in place after a rule apply — no refresh
  const markRuleApplied = (pattern: string, matchDescriptor: boolean, account: string, recat: boolean): void => {
    setDone((d) => {
      const next = { ...d };
      for (const r of data?.rows ?? []) {
        if (!next[r.purchaseId] && ruleHits(r.merchant, r.descriptor, pattern, matchDescriptor)) next[r.purchaseId] = account;
      }
      return next;
    });
    if (recat) {
      setAcctSaved((a) => {
        const next = { ...a };
        for (let i = 0; i < (data?.categorized ?? []).length; i += 1) {
          const c = (data?.categorized ?? [])[i];
          const key = `${c.purchaseId}:${c.lineId || i}`;
          if (ruleHits(c.merchant, c.descriptor, pattern, matchDescriptor)) next[key] = account;
        }
        return next;
      });
    }
  };

  const applyExistingRule = async (rule: RuleRow): Promise<void> => {
    if (!tenantId) return;
    setApplying(true);
    try {
      const dry = await call({ tenantId, action: 'applyMerchantRulesNow', dryRun: true, pattern: rule.pattern, ignoreMinAge: true, recategorize: true });
      const n = Number((dry.data as { applied: number }).applied) || 0;
      if (n === 0) { setApplyNote(`Rule "${rule.pattern}" matches nothing to change.`); return; }
      if (!window.confirm(`Rule "${rule.pattern}" would update ${n} transaction(s) — INCLUDING already-categorized ones — to ${rule.account}. Apply?`)) return;
      await call({ tenantId, action: 'applyMerchantRulesNow', dryRun: false, pattern: rule.pattern, ignoreMinAge: true, recategorize: true });
      markRuleApplied(rule.pattern, rule.matchDescriptor === true, rule.account, true);
      setApplyNote(`Rule "${rule.pattern}" applied to ${n} transaction(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const pending = useMemo(() => (data ? data.rows.filter((r) => !done[r.purchaseId]) : []), [data, done]);
  const filteredCategorized = useMemo(() => {
    const list = data?.categorized ?? [];
    const q = catSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c, i) => {
      const key = `${c.purchaseId}:${c.lineId || i}`;
      const acct = acctSaved[key] ?? c.account;
      const cls = clsSaved[key] ?? c.cls;
      return [c.merchant, c.descriptor, c.cardholder, acct, cls, c.date, String(c.amount)]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [data, catSearch, acctSaved, clsSaved]);
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
            <Tab label={`Categorized (${data.categorizedTotal ?? data.categorized?.length ?? 0})`} />
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
                    <TableCell sx={{ minWidth: 220 }}>Class</TableCell>
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
                          {r.descriptor && (
                            <Typography variant="caption" color="text.secondary" noWrap component="div" sx={{ maxWidth: 460 }}>
                              {r.descriptor.slice(0, 120)}
                            </Typography>
                          )}
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
                              disabled={saving[r.purchaseId]}
                              onChange={(_, v) => {
                                setPicks((p) => ({ ...p, [r.purchaseId]: v ?? '' }));
                                // Picking an account saves immediately (Greg
                                // 2026-09-02); Save stays for accepting the
                                // pre-filled suggestion.
                                if (v) void categorize(r, v);
                              }}
                              renderInput={(params) => <TextField {...params} placeholder="Pick account…" />}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <Autocomplete
                            size="small"
                            options={data.classes ?? []}
                            value={clsSaved[r.purchaseId] ?? (r.cls || null)}
                            disabled={clsSaving[r.purchaseId]}
                            onChange={(_, v) => { if (v) void setClass(r.purchaseId, r.purchaseId, v); }}
                            renderInput={(params) => <TextField {...params} placeholder="Class…" />}
                          />
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
                                    cls: clsSaved[r.purchaseId] ?? r.cls ?? '',
                                    matchDescriptor: false, recat: false,
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
            {(data.categorizedTotal ?? 0) > (data.categorized?.length ?? 0) && (
              <Alert severity="info" sx={{ mb: 1 }}>
                Showing the {data.categorized.length.toLocaleString()} most recent of{' '}
                {(data.categorizedTotal ?? 0).toLocaleString()} categorized lines in this range — narrow the
                dates to see the rest.
              </Alert>
            )}
            <TextField
              size="small" fullWidth placeholder="Search merchant, descriptor, who, account, class…"
              value={catSearch} onChange={(e) => setCatSearch(e.target.value)} sx={{ mb: 1 }}
            />
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Merchant</TableCell>
                    <TableCell>Who / source</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell>Account</TableCell>
                    <TableCell>Class</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredCategorized.map((c, i) => {
                    const key = `${c.purchaseId}:${c.lineId || i}`;
                    return (
                      <TableRow key={key + c.date}>
                        <TableCell>{c.date}</TableCell>
                        <TableCell>
                          {c.merchant}
                          {c.descriptor && (
                            <Typography variant="caption" color="text.secondary" noWrap component="div" sx={{ maxWidth: 420 }}>
                              {c.descriptor.slice(0, 120)}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>{c.cardholder || '—'} <Chip size="small" label={c.source} /></TableCell>
                        <TableCell align="right">{usd(c.amount)}</TableCell>
                        <TableCell sx={{ minWidth: 260 }}>
                          <Autocomplete
                            size="small"
                            options={data.expenseAccounts}
                            value={acctSaved[key] ?? (c.account || null)}
                            disabled={acctSaving[key]}
                            onChange={(_, v) => { if (v) void setAccount(key, c.purchaseId, v, c.lineId); }}
                            renderInput={(params) => <TextField {...params} placeholder="Account…" />}
                          />
                        </TableCell>
                        <TableCell sx={{ minWidth: 220 }}>
                          <Autocomplete
                            size="small"
                            options={data.classes ?? []}
                            value={clsSaved[key] ?? (c.cls || null)}
                            disabled={clsSaving[key]}
                            onChange={(_, v) => { if (v) void setClass(key, c.purchaseId, v, c.lineId); }}
                            renderInput={(params) => <TextField {...params} placeholder="Class…" />}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            size="small"
                            onClick={() =>
                              setRuleDialog({
                                pattern: c.merchant.toLowerCase(),
                                account: acctSaved[key] ?? c.account ?? '',
                                cls: clsSaved[key] ?? c.cls ?? '',
                                matchDescriptor: false, recat: true,
                              })
                            }
                          >
                            Rule…
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            </>
          )}

          {tab === 2 && (
            <>
              <Stack direction="row" spacing={2} sx={{ mb: 1 }}>
                <Button variant="outlined" onClick={() => setRuleDialog({ pattern: '', account: '', cls: '', matchDescriptor: false, recat: false })}>
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
                      <TableCell>Class</TableCell>
                      <TableCell>Min age (days)</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.rules.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          {r.pattern} {r.matchDescriptor && <Chip size="small" variant="outlined" label="descriptor" />}
                          {r.cardholder && <Chip size="small" variant="outlined" label={`card: ${r.cardholder}`} />}{' '}
                          {r.minAmount != null && <Chip size="small" variant="outlined" label={`> ${usd(Number(r.minAmount) - 0.01)}`} />}{' '}
                          {r.maxAmount != null && <Chip size="small" variant="outlined" label={`≤ ${usd(r.maxAmount)}`} />}
                        </TableCell>
                        <TableCell>{r.account}</TableCell>
                        <TableCell>{r.class || '—'}</TableCell>
                        <TableCell>{r.minAgeDays ?? 7}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Button size="small" disabled={applying} onClick={() => void applyExistingRule(r)}>
                              Apply…
                            </Button>
                            <IconButton size="small" onClick={() => void deleteRule(r.id, r.pattern, r.account)}>
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Stack>
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

      <Snackbar
        open={Boolean(ruleToast)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        onClose={() => setRuleToast(null)}
        autoHideDuration={6000}
        message={ruleToast ? `Rule "${ruleToast.pattern}" saved — applied to ${ruleToast.count} transaction(s) in QBO.` : ''}
      />
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
            <Autocomplete
              options={data?.classes ?? []}
              value={ruleDialog?.cls || null}
              onChange={(_, v) => setRuleDialog((d) => (d ? { ...d, cls: v ?? '' } : d))}
              renderInput={(params) => <TextField {...params} label="Class (optional)" />}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={ruleDialog?.matchDescriptor ?? false}
                  onChange={(e) => setRuleDialog((d) => (d ? { ...d, matchDescriptor: e.target.checked } : d))}
                />
              }
              label='Also match the full bank descriptor — for merchants that parse identically (e.g. "google workspace" vs "google cloud", both shown as Google)'
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={ruleDialog?.recat ?? false}
                  onChange={(e) => setRuleDialog((d) => (d ? { ...d, recat: e.target.checked } : d))}
                />
              }
              label="Also recategorize matching expenses that are ALREADY categorized (not just uncategorized ones)"
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
