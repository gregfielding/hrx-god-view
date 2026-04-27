/**
 * Reusable multi-select for picking recruiters (users with
 * `recruiter: true` + security level 5/6/7 in the active tenant).
 *
 * Introduced for the Recruiting Role Model assignment UIs — CSA picker
 * on User Group editors, Scheduler picker on Account editors, and the
 * future tenant-level Role Defaults section. One component so the
 * "who is a recruiter in this tenant" loader lives in one place.
 *
 * @see docs/RECRUITING_ROLE_MODEL.md §4
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Autocomplete, Chip, CircularProgress, TextField } from '@mui/material';
import { collection, getDocs } from 'firebase/firestore';

import { db } from '../../firebase';

export type RecruiterOption = { id: string; label: string };

export interface RecruiterMultiSelectProps {
  tenantId: string | null | undefined;
  label: string;
  value: string[];
  onChange: (nextIds: string[]) => void;
  /** Descriptive helper rendered under the field. */
  helperText?: string;
  disabled?: boolean;
  /** Optional pre-loaded options — lets a parent that already loaded recruiters avoid a second fetch. */
  options?: RecruiterOption[];
  /** When true, show a compact variant (smaller chip size, denser field). */
  dense?: boolean;
}

/**
 * Load recruiters for a tenant from `users` using the same rule used in
 * RecruiterAccountDetails (canonical elsewhere):
 *   - `recruiter === true` (either top-level or nested under `tenantIds[tid]`)
 *   - security level 5, 6, or 7 in this tenant
 */
async function loadRecruiters(tenantId: string): Promise<RecruiterOption[]> {
  const snap = await getDocs(collection(db, 'users'));
  const out: RecruiterOption[] = [];
  const toLabel = (d: Record<string, unknown>) => {
    const first = typeof d.firstName === 'string' ? d.firstName : '';
    const last = typeof d.lastName === 'string' ? d.lastName : '';
    const email = typeof d.email === 'string' ? d.email : '';
    const combined = `${first} ${last}`.trim();
    return combined || (email ? email.split('@')[0] : 'Unknown');
  };
  snap.docs.forEach((d) => {
    const data = d.data() as Record<string, any>;
    const hasTenant =
      data.tenantId === tenantId ||
      data.activeTenantId === tenantId ||
      (data.tenantIds && typeof data.tenantIds === 'object' && tenantId in data.tenantIds);
    if (!hasTenant) return;
    const tenantData = data.tenantIds?.[tenantId];
    const slRaw = tenantData?.securityLevel ?? data.securityLevel ?? '0';
    const securityLevel = parseInt(String(slRaw), 10) || 0;
    const recruiterTrue =
      data.recruiter === true || data.recruiter === 'true' || tenantData?.recruiter === true;
    const isRecruiter =
      (securityLevel === 5 || securityLevel === 6 || securityLevel === 7) && recruiterTrue;
    if (!isRecruiter) return;
    out.push({ id: d.id, label: toLabel(data) });
  });
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

const RecruiterMultiSelect: React.FC<RecruiterMultiSelectProps> = ({
  tenantId,
  label,
  value,
  onChange,
  helperText,
  disabled,
  options: externalOptions,
  dense,
}) => {
  const [options, setOptions] = useState<RecruiterOption[]>(externalOptions ?? []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (externalOptions) {
      setOptions(externalOptions);
      return;
    }
    if (!tenantId) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadRecruiters(tenantId)
      .then((list) => {
        if (!cancelled) setOptions(list);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, externalOptions]);

  // Map current value (ids) to option objects so Autocomplete can render
  // chips even for recruiters whose records loaded async after value did.
  const selected = useMemo<RecruiterOption[]>(() => {
    return value
      .map((id) => options.find((o) => o.id === id) ?? { id, label: id })
      .filter((o): o is RecruiterOption => Boolean(o));
  }, [value, options]);

  return (
    <Autocomplete
      multiple
      disabled={disabled}
      options={options}
      value={selected}
      onChange={(_, next) => {
        const ids = next.map((o) => (typeof o === 'string' ? o : o.id));
        // De-dupe while preserving order (user may drag chips later).
        const seen = new Set<string>();
        const out: string[] = [];
        for (const id of ids) {
          if (!seen.has(id)) {
            seen.add(id);
            out.push(id);
          }
        }
        onChange(out);
      }}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.label)}
      isOptionEqualToValue={(opt, val) => opt.id === val.id}
      size={dense ? 'small' : 'medium'}
      renderTags={(tagValue, getTagProps) =>
        tagValue.map((option, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return (
            <Chip
              key={option.id || key}
              label={option.label}
              size={dense ? 'small' : 'medium'}
              {...tagProps}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          helperText={helperText}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
};

export default RecruiterMultiSelect;
