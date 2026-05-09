/**
 * RecruiterAssignmentCell — inline-editable "Assign recruiters" multi-select
 * cell shared between the global Job Orders list (`/jobs/job-orders`) and the
 * account-detail Job Orders tab.
 *
 * The two surfaces previously had two different cell implementations: the
 * global list rendered an Autocomplete with persistence, and the account
 * tab rendered a static "PersonIcon + recruiterName" line. This component
 * keeps them in sync.
 *
 * Behavior:
 *   - Multi-select Autocomplete bound to `assignedRecruiterIds`.
 *   - Persists `assignedRecruiters: string[]` to
 *     `tenants/{tenantId}/job_orders/{jobOrderId}`.
 *   - Calls `onSaved` after a successful Firestore write so the parent can
 *     refresh its in-memory list (recruiterName summary, optimistic ids).
 *   - Stops click propagation so the row's drawer/navigation handler doesn't
 *     fire when the user clicks inside the cell or the dropdown.
 *
 * The picker options + loading state are owned by the parent (one fetch per
 * page, not per row) and threaded down here.
 */

import React, { useMemo, useState } from 'react';
import {
  Autocomplete,
  Chip,
  CircularProgress,
  TextField,
} from '@mui/material';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { db } from '../../firebase';
import { p as firestorePaths } from '../../data/firestorePaths';
import {
  type RecruiterPickerOption,
} from '../../utils/fetchRecruiterPickerOptions';

/** "First (+N)" / "Unassigned" — keeps row-level summaries consistent across
 *  pages so the in-memory `recruiterName` on every list matches what the
 *  detail page would render. */
export function summarizeAssignedRecruiters(
  ids: string[],
  opts: Map<string, RecruiterPickerOption>,
): string {
  if (!ids.length) return 'Unassigned';
  const names = ids.map((id) => opts.get(id)?.displayName || id);
  const first = names[0];
  return ids.length > 1 ? `${first} (+${ids.length - 1})` : first;
}

export interface RecruiterAssignmentCellProps {
  tenantId: string | null | undefined;
  jobOrderId: string;
  /** Current `assignedRecruiters` array from the JO doc. */
  assignedRecruiterIds: string[];
  /** Page-level cache of recruiter options. */
  options: RecruiterPickerOption[];
  /** Set while options are being fetched (disables the input). */
  optionsLoading: boolean;
  /**
   * Called after a successful Firestore write. The parent uses this to
   * update its own list (e.g. patch `assignedRecruiters` + `recruiterName`
   * on the matching row). The summary string follows the same
   * "First (+N) / Unassigned" convention used elsewhere.
   */
  onSaved?: (
    jobOrderId: string,
    nextIds: string[],
    summary: string,
  ) => void;
  /** Optional error sink so the parent can surface a banner / snackbar. */
  onError?: (err: unknown) => void;
}

const RecruiterAssignmentCell: React.FC<RecruiterAssignmentCellProps> = ({
  tenantId,
  jobOrderId,
  assignedRecruiterIds,
  options,
  optionsLoading,
  onSaved,
  onError,
}) => {
  const [saving, setSaving] = useState(false);

  const optionMap = useMemo(
    () => new Map(options.map((o) => [o.id, o])),
    [options],
  );

  const value = useMemo(
    () =>
      assignedRecruiterIds
        .map((id) => optionMap.get(id))
        .filter((x): x is RecruiterPickerOption => Boolean(x)),
    [assignedRecruiterIds, optionMap],
  );

  const handleChange = async (next: RecruiterPickerOption[]) => {
    if (!tenantId) return;
    const ids = next.map((s) => s.id);
    setSaving(true);
    try {
      await updateDoc(doc(db, firestorePaths.jobOrder(tenantId, jobOrderId)), {
        assignedRecruiters: ids,
        updatedAt: serverTimestamp(),
      });
      const merged = new Map(optionMap);
      next.forEach((s) => merged.set(s.id, s));
      const summary = summarizeAssignedRecruiters(ids, merged);
      onSaved?.(jobOrderId, ids, summary);
    } catch (err) {
      console.error('[RecruiterAssignmentCell] Failed to save assignment:', err);
      onError?.(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Autocomplete
      multiple
      size="small"
      loading={optionsLoading}
      disabled={saving}
      options={options}
      value={value}
      onChange={(_, newValue) => {
        // Stop the row drawer from firing when the dropdown closes via a
        // selection click inside the popper.
        void handleChange(newValue);
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Same a11y guard — Enter inside the input shouldn't bubble up to
        // the row click handler.
        if (e.key === 'Enter') e.stopPropagation();
      }}
      getOptionLabel={(o) => o.displayName}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterSelectedOptions
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => (
          <Chip
            {...getTagProps({ index })}
            key={option.id}
            label={option.displayName}
            size="small"
            sx={{ maxWidth: 120 }}
          />
        ))
      }
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Assign recruiters…"
          variant="outlined"
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {saving ? (
                  <CircularProgress color="inherit" size={14} sx={{ mr: 0.5 }} />
                ) : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      sx={{
        minWidth: 220,
        maxWidth: 320,
        '& .MuiOutlinedInput-root': { py: 0.25 },
      }}
    />
  );
};

export default RecruiterAssignmentCell;
