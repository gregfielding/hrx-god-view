/**
 * **R.16.1 Phase 8** — Banner offering admins the chance to push a
 * dirty snapshot-policy field down onto active Job Orders.
 *
 * Lifecycle:
 *   1. The parent form (typically `AccountOrderDetailsForm`) detects
 *      that the user has just changed a snapshot-policy field on the
 *      Account / Child Account doc. It records the prior value, the
 *      new value, and a label, and renders this banner with that
 *      payload.
 *   2. The banner sits inline above the form, explaining that the
 *      change won't propagate to active JOs unless the admin opts
 *      in. Clicking "Review affected job orders…" opens
 *      `PushToActiveDialog`.
 *   3. The dialog handles the actual preview + write.
 *   4. On dialog close (regardless of whether anything was pushed),
 *      the parent dismisses the banner via `onDismiss`.
 *
 * Why surface this as a separate banner instead of folding into the
 * dialog: Push-to-Active is a destructive operation (write into
 * snapshot envelopes that downstream consumers treat as
 * authoritative). The banner gives the admin a clear, dismissible
 * decision point — "I changed this; do I want it on active JOs too,
 * or only future ones?". Several CORT-tier admins flagged the
 * unannounced cascade behaviour pre-§16.1 as a usability hazard;
 * this is the explicit handoff.
 *
 * Out of scope (R.16.2):
 *   - Detecting dirty per-position fields. The Phase 8 surface only
 *     covers Account-level (top-level) snapshot-policy fields. The
 *     per-position equivalent ships with the position-pricing UI in
 *     R.16.2.
 *   - Reading current values via `getEffectiveJobOrderField`. The
 *     banner only inspects parent doc state; the dialog reads the
 *     server-side preview.
 *
 * @see docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md §L9, Phase 8
 */

import React, { useState } from 'react';
import { Alert, AlertTitle, Box, Button, Stack } from '@mui/material';

import { PushToActiveDialog, type PushFieldKey } from './PushToActiveDialog';

export interface PushToActiveBannerPayload {
  /** The push-eligible cascade field that changed. */
  fieldKey: PushFieldKey;
  /** Per-position pushes pass the positionId; top-level pushes pass `null`. */
  positionId?: string | null;
  /** Value before the user's edit (for the banner copy). */
  previousValue?: unknown;
  /** Value the user just saved (will be sent to push-to-active). */
  newValue: unknown;
  /** Human-friendly label used in copy + dialog title (e.g. "AccuSource Screening Package"). */
  fieldLabel: string;
}

export interface PushToActiveBannerProps {
  tenantId: string;
  /** Recruiter Account id whose JOs are candidates for the push. */
  accountId: string;
  /** When `null`, the banner is hidden. */
  payload: PushToActiveBannerPayload | null;
  /** Called when the user dismisses the banner OR closes the dialog. */
  onDismiss: () => void;
}

const PushToActiveBanner: React.FC<PushToActiveBannerProps> = ({
  tenantId,
  accountId,
  payload,
  onDismiss,
}) => {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!payload) return null;

  const { fieldKey, positionId, fieldLabel, newValue } = payload;

  return (
    <Box sx={{ mb: 2 }}>
      <Alert
        severity="info"
        onClose={onDismiss}
        action={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button
              color="inherit"
              size="small"
              variant="outlined"
              onClick={() => setDialogOpen(true)}
            >
              Review affected job orders…
            </Button>
          </Stack>
        }
      >
        <AlertTitle>
          {fieldLabel} changed — only future job orders use the new value.
        </AlertTitle>
        Active job orders keep the value frozen at activation. Click
        review to choose which active job orders should adopt the new
        value.
      </Alert>

      <PushToActiveDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          onDismiss();
        }}
        tenantId={tenantId}
        accountId={accountId}
        fieldKey={fieldKey}
        positionId={positionId ?? null}
        newValue={newValue}
        fieldLabel={fieldLabel}
      />
    </Box>
  );
};

export default PushToActiveBanner;
