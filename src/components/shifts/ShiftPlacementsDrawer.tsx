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

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { Close as CloseIcon, OpenInNew as OpenInNewIcon } from '@mui/icons-material';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';
import PlacementsTab from '../recruiter/PlacementsTab';
import type { JobOrder } from '../../types/recruiter/jobOrder';
import EditShiftForm, { type ShiftFormShift } from './EditShiftForm';

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
  const [activeTab, setActiveTab] = useState<'assignments' | 'settings'>(
    'assignments',
  );
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
          // Cast — the Firestore doc shape is broader than the TS interface,
          // but PlacementsTab tolerates extra fields and the few fields it
          // strictly needs are all present on real JO docs.
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
                variant="caption"
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
              recruiter swaps between shifts of the same JO. */}
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

      <Tabs
        value={activeTab}
        onChange={(_, value) => setActiveTab(value as typeof activeTab)}
        sx={{
          px: 2.5,
          minHeight: 40,
          '& .MuiTab-root': {
            minHeight: 40,
            textTransform: 'none',
            fontWeight: 500,
          },
        }}
      >
        <Tab value="assignments" label="Assignments" />
        <Tab value="settings" label="Settings" />
      </Tabs>

      <Divider />

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
          </>
        )}
      </Box>
    </Drawer>
  );
};

export default ShiftPlacementsDrawer;
