/**
 * **R.16.3 (interim — Path 1 / Option B)** — Per-field manual "Sync to
 * active" button.
 *
 * Why this exists:
 *   The post-edit `PushToActiveBanner` only surfaces when an admin
 *   *just* changed a snapshot-policy field. Operators routinely need
 *   to re-push the *current* value (e.g. catch JOs that missed the
 *   last push due to a transient error, or sync after a child-account
 *   reorg) without making a fresh edit. This button gives that
 *   workflow a one-click affordance next to the field itself.
 *
 * Wire shape:
 *   1. The button calls `getLastPushedValueForFieldCallable` to fetch
 *      the value pushed in the most recent `push_to_active_summary`
 *      row for `(accountId, fieldKey, positionId?)`.
 *   2. If history exists, that value becomes `previousValue` for the
 *      `PushToActiveDialog` open — the R.16.1.1 child-override filter
 *      then ensures the push only catches JOs whose snapshot still
 *      matches the last pushed value (i.e. true stragglers, not child
 *      overrides).
 *   3. If no history exists OR the lookup fails, the dialog opens with
 *      `previousValue=undefined` (V1 push semantics — operator
 *      reviews and deselects per the R.16.1.1 mitigation pattern).
 *
 * Out of scope (R.16.3 proper, deferred until post-CORT):
 *   - Drift detection (three-way classification: in_sync /
 *     stale_value / child_override). The interim button still surfaces
 *     every active JO via the dialog; per-row classification waits
 *     for the unified "Audit & Sync" panel.
 *   - Per-position pricing surface (5 fields × N rows). Per-edit
 *     banner still covers the "I just edited" case there; manual
 *     re-push for pricing waits for the R.16.3 Audit & Sync panel.
 *
 * Permission model:
 *   - The parent passes `enabled` based on `securityLevel === '7'`.
 *     Non-admins don't see the button (mirrors the banner's Q4 lock).
 *   - Server-side callable still gates independently — the button
 *     can't bypass via direct invocation.
 *
 * @see docs/CASCADE_R16.3_HANDOFF.md (Path 1 notes)
 * @see functions/src/jobOrders/getLastPushedValueForField.ts
 */

import React, { useState } from 'react';
import { CircularProgress, IconButton, Tooltip } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';
import { PushToActiveDialog, type PushFieldKey } from './PushToActiveDialog';

interface LastPushedValueResult {
  previousValue: unknown;
  lastPushedAt: string | null;
  hasHistory: boolean;
}

export interface SyncToActiveButtonProps {
  tenantId: string;
  accountId: string;
  fieldKey: PushFieldKey;
  /** Per-position fields require positionId; top-level fields pass `null`. */
  positionId?: string | null;
  /**
   * Current value on the parent doc — sent as `newValue` to the
   * Push-to-Active dialog. Read at click time so the user always
   * pushes the *latest* saved value (not a stale render-time value).
   */
  getCurrentValue: () => unknown;
  /** Human-friendly label used in the dialog title + tooltip. */
  fieldLabel: string;
  /** Hide the button entirely when `false` (parent's `securityLevel === '7'` gate). */
  enabled?: boolean;
  /**
   * Optional override for the tooltip copy. Defaults to
   * "Sync {fieldLabel} to active job orders".
   */
  tooltipText?: string;
  /** Optional sx override (e.g. for tighter padding inside dense rows). */
  sxOverride?: React.CSSProperties;
}

const SyncToActiveButton: React.FC<SyncToActiveButtonProps> = ({
  tenantId,
  accountId,
  fieldKey,
  positionId = null,
  getCurrentValue,
  fieldLabel,
  enabled = true,
  tooltipText,
  sxOverride,
}) => {
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  // R.16.3-interim: `undefined` means "no previousValue filter" (the
  // dialog falls back to V1 push semantics — every diff is a candidate).
  // A defined value (including `null`) activates the R.16.1.1
  // child-override filter.
  const [previousValue, setPreviousValue] = useState<unknown>(undefined);
  const [pendingNewValue, setPendingNewValue] = useState<unknown>(null);

  if (!enabled) return null;

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    // Read current value AT click time, not render time — admins often
    // edit the field, then click sync without remounting.
    const currentValue = getCurrentValue();
    setPendingNewValue(currentValue);

    try {
      const fn = httpsCallable<
        { tenantId: string; accountId: string; fieldKey: PushFieldKey; positionId: string | null },
        LastPushedValueResult
      >(functions, 'getLastPushedValueForFieldCallable');
      const res = await fn({ tenantId, accountId, fieldKey, positionId });
      // R.16.1.1 filter only fires when previousValue is supplied AND
      // it differs from newValue. If history is absent we leave it
      // `undefined` so the dialog falls back to V1 (operator review).
      setPreviousValue(res.data.hasHistory ? res.data.previousValue : undefined);
    } catch (e) {
      // The lookup is best-effort — if it fails (network blip, missing
      // index, etc.), open the dialog without `previousValue`. That's
      // strictly *more* permissive (V1 semantics), so operators don't
      // get blocked, just lose the child-override filter for this push.
      // The dialog itself surfaces any actual write errors.
      // eslint-disable-next-line no-console
      console.warn('[R.16.3-interim] getLastPushedValueForField failed', {
        fieldKey,
        positionId,
        err: e instanceof Error ? e.message : String(e),
      });
      setPreviousValue(undefined);
    } finally {
      setLoading(false);
      setDialogOpen(true);
    }
  };

  const tooltip = tooltipText ?? `Sync ${fieldLabel} to active job orders`;

  return (
    <>
      <Tooltip title={tooltip}>
        {/* span wrapper so Tooltip works while IconButton is disabled */}
        <span style={sxOverride}>
          <IconButton
            size="small"
            onClick={handleClick}
            disabled={loading}
            aria-label={tooltip}
          >
            {loading ? <CircularProgress size={16} /> : <SyncIcon fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>

      <PushToActiveDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        tenantId={tenantId}
        accountId={accountId}
        fieldKey={fieldKey}
        positionId={positionId ?? null}
        newValue={pendingNewValue}
        previousValue={previousValue}
        fieldLabel={fieldLabel}
      />
    </>
  );
};

export default SyncToActiveButton;
