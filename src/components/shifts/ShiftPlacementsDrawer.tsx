/**
 * ShiftPlacementsDrawer — right-side drawer that opens when a row is clicked
 * in the /shifts/active table. It shows the parent JO's existing
 * `PlacementsTab` so recruiters can manage assignments without leaving the
 * cross-job-order Shifts dashboard.
 *
 * The drawer owns the JO doc fetch (PlacementsTab requires a hydrated
 * `JobOrder`). On close we drop the loaded JO so re-opening a different
 * shift always shows fresh data.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  Grid,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Close as CloseIcon,
  NotificationsOff as NotificationsOffIcon,
  NotificationsActive as NotificationsActiveIcon,
  OpenInNew as OpenInNewIcon,
  Description as DescriptionIcon,
} from '@mui/icons-material';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { format } from 'date-fns';

import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';
import PlacementsTab from '../recruiter/PlacementsTab';
import JobOrderAutoMessagingTab from '../recruiter/JobOrderAutoMessagingTab';
import { experienceOptions, educationOptions } from '../../data/experienceOptions';
import { JOB_REQUIREMENT_PACKS } from '../../data/jobRequirementPacks';
import type { JobOrder } from '../../types/recruiter/jobOrder';
import EditShiftForm, { type ShiftFormShift } from './EditShiftForm';

// Instructions tab section config. Mirrors the JO Detail page's
// "Staff Instructions" tab (`RecruiterJobOrderDetail.tsx`) so the
// drawer's vocabulary stays in lock-step. Order matters — these are
// the seven `staffInstructions` keys the cascade engine expects to
// see on a JO doc (firstDay, parking, checkIn, uniform, credentials,
// other, attachments). Adding a new section? Update both lists.
const INSTRUCTION_SECTIONS: ReadonlyArray<{
  title: string;
  fieldKey: string;
  placeholder: string;
  uploadPlaceholder: string;
}> = [
  {
    title: 'First Day Instructions',
    fieldKey: 'firstDay',
    placeholder:
      'Enter first day instructions (e.g., arrival time, what to bring, who to meet, orientation details...)',
    uploadPlaceholder:
      'Upload first day schedules, orientation materials, or related documents',
  },
  {
    title: 'Parking Instructions',
    fieldKey: 'parking',
    placeholder:
      'Enter parking instructions for staff (e.g., where to park, parking pass requirements, visitor parking location...)',
    uploadPlaceholder:
      'Upload parking maps, diagrams, or related documents',
  },
  {
    title: 'Check-In Instructions',
    fieldKey: 'checkIn',
    placeholder:
      'Enter check-in instructions (e.g., where to report, who to ask for, required documents...)',
    uploadPlaceholder:
      'Upload check-in forms, maps, or related documents',
  },
  {
    title: 'Uniform Instructions',
    fieldKey: 'uniform',
    placeholder:
      'Enter uniform and dress code requirements (e.g., specific colors, safety gear, PPE requirements...)',
    uploadPlaceholder:
      'Upload uniform photos, dress code guides, or related documents',
  },
  {
    title: 'Credential Instructions',
    fieldKey: 'credentials',
    placeholder:
      'Enter credential requirements (e.g., badge pickup, wristband issuance, ID requirements...)',
    uploadPlaceholder:
      'Upload credential forms, badge photos, or related documents',
  },
  {
    title: 'Other Instructions',
    fieldKey: 'other',
    placeholder:
      'Enter any additional instructions or important information for staff...',
    uploadPlaceholder: 'Upload any other relevant documents',
  },
  {
    title: 'Other Attachments',
    fieldKey: 'attachments',
    // Empty placeholder hides the text area on this card — see
    // StaffInstructionCard's conditional render. Attachments-only.
    placeholder: '',
    uploadPlaceholder:
      'Upload any other relevant documents for this job order',
  },
];

// Money + percent formatters duplicated from the /shifts table so the
// drawer's Financials field reads identically to the table cell. (If
// these grow further, extract to `src/utils/shifts/format.ts`.)
const fmtMoney = (n: number | null | undefined): string =>
  n != null && Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';

const fmtPct = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  const fixed = n.toFixed(2);
  const trimmed = fixed.replace(/\.?0+$/, '');
  return `${trimmed}%`;
};

// Small column inside the drawer's header strip. Renders a tiny
// uppercase label on top (mirrors the field-label treatment used in
// the rest of the recruiter UI) and stacks its children beneath.
const HeaderField: React.FC<{
  label: string;
  children: React.ReactNode;
  sx?: React.ComponentProps<typeof Box>['sx'];
}> = ({ label, children, sx }) => (
  <Box sx={{ minWidth: 0, ...(sx || {}) }}>
    <Typography
      variant="caption"
      sx={{
        display: 'block',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        color: 'text.secondary',
        fontWeight: 600,
        mb: 0.25,
      }}
    >
      {label}
    </Typography>
    <Stack spacing={0.15} sx={{ minWidth: 0 }}>
      {children}
    </Stack>
  </Box>
);

interface ShiftSummary {
  id: string;
  /** Shift title (e.g. "Loader / Crew"). Used for the main header line. */
  shiftTitle?: string;
  /** JO-level job title (e.g. "Warehouse Associate"). Rendered below
   *  the shift title in the Job column of the header strip — mirrors
   *  the Job cell in the /shifts table. */
  jobTitle?: string;
  /** Pretty date display (e.g. "Sun, Apr 26, 2026", "Career"). */
  dateLabel: string;
  /** Pretty time display (e.g. "8:00 AM – 4:00 PM"). */
  timeLabel: string;
  /** Resolved shift- or JO-level PO number. Empty / undefined renders
   *  as an em-dash so the column stays a constant width. */
  poNumber?: string;
  /** Worksite (location) name — first line of the Worksite column. */
  worksiteName?: string;
  /** Street address line of the worksite. Optional — older tenants
   *  may have JOs with no street persisted. */
  worksiteStreet?: string;
  /** "City, ST zip" line. Composed by the caller; the drawer just
   *  renders it as a single string so callers control format. */
  worksiteCityStateZip?: string;
  /** Account / company display name. Shown via the avatar tooltip;
   *  not rendered as text in the header so the strip stays compact. */
  companyName?: string;
  /** Resolved company logo URL (hydrated upstream by useActiveShifts).
   *  Falls back to the first letter of `companyName` when missing. */
  companyLogoUrl?: string;
  /* --- Financials (mirrors the table's Financials column) -----------
   * All five values are optional because old JOs may have been imported
   * without them. The header field renders an em-dash when nothing is
   * set so layout doesn't shift. */
  payRate?: number | null;
  billRate?: number | null;
  markupPercent?: number | null;
  wcRate?: number | null;
  sutaRate?: number | null;
  futaRate?: number | null;
  /** Total workers requested for this shift (top-line denominator in
   *  the "Placements" header summary and the table's Staff column). */
  totalStaffRequested?: number;
  /** Number of applications attached to this shift with status
   *  `confirmed` (top-line numerator). Hydrated by useActiveShifts. */
  confirmedCount?: number;
}

interface ShiftPlacementsDrawerProps {
  open: boolean;
  tenantId: string | null;
  jobOrderId: string | null;
  shift: ShiftSummary | null;
  onClose: () => void;
}

const ShiftPlacementsDrawer: React.FC<ShiftPlacementsDrawerProps> = ({
  open,
  tenantId,
  jobOrderId,
  shift,
  onClose,
}) => {
  const [jobOrder, setJobOrder] = useState<JobOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Active drawer tab. Resets to 'assignments' whenever the drawer
  // reopens against a new shift so a recruiter never lands on a stale
  // tab they last touched on a previous shift.
  const [activeTab, setActiveTab] = useState<
    'assignments' | 'settings' | 'instructions' | 'requirements' | 'promotion'
  >('assignments');
  // Full shift doc loaded for the Settings tab. The drawer's `shift`
  // prop is a *summary* (the shape used by the /shifts table rows) and
  // doesn't carry the full edit-time fields (weeklySchedule,
  // dateSchedule, defaultStartTime, etc.). EditShiftForm needs the
  // real shift document, so we lazy-load it the first time the
  // Settings tab is activated against a given (tenant, jo, shift).
  const [shiftDoc, setShiftDoc] = useState<ShiftFormShift | null>(null);
  const [shiftDocLoading, setShiftDocLoading] = useState(false);
  const [shiftDocError, setShiftDocError] = useState<string | null>(null);
  const [shiftDocReloadKey, setShiftDocReloadKey] = useState(0);
  // Lightweight inline status message after a successful save inside
  // the Settings tab. Cleared on next save / shift / close.
  const [settingsSaveMessage, setSettingsSaveMessage] = useState<string | null>(null);

  // Mute-notifications toggle. The state lives on the JO doc
  // (`muted: boolean`); we read from `jobOrder` and write back via
  // `updateDoc`. Mirrors `PlacementsTab.handleTogglePlacementNotificationsMuted`
  // so the JO Detail page and the drawer stay in sync.
  const placementNotificationsMuted = Boolean((jobOrder as { muted?: boolean } | null)?.muted);
  const [togglingMute, setTogglingMute] = useState(false);
  const [muteError, setMuteError] = useState<string | null>(null);

  // Reset the active tab whenever the drawer opens against a new
  // shift. We key on `shift?.id` (not `open`) so toggling the same
  // shift open/closed preserves the tab the recruiter was on.
  useEffect(() => {
    if (open) setActiveTab('assignments');
    // Clear any previous Settings-tab transient state when we swap
    // shifts so the next shift starts clean.
    setShiftDoc(null);
    setShiftDocError(null);
    setSettingsSaveMessage(null);
  }, [open, shift?.id]);

  // Lazy-load the full shift document the first time Settings is
  // opened (or when `shiftDocReloadKey` bumps after a save). We don't
  // load eagerly — the assignments tab is the default and doesn't
  // need the full doc.
  useEffect(() => {
    if (!open || !tenantId || !jobOrderId || !shift?.id) return;
    if (activeTab !== 'settings') return;
    if (shiftDoc && shiftDoc.id === shift.id && shiftDocReloadKey === 0) return;
    let cancelled = false;
    setShiftDocLoading(true);
    setShiftDocError(null);
    (async () => {
      try {
        const ref = doc(
          db,
          'tenants',
          tenantId,
          'job_orders',
          jobOrderId,
          'shifts',
          shift.id,
        );
        const snap = await getDoc(ref);
        if (cancelled) return;
        if (!snap.exists()) {
          setShiftDocError('Shift no longer exists.');
          setShiftDoc(null);
        } else {
          setShiftDoc({ id: snap.id, ...(snap.data() as object) } as ShiftFormShift);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load shift doc for Settings tab:', err);
        setShiftDocError(
          err instanceof Error ? err.message : 'Failed to load shift',
        );
      } finally {
        if (!cancelled) setShiftDocLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    tenantId,
    jobOrderId,
    shift?.id,
    activeTab,
    shiftDocReloadKey,
    // shiftDoc is intentionally excluded — re-running on every state
    // change to shiftDoc would cause an infinite reload loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  // Refetch the JO doc. Exposed as a callback so child panels (e.g.
  // `StaffInstructionCard`'s `onRefresh`) can pull fresh data after
  // mutating the JO without us having to wire a Firestore subscription
  // into the drawer.
  const refreshJobOrder = useCallback(async (): Promise<void> => {
    if (!tenantId || !jobOrderId) return;
    try {
      const snap = await getDoc(doc(db, p.jobOrder(tenantId, jobOrderId)));
      if (!snap.exists()) {
        setError('Job order no longer exists.');
        setJobOrder(null);
        return;
      }
      // Cast — the Firestore doc shape is broader than the TS interface,
      // but PlacementsTab tolerates extra fields and the few fields it
      // strictly needs are all present on real JO docs.
      setJobOrder({ id: snap.id, ...(snap.data() as object) } as JobOrder);
    } catch (err) {
      console.error('Failed to refresh job order for shift drawer:', err);
      setError(err instanceof Error ? err.message : 'Failed to refresh job order');
    }
  }, [tenantId, jobOrderId]);

  // Load the JO doc whenever a new (tenant, jobOrderId) pair opens.
  // PlacementsTab wants a fully populated JobOrder, not an empty shell —
  // empty would crash several `jobOrder.requiredCertifications` etc. lookups.
  useEffect(() => {
    if (!open || !tenantId || !jobOrderId) {
      setJobOrder(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const snap = await getDoc(doc(db, p.jobOrder(tenantId, jobOrderId)));
        if (cancelled) return;
        if (!snap.exists()) {
          setError('Job order no longer exists.');
          setJobOrder(null);
        } else {
          setJobOrder({ id: snap.id, ...(snap.data() as object) } as JobOrder);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load job order for shift drawer:', err);
        setError(err instanceof Error ? err.message : 'Failed to load job order');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tenantId, jobOrderId]);

  const handleOpenJobOrder = () => {
    if (!jobOrderId) return;
    // Open the full JO in a new browser tab so the recruiter keeps the
    // shift drawer + Shifts table context where they were. We don't
    // close the drawer because they're explicitly going to a separate
    // tab; closing would lose their place in the table on return.
    window.open(`/jobs/job-orders/${jobOrderId}`, '_blank', 'noopener,noreferrer');
  };

  const handleToggleMute = async () => {
    if (!tenantId || !jobOrderId) return;
    setTogglingMute(true);
    setMuteError(null);
    try {
      const next = !placementNotificationsMuted;
      await updateDoc(doc(db, 'tenants', tenantId, 'job_orders', jobOrderId), {
        muted: next,
        updatedAt: serverTimestamp(),
      });
      // Optimistic local update so the button label flips before the
      // JO doc reload propagates. The drawer's load effect will reconcile.
      setJobOrder((prev) => (prev ? ({ ...prev, muted: next } as JobOrder) : prev));
    } catch (err) {
      setMuteError(err instanceof Error ? err.message : 'Failed to update mute setting');
    } finally {
      setTogglingMute(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: '100%', md: '60vw', lg: '70vw' },
          minWidth: { md: '600px', lg: '800px' },
          maxWidth: { md: '60vw', lg: '70vw' },
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* Header: top row holds the section overline + action buttons,
          and the strip below mirrors the first few cells of the
          /shifts table (company avatar, worksite, PO#, date+time, job)
          so a recruiter never loses context of which shift they're
          inside. Visual hierarchy: overline → strip → divider → tabs. */}
      <Box
        sx={{
          px: 2.5,
          pt: 1.5,
          pb: 1.25,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Stack
          direction="row"
          spacing={1.25}
          alignItems="baseline"
          sx={{ minWidth: 0 }}
        >
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ letterSpacing: 1.1, lineHeight: 1.4 }}
          >
            Placements
          </Typography>
          {/* Requested / Confirmed counts. Mirrors the table's Staff
              column (numerator = confirmed, denominator = requested)
              but rendered inline with the section header so the count
              is visible regardless of which tab is active. We only
              render when at least one of the values is known so the
              header doesn't show a stale "0 / 0" before hydration. */}
          {shift &&
            (shift.confirmedCount != null || shift.totalStaffRequested != null) && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontWeight: 500, whiteSpace: 'nowrap' }}
              >
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
                  {shift.totalStaffRequested ?? '—'}
                </Box>{' '}
                Requested ·{' '}
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
                  {shift.confirmedCount ?? 0}
                </Box>{' '}
                Confirmed
              </Typography>
            )}
        </Stack>
        <Stack direction="row" spacing={0.5}>
          {jobOrderId && (
            <IconButton
              onClick={handleOpenJobOrder}
              size="small"
              title="Open full job order in new tab"
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          )}
          <IconButton onClick={onClose} size="small" title="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>

      <Box
        sx={{
          px: 2.5,
          pb: 1.5,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 2,
          minWidth: 0,
        }}
      >
        {/* Company avatar — same 36px size and rounded-square shape
            as the company column in the table. Tooltip carries the
            company name so the strip itself stays compact. */}
        <Tooltip title={shift?.companyName || ''} arrow>
          <Avatar
            src={shift?.companyLogoUrl || undefined}
            alt={shift?.companyName || 'Company'}
            variant="rounded"
            sx={{
              width: 40,
              height: 40,
              fontSize: '0.875rem',
              bgcolor: 'background.default',
              color: 'text.secondary',
              border: '1px solid',
              borderColor: 'divider',
              flexShrink: 0,
            }}
          >
            {(shift?.companyName || '?').charAt(0).toUpperCase()}
          </Avatar>
        </Tooltip>

        {/* Field strip — four logical columns matching the table. Each
            column is a Stack with a small caption label on top and 1-3
            value lines beneath. Wraps on narrow viewports because the
            drawer maxes at 70vw on lg+ but `xs` is 100% and would
            otherwise overflow. */}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            rowGap: 1.25,
            columnGap: 3,
            flex: 1,
            minWidth: 0,
          }}
        >
          <HeaderField label="Worksite" sx={{ minWidth: 200, flex: '1 1 220px' }}>
            {shift?.worksiteName ? (
              <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.35 }}>
                {shift.worksiteName}
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">
                —
              </Typography>
            )}
            {shift?.worksiteStreet && (
              <Typography variant="caption" color="text.secondary">
                {shift.worksiteStreet}
              </Typography>
            )}
            {shift?.worksiteCityStateZip && (
              <Typography variant="caption" color="text.secondary">
                {shift.worksiteCityStateZip}
              </Typography>
            )}
          </HeaderField>

          <HeaderField label="PO#" sx={{ minWidth: 80 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {shift?.poNumber?.trim() || '—'}
            </Typography>
          </HeaderField>

          <HeaderField label="Date" sx={{ minWidth: 150 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {shift?.dateLabel || '—'}
            </Typography>
            {shift?.timeLabel && shift.timeLabel !== '—' && (
              <Typography variant="caption" color="text.secondary">
                {shift.timeLabel}
              </Typography>
            )}
          </HeaderField>

          <HeaderField label="Job" sx={{ minWidth: 160, flex: '1 1 180px' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {shift?.shiftTitle?.trim() || 'Shift'}
            </Typography>
            {shift?.jobTitle?.trim() && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {shift.jobTitle.trim()}
              </Typography>
            )}
          </HeaderField>

          {/* Financials — mirrors the /shifts table Financials cell:
              top line is Pay/Bill/Markup, second line is the tax-rate
              triplet. Renders an em-dash when nothing is set instead
              of being hidden so the column position is stable when a
              recruiter swaps between shifts of the same JO.
              R.16.2a — `shift.markupPercent` is already produced by
              `useActiveShifts.readJoFinancials`, which wraps the JO-doc
              read through `getEffectiveJobOrderPositionField`. No JO
              doc is in scope here, so no second-tier wrap is needed
              (the upstream wrap already enforces snapshot precedence
              for the value displayed below). */}
          <HeaderField label="Financials" sx={{ minWidth: 200 }}>
            {shift &&
            (shift.payRate != null ||
              shift.billRate != null ||
              shift.wcRate != null ||
              shift.sutaRate != null ||
              shift.futaRate != null) ? (
              <>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 500, whiteSpace: 'nowrap' }}
                >
                  Pay: {fmtMoney(shift.payRate)} · Bill: {fmtMoney(shift.billRate)}
                  {shift.markupPercent != null &&
                    Number.isFinite(shift.markupPercent) && (
                      <> ({fmtPct(shift.markupPercent)})</>
                    )}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  FUTA: {fmtPct(shift.futaRate)} · SUTA: {fmtPct(shift.sutaRate)} · WC:{' '}
                  {fmtPct(shift.wcRate)}
                </Typography>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                —
              </Typography>
            )}
          </HeaderField>
        </Box>
      </Box>

      <Divider />

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pl: 2.5,
          pr: 2.5,
          py: 1.25,
          gap: 1.25,
        }}
      >
        {/* Pill tabs styled to match /shifts (Active/Past/Recurring/Drafts) */}
        <Box sx={{ display: 'flex', gap: 0.35, alignItems: 'center' }}>
          {(
            [
              { id: 'assignments', label: 'Assignments' },
              { id: 'settings', label: 'Settings' },
              { id: 'instructions', label: 'Instructions' },
              { id: 'requirements', label: 'Requirements' },
              { id: 'promotion', label: 'Promotion' },
            ] as const
          ).map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <Button
                key={tab.id}
                variant="text"
                onClick={() => setActiveTab(tab.id)}
                sx={{
                  textTransform: 'none',
                  borderRadius: '999px',
                  fontSize: '13px',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                  bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                  px: 1.25,
                  py: 0.5,
                  minHeight: 30,
                  minWidth: 'auto',
                  whiteSpace: 'nowrap',
                  '&:hover': {
                    bgcolor: isActive ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                  },
                }}
              >
                {tab.label}
              </Button>
            );
          })}
        </Box>
        {jobOrder && (
          <Button
            size="small"
            disableRipple
            onClick={() => void handleToggleMute()}
            disabled={togglingMute || loading}
            startIcon={
              placementNotificationsMuted ? (
                <NotificationsOffIcon fontSize="small" />
              ) : (
                <NotificationsActiveIcon fontSize="small" />
              )
            }
            sx={{
              textTransform: 'none',
              fontWeight: 500,
              px: 1,
              minWidth: 'auto',
              color: placementNotificationsMuted ? 'warning.main' : 'text.secondary',
              '&:hover': {
                background: 'transparent',
                color: placementNotificationsMuted ? 'warning.dark' : 'text.primary',
              },
            }}
          >
            {placementNotificationsMuted ? 'Notifications Muted' : 'Mute Notifications'}
          </Button>
        )}
      </Box>

      <Divider />
      {muteError && (
        <Alert severity="error" sx={{ mx: 2.5, mt: 1 }} onClose={() => setMuteError(null)}>
          {muteError}
        </Alert>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        )}
        {!loading && error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        )}
        {!loading && !error && jobOrder && tenantId && jobOrderId && (
          <>
            {/* Assignments tab — keep PlacementsTab mounted (display:none
                when inactive) so dragging workers between the pool and
                assignments doesn't reset on a tab toggle. The Settings
                tab is cheap and re-renders on activation. */}
            <Box
              sx={{
                px: 1.5,
                pb: 2,
                display: activeTab === 'assignments' ? 'block' : 'none',
              }}
            >
              <PlacementsTab
                tenantId={tenantId}
                jobOrderId={jobOrderId}
                jobOrder={jobOrder}
                connectedJobPostIds={[]}
                hiringEntityName={null}
                placementHiringEntityId={null}
                lockedShiftId={shift?.id ?? null}
              />
            </Box>
            {activeTab === 'settings' && (
              <Box sx={{ px: 2.5, py: 2 }}>
                {shiftDocLoading && (
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      py: 6,
                    }}
                  >
                    <CircularProgress />
                  </Box>
                )}
                {!shiftDocLoading && shiftDocError && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {shiftDocError}
                  </Alert>
                )}
                {!shiftDocLoading && !shiftDocError && shiftDoc && (
                  <>
                    {settingsSaveMessage && (
                      <Alert
                        severity="success"
                        sx={{ mb: 2 }}
                        onClose={() => setSettingsSaveMessage(null)}
                      >
                        {settingsSaveMessage}
                      </Alert>
                    )}
                    <EditShiftForm
                      tenantId={tenantId}
                      jobOrderId={jobOrderId}
                      jobOrder={jobOrder}
                      shift={shiftDoc}
                      onSaved={(message) => {
                        setSettingsSaveMessage(message);
                        // Reload the shift doc so the form re-hydrates
                        // with whatever the server now has (including
                        // any deleteField() pruning we just performed).
                        setShiftDocReloadKey((n) => n + 1);
                      }}
                      onCancel={onClose}
                      submitLabel="Update Shift"
                    />
                  </>
                )}
              </Box>
            )}
            {activeTab === 'instructions' && (
              <Box sx={{ px: 2.5, py: 2.5 }}>
                {!jobOrder ? (
                  <Alert severity="info">Loading job order…</Alert>
                ) : (
                  <InstructionsSummary jobOrder={jobOrder} />
                )}
              </Box>
            )}
            {activeTab === 'requirements' && (
              <Box sx={{ px: 2.5, py: 2.5 }}>
                {!jobOrder ? (
                  <Alert severity="info">Loading job order…</Alert>
                ) : (
                  <RequirementsSummary jobOrder={jobOrder} />
                )}
              </Box>
            )}
            {activeTab === 'promotion' && (
              <Box sx={{ px: 2.5, py: 2.5 }}>
                {!jobOrder || !tenantId || !jobOrderId ? (
                  <Alert severity="info">Loading job order…</Alert>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <PostingUrlsCard tenantId={tenantId} jobOrderId={jobOrderId} />
                    <JobOrderAutoMessagingTab
                      tenantId={tenantId}
                      jobOrderId={jobOrderId}
                      jobOrder={jobOrder}
                      onJobOrderUpdated={() => {
                        void refreshJobOrder();
                      }}
                    />
                  </Box>
                )}
              </Box>
            )}
          </>
        )}
      </Box>
    </Drawer>
  );
};

// Read-only mirror of the JO Detail page's "Staff Instructions" tab.
// Reads `jobOrder.staffInstructions[fieldKey]` (same shape `StaffInstructionCard`
// writes: `{ text, files }`). Edits live on the JO Staff Instructions tab; this
// view simply surfaces whatever's there per section, with a dash for empty
// fields and read-only "View" links for attachments. Mirrors the
// `RequirementsSummary` design (uppercase section heading, body row, dash
// fallback) so the drawer's read-only tabs feel consistent.
const InstructionsSummary: React.FC<{ jobOrder: JobOrder }> = ({ jobOrder }) => {
  const jo = jobOrder as unknown as Record<string, unknown>;
  const staffInstructions =
    (jo.staffInstructions as Record<string, unknown> | undefined) ?? {};

  // Match `StaffInstructionCard.instructionTextToString` so legacy shapes
  // (`{ en, instructions, text: { en } }`) all collapse to a clean string.
  const toText = (value: unknown): string => {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const o = value as Record<string, unknown>;
      if (typeof o.en === 'string') return o.en;
      if (typeof o.instructions === 'string') return o.instructions;
      if (typeof o.text === 'string') return o.text;
      const nested = o.text as Record<string, unknown> | undefined;
      if (nested && typeof nested.en === 'string') return nested.en;
    }
    return '';
  };

  type InstructionFile = {
    label?: string;
    name?: string;
    url?: string;
    uploadedAt?: string | number | Date | null;
  };
  const filesFor = (entry: unknown): InstructionFile[] => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = (entry as { files?: unknown }).files;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((f): f is InstructionFile => !!f && typeof f === 'object')
      .filter((f) => typeof f.url === 'string' && f.url.trim().length > 0);
  };

  const dash = '—';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="body2" color="text.secondary">
        Reflects the parent job order&apos;s Staff Instructions. Edit on the Job Order
        Staff Instructions tab.
      </Typography>
      {INSTRUCTION_SECTIONS.map((section) => {
        const entry = staffInstructions[section.fieldKey];
        const rawText = entry == null ? '' : toText(
          (entry as { text?: unknown })?.text ?? entry,
        );
        const text = rawText.trim();
        const files = filesFor(entry);
        const hasAnything = text.length > 0 || files.length > 0;
        // Skip the dedicated attachments-only card (`section.placeholder === ''`)
        // when no files are attached — keeps the read-only view compact.
        if (section.placeholder === '' && files.length === 0) return null;

        return (
          <Box key={section.fieldKey}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: 'block',
                mb: 1,
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {section.title}
            </Typography>
            {section.placeholder !== '' && (
              <Typography
                variant="body2"
                color={text ? 'text.primary' : 'text.secondary'}
                sx={{ whiteSpace: 'pre-wrap', mb: files.length > 0 ? 1 : 0 }}
              >
                {text || dash}
              </Typography>
            )}
            {files.length > 0 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {files.map((file, idx) => {
                  const label =
                    (file.label && file.label.trim()) ||
                    (file.name && file.name.trim()) ||
                    'Attachment';
                  const uploaded = (() => {
                    if (!file.uploadedAt) return '';
                    try {
                      return format(new Date(file.uploadedAt), 'MMM dd, yyyy');
                    } catch {
                      return '';
                    }
                  })();
                  return (
                    <Box
                      key={`${section.fieldKey}-${idx}`}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        p: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        bgcolor: 'grey.50',
                      }}
                    >
                      <DescriptionIcon fontSize="small" color="primary" />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={500} noWrap>
                          {label}
                        </Typography>
                        {(file.name || uploaded) && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block' }}
                          >
                            {[file.name, uploaded].filter(Boolean).join(' • ')}
                          </Typography>
                        )}
                      </Box>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<OpenInNewIcon fontSize="small" />}
                        onClick={() =>
                          file.url &&
                          window.open(file.url, '_blank', 'noopener,noreferrer')
                        }
                        sx={{ textTransform: 'none', borderRadius: '20px' }}
                      >
                        View
                      </Button>
                    </Box>
                  );
                })}
              </Box>
            )}
            {/* In the rare case where text is empty but the section is shown
                because of file presence, keep layout tidy: nothing else to add. */}
            {!hasAnything && section.placeholder !== '' ? null : null}
          </Box>
        );
      })}
    </Box>
  );
};

// Read-only mirror of the JO Overview "Compliance & Requirements" section.
// Reads top-level JO fields (preferred — those are what `JobOrderForm` writes
// alongside its denormalized `stageData.scoping.compliance.*` paths) with the
// `stageData.scoping.compliance` shape as a fallback. Edits live on the
// JO Overview tab; this view reflects whatever the JO doc currently holds.
const RequirementsSummary: React.FC<{ jobOrder: JobOrder }> = ({ jobOrder }) => {
  const jo = jobOrder as unknown as Record<string, unknown>;
  const scoping =
    ((jo.stageData as Record<string, unknown> | undefined)?.scoping as
      | Record<string, unknown>
      | undefined) ||
    ((jo.deal as { stageData?: { scoping?: Record<string, unknown> } } | undefined)?.stageData
      ?.scoping as Record<string, unknown> | undefined) ||
    {};
  const compliance = (scoping.compliance as Record<string, unknown> | undefined) ?? {};

  const asArray = (...candidates: unknown[]): string[] => {
    for (const c of candidates) {
      if (Array.isArray(c)) {
        const list = c.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
        if (list.length) return list;
      } else if (typeof c === 'string' && c.trim().length > 0) {
        return [c.trim()];
      }
    }
    return [];
  };
  const asScalar = (...candidates: unknown[]): string => {
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length > 0) return c.trim();
      if (typeof c === 'number') return String(c);
      if (typeof c === 'boolean') return c ? 'Yes' : 'No';
    }
    return '';
  };

  const labelForOption = (
    options: ReadonlyArray<{ value: string; label: string }>,
    value: string,
  ) => options.find((o) => o.value === value)?.label ?? value;

  const screeningPackageId = asScalar(jo.screeningPackageId);
  const screeningPackageName = asScalar(jo.screeningPackageName);
  const screeningPackageLabel = screeningPackageId
    ? screeningPackageName
      ? `${screeningPackageName} (${screeningPackageId})`
      : screeningPackageId
    : '';

  const backgroundCheckPackages = Array.from(
    new Set(asArray(jo.backgroundCheckPackages, compliance.backgroundCheckPackages)),
  );
  // R.0d (Apr 2026): drugScreeningPanels removed from the requirements
  // summary — soft-deprecated by the Readiness Rebuild; subsumed by the
  // AccuSource package + Additional Screenings rows. Existing JO data
  // remains in Firestore but is no longer surfaced here. See
  // docs/READINESS_R0_HANDOFF.md.
  const additionalScreenings = Array.from(
    new Set(asArray(jo.additionalScreenings, compliance.additionalScreenings)),
  );
  const licensesCerts = Array.from(
    new Set(
      asArray(
        jo.licensesCerts,
        jo.requiredLicenses,
        jo.requiredCertifications,
        compliance.licensesCerts,
        scoping.licensesCerts,
      ),
    ),
  );
  const skills = Array.from(
    new Set(asArray(jo.skillsRequired, compliance.skills, scoping.skills)),
  );
  const languages = Array.from(
    new Set(asArray(jo.languagesRequired, compliance.languages, scoping.languages)),
  );
  const physicalRequirements = Array.from(
    new Set(asArray(jo.physicalRequirements, compliance.physicalRequirements, scoping.physicalRequirements)),
  );
  const ppeRequirements = Array.from(
    new Set(asArray(jo.ppeRequirements, compliance.ppe, scoping.ppe)),
  );
  const uniformRequirements = Array.from(
    new Set(asArray(jo.uniformRequirements, scoping.uniformRequirements)),
  );

  const experienceRaw = asScalar(jo.experienceRequired, compliance.experience, scoping.experience);
  const experienceLabel = experienceRaw ? labelForOption(experienceOptions, experienceRaw) : '';
  const educationRaw = asScalar(jo.educationRequired, compliance.education);
  const educationLabel = educationRaw ? labelForOption(educationOptions, educationRaw) : '';
  const ppeProvidedByRaw = asScalar(jo.ppeProvidedBy, compliance.ppeProvidedBy);
  const ppeProvidedByLabel = ppeProvidedByRaw
    ? ppeProvidedByRaw.charAt(0).toUpperCase() + ppeProvidedByRaw.slice(1)
    : '';
  const customUniformRequirements = asScalar(
    jo.customUniformRequirements,
    scoping.customUniformRequirements,
  );
  const requirementPackId = asScalar(jo.requirementPackId);
  const requirementPackLabel = requirementPackId
    ? JOB_REQUIREMENT_PACKS[requirementPackId as keyof typeof JOB_REQUIREMENT_PACKS]?.name ??
      requirementPackId
    : '';

  const eVerifyLabel = asScalar(
    jo.eVerifyRequired,
    compliance.eVerify,
    (jo as { eVerify?: unknown }).eVerify,
  );

  type Row =
    | { kind: 'chips'; label: string; values: string[] }
    | { kind: 'text'; label: string; value: string };

  const sections: Array<{ heading: string; rows: Row[] }> = [
    {
      heading: 'Screening',
      rows: [
        { kind: 'text', label: 'AccuSource Package', value: screeningPackageLabel },
        { kind: 'chips', label: 'Background Check Packages', values: backgroundCheckPackages },
        { kind: 'chips', label: 'Additional Screenings', values: additionalScreenings },
        { kind: 'text', label: 'E-Verify', value: eVerifyLabel },
      ],
    },
    {
      heading: 'Qualifications',
      rows: [
        { kind: 'text', label: 'Experience Required', value: experienceLabel },
        { kind: 'text', label: 'Education Required', value: educationLabel },
        { kind: 'chips', label: 'Licenses & Certifications', values: licensesCerts },
        { kind: 'chips', label: 'Languages Required', values: languages },
        { kind: 'chips', label: 'Skills Required', values: skills },
      ],
    },
    {
      heading: 'Workplace',
      rows: [
        { kind: 'chips', label: 'Physical Requirements', values: physicalRequirements },
        { kind: 'chips', label: 'PPE Requirements', values: ppeRequirements },
        { kind: 'text', label: 'PPE Provided By', value: ppeProvidedByLabel },
        { kind: 'chips', label: 'Uniform / Dress Code', values: uniformRequirements },
        { kind: 'text', label: 'Custom Uniform Notes', value: customUniformRequirements },
        { kind: 'text', label: 'Job Score Requirement Pack', value: requirementPackLabel },
      ],
    },
  ];

  const dash = '—';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="body2" color="text.secondary">
        Reflects the parent job order&apos;s Compliance &amp; Requirements. Edit on the Job Order
        Overview tab.
      </Typography>
      {sections.map((section) => (
        <Box key={section.heading}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'block',
              mb: 1,
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {section.heading}
          </Typography>
          <Grid container spacing={2}>
            {section.rows.map((row) => (
              <Grid item xs={12} md={6} key={row.label}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, mb: 0.5 }}
                >
                  {row.label}
                </Typography>
                {row.kind === 'chips' ? (
                  row.values.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {dash}
                    </Typography>
                  ) : (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {row.values.map((v) => (
                        <Chip key={v} label={v} size="small" variant="outlined" />
                      ))}
                    </Box>
                  )
                ) : (
                  <Typography variant="body2" sx={{ fontWeight: row.value ? 500 : 400 }} color={row.value ? 'text.primary' : 'text.secondary'}>
                    {row.value || dash}
                  </Typography>
                )}
              </Grid>
            ))}
          </Grid>
        </Box>
      ))}
    </Box>
  );
};

// Read-only card showing the JO's external job-board URLs (Craigslist, Indeed)
// plus a button to open the public Jobs Board posting in a new tab.
// We pull these from the latest `job_postings` doc linked to the job order.
// External URLs are edited on the Job Posting itself; the public Jobs Board
// link follows the canonical `/c1/jobs-board/{postId}` route.
const PostingUrlsCard: React.FC<{ tenantId: string; jobOrderId: string }> = ({
  tenantId,
  jobOrderId,
}) => {
  const [craigslistUrl, setCraigslistUrl] = useState<string>('');
  const [indeedUrl, setIndeedUrl] = useState<string>('');
  const [postId, setPostId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!tenantId || !jobOrderId) return;
      setLoading(true);
      try {
        const postingsRef = collection(db, 'tenants', tenantId, 'job_postings');
        // Most recent posting wins; if multiple have URLs we take the newest one.
        let snap;
        try {
          snap = await getDocs(
            query(
              postingsRef,
              where('jobOrderId', '==', jobOrderId),
              orderBy('createdAt', 'desc'),
              fsLimit(5),
            ),
          );
        } catch {
          // Fallback if the composite index isn't available yet.
          snap = await getDocs(query(postingsRef, where('jobOrderId', '==', jobOrderId)));
        }
        if (cancelled) return;
        let craig = '';
        let indeed = '';
        let firstPostId = '';
        for (const d of snap.docs) {
          if (!firstPostId) firstPostId = d.id;
          const data = d.data() as { craigslistUrl?: unknown; indeedUrl?: unknown };
          if (!craig && typeof data.craigslistUrl === 'string' && data.craigslistUrl.trim()) {
            craig = data.craigslistUrl.trim();
          }
          if (!indeed && typeof data.indeedUrl === 'string' && data.indeedUrl.trim()) {
            indeed = data.indeedUrl.trim();
          }
          if (craig && indeed) break;
        }
        setPostId(firstPostId);
        setCraigslistUrl(craig);
        setIndeedUrl(indeed);
      } catch (e) {
        console.error('Failed to load job posting URLs', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [tenantId, jobOrderId]);

  const renderField = (label: string, value: string) => (
    <TextField
      label={label}
      value={loading ? '' : value}
      placeholder={loading ? 'Loading…' : 'Not set'}
      fullWidth
      size="small"
      InputProps={{
        readOnly: true,
        endAdornment: value ? (
          <Tooltip title="Open in new tab">
            <IconButton
              size="small"
              onClick={() => window.open(value, '_blank', 'noopener,noreferrer')}
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : undefined,
      }}
    />
  );

  const publicPostingUrl = postId
    ? `${window.location.origin}/c1/jobs-board/${postId}`
    : '';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={<OpenInNewIcon fontSize="small" />}
          disabled={loading || !publicPostingUrl}
          onClick={() =>
            publicPostingUrl &&
            window.open(publicPostingUrl, '_blank', 'noopener,noreferrer')
          }
          sx={{ textTransform: 'none', borderRadius: '24px' }}
        >
          {loading
            ? 'Loading…'
            : publicPostingUrl
              ? 'Open Public Posting'
              : 'No public posting yet'}
        </Button>
      </Box>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          {renderField('Craigslist URL', craigslistUrl)}
        </Grid>
        <Grid item xs={12} md={6}>
          {renderField('Indeed URL', indeedUrl)}
        </Grid>
      </Grid>
    </Box>
  );
};

export default ShiftPlacementsDrawer;
