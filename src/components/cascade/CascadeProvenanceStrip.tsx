/**
 * Cascade UX primitive — provenance + Reset-to-inherited strip.
 *
 * Renders above an editor (e.g. `StaffInstructionCard`) to surface:
 *
 *  1. Where the currently-shown value came from (account / child /
 *     location / jo / shift).
 *  2. A "Reset to inherited" affordance that drops the descendant
 *     override so the next ancestor's value resurfaces.
 *
 * This is the first concrete UX pattern for the cascade engine
 * (handoff §6 + O.4 slice). Reuse it on every cascade-aware editor
 * we add downstream so the language stays consistent ("Inherited
 * from", "Set at", "Overridden at", "Reset to inherited").
 *
 * It is intentionally framework-light: the strip does NOT load data
 * or write Firestore on its own. The parent owns the chain, the
 * provenance entry, and the reset side-effect — keeps the strip
 * unit-testable with a synthetic provenance entry.
 */

import React from 'react';
import { Box, Button, Chip, Tooltip, Typography } from '@mui/material';
import RestoreIcon from '@mui/icons-material/Restore';

import type { LevelType, ProvenanceEntry } from '../../shared/cascade/types';

export interface CascadeProvenanceStripProps {
  /**
   * The provenance entry to display. Pass the most-recent
   * contributor for the field/key the editor below renders. For
   * `merge_deep` fields the caller derives this with
   * `provenanceForKey(provenance, key)`.
   */
  provenance: ProvenanceEntry | undefined;
  /**
   * Where the editor below writes by default. Used to phrase the
   * label ("Set at this Job Order" vs. "Set at Job Order"):
   *   - `'jo'`    → editor writes to the JO doc
   *   - `'shift'` → editor writes to the shift doc
   *
   * Defaults to `'jo'` since that's the only writeable surface
   * wired today. The shift-tier write lands in a follow-up; the
   * prop already exists so every consumer site is forward-compatible.
   */
  editLevel?: LevelType;
  /**
   * Optional reset handler. When provided AND the current
   * provenance level matches `editLevel`, the strip renders a
   * "Reset to inherited" button. The handler is responsible for
   * the actual Firestore write (typically clearing the override
   * by writing `null` at the descendant path) and refreshing the
   * resolved value.
   */
  onResetToInherited?: () => void | Promise<void>;
  /**
   * Disable the reset button (e.g. while a save is in flight).
   * The strip never disables itself — parents decide.
   */
  resetDisabled?: boolean;
}

const LEVEL_NOUN: Record<LevelType, string> = {
  account: 'Account',
  child: 'Child Account',
  location: 'Location',
  jo: 'Job Order',
  shift: 'Shift',
};

const CONTRIBUTION_VERB: Record<
  ProvenanceEntry['contribution'],
  string
> = {
  set_initial: 'Inherited from',
  overrode: 'Overridden at',
  added: 'Added at',
  removed: 'Removed at',
  derived: 'Derived from',
};

function CascadeProvenanceStrip({
  provenance,
  editLevel = 'jo',
  onResetToInherited,
  resetDisabled = false,
}: CascadeProvenanceStripProps): JSX.Element | null {
  if (!provenance) {
    // No level contributed → there's nothing to inherit AND nothing
    // to override. Render nothing so the editor below sits flush.
    return null;
  }

  const verb = CONTRIBUTION_VERB[provenance.contribution] ?? 'Set at';
  const noun = LEVEL_NOUN[provenance.levelType] ?? provenance.levelType;
  const labelSuffix = provenance.levelLabel ? `: ${provenance.levelLabel}` : '';
  const text = `${verb} ${noun}${labelSuffix}`;

  // Reset is meaningful only when this level IS the edit level —
  // i.e. clearing the override here would surface an ancestor.
  const canReset =
    Boolean(onResetToInherited) && provenance.levelType === editLevel;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        mb: 1,
        flexWrap: 'wrap',
      }}
    >
      <Tooltip
        title={
          <Box sx={{ fontSize: 12 }}>
            <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>
              Where this value comes from
            </Typography>
            <Typography variant="caption" sx={{ display: 'block' }}>
              The cascade engine resolves this field by walking the
              ancestor chain (account → child → job order → shift).
              Edits land at the {LEVEL_NOUN[editLevel]} level by default;
              clearing the override surfaces the next ancestor's value.
            </Typography>
          </Box>
        }
        arrow
        disableInteractive
      >
        <Chip
          size="small"
          label={text}
          color={provenance.levelType === editLevel ? 'primary' : 'default'}
          variant="outlined"
          sx={{
            fontWeight: 500,
            // Keep the chip flat: it's metadata, not a primary action.
            '& .MuiChip-label': { px: 1 },
          }}
        />
      </Tooltip>

      {canReset && (
        <Tooltip
          title={`Clear the ${LEVEL_NOUN[editLevel]} override and inherit from the next ancestor`}
          arrow
          disableInteractive
        >
          <span>
            <Button
              size="small"
              variant="text"
              color="primary"
              startIcon={<RestoreIcon fontSize="small" />}
              onClick={() => void onResetToInherited?.()}
              disabled={resetDisabled}
              sx={{ textTransform: 'none', py: 0.25 }}
            >
              Reset to inherited
            </Button>
          </span>
        </Tooltip>
      )}
    </Box>
  );
}

export default CascadeProvenanceStrip;
