/**
 * **R.8** — `MatrixCell` — one (row × requirement-category) cell in the
 * cross-worker readiness matrix.
 *
 * Renders the `inline`-size `JobReadinessChip` with the per-category
 * aggregate, plus a per-cell action menu (popover). Action menu routing
 * (D5.R8 lock):
 *
 *   - **Vendor cells** (BG / drug / E-Verify / screening_package_match) →
 *     single "Open case" item that fires `onVendorDrillIn` on the parent
 *     so the parent mounts `EverifyCaseDrawer` or `BackgroundCheckCaseDrawer`.
 *     Confirm / waive / mark-failed are NOT shown — vendor cells have their
 *     own write surface (single-action menu rule).
 *
 *   - **Non-vendor cells** → confirm / waive / mark-failed dialog, fan-out
 *     to the R.3 callables via `onCsaAction`. Multiple underlying items
 *     fan out via `Promise.allSettled` (handled by the parent).
 *
 * **Selection checkbox visibility:**
 *   - Non-vendor cells render a checkbox when bulk-selectable. Cell is
 *     "bulk-selectable" when the chip is yellow or red (a green cell has
 *     nothing to act on). The matrix parent owns the actual selection set.
 *   - Vendor cells NEVER render a checkbox (D5.R8 lock — bulk fan-out on
 *     vendor cells is incoherent).
 *
 * **Disabled (admin-gate) state:**
 *   - When `canManageInTenant === false`, the per-cell action menu is
 *     rendered but every action item is disabled with a tooltip explaining
 *     "no admin role in this tenant". The chip + popover stay live so the
 *     CSA can still inspect contributors. Server enforces the same gate
 *     via `ensureReadinessCsaAdmin` (D8.R8).
 *
 * **Empty cells** (no data for this category in this row) render as a "—"
 * placeholder with no chip, no checkbox, no menu — visually distinct from
 * a cell that exists but is computing.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Box,
  Checkbox,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import JobReadinessChip from '../../recruiter/readiness/JobReadinessChip';
import type { JobReadinessChipContributor } from '../../../shared/jobReadinessChip/types';
import type { MatrixCellAggregate } from '../../../utils/readinessMatrix/aggregateByCategory';
import type { MatrixCategoryKey } from '../../../utils/readinessMatrix/categories';
import type { MatrixVendorDrillIn } from './types';
import type { CsaReadinessActionKind } from '../../../shared/csaReadinessActionTypes';

export interface MatrixCellProps {
  /** Stable row key (`workerUid__hiringEntityId`). */
  rowKey: string;
  /** Cell aggregate — `null`/`undefined` renders as the "—" empty placeholder. */
  aggregate: MatrixCellAggregate | null | undefined;
  /** Whether this cell is currently selected for bulk-action. */
  selected: boolean;
  /** Selection toggle callback — parent owns the set. */
  onToggleSelect: (args: {
    rowKey: string;
    categoryKey: MatrixCategoryKey;
    /** Item refs the bulk action would fan out to. */
    itemRefs: ReadonlyArray<{ itemId: string; source: 'assignment' | 'employee' }>;
  }) => void;
  /**
   * Whether selection toggling is permitted right now. The parent caps
   * selection at 50 cells (D4.R8); when at cap, this is `false` for
   * unselected cells (selected cells stay togglable so the user can
   * deselect).
   */
  canSelect: boolean;
  /**
   * `true` when the current user is an R.3-eligible admin in this
   * cell's tenant. When `false`, action items are visually disabled with
   * a tooltip; server still re-checks (D8.R8).
   */
  canManageInTenant: boolean;
  /** Open the R.3 confirm/waive/markFailed dialog for a single item ref. */
  onOpenSingleAction: (args: {
    rowKey: string;
    categoryKey: MatrixCategoryKey;
    kind: CsaReadinessActionKind;
    itemRef: { itemId: string; source: 'assignment' | 'employee' };
  }) => void;
  /** Open a vendor drawer (E-Verify or BG check). */
  onVendorDrillIn: (target: MatrixVendorDrillIn) => void;
}

const SELECTABLE_STATES = new Set<MatrixCellAggregate['chip']['state']>([
  'red',
  'yellow',
]);

/**
 * Empty-cell placeholder. Centred dash with secondary text colour so it
 * reads as "no data" rather than "loading".
 */
const EmptyCell: React.FC = () => (
  <Box
    sx={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'text.disabled',
      fontSize: 13,
    }}
    aria-label="No data for this requirement"
  >
    —
  </Box>
);

/**
 * Per-cell action menu config. Mirrors `ReadinessCsaActionsSection`'s
 * `ACTION_MENU` shape — labels stay aligned across surfaces so a CSA who
 * uses both never has to re-learn the verbs.
 */
const NON_VENDOR_ACTIONS: ReadonlyArray<{
  kind: CsaReadinessActionKind;
  label: string;
  destructive?: boolean;
}> = [
  { kind: 'csa_confirm', label: 'Confirm…' },
  { kind: 'csa_waive', label: 'Waive…' },
  { kind: 'csa_mark_failed', label: 'Mark failed…', destructive: true },
];

/**
 * Pick the most relevant contributor's `caseId` for vendor drill-in. With
 * one item per cell (the common case for BG / drug / E-Verify) this is
 * just `contributors[0].caseId`. For matrix cells that aggregate multiple
 * vendor cases (rare but possible — e.g. drug retest after fail), we use
 * the first non-green contributor since that's where action is needed.
 */
function pickVendorCaseId(
  aggregate: MatrixCellAggregate,
): string | null {
  const contributors = aggregate.chip.contributors;
  // Prefer red/yellow (action needed); fall back to the first green if
  // everything passes (e.g. CSA wants to view a closed case).
  const actionable = contributors.find(
    (c: JobReadinessChipContributor) => c.contribution !== 'green',
  );
  const chosen = actionable ?? contributors[0];
  return chosen?.caseId ?? null;
}

const MatrixCell: React.FC<MatrixCellProps> = ({
  rowKey,
  aggregate,
  selected,
  onToggleSelect,
  canSelect,
  canManageInTenant,
  onOpenSingleAction,
  onVendorDrillIn,
}) => {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const cellRef = useRef<HTMLDivElement | null>(null);

  const handleOpenMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
  }, []);
  const handleCloseMenu = useCallback(() => setMenuAnchor(null), []);

  const handleVendorDrillIn = useCallback(() => {
    setMenuAnchor(null);
    if (!aggregate || !aggregate.category.vendorBacked) return;
    const caseId = pickVendorCaseId(aggregate);
    if (!caseId) return;
    const target: MatrixVendorDrillIn =
      aggregate.category.key === 'e_verify'
        ? { kind: 'everify', caseId, rowKey }
        : { kind: 'background', checkId: caseId, rowKey };
    onVendorDrillIn(target);
  }, [aggregate, onVendorDrillIn, rowKey]);

  const handleNonVendorAction = useCallback(
    (kind: CsaReadinessActionKind) => {
      setMenuAnchor(null);
      if (!aggregate) return;
      // For multi-item cells the bulk action bar is the right surface; the
      // per-cell menu only acts on the FIRST contributing item. The cell
      // surfaces this via the action menu copy ("Confirm first…" when
      // `itemRefs.length > 1`).
      const ref = aggregate.itemRefs[0];
      if (!ref) return;
      onOpenSingleAction({
        rowKey,
        categoryKey: aggregate.category.key,
        kind,
        itemRef: ref,
      });
    },
    [aggregate, onOpenSingleAction, rowKey],
  );

  const handleToggleSelect = useCallback(() => {
    if (!aggregate) return;
    onToggleSelect({
      rowKey,
      categoryKey: aggregate.category.key,
      itemRefs: aggregate.itemRefs,
    });
  }, [aggregate, onToggleSelect, rowKey]);

  // Empty cell — no aggregate at all for this category in this row.
  if (!aggregate) {
    return <EmptyCell />;
  }

  const isVendor = aggregate.category.vendorBacked;
  const chipState = aggregate.chip.state;
  // Bulk-selectable iff non-vendor AND chip has actionable state.
  const bulkSelectable = !isVendor && SELECTABLE_STATES.has(chipState);
  const multiItem = aggregate.itemRefs.length > 1;
  const vendorCaseId = isVendor ? pickVendorCaseId(aggregate) : null;

  return (
    <Box
      ref={cellRef}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        px: 0.5,
        py: 0.25,
        minHeight: 32,
      }}
    >
      {bulkSelectable ? (
        <Tooltip
          title={
            !canSelect && !selected
              ? 'Selection cap reached — deselect another cell to add this one.'
              : ''
          }
          placement="top"
        >
          <span>
            <Checkbox
              checked={selected}
              disabled={!canSelect && !selected}
              onChange={handleToggleSelect}
              size="small"
              sx={{ p: 0.25 }}
              inputProps={{
                'aria-label': `Select ${aggregate.category.label} for ${rowKey}`,
              }}
            />
          </span>
        </Tooltip>
      ) : (
        // Reserve the same horizontal slot as the checkbox so cells stay
        // grid-aligned across categories. ~28px keeps it visually flush
        // with `Checkbox size="small"` cells.
        <Box sx={{ width: 28 }} />
      )}

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
        <JobReadinessChip
          data={aggregate.chip}
          size="inline"
          popoverTitle={aggregate.category.label}
        />
      </Box>

      <Tooltip
        title={
          isVendor
            ? vendorCaseId
              ? 'Open vendor case'
              : 'No case linked'
            : !canManageInTenant
              ? 'You do not have admin access in this tenant'
              : 'Recruiter actions'
        }
      >
        <span>
          <IconButton
            size="small"
            onClick={handleOpenMenu}
            disabled={isVendor && !vendorCaseId}
            aria-label={`Open actions for ${aggregate.category.label}`}
            sx={{ p: 0.25 }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleCloseMenu}
      >
        {isVendor ? (
          <MenuItem onClick={handleVendorDrillIn} disabled={!vendorCaseId}>
            <Stack direction="row" alignItems="center" gap={1}>
              <OpenInNewIcon fontSize="small" />
              <Typography variant="body2">
                {aggregate.category.key === 'e_verify'
                  ? 'Open E-Verify case'
                  : 'Open background check'}
              </Typography>
            </Stack>
          </MenuItem>
        ) : (
          // R.3 confirm/waive/markFailed actions. We always render the
          // three items so menu height stays stable across cells; gate
          // them with the per-tenant admin role.
          NON_VENDOR_ACTIONS.map((action) => (
            <Tooltip
              key={action.kind}
              title={
                !canManageInTenant
                  ? 'No admin role in this tenant'
                  : multiItem
                    ? `Acts on the first of ${aggregate.itemRefs.length} items — use bulk actions to apply across all`
                    : ''
              }
              placement="left"
            >
              <span>
                <MenuItem
                  disabled={!canManageInTenant}
                  onClick={() => handleNonVendorAction(action.kind)}
                  sx={{
                    color: action.destructive ? 'error.main' : undefined,
                  }}
                >
                  {action.label}
                </MenuItem>
              </span>
            </Tooltip>
          ))
        )}
      </Menu>
    </Box>
  );
};

export default MatrixCell;
