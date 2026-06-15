/**
 * Per-shift Assignments column card. Phase 1b extraction: pure
 * presentational refactor of the JSX that previously lived inline in
 * `PlacementsTab.tsx`. All data + handlers are passed in as props —
 * no Firestore I/O, no useState — so this component renders identically
 * regardless of how the parent groups workers across shifts.
 *
 * Phase 2: parent renders N cards (one per shift in the current
 * `visibleShifts` set) and drives expand/collapse via `isExpanded` +
 * `onToggleExpand`. Accordion behavior (only one card expanded at a
 * time) lives in the parent so the "Shift Applicants" worker-pool
 * filter has an unambiguous anchor.
 */
import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Cancel as CancelIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  Email as EmailIcon,
  Error as ErrorIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  ForwardToInbox as ForwardToInboxIcon,
  GetApp as GetAppIcon,
  Lock as LockedIcon,
  LockOpen as UnlockedIcon,
  Refresh as RefreshIcon,
  Sms as SmsIcon,
  Visibility as VisibilityIcon,
} from '@mui/icons-material';

import type { JobOrder } from '../../types/recruiter/jobOrder';
import { buildShiftPickerSecondLine } from '../../utils/shiftPickerLabel';
import {
  placementRequiredCertMatchList,
} from '../../utils/placementTileWorkforceSignals';
import type {
  JobReadinessChipContributor,
  JobReadinessChipData,
} from '../../shared/jobReadinessChip/types';
import {
  type Worker,
  placementActionChipSx,
  placementActionIconBtnSx,
  PlacementProfileActionIcons,
  PlacementWorkerTileMainColumn,
} from './placementsTileShared';

/**
 * Minimal shape this component reads off the selected Shift doc.
 * Kept structurally compatible with the `Shift` interface in
 * `PlacementsTab.tsx` (no index signature, same field set). Extra
 * legacy fields like `totalStaffRequested` / `staffNeeded` /
 * `workersNeeded` are accessed via `(selectedShift as any)` casts
 * inside the component since they're written by varied callers.
 * Phase 2 tightens the typing once the multi-shift refactor settles.
 */
export interface ShiftForCard {
  id: string;
  shiftTitle?: string;
  shiftDate?: string;
  startTime?: string;
  endTime?: string;
  spotsRemaining?: number;
  staffNeeded?: number;
}

export interface DayOptionForCard {
  date: string;
  dayLabel?: string;
  workersNeeded?: number;
  overstaff?: number;
}

export interface ShiftAssignmentCardProps {
  /** Drawer mode strips the elevated Card chrome + flattens the dropzone. */
  lockedShiftId: string | null;
  /** Currently selected shift id; `''` shows the "Select a shift…" alert. */
  selectedShiftId: string;
  /** The shift doc matching `selectedShiftId` (undefined if not found). */
  selectedShift: ShiftForCard | undefined;
  /** Per-shift placed/confirmed counts for the header (undefined while loading). */
  fillCounts?: { placed: number; confirmed: number };
  selectedDay: string;
  dayOptions: DayOptionForCard[];
  jobOrder: JobOrder | null;

  /** Workers in the Assignments column for `selectedShiftId`. */
  displayedAssignedWorkers: Worker[];
  shiftStartDateStr: string;

  // ── Selection state ──────────────────────────────────────────────────
  selectedAssignmentWorkerIds: Set<string>;
  isAllAssignmentsSelected: boolean;
  isSomeAssignmentsSelected: boolean;
  onSelectAllAssignments: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectOneAssignment: (workerId: string) => void;
  onClearAssignmentSelection: () => void;

  // ── Bulk actions ─────────────────────────────────────────────────────
  bulkAcceptBusy: boolean;
  bulkCancelBusy: boolean;
  onBulkAccept: () => void;
  onBulkCancel: () => void;
  onOpenBulkEmailDrawer: () => void;
  onOpenBulkSmsDrawer: () => void;

  // ── Export / Preview ────────────────────────────────────────────────
  onExportAssignmentsCsv: () => void;
  onPreviewEmail: () => void;
  /**
   * Resend the confirmation email (+ short SMS ping) to every confirmed
   * worker on this shift. Fires the `resendShiftConfirmationsToConfirmedStaff`
   * callable. Recruiter typically uses this when the JO's check-in
   * instructions / parking / start time changed and they want every
   * confirmed worker to see the latest details.
   */
  onResendConfirmations: () => void;
  /** Spinner state for the resend icon button. */
  resendingShiftConfirmations?: boolean;

  // ── Drag-and-drop dropzone state ────────────────────────────────────
  isAssignmentDragOver: boolean;
  onAssignmentsDragOver: (e: React.DragEvent) => void;
  onAssignmentsDragLeave: () => void;
  onAssignmentsDrop: (e: React.DragEvent) => void;
  onWorkerDragStart: (e: React.DragEvent, workerId: string) => void;

  // ── Per-worker hire / confirm / cancel flow ─────────────────────────
  confirmingPlacementUserId: string | null;
  confirmLoadingAssignmentId: string | null;
  resendLoadingAssignmentId: string | null;
  resendCooldownUntilByAssignmentId: Record<string, number>;
  onConfirmPlacement: (worker: Worker) => void;
  onConfirmForWorker: (worker: Worker) => void;
  onResendOffer: (worker: Worker) => void;
  /**
   * Per-worker confirmation resend — fires next to the "Confirmed Jun X"
   * timestamp on confirmed tiles. Sends the latest assignment-details
   * email + a short SMS pointer. Shares loading + cooldown state with
   * the offer-resend path.
   */
  onResendConfirmation: (worker: Worker) => void;
  onCancelAssignment: (worker: Worker) => void;
  /**
   * Revert a declined assignment back to 'pending' so the recruiter can
   * re-offer / re-confirm. Clicking the red Declined chip calls this.
   * Loading state is shared with the confirm-for-worker handler since
   * the chip itself swaps in for the Accept/Confirm controls.
   */
  onRevertDecline: (worker: Worker) => void;
  /**
   * Symmetric undo for the red Cancelled chip — flips a cancelled
   * assignment back to 'pending' so the recruiter can un-do an
   * accidental cancellation. Only meaningful when the assignment doc
   * still has status='cancelled' (i.e., the cancel flow's downstream
   * delete-and-replace-with-placement step hasn't completed yet).
   */
  onRevertCancel: (worker: Worker) => void;
  onOpenEditStartDate: (worker: Worker) => void;

  // ── Tile readiness/blocker data (forwarded to PlacementWorkerTileMainColumn) ──
  hiringEntityName: string | null | undefined;
  entityEmploymentByUserId: Map<string, Record<string, unknown>>;
  placementEntityEmploymentLoading: boolean;
  blockerLabelsForAssignmentId: (assignmentId: string | undefined) => string[];
  onboardingMissingLabelsForAssignmentId: (assignmentId: string | undefined) => string[];
  jobReadinessChipDataForAssignmentId: (assignmentId: string | undefined) => JobReadinessChipData | null;
  onJobReadinessItemClick: (
    workerUid: string,
    assignmentId: string | null | undefined,
    contributor: JobReadinessChipContributor,
  ) => void;

  // ── Modal openers (resume / licenses / certs) ───────────────────────
  onOpenResume: (resumeUrl: string, fileName: string | undefined) => void;
  onOpenLicenses: (licenses: any[]) => void;
  onOpenCerts: (certs: any[]) => void;

  // ── Pure helper passthrough ─────────────────────────────────────────
  formatDateDisplay: (raw: string | undefined | null) => string;

  // ── Phase 2: accordion expand/collapse ──────────────────────────────
  /**
   * When `undefined`, the card renders its full body always-expanded
   * (Phase 1 single-shift behavior + drawer mode). When set, the
   * parent owns the expanded state; the card body collapses behind
   * a `<Collapse>` and the header gains an expand/collapse chevron.
   */
  isExpanded?: boolean;
  /** Called when the user clicks the header to toggle this card. */
  onToggleExpand?: () => void;
}

export function ShiftAssignmentCard({
  lockedShiftId,
  selectedShiftId,
  selectedShift,
  fillCounts,
  selectedDay,
  dayOptions,
  jobOrder,
  displayedAssignedWorkers,
  shiftStartDateStr,
  selectedAssignmentWorkerIds,
  isAllAssignmentsSelected,
  isSomeAssignmentsSelected,
  onSelectAllAssignments,
  onSelectOneAssignment,
  onClearAssignmentSelection,
  bulkAcceptBusy,
  bulkCancelBusy,
  onBulkAccept,
  onBulkCancel,
  onOpenBulkEmailDrawer,
  onOpenBulkSmsDrawer,
  onExportAssignmentsCsv,
  onPreviewEmail,
  onResendConfirmations,
  resendingShiftConfirmations,
  isAssignmentDragOver,
  onAssignmentsDragOver,
  onAssignmentsDragLeave,
  onAssignmentsDrop,
  onWorkerDragStart,
  confirmingPlacementUserId,
  confirmLoadingAssignmentId,
  resendLoadingAssignmentId,
  resendCooldownUntilByAssignmentId,
  onConfirmPlacement,
  onConfirmForWorker,
  onResendOffer,
  onResendConfirmation,
  onCancelAssignment,
  onRevertDecline,
  onRevertCancel,
  onOpenEditStartDate,
  hiringEntityName,
  entityEmploymentByUserId,
  placementEntityEmploymentLoading,
  blockerLabelsForAssignmentId,
  onboardingMissingLabelsForAssignmentId,
  jobReadinessChipDataForAssignmentId,
  onJobReadinessItemClick,
  onOpenResume,
  onOpenLicenses,
  onOpenCerts,
  formatDateDisplay,
  isExpanded,
  onToggleExpand,
}: ShiftAssignmentCardProps) {
  // Accordion mode = parent passed in a defined `isExpanded` (Phase 2).
  // Legacy single-shift mode (Phase 1 + drawer) leaves it undefined and
  // we render the body always-expanded with no chevron.
  const isAccordionMode = isExpanded !== undefined;
  const showBody = !isAccordionMode || isExpanded;
  return (
    <Card
      elevation={0}
      // Phase 3: per-card drop target. The whole Card root accepts
      // the drop (not just the body) so collapsed cards are valid
      // drop targets too — the parent auto-expands the card after a
      // successful drop to surface the new placement.
      onDragOver={onAssignmentsDragOver}
      onDragLeave={onAssignmentsDragLeave}
      onDrop={onAssignmentsDrop}
      sx={{
        height: '100%',
        // Strip the theme's `MuiCard.styleOverrides` chrome:
        // `createBaseTheme` registers `padding: 24` plus a
        // hover state that re-applies the shadow. Theme
        // overrides outweigh sx without !important.
        // - Collapse Card padding to 0 so CardContent owns
        //   the visible inset (8px instead of the prior 16
        //   + Card's hidden 24 = effective 40)
        // - Remove the box shadow + the hover-re-applies-it
        //   trick — the column cards stay flat
        boxShadow: 'none !important',
        padding: '0 !important',
        // Phase 3: drag-over visual feedback on the whole card,
        // visible even when the body is collapsed so the recruiter
        // can confirm the drop target before releasing.
        transition: 'border-color 0.15s ease, background-color 0.15s ease',
        ...(isAssignmentDragOver && {
          borderColor: 'primary.main !important',
          backgroundColor: 'rgba(0,87,184,0.04) !important',
          boxShadow: '0 0 0 1px var(--mui-palette-primary-main) !important',
        }),
        '&:hover': {
          boxShadow: 'none !important',
          border: 'none !important',
          borderColor: 'transparent !important',
        },
        ...(lockedShiftId && {
          border: 'none !important',
          backgroundColor: 'transparent !important',
        }),
      }}
    >
      <CardContent
        sx={{
          p: lockedShiftId ? 0 : '12px',
          '&:last-child': { pb: lockedShiftId ? 0 : '12px' },
          overflow: 'visible',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 0.5, overflow: 'visible' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              minWidth: 0,
              flex: '0 1 auto',
              ...(isAccordionMode && {
                cursor: 'pointer',
                '&:hover': { opacity: 0.85 },
              }),
            }}
            onClick={isAccordionMode ? onToggleExpand : undefined}
          >
            {isAccordionMode && (
              <IconButton
                size="small"
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                sx={{ p: 0.25 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand?.();
                }}
              >
                {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            )}
            {/* The bulk-select checkbox only makes sense when the card is
                expanded (it acts on the visible tile list). Hide it when
                the body is collapsed so it doesn't toggle invisible rows. */}
            {showBody && selectedShiftId && displayedAssignedWorkers.length > 0 && (
              <Checkbox
                indeterminate={isSomeAssignmentsSelected && !isAllAssignmentsSelected}
                checked={isAllAssignmentsSelected}
                onChange={onSelectAllAssignments}
                size="small"
                aria-label="select all assignees"
                onClick={(e) => e.stopPropagation()}
              />
            )}
            {/* Two-line shift summary replaces the prior "Assignments (#)"
                heading. Line 1: shift title (same h6/600 weight as before).
                Line 2: caption with date(s) • times • job title • staff need
                (and overstaff when set). The standalone schedule + staff
                row that used to live below the column-row is removed —
                this consolidates it into the Assignments header. */}
            <Box sx={{ minWidth: 0 }}>
              {(() => {
                // Resolve staff-requested + overstaff for THIS shift (per-day
                // override when a multi-day day is selected, else shift-level).
                // Shown next to the shift name (replacing the old "(updated)"
                // label, 2026-06-04 request) so the count is always visible
                // even when the subtitle truncates.
                const dayEntry =
                  selectedDay && dayOptions.length > 0
                    ? dayOptions.find((d) => d.date === selectedDay)
                    : null;
                const staffReq =
                  dayEntry?.workersNeeded !== undefined
                    ? dayEntry.workersNeeded
                    : (selectedShift as any)?.totalStaffRequested ??
                      (selectedShift as any)?.staffNeeded ??
                      (selectedShift as any)?.workersNeeded;
                const overstaff =
                  dayEntry?.overstaff ??
                  (selectedShift as any)?.overstaffCount ??
                  (selectedShift as any)?.overstaff ??
                  0;
                const staffLabel =
                  typeof staffReq === 'number'
                    ? `Staff: ${staffReq}${
                        typeof overstaff === 'number' && overstaff > 0
                          ? ` (+${overstaff} overstaff)`
                          : ''
                      }`
                    : '';
                // Placed = anyone placed or non-cancelled-assigned on this shift;
                // Confirmed = confirmed assignments. Shown next to the staff need.
                const fillLabel = fillCounts
                  ? `${fillCounts.placed} placed · ${fillCounts.confirmed} confirmed`
                  : '';
                const secondLine = selectedShift
                  ? buildShiftPickerSecondLine(selectedShift as any, (jobOrder as any)?.jobTitle)
                  : '';
                return (
                  <>
                    <Typography variant="h6" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>
                      {selectedShift?.shiftTitle || 'Assignments'}
                      {staffLabel && (
                        <Typography
                          component="span"
                          sx={{ ml: 0.75, fontSize: '0.78rem', color: 'text.secondary', fontWeight: 500 }}
                        >
                          · {staffLabel}
                        </Typography>
                      )}
                      {fillCounts && (
                        <Typography
                          component="span"
                          sx={{ ml: 0.75, fontSize: '0.78rem', fontWeight: 600 }}
                        >
                          <Box component="span" sx={{ color: 'text.secondary' }}>
                            · {fillCounts.placed} placed
                          </Box>{' '}
                          <Box
                            component="span"
                            sx={{ color: fillCounts.confirmed > 0 ? 'success.main' : 'text.secondary' }}
                          >
                            · {fillCounts.confirmed} confirmed
                          </Box>
                        </Typography>
                      )}
                    </Typography>
                    {selectedShift && secondLine && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        sx={{ display: 'block', lineHeight: 1.3 }}
                      >
                        {secondLine}
                      </Typography>
                    )}
                  </>
                );
              })()}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: '0 0 auto', ml: 'auto' }}>
            <Tooltip title="Export confirmed staff as CSV">
              <span>
                <IconButton
                  size="small"
                  disabled={displayedAssignedWorkers.length === 0 || !selectedShiftId}
                  onClick={onExportAssignmentsCsv}
                  aria-label="Export"
                >
                  <GetAppIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Preview the confirmation email workers receive (staff details, parking, check-in, attachments)">
              <span>
                <IconButton
                  size="small"
                  disabled={!selectedShiftId}
                  onClick={onPreviewEmail}
                  aria-label="Preview confirmation email"
                >
                  <VisibilityIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Resend the latest confirmation email + SMS to every confirmed worker on this shift">
              <span>
                <IconButton
                  size="small"
                  disabled={
                    !selectedShiftId ||
                    !displayedAssignedWorkers.some(
                      (w) => w.assignmentStatus === 'confirmed' || w.assignmentStatus === 'active',
                    ) ||
                    resendingShiftConfirmations
                  }
                  onClick={onResendConfirmations}
                  aria-label="Resend confirmation to confirmed staff"
                >
                  {resendingShiftConfirmations ? (
                    <CircularProgress size={16} />
                  ) : (
                    <ForwardToInboxIcon fontSize="small" />
                  )}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
        <Collapse in={showBody} timeout="auto" unmountOnExit={false}>
        {isSomeAssignmentsSelected && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              px: 0,
              py: 1,
              mb: 0.5,
              borderBottom: 1,
              borderColor: 'divider',
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {selectedAssignmentWorkerIds.size} selected
            </Typography>
            <Tooltip title="Accept All">
              <span>
                <IconButton
                  size="small"
                  color="primary"
                  onClick={onBulkAccept}
                  disabled={bulkAcceptBusy || displayedAssignedWorkers.filter((w) => selectedAssignmentWorkerIds.has(w.id) && w.isPlacementOnly).length === 0}
                  aria-label="Accept All"
                >
                  {bulkAcceptBusy ? <CircularProgress size={20} /> : <CheckIcon />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Cancel All">
              <span>
                <IconButton
                  size="small"
                  color="error"
                  onClick={onBulkCancel}
                  disabled={bulkCancelBusy || displayedAssignedWorkers.filter((w) => selectedAssignmentWorkerIds.has(w.id) && !w.isPlacementOnly && w.assignmentId).length === 0}
                  aria-label="Cancel All"
                >
                  {bulkCancelBusy ? <CircularProgress size={20} /> : <CancelIcon />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Email All">
              <IconButton
                size="small"
                color="primary"
                onClick={onOpenBulkEmailDrawer}
                aria-label="Email All"
              >
                <EmailIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Message All">
              <IconButton
                size="small"
                color="primary"
                onClick={onOpenBulkSmsDrawer}
                aria-label="Message All"
              >
                <SmsIcon />
              </IconButton>
            </Tooltip>
            <Button
              size="small"
              onClick={onClearAssignmentSelection}
            >
              Clear selection
            </Button>
          </Box>
        )}
        {/* Phase 3: drop handlers moved up to the Card root so the
            whole card (header included) is a drop target. This inner
            Box keeps its visible affordance (dashed border + hint
            text) but no longer owns the event listeners. */}
        <Box
          sx={{
            borderRadius: 1,
            // Drawer mode keeps the dropzone visually flat:
            // resting state has no border / no shadow / 8px
            // padding. The drag-over state still flips the
            // border + bgcolor so the affordance survives.
            border: lockedShiftId
              ? isAssignmentDragOver
                ? '1px dashed'
                : 'none'
              : '1px dashed',
            borderColor: isAssignmentDragOver ? 'primary.main' : 'divider',
            bgcolor: isAssignmentDragOver ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.02)',
            minHeight: 220,
            p: 1,
            transition: 'all 0.15s ease',
            boxShadow: lockedShiftId ? 0 : isAssignmentDragOver ? 2 : 0,
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Drag workers here to place them (no message sent). Click Placed chip to offer position.
          </Typography>
          {!selectedShiftId ? (
            <Alert severity="info" sx={{ py: 2 }}>
              Select a shift to view placements.
            </Alert>
          ) : (
            <Stack spacing={1}>
              {displayedAssignedWorkers.map((worker) => {
                const isPlacementOnly = Boolean(worker.isPlacementOnly);
                const isDeclined = worker.assignmentStatus === 'declined';
                const isCancelled = worker.assignmentStatus === 'cancelled' || worker.assignmentStatus === 'canceled';
                // Placed = placement only (no offer sent). Accepted = offer sent, awaiting response. Confirmed = worker accepted. Declined/Cancelled = worker or system cancelled.
                const isConfirmed = worker.assignmentStatus && ['confirmed', 'active'].includes(worker.assignmentStatus);
                const offeringThis = isPlacementOnly && confirmingPlacementUserId === worker.id;
                // Placement-only tiles use action-phrased label "Click to
                // Hire" because the chip IS the click target that fires
                // the hire / offer flow — the label tells the recruiter
                // what happens, not what state the tile is in.
                const statusLabel = offeringThis ? 'Offering…' : isPlacementOnly ? 'Click to Hire' : isDeclined ? 'Declined' : isCancelled ? 'Cancelled' : isConfirmed ? 'Confirmed' : 'Accepted';
                const canDragBackToPool = isPlacementOnly && !offeringThis; // Only placement-only (no Assignment) can be dragged back
                return (
                  <Paper
                    key={worker.id}
                    // Drop the outlined variant in drawer
                    // mode so the variant's `1px solid …`
                    // border can't win the cascade against
                    // our sx override.
                    variant={lockedShiftId ? undefined : 'outlined'}
                    // MUI: `variant="outlined"` ignores elevation; combining
                    // with elevation>0 warns. Outlined tiles use border only.
                    elevation={0}
                    draggable={canDragBackToPool}
                    onDragStart={(event) => onWorkerDragStart(event, worker.id)}
                    sx={{
                      p: lockedShiftId ? 1 : '6px',
                      cursor: canDragBackToPool ? 'grab' : 'default',
                      ...(lockedShiftId && {
                        border: 'none',
                        boxShadow: 'none',
                      }),
                    }}
                  >
                    <PlacementWorkerTileMainColumn
                      worker={worker}
                      jobOrder={jobOrder}
                      hiringEntityName={hiringEntityName}
                      entityEmploymentByUserId={entityEmploymentByUserId}
                      placementEntityEmploymentLoading={placementEntityEmploymentLoading}
                      blockerLabels={blockerLabelsForAssignmentId(worker.assignmentId)}
                      onboardingMissingLabels={onboardingMissingLabelsForAssignmentId(worker.assignmentId)}
                      jobReadinessChipData={jobReadinessChipDataForAssignmentId(worker.assignmentId)}
                      onJobReadinessItemClick={onJobReadinessItemClick}
                      requiredCertStatuses={placementRequiredCertMatchList(
                        jobOrder,
                        worker.certifications,
                        worker.licenses,
                      )}
                      headerLeading={
                        <Checkbox
                          checked={selectedAssignmentWorkerIds.has(worker.id)}
                          onChange={() => onSelectOneAssignment(worker.id)}
                          size="small"
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${worker.displayName}`}
                          sx={{ py: 0, px: 0.5 }}
                        />
                      }
                      profileActionIcons={
                        <PlacementProfileActionIcons
                          worker={worker}
                          jobOrder={jobOrder}
                          onOpenResume={onOpenResume}
                          onOpenLicenses={onOpenLicenses}
                          onOpenCerts={onOpenCerts}
                        />
                      }
                      row3={
                        <>
                          {(() => {
                            const cityState = [worker.city, worker.state].filter(Boolean).join(', ');
                            return cityState ? (
                              <Typography variant="caption" color="text.secondary" noWrap>
                                {cityState}
                              </Typography>
                            ) : null;
                          })()}
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary" noWrap>
                              Starts: {formatDateDisplay(worker.assignmentStartDate || shiftStartDateStr) || '—'}
                            </Typography>
                            {/* Edit pencil shown for both assignment-backed workers AND
                                placement-only workers so the recruiter can pre-set the
                                target start date before hiring (persisted on the
                                placement doc and forwarded to the assignment). */}
                            {(worker.assignmentId || isPlacementOnly) && !isDeclined && !isCancelled && (
                              <Tooltip title={isPlacementOnly ? 'Edit target start date (saved on placement; applied when hired)' : 'Edit start date'}>
                                <IconButton
                                  size="small"
                                  sx={{ p: 0, color: 'text.secondary' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenEditStartDate(worker);
                                  }}
                                  aria-label="Edit start date"
                                >
                                  <EditIcon sx={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                            )}
                          </Box>
                        </>
                      }
                      actions={
                        <>
                          {!isPlacementOnly && !isDeclined && !isCancelled && (
                            <Tooltip title="Remove assignment (revert to Placed, worker will be notified)">
                              <IconButton
                                size="small"
                                onClick={() => onCancelAssignment(worker)}
                                sx={{ ...placementActionIconBtnSx, color: 'error.main' }}
                                aria-label="Cancel assignment"
                              >
                                <CloseIcon />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip
                            title={
                              offeringThis
                                ? 'Sending offer…'
                                : isPlacementOnly
                                  ? 'Click to offer position (sends accept/decline message)'
                                  : isDeclined
                                    ? 'Worker declined this assignment. Click to revert — restores Accepted / Confirm so you can re-offer or confirm on their behalf.'
                                    : isCancelled
                                      ? 'Assignment was cancelled. Click to undo — restores Accepted / Confirm.'
                                      : undefined
                            }
                          >
                            <Chip
                              size="small"
                              label={statusLabel}
                              color={isPlacementOnly ? 'info' : isDeclined || isCancelled ? 'error' : undefined}
                              icon={
                                offeringThis ? (
                                  <CircularProgress size={10} color="inherit" sx={{ color: 'white' }} />
                                ) : isPlacementOnly ? (
                                  <UnlockedIcon />
                                ) : isDeclined || isCancelled ? (
                                  <ErrorIcon />
                                ) : isConfirmed ? (
                                  <CheckIcon />
                                ) : (
                                  <LockedIcon />
                                )
                              }
                              onClick={
                                isPlacementOnly && !offeringThis
                                  ? () => onConfirmPlacement(worker)
                                  : isDeclined && confirmLoadingAssignmentId !== worker.id
                                    ? () => onRevertDecline(worker)
                                    : isCancelled && confirmLoadingAssignmentId !== worker.id
                                      ? () => onRevertCancel(worker)
                                      : undefined
                              }
                              disabled={offeringThis}
                              sx={{
                                ...placementActionChipSx,
                                ...(isPlacementOnly && !offeringThis && {
                                  cursor: 'pointer',
                                  zIndex: 50,
                                  position: 'relative',
                                  '&:hover': { opacity: 0.9 },
                                }),
                                // Both Declined and Cancelled chips are clickable to
                                // revert. Same hover affordance as the placement-only
                                // chip so the recruiter sees they're interactive.
                                ...((isDeclined || isCancelled) && confirmLoadingAssignmentId !== worker.id && {
                                  cursor: 'pointer',
                                  zIndex: 50,
                                  position: 'relative',
                                  '&:hover': { opacity: 0.9 },
                                }),
                                ...(offeringThis && {
                                  cursor: 'wait',
                                  opacity: 0.95,
                                  '& .MuiChip-icon': { ...placementActionChipSx['& .MuiChip-icon'], color: 'white' },
                                }),
                                ...((isDeclined || isCancelled) && {
                                  bgcolor: 'error.main',
                                  color: 'white',
                                  '& .MuiChip-icon': { ...placementActionChipSx['& .MuiChip-icon'], color: 'white' },
                                }),
                                ...(isConfirmed && {
                                  bgcolor: 'success.main',
                                  color: 'white',
                                  '& .MuiChip-icon': { ...placementActionChipSx['& .MuiChip-icon'], color: 'white' },
                                }),
                                ...(!isPlacementOnly && !isConfirmed && !isDeclined && !isCancelled && {
                                  bgcolor: '#e8f5e9', // Light green (Material green 50)
                                  color: 'success.main',
                                  '& .MuiChip-icon': { ...placementActionChipSx['& .MuiChip-icon'], color: 'success.main' },
                                }),
                              }}
                            />
                          </Tooltip>
                          {!isPlacementOnly && !isConfirmed && !isDeclined && !isCancelled && worker.assignmentId && (
                            <Tooltip title="Confirm this assignment on behalf of the worker (same as them clicking Accept)">
                              <Chip
                                size="small"
                                label={confirmLoadingAssignmentId === worker.assignmentId || confirmLoadingAssignmentId === worker.id ? 'Confirming…' : 'Confirm'}
                                onClick={() => onConfirmForWorker(worker)}
                                disabled={confirmLoadingAssignmentId === worker.assignmentId || confirmLoadingAssignmentId === worker.id}
                                sx={{
                                  ...placementActionChipSx,
                                  bgcolor: '#E3F2FD',
                                  color: '#1976D2',
                                  '&:hover': { bgcolor: '#BBDEFB' },
                                }}
                              />
                            </Tooltip>
                          )}
                        </>
                      }
                      actionsSubline={
                        !isPlacementOnly && !isDeclined && !isCancelled && (worker.assignmentConfirmedAt != null || worker.assignmentOfferSentAt != null) ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
                              {isConfirmed
                                ? worker.assignmentConfirmedAt != null
                                  ? `Confirmed ${new Date(worker.assignmentConfirmedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                                  : worker.assignmentOfferSentAt != null
                                    ? `Confirmed (offer sent ${new Date(worker.assignmentOfferSentAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`
                                    : 'Confirmed'
                                : worker.assignmentOfferSentAt != null
                                  ? `Offer sent ${new Date(worker.assignmentOfferSentAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                                  : null}
                            </Typography>
                            {(() => {
                              // One refresh icon serves both states:
                              //   - Pre-confirm (offer-sent): fires `onResendOffer`
                              //   - Post-confirm: fires `onResendConfirmation`
                              // Both share loading + cooldown state since the recruiter's
                              // intent is "resend this worker's message" regardless of
                              // which side of confirmation it is.
                              const showOfferResend = !isConfirmed && worker.assignmentOfferSentAt != null;
                              const showConfirmResend = isConfirmed && worker.assignmentConfirmedAt != null;
                              if (!showOfferResend && !showConfirmResend) return null;
                              const aid = worker.assignmentId ?? '';
                              const loading = resendLoadingAssignmentId === aid;
                              const cooldownUntil = resendCooldownUntilByAssignmentId[aid] ?? 0;
                              const inCooldown = Date.now() < cooldownUntil;
                              const disabled = loading || inCooldown;
                              const tooltip = inCooldown
                                ? 'Please wait before resending'
                                : showConfirmResend
                                  ? 'Resend confirmation details (email + SMS) to this worker'
                                  : 'Resend offer (SMS + push + email)';
                              const ariaLabel = showConfirmResend ? 'Resend confirmation' : 'Resend offer';
                              const handler = showConfirmResend
                                ? () => onResendConfirmation(worker)
                                : () => onResendOffer(worker);
                              return (
                                <Tooltip title={tooltip}>
                                  <span>
                                    <IconButton
                                      size="small"
                                      sx={{ p: 0, color: 'text.secondary' }}
                                      onClick={handler}
                                      disabled={disabled}
                                      aria-label={ariaLabel}
                                    >
                                      <RefreshIcon
                                        sx={{
                                          fontSize: 14,
                                          ...(loading && {
                                            animation: 'spin 0.8s linear infinite',
                                            '@keyframes spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
                                          }),
                                        }}
                                      />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              );
                            })()}
                          </Box>
                        ) : null
                      }
                    />
                  </Paper>
                );
              })}
              {displayedAssignedWorkers.length === 0 && (
                <Alert severity="info">
                  No workers placed or assigned yet.
                </Alert>
              )}
            </Stack>
          )}
        </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}
