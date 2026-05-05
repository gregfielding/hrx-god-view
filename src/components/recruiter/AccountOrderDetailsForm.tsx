/**
 * Order Details defaults (Compliance & Requirements + Company Contacts).
 * Used on Account and Location Order Defaults tab. Data flows: National → Child → Job Order or Standalone → Location → Job Order.
 */
import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Typography,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  Chip,
  Divider,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { doc, updateDoc, serverTimestamp, deleteField } from 'firebase/firestore';
import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';
import type { RecruiterAccount } from '../../types/recruiter/account';
import {
  mergeRecruiterOrderDetails,
  mergeScreeningPackageFromOrderDefaultLayers,
  type RecruiterOrderDetailsData,
} from '../../utils/recruiterAccountOrderDefaultsMerge';
import { experienceOptions, educationOptions } from '../../data/experienceOptions';
import { backgroundCheckOptions, additionalScreeningOptions } from '../../data/screeningsOptions';
import { getOptionsForField } from '../../utils/fieldOptions';
import { getRequirementPackIds, JOB_REQUIREMENT_PACKS } from '../../data/jobRequirementPacks';
import { AccusourcePackageSelector } from './AccusourcePackageSelector';
// **R.16.1 Phase 8** — Snapshot-policy field edits at the Account
// level don't propagate to active JOs (the snapshot trigger
// captures values at activation; subsequent edits are
// "live-until-active" → no-op for already-active JOs). The banner
// surfaces this gap and lets an admin opt into Push-to-Active for
// the dirty field. Only Account-level edits surface the banner;
// Location-level edits don't (they only affect the location-merged
// effective value, not the cascaded snapshot field set captured at
// activation). See docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md §L9.
import PushToActiveBanner, {
  type PushToActiveBannerPayload,
} from './PushToActiveBanner';
// **R.16.3 (interim — Path 1)** — Per-field manual "Sync to active"
// button. Lets admins re-push the current value to active JOs without
// editing the field first (e.g. catching JOs that missed a prior
// push). Same security gate as the banner: `securityLevel === '7'`.
import SyncToActiveButton from './SyncToActiveButton';
import { useAuth } from '../../contexts/AuthContext';

const PHYSICAL_OPTIONS = [
  'Standing', 'Walking', 'Sitting', 'Lifting 25 lbs', 'Lifting 50 lbs', 'Lifting 75 lbs', 'Lifting 100+ lbs',
  'Carrying 25 lbs', 'Carrying 50 lbs', 'Pushing', 'Pulling', 'Climbing', 'Reaching', 'Handling', 'Outdoor Work', 'Indoor Work', 'Other',
];
const PPE_OPTIONS = [
  'Hard Hat', 'Safety Glasses', 'Steel-Toe Boots', 'High-Visibility Vest', 'Hearing Protection', 'Respirator', 'Other',
];
const DRESS_CODE_OPTIONS = [
  'Business Casual', 'Casual', 'Uniform Provided', 'Steel-Toe Boots', 'Non-Slip Shoes', 'Scrubs', 'Other',
];

/** @deprecated Use RecruiterOrderDetailsData from utils — kept for external imports of this type */
export type OrderDetailsData = RecruiterOrderDetailsData;

export type AccountOrderDetailsFormHandle = {
  /** Clears pending debounced save and persists current form state to Firestore. */
  flushSave: () => Promise<void>;
};

export interface AccountOrderDetailsFormProps {
  account: RecruiterAccount | null;
  accountId: string;
  tenantId: string;
  userId: string;
  locationKey?: string;
  locationDefaults?: Record<string, unknown> | null;
  onRefreshLocation?: () => void | Promise<void>;
  /** Contacts for Company Contact dropdowns (e.g. location contacts or account company contacts). May have id + label, or id + fullName/name/email. */
  contacts: Array<{ id: string; label?: string; fullName?: string; name?: string; firstName?: string; lastName?: string; email?: string; title?: string }>;
  /**
   * National / parent account doc — when set (child account UI), order details and screening merge parent → child → location.
   */
  inheritanceParentAccount?: RecruiterAccount | null;
  /** When true, render fields only (no outer Card). Parent typically wraps in a Card. */
  embedded?: boolean;
  /** `full` includes Company Contacts; `compliance` is screening + requirements only (no contact-role dropdowns). */
  sections?: 'full' | 'compliance';
  /** Intro copy. Default becomes cascade hint when `embedded` is true. */
  introMode?: 'default' | 'none' | 'cascade';
  /** Omit the inline "Compliance & Requirements" heading (e.g. parent uses CardHeader). */
  hideComplianceHeading?: boolean;
  /** Hide specific compliance rows (settings tab shows full set). */
  omitComplianceRows?: ReadonlyArray<'backgroundCheckPackages' | 'additionalScreenings'>;
  /**
   * `inline` — small sync icon beside each pushable field (default).
   * `footer` — hide inline icons; show labeled sync buttons under the compliance grid (Cascading Data tab).
   */
  syncLayout?: 'inline' | 'footer';
}

const AccountOrderDetailsForm = forwardRef<
  AccountOrderDetailsFormHandle,
  AccountOrderDetailsFormProps
>(function AccountOrderDetailsForm(
  {
    account,
    accountId,
    tenantId,
    userId,
    locationKey,
    locationDefaults,
    onRefreshLocation,
    contacts,
    inheritanceParentAccount,
    embedded = false,
    sections = 'full',
    introMode = 'default',
    hideComplianceHeading = false,
    omitComplianceRows = [],
    syncLayout = 'inline',
  },
  ref,
) {
  // R.16.3-interim — gate the per-field "Sync to active" button on
  // `securityLevel === '7'` (same Q4 lock as the banner in
  // RecruiterAccountDetails). Server still enforces independently.
  // Location-level edits hide the button entirely (snapshot-policy
  // pushes are only meaningful at the Account level — see save()).
  const { securityLevel } = useAuth();
  const canPushToActive = securityLevel === '7';
  const locationOrderDetails = (locationDefaults as any)?.orderDefaults?.orderDetails as OrderDetailsData | undefined;
  const accountOrderDetails = (account as any)?.orderDefaults?.orderDetails as OrderDetailsData | undefined;
  const parentOrderDetails = (inheritanceParentAccount as any)?.orderDefaults?.orderDetails as OrderDetailsData | undefined;

  const effective = useMemo(() => {
    const accountPlusParent = inheritanceParentAccount
      ? mergeRecruiterOrderDetails(accountOrderDetails, parentOrderDetails)
      : mergeRecruiterOrderDetails(undefined, accountOrderDetails);
    return mergeRecruiterOrderDetails(locationOrderDetails, accountPlusParent);
  }, [locationOrderDetails, accountOrderDetails, parentOrderDetails, inheritanceParentAccount]);

  const mergedScreening = useMemo(() => {
    const odLoc = (locationDefaults as any)?.orderDefaults as Record<string, unknown> | undefined;
    const odAcc = (account as any)?.orderDefaults as Record<string, unknown> | undefined;
    const odParent = (inheritanceParentAccount as any)?.orderDefaults as Record<string, unknown> | undefined;
    return mergeScreeningPackageFromOrderDefaultLayers(
      locationKey ? odLoc : undefined,
      odAcc,
      inheritanceParentAccount ? odParent : undefined
    );
  }, [locationDefaults, account, inheritanceParentAccount, locationKey]);

  const [form, setForm] = useState<OrderDetailsData>(effective);
  const [screeningPackageId, setScreeningPackageId] = useState(mergedScreening.id);
  const [screeningPackageName, setScreeningPackageName] = useState(mergedScreening.name);
  const formRef = useRef<OrderDetailsData>(form);
  // 2026-05-05 stale-closure fix — the AccuSource selector calls
  // `setScreeningPackageId(...)` then `scheduleSave()` synchronously in
  // the same `onChange`. The debounced timer is scheduled from THIS
  // render's `scheduleSave`, which closes over THIS render's `save`,
  // which closes over THIS render's `screeningPackageId` (the value
  // BEFORE the setState). So when the 400ms timer fires after the
  // re-render, it runs the stale `save` and persists the previous
  // value — typically an empty string when picking from "None", which
  // hits the `deleteField()` branch and wipes the field. Bug Greg
  // reported: "I am unable to select an accusource package… it's
  // saving on change and not recording the update."
  //
  // Mirror the `formRef` pattern: keep the latest screening values in
  // refs and have `save()` read from those instead of the closure-
  // captured state. Removes the stale read without restructuring the
  // debounce.
  const screeningPackageIdRef = useRef<string>(screeningPackageId);
  const screeningPackageNameRef = useRef<string>(screeningPackageName);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // R.16.1 Phase 8 — banner state. Set after a saved-to-Firestore
  // edit on a snapshot-policy field. Cleared either by the banner's
  // X button (`onDismiss`) or by closing the dialog. Only one
  // payload at a time — if the admin edits screening then
  // additionalScreenings before reviewing the first, the second
  // edit replaces the banner. Multi-field push isn't supported in
  // V1 (§L9 — pushed one fieldKey per call), and stacking banners
  // hurts comprehension more than it helps.
  const [pushBanner, setPushBanner] = useState<PushToActiveBannerPayload | null>(null);
  // Latest *server-saved* values for snapshot-policy fields. We
  // compare against these on save to decide whether to fire the
  // banner. We don't compare against `form` directly because
  // unsaved typing in the multi-select shouldn't strobe the banner.
  const lastSavedScreeningRef = useRef<string>(mergedScreening.id);
  const lastSavedAdditionalScreeningsRef = useRef<string[]>(
    Array.isArray(effective.additionalScreenings)
      ? [...effective.additionalScreenings]
      : [],
  );
  // Save status. Auto-save (on blur / scheduleSave) and the manual
  // Save button both feed the same `save()` and surface here. Errors
  // were previously swallowed to console only; now they render as
  // an inline Alert at the top of the card per Greg's UX call.
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    setForm(effective);
  }, [effective]);

  useEffect(() => {
    setScreeningPackageId(mergedScreening.id);
    setScreeningPackageName(mergedScreening.name);
  }, [mergedScreening]);

  // Keep refs in lockstep with state so `save()` (called from the
  // debounce timer) sees the latest values even when the closure that
  // scheduled the timer was created with stale state. Pairs with the
  // ref-based reads in `save()` below.
  useEffect(() => {
    screeningPackageIdRef.current = screeningPackageId;
  }, [screeningPackageId]);
  useEffect(() => {
    screeningPackageNameRef.current = screeningPackageName;
  }, [screeningPackageName]);

  const update = useCallback((patch: Partial<OrderDetailsData>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const save = useCallback(async () => {
    const data = formRef.current;
    // Read from refs (kept in sync with state via the effects above).
    // Reading from the closure-captured `screeningPackageId` /
    // `screeningPackageName` here is the source of the stale-closure
    // bug — see the explanatory comment block on the ref declarations.
    const sid = screeningPackageIdRef.current.trim();
    const sname = screeningPackageNameRef.current.trim();
    const nextAdditionalScreenings = Array.isArray(data.additionalScreenings)
      ? data.additionalScreenings
      : [];
    setIsSaving(true);
    setSaveError(null);
    try {
      const payload: Record<string, unknown> = {
        'orderDefaults.orderDetails': data,
        updatedAt: serverTimestamp(),
        ...(locationKey ? { updatedBy: userId || null } : {}),
      };
      if (sid) {
        payload['orderDefaults.screeningPackageId'] = sid;
        payload['orderDefaults.screeningPackageName'] = sname || '';
      } else {
        payload['orderDefaults.screeningPackageId'] = deleteField();
        payload['orderDefaults.screeningPackageName'] = deleteField();
      }
      if (locationKey) {
        const locationRef = doc(db, p.recruiterAccountLocationDefaults(tenantId, accountId, locationKey));
        await updateDoc(locationRef, payload);
        await onRefreshLocation?.();
      } else {
        const accountRef = doc(db, p.recruiterAccount(tenantId, accountId));
        await updateDoc(accountRef, payload);
      }

      // R.16.1 Phase 8 — surface the banner only at the Account
      // level. Location-level saves don't carry snapshot-policy
      // semantics in this dialog: snapshot fields capture the
      // resolved cascade at activation time, and the
      // location-merged value is incidentally observable through
      // that capture but isn't itself a push surface in V1.
      if (!locationKey) {
        const prevSid = lastSavedScreeningRef.current;
        if (sid !== prevSid) {
          setPushBanner({
            fieldKey: 'screeningPackageId',
            positionId: null,
            previousValue: prevSid || null,
            newValue: sid || null,
            fieldLabel: 'AccuSource Screening Package',
          });
          lastSavedScreeningRef.current = sid;
        } else {
          const prevAdd = lastSavedAdditionalScreeningsRef.current;
          const sameLength = prevAdd.length === nextAdditionalScreenings.length;
          const sameContents =
            sameLength &&
            [...prevAdd].sort().every((v, i) => v === [...nextAdditionalScreenings].sort()[i]);
          if (!sameContents) {
            setPushBanner({
              fieldKey: 'additionalScreenings',
              positionId: null,
              previousValue: prevAdd,
              newValue: nextAdditionalScreenings,
              fieldLabel: 'Additional Screenings',
            });
            lastSavedAdditionalScreeningsRef.current = [...nextAdditionalScreenings];
          }
        }
      }
      setLastSavedAt(Date.now());
    } catch (err: any) {
      console.error('Save order details error:', err);
      // Surface to the operator. Common shapes: permission denied
      // (rules), not-found (stale doc id), unavailable (network).
      // Stringify defensively — Firestore errors expose `.code` and
      // `.message`, but anything thrown from a callback chain might
      // not.
      const code = err && typeof err.code === 'string' ? `[${err.code}] ` : '';
      const msg =
        (err && typeof err.message === 'string' && err.message) ||
        (typeof err === 'string' && err) ||
        'Unknown error while saving order details.';
      setSaveError(`${code}${msg}`);
    } finally {
      setIsSaving(false);
    }
    // `screeningPackageId` / `screeningPackageName` deliberately omitted
    // from the dep list — `save` now reads them from refs, so re-creating
    // the callback (and thus `scheduleSave`) on every keystroke would
    // only churn the timer without changing observable behavior.
  }, [tenantId, accountId, userId, locationKey, onRefreshLocation]);

  useImperativeHandle(
    ref,
    () => ({
      flushSave: async () => {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        await save();
      },
    }),
    [save],
  );

  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      save();
    }, 400);
  }, [save]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const contactOptions = contacts.map((c) => ({
    id: c.id,
    label: c.label || [c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name, c.email].filter(Boolean).join(' · ') || c.id,
  }));
  const getContactById = (id: string) => contactOptions.find((o) => o.id === id) || null;

  const emptyOpts = {};
  const bgOptions = (getOptionsForField('backgroundCheckPackages', emptyOpts) as { value: string; label: string }[])?.length
    ? getOptionsForField('backgroundCheckPackages', emptyOpts)
    : backgroundCheckOptions.map((o) => ({ value: o.value, label: o.label }));
  const addlOptions = (getOptionsForField('additionalScreenings', emptyOpts) as { value: string; label: string }[])?.length
    ? getOptionsForField('additionalScreenings', emptyOpts)
    : additionalScreeningOptions.map((o) => ({ value: o.value, label: o.label }));
  const licenseOptions = getOptionsForField('licensesCerts', emptyOpts) as { value: string; label: string }[];
  const languageOptions = (getOptionsForField('languages', emptyOpts) as { value: string; label: string }[])?.map((o) => o.value) || [];
  const skillOptions = getOptionsForField('skills', emptyOpts) as { value: string; label: string }[];

  const hasPpeRequirements =
    Array.isArray(form.ppeRequirements) && form.ppeRequirements.length > 0;

  const effectiveIntro: 'none' | 'default' | 'cascade' =
    introMode === 'none'
      ? 'none'
      : introMode === 'cascade' || (embedded && introMode === 'default')
        ? 'cascade'
        : 'default';

  const inner = (
    <>
      {effectiveIntro === 'default' && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          These defaults flow to job orders. Set at account or location level; job orders can override. Edits auto-save when you click out of a field; you can also use the Save button at the bottom.
        </Typography>
      )}
      {effectiveIntro === 'cascade' && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Same fields as Docs & Settings → Order Details. Values cascade to child accounts and job orders; edits stay in sync with that section.
        </Typography>
      )}

        {/* Save-error surface — sticky at the top of the card per
            UX call. Prior to this the save flow only console.error'd
            and edits silently dropped on permission / network failure. */}
        {saveError && (
          <Alert
            severity="error"
            onClose={() => setSaveError(null)}
            sx={{ mb: 2 }}
          >
            <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
              Couldn't save order details:
            </Typography>{' '}
            {saveError}
          </Alert>
        )}

        {/* R.16.1 Phase 8 — Push-to-Active banner. Only renders at
            the Account level (location-level edits don't surface a
            push prompt; see save() above for the rationale). */}
        {!locationKey && (
          <PushToActiveBanner
            tenantId={tenantId}
            accountId={accountId}
            payload={pushBanner}
            onDismiss={() => setPushBanner(null)}
          />
        )}

        {!hideComplianceHeading && (
          <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 2, mb: 1 }}>
            Compliance & Requirements
          </Typography>
        )}
        <Grid container spacing={2}>
          <Grid item xs={12}>
            {/* R.16.3-interim — manual sync button + selector in one row.
                The selector is full-width; the button hangs to the right
                like an inline action. Hidden at location level (no
                snapshot semantics) and for non-admin users. */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Box sx={{ flex: 1 }}>
                <AccusourcePackageSelector
                  packageId={screeningPackageId}
                  packageName={screeningPackageName}
                  onChange={(next) => {
                    setScreeningPackageId(next.packageId);
                    setScreeningPackageName(next.packageName);
                    scheduleSave();
                  }}
                  showDiagnostics
                  emptyMenuLabel="None"
                  helperText="AccuSource package for order screening. Job orders can override; merges with location → account defaults."
                />
              </Box>
              {syncLayout === 'inline' && !locationKey && canPushToActive && (
                <Box sx={{ pt: 0.5 }}>
                  <SyncToActiveButton
                    tenantId={tenantId}
                    accountId={accountId}
                    fieldKey="screeningPackageId"
                    getCurrentValue={() => screeningPackageId.trim() || null}
                    fieldLabel="AccuSource Screening Package"
                  />
                </Box>
              )}
            </Box>
          </Grid>
          {!omitComplianceRows.includes('backgroundCheckPackages') && (
            <Grid item xs={12}>
              <Autocomplete
                multiple
                fullWidth
                size="small"
                options={bgOptions.map((o) => o.label)}
                value={form.backgroundCheckPackages ?? []}
                onChange={(_, v) => update({ backgroundCheckPackages: v })}
                onBlur={scheduleSave}
                renderInput={(params) => <TextField {...params} label="Background Check Packages" onBlur={scheduleSave} />}
                renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" label={option} {...getTagProps({ index })} key={option} />)}
              />
            </Grid>
          )}
          {/* R.0d (Apr 2026): "Drug Screening Panels" Autocomplete removed —
              soft-deprecated by the Readiness Rebuild; subsumed by the
              AccuSource package selector above + "Additional Screenings"
              below. See docs/READINESS_R0_HANDOFF.md. */}
          {!omitComplianceRows.includes('additionalScreenings') && (
            <Grid item xs={12}>
              {/* R.16.3-interim — same inline-action pattern as the
                  AccuSource selector above. */}
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <Box sx={{ flex: 1 }}>
                  <Autocomplete
                    multiple
                    fullWidth
                    size="small"
                    options={addlOptions.map((o) => o.label)}
                    value={form.additionalScreenings ?? []}
                    onChange={(_, v) => update({ additionalScreenings: v })}
                    onBlur={scheduleSave}
                    renderInput={(params) => <TextField {...params} label="Additional Screenings" onBlur={scheduleSave} />}
                    renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" label={option} {...getTagProps({ index })} key={option} />)}
                  />
                </Box>
                {syncLayout === 'inline' && !locationKey && canPushToActive && (
                  <Box sx={{ pt: 0.5 }}>
                    <SyncToActiveButton
                      tenantId={tenantId}
                      accountId={accountId}
                      fieldKey="additionalScreenings"
                      getCurrentValue={() =>
                        Array.isArray(formRef.current.additionalScreenings)
                          ? formRef.current.additionalScreenings
                          : []
                      }
                      fieldLabel="Additional Screenings"
                    />
                  </Box>
                )}
              </Box>
            </Grid>
          )}
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              fullWidth
              size="small"
              options={licenseOptions.map((o) => o.value || o.label)}
              value={form.licensesCerts ?? []}
              onChange={(_, v) => update({ licensesCerts: v })}
              onBlur={scheduleSave}
              renderInput={(params) => <TextField {...params} label="Licenses & Certifications" onBlur={scheduleSave} />}
              renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" size="small" label={option} {...getTagProps({ index })} key={option} />)}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Experience Required</InputLabel>
              <Select value={form.experienceRequired ?? ''} onChange={(e) => { update({ experienceRequired: e.target.value }); scheduleSave(); }} onClose={scheduleSave} label="Experience Required">
                <MenuItem value="">—</MenuItem>
                {experienceOptions.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Education Required</InputLabel>
              <Select value={form.educationRequired ?? ''} onChange={(e) => { update({ educationRequired: e.target.value }); scheduleSave(); }} onClose={scheduleSave} label="Education Required">
                <MenuItem value="">—</MenuItem>
                {educationOptions.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              freeSolo
              fullWidth
              size="small"
              options={languageOptions}
              value={form.languagesRequired ?? []}
              onChange={(_, v) => update({ languagesRequired: v })}
              onBlur={scheduleSave}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Languages Required"
                  placeholder="Select or type to add"
                  onBlur={scheduleSave}
                />
              )}
              renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" label={option} {...getTagProps({ index })} key={option} />)}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              fullWidth
              size="small"
              options={skillOptions.map((o) => o.value || o.label)}
              value={form.skillsRequired ?? []}
              onChange={(_, v) => update({ skillsRequired: v })}
              onBlur={scheduleSave}
              renderInput={(params) => <TextField {...params} label="Skills Required" onBlur={scheduleSave} />}
              renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" size="small" label={option} {...getTagProps({ index })} key={option} />)}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            {/* R.16.2c — same inline-action pattern as the AccuSource +
                Additional Screenings selectors above. Snapshot-policy
                field; manual sync available for level-7 admins on the
                top-level form (locationKey === undefined means we're
                editing the National/Child account, not a location). */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Box sx={{ flex: 1 }}>
                <Autocomplete
                  multiple
                  fullWidth
                  size="small"
                  options={PHYSICAL_OPTIONS}
                  value={form.physicalRequirements ?? []}
                  onChange={(_, v) => update({ physicalRequirements: v })}
                  onBlur={scheduleSave}
                  renderInput={(params) => <TextField {...params} label="Physical Requirements" onBlur={scheduleSave} />}
                  renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" label={option} {...getTagProps({ index })} key={option} />)}
                />
              </Box>
              {syncLayout === 'inline' && !locationKey && canPushToActive && (
                <Box sx={{ pt: 0.5 }}>
                  <SyncToActiveButton
                    tenantId={tenantId}
                    accountId={accountId}
                    fieldKey="physicalRequirements"
                    getCurrentValue={() =>
                      Array.isArray(formRef.current.physicalRequirements)
                        ? formRef.current.physicalRequirements
                        : []
                    }
                    fieldLabel="Physical Requirements"
                  />
                </Box>
              )}
            </Box>
          </Grid>
          <Grid item xs={12} md={6}>
            <Autocomplete
              multiple
              fullWidth
              size="small"
              options={PPE_OPTIONS}
              value={form.ppeRequirements ?? []}
              onChange={(_, v) => {
                const nextReq = v ?? [];
                const nextHad = nextReq.length > 0;
                const prevHad = Array.isArray(form.ppeRequirements) && form.ppeRequirements.length > 0;
                const curBy = String(form.ppeProvidedBy ?? '').trim();
                const validBy = curBy === 'company' || curBy === 'worker' || curBy === 'both';
                let nextProvidedBy = '';
                if (nextHad) {
                  nextProvidedBy =
                    prevHad && validBy ? curBy : 'company';
                }
                update({
                  ppeRequirements: nextReq,
                  ppeProvidedBy: nextProvidedBy,
                });
                scheduleSave();
              }}
              onBlur={scheduleSave}
              renderInput={(params) => <TextField {...params} label="PPE Requirements" onBlur={scheduleSave} />}
              renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" label={option} {...getTagProps({ index })} key={option} />)}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small" disabled={!hasPpeRequirements}>
              <InputLabel>PPE Provided By</InputLabel>
              <Select
                displayEmpty
                value={hasPpeRequirements ? String(form.ppeProvidedBy || 'company') : ''}
                onChange={(e) => {
                  update({ ppeProvidedBy: e.target.value });
                  scheduleSave();
                }}
                onClose={scheduleSave}
                label="PPE Provided By"
              >
                {!hasPpeRequirements && (
                  <MenuItem value="">
                    <em>Add PPE requirements first</em>
                  </MenuItem>
                )}
                <MenuItem value="company">Company</MenuItem>
                <MenuItem value="worker">Worker</MenuItem>
                <MenuItem value="both">Both</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Job Score requirement pack</InputLabel>
              <Select value={form.requirementPackId ?? ''} onChange={(e) => { update({ requirementPackId: e.target.value }); scheduleSave(); }} onClose={scheduleSave} label="Job Score requirement pack">
                <MenuItem value="">None</MenuItem>
                {getRequirementPackIds().map((id) => (
                  <MenuItem key={id} value={id}>{JOB_REQUIREMENT_PACKS[id as keyof typeof JOB_REQUIREMENT_PACKS]?.name ?? id}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <Autocomplete
              multiple
              fullWidth
              size="small"
              options={DRESS_CODE_OPTIONS}
              value={form.dressCode ?? []}
              onChange={(_, v) => update({ dressCode: v })}
              onBlur={scheduleSave}
              renderInput={(params) => <TextField {...params} label="Uniform Requirements" onBlur={scheduleSave} />}
              renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" label={option} {...getTagProps({ index })} key={option} />)}
            />
          </Grid>
          <Grid item xs={12}>
            {/* R.16.2c — manual sync next to the freeform "Custom Uniform
                Requirements" textarea. Same gating as physicalRequirements
                above. */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Box sx={{ flex: 1 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Custom Uniform Requirements"
                  multiline
                  rows={2}
                  value={form.customUniformRequirements ?? ''}
                  onChange={(e) => update({ customUniformRequirements: e.target.value })}
                  onBlur={scheduleSave}
                />
              </Box>
              {syncLayout === 'inline' && !locationKey && canPushToActive && (
                <Box sx={{ pt: 0.5 }}>
                  <SyncToActiveButton
                    tenantId={tenantId}
                    accountId={accountId}
                    fieldKey="customUniformRequirements"
                    getCurrentValue={() =>
                      typeof formRef.current.customUniformRequirements === 'string'
                        ? formRef.current.customUniformRequirements
                        : ''
                    }
                    fieldLabel="Custom Uniform Requirements"
                  />
                </Box>
              )}
            </Box>
          </Grid>
        </Grid>

        {sections === 'full' && (
          <>
            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
              Company Contacts
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Default contact roles for job orders at this account/location.
            </Typography>
            <Grid container spacing={2}>
              {(['decisionMaker', 'hrContactId', 'operationsContactId', 'procurementContactId', 'billingContactId', 'safetyContactId', 'invoiceContactId'] as const).map((key) => {
                const labels: Record<string, string> = {
                  decisionMaker: 'Decision Maker',
                  hrContactId: 'HR Contact',
                  operationsContactId: 'Operations Contact',
                  procurementContactId: 'Procurement Contact',
                  billingContactId: 'Billing Contact',
                  safetyContactId: 'Safety Contact',
                  invoiceContactId: 'Invoice Contact',
                };
                const value = form[key] ?? '';
                return (
                  <Grid item xs={12} md={6} key={key}>
                    <Autocomplete
                      fullWidth
                      size="small"
                      options={contactOptions}
                      value={getContactById(value)}
                      onChange={(_, v) => update({ [key]: v?.id ?? '' })}
                      onBlur={scheduleSave}
                      getOptionLabel={(o) => o.label}
                      isOptionEqualToValue={(o, v) => o.id === v?.id}
                      renderInput={(params) => <TextField {...params} label={labels[key]} placeholder="Select contact..." onBlur={scheduleSave} />}
                    />
                  </Grid>
                );
              })}
            </Grid>
          </>
        )}

        {/* Save button + status row. Auto-save still fires on blur
            via scheduleSave(); this is for discoverability + manual
            flush after a typing burst. Mirrors the Billing & Invoicing
            section's "Save" affordance on the same Settings page. */}
        <Box sx={{ mt: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            variant="contained"
            color="primary"
            startIcon={isSaving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
            onClick={() => {
              // Cancel any pending debounced auto-save and run now,
              // so the button click and the trailing scheduleSave
              // don't double-fire.
              if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = null;
              }
              save();
            }}
            disabled={isSaving}
          >
            {isSaving ? 'Saving…' : 'Save Order Details'}
          </Button>
          {!isSaving && saveError === null && lastSavedAt !== null && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'success.main' }}>
              <CheckCircleIcon fontSize="small" />
              <Typography variant="body2">
                Saved {formatRelativeTime(lastSavedAt)}
              </Typography>
            </Box>
          )}
          {!isSaving && saveError === null && lastSavedAt === null && (
            <Typography variant="body2" color="text.secondary">
              Edits auto-save when you click out of a field.
            </Typography>
          )}
        </Box>
    </>
  );

  if (embedded) {
    return inner;
  }

  return (
    <Card>
      <CardContent>{inner}</CardContent>
    </Card>
  );
});

/**
 * Tiny relative-time formatter for the "Saved <when>" status. Avoids
 * pulling in date-fns just for this one label.
 */
function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(timestamp).toLocaleString();
}

AccountOrderDetailsForm.displayName = 'AccountOrderDetailsForm';

export default AccountOrderDetailsForm;
