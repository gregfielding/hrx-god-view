/**
 * EmployeePayrollSection — read-only Everee record viewer for the
 * Employment & Payroll tab on User Profile.
 *
 * Renders ONLY when `payrollProvider === 'everee'` AND we already know the
 * worker's `evereeWorkerId` for this Everee tenant — the
 * `EvereeAdminSyncCard` handles the "needs provisioning" case ahead of us.
 *
 * No Firestore caching: every mount fires `evereeAdminGetWorker` +
 * `evereeAdminGetWorkerDocuments` against the live API. PII (SSN last 4,
 * DOB, addresses, bank accounts) is rendered to the screen and discarded
 * on unmount. We never persist it.
 *
 * Permission gate: server uses `canSelfOrManageEveree` — workers can pull
 * their own record, recruiters can pull anyone's. This component renders
 * regardless of viewer kind; the server enforces the actual gate.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Divider,
  Link as MuiLink,
  Skeleton,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SmsIcon from '@mui/icons-material/Sms';

import {
  evereeAdminGetWorker,
  evereeAdminGetWorkerDocuments,
  evereeAdminGetWorkerW4,
  evereeAdminGetWorkerW9,
  evereeSendHostedOnboardingLink,
  type EvereeAdminGetWorkerDocumentsResult,
  type EvereeAdminGetWorkerResult,
  type EvereeAdminGetWorkerTaxFormResult,
  type EvereeWorkerFile,
} from '../../../../services/everee/evereeCallables';
import { assertEvereeWorkerIdMatch } from '../../../../utils/everee/assertEvereeWorkerIdMatch';
import { formatFirebaseHttpsError } from '../../../../utils/firebaseHttpsErrors';
import {
  formatBankAllocation,
  formatDocumentTypeColor,
  formatDocumentTypeLabel,
  formatEvereeAddress,
  formatEvereeShortDate,
  formatEvereeShortDateTime,
  formatTinStatus,
  titleCase,
  type EvereeAddressShape,
  type EvereeWorkerFileDocumentType,
} from '../../../../utils/evereeFormatters';

export interface EmployeePayrollSectionProps {
  tenantId: string;
  entityId: string;
  userId: string;
  evereeTenantId: string;
  evereeWorkerId: string;
  /**
   * Drives nothing visually for now (the server gate is what's enforced),
   * but kept on the props signature so the parent can later vary copy or
   * extra controls per audience without a re-plumb.
   */
  viewerKind: 'worker' | 'recruiter';
}

interface EvereeBankAccount {
  accountName?: string | null;
  bankName?: string | null;
  accountType?: string | null;
  accountNumberLast4?: string | null;
  routingNumber?: string | null;
  ruleAmount?: number | null;
  ruleAmountType?: string | null;
  depositsBlocked?: boolean | null;
  createdAt?: string | null;
  id?: string | null;
}

interface EvereeWorkerResponse {
  workerId?: string | null;
  id?: string | null;
  onboardingStatus?: string | null;
  lifecycleStatus?: string | null;
  employmentType?: string | null;
  hireDate?: string | null;
  legalWorkState?: string | null;
  taxpayerIdentifierLast4?: string | null;
  tinVerificationStatus?: string | null;
  /** Some Everee revisions return this nested under `taxpayerIdentifier`. */
  taxpayerIdentifier?: { last4?: string | null; verificationStatus?: string | null } | null;
  dateOfBirth?: string | null;
  homeAddress?: EvereeAddressShape | null;
  legalWorkAddress?: EvereeAddressShape | null;
  availablePaymentMethods?: { directDeposit?: boolean | null; payCard?: boolean | null } | null;
  preferredPaymentMethod?: string | null;
  bankAccounts?: EvereeBankAccount[] | null;
  /**
   * `false` means the worker hasn't set up an Everee login password yet, so
   * they can't log into Everee directly. Per Everee (Piers, 2026-06-09) the
   * password is created ~halfway through onboarding, at which point this
   * flips to `true`. It is NOT a lock/block/anti-fraud signal — it's the
   * normal state for anyone who hasn't reached the password step.
   *
   * The real onboarding "lock" ("locked due to a possible security risk",
   * e.g. repeated invalid password attempts on an existing account) is a
   * SEPARATE mechanism that this flag does not reflect, and which we have no
   * direct API signal for. The Everee-hosted account-setup link
   * (`evereeSendHostedOnboardingLink`) is the remediation when a worker
   * actually hits that lock screen.
   */
  accountAccessPermitted?: boolean | null;
}

function pickWorker(raw: unknown): EvereeWorkerResponse {
  if (!raw || typeof raw !== 'object') return {};
  // Everee sometimes wraps the worker in `{ worker: {...} }` or `{ data: {...} }`.
  const r = raw as Record<string, unknown>;
  if (r.worker && typeof r.worker === 'object') return r.worker as EvereeWorkerResponse;
  if (r.data && typeof r.data === 'object') return r.data as EvereeWorkerResponse;
  return r as EvereeWorkerResponse;
}

/**
 * `evereeAdminGetWorkerDocuments` already validated `items` is an array on
 * the server. We still defend against drift — Everee occasionally renames
 * fields between sandbox and prod. Anything missing the canonical
 * `documentType` field is bucketed as ONBOARDING (the safest neutral group)
 * rather than dropped, so support can still see the file in the UI.
 */
function normalizeWorkerFile(raw: unknown): EvereeWorkerFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const fileName =
    typeof r.fileName === 'string' && r.fileName.trim() ? r.fileName.trim() : null;
  const downloadUrl =
    typeof r.downloadUrl === 'string' && r.downloadUrl.trim() ? r.downloadUrl.trim() : null;
  if (!fileName || !downloadUrl) return null;
  const dtRaw = String(r.documentType || '').trim().toUpperCase();
  const documentType: EvereeWorkerFileDocumentType =
    dtRaw === 'TAXES' || dtRaw === 'ONBOARDING' || dtRaw === 'POLICY' ? dtRaw : 'ONBOARDING';
  const taxYear =
    typeof r.taxYear === 'string' && r.taxYear.trim()
      ? r.taxYear.trim()
      : typeof r.taxYear === 'number'
        ? String(r.taxYear)
        : undefined;
  return {
    documentType,
    fileName,
    taxYear,
    mimeType: typeof r.mimeType === 'string' ? r.mimeType : '',
    publishedAt: typeof r.publishedAt === 'string' ? r.publishedAt : '',
    downloadUrl,
  };
}

const DOCUMENT_TYPE_RENDER_ORDER: EvereeWorkerFileDocumentType[] = [
  'TAXES',
  'ONBOARDING',
  'POLICY',
];

/**
 * W-9 (1099 contractor) — pull the few fields Everee surfaces on
 * `/w9-info`. Schema has shifted across pilot revisions (camelCase vs
 * SCREAMING_SNAKE on the same payload), so each accessor walks a small
 * candidate list defensively. Anything else is rendered as "—".
 */
interface EvereeW9Display {
  signedAt: string | null;
  effectiveDate: string | null;
  federalTaxClassification: string | null;
  fatcaExempt: boolean | null;
  status: string | null;
}

function unwrapMaybeWrapped(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  for (const key of ['response', 'w9', 'w9Info', 'data', 'result']) {
    const v = r[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return r;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function pickBool(obj: Record<string, unknown>, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'boolean') return v;
  }
  return null;
}

function pickW9Display(raw: unknown): EvereeW9Display {
  const obj = unwrapMaybeWrapped(raw) ?? {};
  return {
    signedAt: pickString(obj, ['signedAt', 'signedDate', 'submittedAt', 'createdAt']),
    effectiveDate: pickString(obj, [
      'effectiveDate',
      'effectiveAt',
      'startDate',
      'taxYearStartDate',
    ]),
    federalTaxClassification: pickString(obj, [
      'federalTaxClassification',
      'taxClassification',
      'classification',
      'businessClassification',
    ]),
    fatcaExempt: pickBool(obj, ['fatcaExempt', 'fatcaExemptionStatus', 'fatca']),
    status: pickString(obj, ['status', 'state', 'formStatus']),
  };
}

interface EvereeW4Display {
  signedAt: string | null;
  effectiveDate: string | null;
  filingStatus: string | null;
  dependentsAmount: string | null;
  additionalWithholding: string | null;
  status: string | null;
}

function pickMoneyish(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    }
  }
  return null;
}

function pickW4Display(raw: unknown): EvereeW4Display {
  const obj = unwrapMaybeWrapped(raw) ?? {};
  return {
    signedAt: pickString(obj, ['signedAt', 'signedDate', 'submittedAt', 'createdAt']),
    effectiveDate: pickString(obj, ['effectiveDate', 'effectiveAt', 'startDate']),
    filingStatus: pickString(obj, ['filingStatus', 'maritalStatus', 'filing_status']),
    dependentsAmount: pickMoneyish(obj, [
      'dependentsAmount',
      'totalDependentsAmount',
      'creditForDependents',
      'dependents',
    ]),
    additionalWithholding: pickMoneyish(obj, [
      'additionalWithholding',
      'extraWithholding',
      'additionalAmount',
    ]),
    status: pickString(obj, ['status', 'state', 'formStatus']),
  };
}

/**
 * Derive the CURRENT/MISSING badge state. Everee returns a `status` field
 * inconsistently across pilot revisions; a successful 200 with a signed
 * timestamp is good enough to call the form "current" — that's what the
 * Everee dashboard does too.
 */
function deriveTaxFormBadge(args: {
  hasResponse: boolean;
  status: string | null;
  signedAt: string | null;
}): { label: 'CURRENT' | 'MISSING'; color: 'success' | 'default' } {
  if (!args.hasResponse) return { label: 'MISSING', color: 'default' };
  const s = String(args.status || '').toUpperCase();
  if (s === 'CURRENT' || s === 'ACTIVE' || s === 'COMPLETE' || s === 'SIGNED') {
    return { label: 'CURRENT', color: 'success' };
  }
  if (args.signedAt) return { label: 'CURRENT', color: 'success' };
  return { label: 'MISSING', color: 'default' };
}

function onboardingChipColor(status: string | null | undefined): {
  color: 'success' | 'warning' | 'default';
  icon: React.ReactNode;
  label: string;
} {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'COMPLETE' || s === 'COMPLETED' || s === 'DONE') {
    return { color: 'success', icon: <CheckCircleIcon fontSize="small" />, label: 'Complete' };
  }
  if (s === 'IN_PROGRESS' || s === 'NEEDS_ACTION' || s === 'PENDING') {
    return {
      color: 'warning',
      icon: <HourglassEmptyIcon fontSize="small" />,
      label: titleCase(s) || 'In progress',
    };
  }
  if (s === 'NOT_STARTED' || !s) {
    return {
      color: 'default',
      icon: <HourglassEmptyIcon fontSize="small" />,
      label: s ? titleCase(s) : 'Not started',
    };
  }
  return { color: 'default', icon: <HourglassEmptyIcon fontSize="small" />, label: titleCase(s) };
}

function formatYesNo(value: boolean | null | undefined, yes: string, no: string): string {
  if (value === true) return yes;
  if (value === false) return no;
  return '—';
}

function LabelValueRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '180px 1fr' },
        rowGap: 0.5,
        columnGap: 2,
        py: 0.5,
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" component="div">
        {children}
      </Typography>
    </Box>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
      {children}
    </Typography>
  );
}

/**
 * Compact card used by the Tax Forms section. One per applicable form (W-9
 * for contractors, W-4 for employees). Status chip ("CURRENT" / "MISSING")
 * lives in the header so the recruiter can scan compliance state without
 * reading every row.
 */
function TaxFormCard({
  title,
  rows,
  badge,
}: {
  title: string;
  rows: Array<{ label: string; value: React.ReactNode }>;
  badge: { label: 'CURRENT' | 'MISSING'; color: 'success' | 'default' };
}) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 1.5 }}>
      <CardHeader
        title={title}
        titleTypographyProps={{ variant: 'subtitle2', fontWeight: 700 }}
        action={<Chip size="small" color={badge.color} label={badge.label} sx={{ mt: 0.5, mr: 0.5 }} />}
        sx={{ pb: 0 }}
      />
      <CardContent sx={{ pt: 1, '&:last-child': { pb: 1.5 } }}>
        <Stack spacing={0}>
          {rows.map((row) => (
            <LabelValueRow key={row.label} label={row.label}>
              {row.value}
            </LabelValueRow>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

const EmployeePayrollSection: React.FC<EmployeePayrollSectionProps> = ({
  tenantId,
  entityId,
  userId,
  evereeTenantId,
  evereeWorkerId,
  viewerKind: _viewerKind,
}) => {
  const [worker, setWorker] = useState<EvereeWorkerResponse | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [workerLoading, setWorkerLoading] = useState<boolean>(true);

  // Hosted-link remediation (May 14 2026 — Andrew Freeman incident).
  // Surfaced when the live Everee record reports `accountAccessPermitted: false`.
  // We don't try to clear the lock from here (Everee admin-only); we send the
  // worker the hosted account-setup URL, which uses a different signing context
  // and consistently bypasses the embed-session lock.
  const [hostedLinkSending, setHostedLinkSending] = useState<boolean>(false);
  const [hostedLinkResult, setHostedLinkResult] = useState<{
    severity: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);
  const [snackbarOpen, setSnackbarOpen] = useState<boolean>(false);

  const [documentsResult, setDocumentsResult] = useState<EvereeAdminGetWorkerDocumentsResult | null>(
    null,
  );
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState<boolean>(true);

  const [w9Result, setW9Result] = useState<EvereeAdminGetWorkerTaxFormResult | null>(null);
  const [w9Loading, setW9Loading] = useState<boolean>(true);
  const [w4Result, setW4Result] = useState<EvereeAdminGetWorkerTaxFormResult | null>(null);
  const [w4Loading, setW4Loading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setWorker(null);
    setWorkerError(null);
    setWorkerLoading(true);
    setDocumentsResult(null);
    setDocumentsError(null);
    setDocumentsLoading(true);
    setW9Result(null);
    setW9Loading(true);
    setW4Result(null);
    setW4Loading(true);

    // Snapshot the (entity × worker) pair this render cycle is fetching for.
    // Every async IIFE below captures *these locals* — not the props directly
    // — so a mid-flight prop change (panel switches between C1 Select and
    // C1 Events) can't have one of the four fetches resolve into the wrong
    // tab. The `cancelled` flag still drops the result, but the assertion
    // also runs first to surface anything weird in the console.
    const requestEvereeWorkerId = evereeWorkerId;
    const requestEntityId = entityId;
    const requestEvereeTenantId = evereeTenantId;
    const requestTenantId = tenantId;

    void (async () => {
      try {
        const res = await evereeAdminGetWorker({
          tenantId: requestTenantId,
          entityId: requestEntityId,
          evereeWorkerId: requestEvereeWorkerId,
          userId,
        });
        if (cancelled) return;
        const data = res.data as EvereeAdminGetWorkerResult;
        assertEvereeWorkerIdMatch({
          expectedEvereeWorkerId: requestEvereeWorkerId,
          serverEchoEvereeWorkerId: data?.evereeWorkerId,
          responseBody: data?.response,
          context: {
            site: 'EmployeePayrollSection.evereeAdminGetWorker',
            tenantId: requestTenantId,
            entityId: requestEntityId,
            evereeTenantId: requestEvereeTenantId,
          },
        });
        setWorker(pickWorker(data?.response));
      } catch (err: unknown) {
        if (cancelled) return;
        const msg =
          formatFirebaseHttpsError(err) ||
          (err instanceof Error ? err.message : 'Could not fetch worker from Everee.');
        setWorkerError(msg);
      } finally {
        if (!cancelled) setWorkerLoading(false);
      }
    })();

    void (async () => {
      try {
        const res = await evereeAdminGetWorkerDocuments({
          tenantId: requestTenantId,
          entityId: requestEntityId,
          evereeWorkerId: requestEvereeWorkerId,
          userId,
        });
        if (cancelled) return;
        const data = res.data as EvereeAdminGetWorkerDocumentsResult;
        assertEvereeWorkerIdMatch({
          expectedEvereeWorkerId: requestEvereeWorkerId,
          serverEchoEvereeWorkerId: data?.evereeWorkerId,
          // Documents endpoint doesn't echo a worker shape — the server-echo
          // check is the meaningful one here. `responseBody` left undefined.
          context: {
            site: 'EmployeePayrollSection.evereeAdminGetWorkerDocuments',
            tenantId: requestTenantId,
            entityId: requestEntityId,
            evereeTenantId: requestEvereeTenantId,
          },
        });
        setDocumentsResult(data);
        if (data?.ok === false && data?.error) {
          setDocumentsError(data.error);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const msg =
          formatFirebaseHttpsError(err) ||
          (err instanceof Error ? err.message : 'Could not fetch files from Everee.');
        setDocumentsError(msg);
      } finally {
        if (!cancelled) setDocumentsLoading(false);
      }
    })();

    void (async () => {
      try {
        const res = await evereeAdminGetWorkerW9({
          tenantId: requestTenantId,
          entityId: requestEntityId,
          evereeWorkerId: requestEvereeWorkerId,
          userId,
        });
        if (cancelled) return;
        const data = res.data as EvereeAdminGetWorkerTaxFormResult;
        // Tax-form callables don't echo `evereeWorkerId` — only the
        // raw response (when `ok === true && applicable === true`)
        // contains anything we can compare. Skip the assertion in the
        // `ok: false` / not-applicable cases.
        if (data && data.ok === true && data.applicable === true) {
          assertEvereeWorkerIdMatch({
            expectedEvereeWorkerId: requestEvereeWorkerId,
            responseBody: data.response,
            context: {
              site: 'EmployeePayrollSection.evereeAdminGetWorkerW9',
              tenantId: requestTenantId,
              entityId: requestEntityId,
              evereeTenantId: requestEvereeTenantId,
            },
          });
        }
        setW9Result(data);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg =
          formatFirebaseHttpsError(err) ||
          (err instanceof Error ? err.message : 'Could not fetch W-9 from Everee.');
        setW9Result({ ok: false, applicable: true, error: msg });
      } finally {
        if (!cancelled) setW9Loading(false);
      }
    })();

    void (async () => {
      try {
        const res = await evereeAdminGetWorkerW4({
          tenantId: requestTenantId,
          entityId: requestEntityId,
          evereeWorkerId: requestEvereeWorkerId,
          userId,
        });
        if (cancelled) return;
        const data = res.data as EvereeAdminGetWorkerTaxFormResult;
        if (data && data.ok === true && data.applicable === true) {
          assertEvereeWorkerIdMatch({
            expectedEvereeWorkerId: requestEvereeWorkerId,
            responseBody: data.response,
            context: {
              site: 'EmployeePayrollSection.evereeAdminGetWorkerW4',
              tenantId: requestTenantId,
              entityId: requestEntityId,
              evereeTenantId: requestEvereeTenantId,
            },
          });
        }
        setW4Result(data);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg =
          formatFirebaseHttpsError(err) ||
          (err instanceof Error ? err.message : 'Could not fetch W-4 from Everee.');
        setW4Result({ ok: false, applicable: true, error: msg });
      } finally {
        if (!cancelled) setW4Loading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, entityId, userId, evereeTenantId, evereeWorkerId]);

  const onboardingChip = useMemo(
    () => onboardingChipColor(worker?.onboardingStatus ?? null),
    [worker?.onboardingStatus],
  );

  const tinDisplay = useMemo(() => {
    const status =
      worker?.tinVerificationStatus ??
      worker?.taxpayerIdentifier?.verificationStatus ??
      null;
    return formatTinStatus(status);
  }, [worker?.tinVerificationStatus, worker?.taxpayerIdentifier?.verificationStatus]);

  const ssnLast4 =
    worker?.taxpayerIdentifierLast4 ??
    worker?.taxpayerIdentifier?.last4 ??
    null;

  const directDeposit = worker?.availablePaymentMethods?.directDeposit ?? null;
  const payCard = worker?.availablePaymentMethods?.payCard ?? null;
  const preferredMethod = worker?.preferredPaymentMethod ?? null;
  const bankAccounts = (worker?.bankAccounts ?? []).filter(
    (b): b is EvereeBankAccount => !!b && typeof b === 'object',
  );

  /**
   * Files grouped by `documentType` for per-section rendering. We keep the
   * incoming order within each group so support sees newest-first when
   * Everee returns sorted; if it doesn't, the publishedAt column makes the
   * intent clear without needing client-side sort.
   */
  const filesByGroup = useMemo<Record<EvereeWorkerFileDocumentType, EvereeWorkerFile[]>>(() => {
    const empty: Record<EvereeWorkerFileDocumentType, EvereeWorkerFile[]> = {
      TAXES: [],
      ONBOARDING: [],
      POLICY: [],
    };
    if (!documentsResult || documentsResult.ok !== true) return empty;
    for (const raw of documentsResult.files ?? []) {
      const f = normalizeWorkerFile(raw);
      if (!f) continue;
      empty[f.documentType].push(f);
    }
    return empty;
  }, [documentsResult]);

  const totalFiles =
    filesByGroup.TAXES.length + filesByGroup.ONBOARDING.length + filesByGroup.POLICY.length;

  const w9Display = useMemo(
    () =>
      w9Result && w9Result.ok ? pickW9Display(w9Result.response) : null,
    [w9Result],
  );
  const w4Display = useMemo(
    () =>
      w4Result && w4Result.ok ? pickW4Display(w4Result.response) : null,
    [w4Result],
  );

  const w9Applicable = w9Result == null ? null : w9Result.applicable;
  const w4Applicable = w4Result == null ? null : w4Result.applicable;
  const taxFormsLoading = w9Loading || w4Loading;
  const showTaxFormsSection =
    taxFormsLoading || w9Applicable === true || w4Applicable === true;

  const w9Error =
    w9Result && w9Result.ok === false && w9Result.applicable === true
      ? w9Result.error
      : null;
  const w4Error =
    w4Result && w4Result.ok === false && w4Result.applicable === true
      ? w4Result.error
      : null;

  /**
   * `accountAccessPermitted === false` does NOT mean the account is locked.
   * Per Everee (Piers, 2026-06-09) it only means the worker hasn't created
   * their Everee login password yet — that happens ~halfway through
   * onboarding, so it's the normal state for anyone who hasn't reached that
   * step. The real onboarding "lock" (security risk, e.g. repeated bad
   * password attempts on an existing account) is a separate mechanism this
   * flag does not reflect. We render a calm informational note + keep the
   * hosted-link escape hatch for workers who DO hit the real lock screen.
   */
  const evereeLoginNotSetUp = worker?.accountAccessPermitted === false;

  const handleSendHostedLink = async () => {
    if (hostedLinkSending) return;
    setHostedLinkSending(true);
    setHostedLinkResult(null);
    try {
      const res = await evereeSendHostedOnboardingLink({
        tenantId,
        entityId,
        userId,
      });
      const data = res?.data;
      if (data?.ok) {
        setHostedLinkResult({
          severity: 'success',
          message: 'Sent a fresh Everee onboarding link to the worker via SMS.',
        });
      } else if (data?.ok === false && data.reason === 'twilio_failed' && data.hostedUrl) {
        // We did mint a URL, just couldn't SMS it. Auto-copy so the admin
        // can paste it elsewhere (Slack, internal note, second SMS).
        try {
          await navigator.clipboard.writeText(data.hostedUrl);
        } catch {
          /* clipboard may be unavailable — admin can still use the link in the alert below */
        }
        setHostedLinkResult({
          severity: 'warning',
          message:
            'Generated a fresh link but the SMS failed. The URL has been copied to your clipboard.',
        });
      } else if (data?.ok === false) {
        const reasonMap: Record<string, string> = {
          user_not_found: 'Worker user record not found.',
          missing_phone: 'Worker has no phone number on file — add one first.',
          invalid_e164: 'Worker phone is not in a valid format.',
        };
        setHostedLinkResult({
          severity: 'error',
          message: reasonMap[data.reason] ?? `Failed: ${data.reason}`,
        });
      } else {
        setHostedLinkResult({
          severity: 'error',
          message: 'Unexpected response from Everee hosted-link callable.',
        });
      }
    } catch (err: unknown) {
      const msg =
        formatFirebaseHttpsError(err) ||
        (err instanceof Error ? err.message : 'Could not send hosted onboarding link.');
      setHostedLinkResult({ severity: 'error', message: msg });
    } finally {
      setHostedLinkSending(false);
      setSnackbarOpen(true);
    }
  };

  return (
    <Card variant="outlined" sx={{ mt: 2 }}>
      <CardHeader
        title="Everee data"
        subheader="Live from Everee — not stored in HRX"
        titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }}
        subheaderTypographyProps={{ variant: 'caption' }}
        action={
          <Chip
            size="small"
            color={onboardingChip.color}
            icon={onboardingChip.icon as React.ReactElement}
            label={onboardingChip.label}
            sx={{ mt: 0.5, mr: 0.5 }}
          />
        }
      />
      <CardContent sx={{ pt: 0 }}>
        {workerError ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            Could not load worker details from Everee — {workerError}
          </Alert>
        ) : null}
        {evereeLoginNotSetUp ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            <AlertTitle>Everee login not set up yet</AlertTitle>
            <Typography variant="body2" sx={{ mb: 1.25 }}>
              <code>accountAccessPermitted</code> is <code>false</code>, which just
              means this worker hasn&apos;t created their Everee login password yet —
              that happens about halfway through onboarding, so it&apos;s normal for
              anyone who hasn&apos;t reached that step. Per Everee (Piers, 2026-06-09),
              this flag does <strong>not</strong> mean the account is locked.
            </Typography>
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              A real onboarding <em>lock</em> is a separate thing — Everee locks an
              onboarding for a possible security risk (e.g. too many failed password
              attempts on an existing account), and we can&apos;t see that from this
              flag. If the worker reports the &quot;onboarding has been locked due to a
              possible security risk&quot; screen, send them the Everee-hosted
              account-setup link below (different signing context). If that screen
              still appears, escalate to{' '}
              <MuiLink href="mailto:support@everee.com">support@everee.com</MuiLink>{' '}
              with worker id <code>{evereeWorkerId}</code>.
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                color="warning"
                size="small"
                startIcon={
                  hostedLinkSending ? (
                    <CircularProgress size={14} color="inherit" />
                  ) : (
                    <SmsIcon fontSize="small" />
                  )
                }
                onClick={handleSendHostedLink}
                disabled={hostedLinkSending}
              >
                {hostedLinkSending ? 'Sending…' : 'Send Everee-hosted link via SMS'}
              </Button>
            </Stack>
          </Alert>
        ) : null}
        <Snackbar
          open={snackbarOpen}
          autoHideDuration={6000}
          onClose={() => setSnackbarOpen(false)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          {hostedLinkResult ? (
            <Alert
              onClose={() => setSnackbarOpen(false)}
              severity={hostedLinkResult.severity}
              variant="filled"
              sx={{ width: '100%' }}
            >
              {hostedLinkResult.message}
            </Alert>
          ) : (
            <span />
          )}
        </Snackbar>
        {workerLoading ? (
          <Stack spacing={1}>
            <Skeleton variant="text" width="40%" />
            <Skeleton variant="rounded" height={28} />
            <Skeleton variant="rounded" height={28} />
            <Skeleton variant="rounded" height={28} />
          </Stack>
        ) : (
          <Stack spacing={2.5}>
            {/* Onboarding */}
            <Box>
              <SectionHeading>Onboarding</SectionHeading>
              <LabelValueRow label="Lifecycle">
                {worker?.lifecycleStatus ? titleCase(worker.lifecycleStatus) : '—'}
              </LabelValueRow>
            </Box>

            <Divider flexItem />

            {/* Employment */}
            <Box>
              <SectionHeading>Employment</SectionHeading>
              <LabelValueRow label="Employment type">
                {worker?.employmentType ? titleCase(worker.employmentType) : '—'}
              </LabelValueRow>
              <LabelValueRow label="Hire date">
                {formatEvereeShortDate(worker?.hireDate ?? null)}
              </LabelValueRow>
              <LabelValueRow label="Legal work state">
                {worker?.legalWorkState ? String(worker.legalWorkState).toUpperCase() : '—'}
              </LabelValueRow>
            </Box>

            <Divider flexItem />

            {/* Identity */}
            <Box>
              <SectionHeading>Identity</SectionHeading>
              <LabelValueRow label="SSN last 4">
                {ssnLast4 ? `•••• ${String(ssnLast4).trim()}` : '—'}
              </LabelValueRow>
              <LabelValueRow label="TIN verification">
                <Chip
                  size="small"
                  color={tinDisplay.color}
                  label={tinDisplay.label}
                  icon={
                    tinDisplay.color === 'success' ? (
                      <CheckCircleIcon fontSize="small" />
                    ) : tinDisplay.color === 'error' ? (
                      <ErrorIcon fontSize="small" />
                    ) : tinDisplay.color === 'info' ? (
                      // E.4 — SENT_FOR_VERIFICATION ("Submitted to IRS") gets
                      // its own animated-feeling hourglass to read as
                      // in-progress rather than collapsing into the neutral
                      // pre-submission state.
                      <HourglassTopIcon fontSize="small" />
                    ) : undefined
                  }
                />
              </LabelValueRow>
              <LabelValueRow label="Date of birth">
                {formatEvereeShortDate(worker?.dateOfBirth ?? null)}
              </LabelValueRow>
            </Box>

            <Divider flexItem />

            {/* Addresses */}
            <Box>
              <SectionHeading>Addresses</SectionHeading>
              <LabelValueRow label="Home address">
                {formatEvereeAddress(worker?.homeAddress ?? null)}
              </LabelValueRow>
              <LabelValueRow label="Legal work address">
                {formatEvereeAddress(worker?.legalWorkAddress ?? null)}
              </LabelValueRow>
            </Box>

            <Divider flexItem />

            {/* Pay setup */}
            <Box>
              <SectionHeading>Pay setup</SectionHeading>
              <LabelValueRow label="Direct deposit">
                {formatYesNo(directDeposit, 'Enabled', 'Not set up')}
              </LabelValueRow>
              <LabelValueRow label="Pay card">
                {formatYesNo(payCard, 'Enabled', 'Not enabled')}
              </LabelValueRow>
              <LabelValueRow label="Preferred method">
                {preferredMethod ? titleCase(preferredMethod) : '—'}
              </LabelValueRow>
            </Box>

            <Divider flexItem />

            {/* Bank accounts */}
            <Box>
              <SectionHeading>Bank accounts</SectionHeading>
              {bankAccounts.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No bank accounts on file with Everee.
                </Typography>
              ) : (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Nickname</TableCell>
                        <TableCell>Bank</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Account #</TableCell>
                        <TableCell>Routing #</TableCell>
                        <TableCell>Allocation</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Added</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {bankAccounts.map((ba, idx) => {
                        const blocked = ba.depositsBlocked === true;
                        return (
                          <TableRow key={ba.id ?? `${idx}-${ba.accountNumberLast4 ?? ''}`}>
                            <TableCell>{ba.accountName?.trim() || '—'}</TableCell>
                            <TableCell>{ba.bankName?.trim() || '—'}</TableCell>
                            <TableCell>
                              {ba.accountType ? titleCase(ba.accountType) : '—'}
                            </TableCell>
                            <TableCell>
                              {ba.accountNumberLast4
                                ? `•••• ${String(ba.accountNumberLast4).trim()}`
                                : '—'}
                            </TableCell>
                            <TableCell>{ba.routingNumber?.trim() || '—'}</TableCell>
                            <TableCell>
                              {formatBankAllocation(ba.ruleAmount ?? null, ba.ruleAmountType ?? null)}
                            </TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                color={blocked ? 'error' : 'success'}
                                label={blocked ? 'Deposits blocked' : 'Active'}
                              />
                            </TableCell>
                            <TableCell>
                              {formatEvereeShortDateTime(ba.createdAt ?? null)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Box>

            {showTaxFormsSection ? (
              <>
                <Divider flexItem />

                {/* Tax Forms (W-9 / W-4) — only the form matching the worker's
                    classification comes back applicable; the other 404s and the
                    card hides itself. */}
                <Box>
                  <SectionHeading>Tax Forms</SectionHeading>
                  {taxFormsLoading ? (
                    <Stack direction="row" spacing={1} alignItems="center">
                      <CircularProgress size={16} />
                      <Typography variant="body2" color="text.secondary">
                        Loading tax forms…
                      </Typography>
                    </Stack>
                  ) : (
                    <Stack spacing={1.5}>
                      {w9Result && w9Result.ok && w9Display ? (
                        <TaxFormCard
                          title="W-9 Taxpayer Identification"
                          rows={[
                            {
                              label: 'Federal Tax Classification',
                              value: w9Display.federalTaxClassification
                                ? titleCase(w9Display.federalTaxClassification)
                                : '—',
                            },
                            {
                              label: 'FATCA Exempt',
                              value:
                                w9Display.fatcaExempt == null
                                  ? '—'
                                  : w9Display.fatcaExempt
                                    ? 'Yes'
                                    : 'No',
                            },
                            {
                              label: 'Signed',
                              value: formatEvereeShortDateTime(w9Display.signedAt),
                            },
                            {
                              label: 'Effective',
                              value: formatEvereeShortDate(w9Display.effectiveDate),
                            },
                          ]}
                          badge={deriveTaxFormBadge({
                            hasResponse: true,
                            status: w9Display.status,
                            signedAt: w9Display.signedAt,
                          })}
                        />
                      ) : null}
                      {w9Error ? (
                        <Alert severity="warning">
                          Could not fetch W-9 from Everee — {w9Error}
                        </Alert>
                      ) : null}

                      {w4Result && w4Result.ok && w4Display ? (
                        <TaxFormCard
                          title="W-4 Withholding"
                          rows={[
                            {
                              label: 'Filing status',
                              value: w4Display.filingStatus
                                ? titleCase(w4Display.filingStatus)
                                : '—',
                            },
                            {
                              label: 'Dependents',
                              value: w4Display.dependentsAmount ?? '—',
                            },
                            {
                              label: 'Additional withholding',
                              value: w4Display.additionalWithholding ?? '—',
                            },
                            {
                              label: 'Signed',
                              value: formatEvereeShortDateTime(w4Display.signedAt),
                            },
                            {
                              label: 'Effective',
                              value: formatEvereeShortDate(w4Display.effectiveDate),
                            },
                          ]}
                          badge={deriveTaxFormBadge({
                            hasResponse: true,
                            status: w4Display.status,
                            signedAt: w4Display.signedAt,
                          })}
                        />
                      ) : null}
                      {w4Error ? (
                        <Alert severity="warning">
                          Could not fetch W-4 from Everee — {w4Error}
                        </Alert>
                      ) : null}
                    </Stack>
                  )}
                </Box>
              </>
            ) : null}

            <Divider flexItem />

            {/* Files — `GET /api/v2/workers/files`. Grouped by documentType so
                support can scan tax docs vs. onboarding paperwork vs. signed
                policies at a glance. Empty groups are omitted entirely. */}
            <Box>
              <SectionHeading>Files</SectionHeading>
              {documentsError ? (
                <Alert severity="warning" sx={{ mb: 1 }}>
                  Could not fetch files from Everee — {documentsError}
                </Alert>
              ) : null}
              {documentsLoading ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={16} />
                  <Typography variant="body2" color="text.secondary">
                    Loading files…
                  </Typography>
                </Stack>
              ) : totalFiles === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No files yet. Files appear here as Everee generates tax
                  documents and policy acknowledgments.
                </Typography>
              ) : (
                <Stack spacing={2}>
                  {DOCUMENT_TYPE_RENDER_ORDER.map((groupType) => {
                    const items = filesByGroup[groupType];
                    if (!items.length) return null;
                    return (
                      <Box key={groupType}>
                        <Typography
                          variant="overline"
                          sx={{
                            fontWeight: 700,
                            letterSpacing: 0.4,
                            color: 'text.secondary',
                            display: 'block',
                            mb: 0.5,
                          }}
                        >
                          {formatDocumentTypeLabel(groupType)}
                        </Typography>
                        <Box sx={{ overflowX: 'auto' }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>File</TableCell>
                                <TableCell>Type</TableCell>
                                <TableCell>Tax year</TableCell>
                                <TableCell>Published</TableCell>
                                <TableCell align="right">Action</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {items.map((file, idx) => (
                                <TableRow key={`${groupType}-${idx}-${file.fileName}`}>
                                  <TableCell>{file.fileName}</TableCell>
                                  <TableCell>
                                    <Chip
                                      size="small"
                                      color={formatDocumentTypeColor(file.documentType)}
                                      label={formatDocumentTypeLabel(file.documentType)}
                                    />
                                  </TableCell>
                                  <TableCell>{file.taxYear ?? '—'}</TableCell>
                                  <TableCell>
                                    {formatEvereeShortDate(file.publishedAt || null)}
                                  </TableCell>
                                  <TableCell align="right">
                                    <a
                                      href={file.downloadUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{
                                        textDecoration: 'none',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                      }}
                                    >
                                      View
                                      <OpenInNewIcon fontSize="inherit" />
                                    </a>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Box>
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </Box>

            <Box sx={{ pt: 1 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontFamily: 'Menlo, Monaco, "Courier New", monospace' }}
              >
                Everee Worker ID: {evereeWorkerId}
              </Typography>
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};

export default EmployeePayrollSection;
