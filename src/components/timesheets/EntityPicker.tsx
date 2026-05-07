/**
 * EntityPicker — required dropdown that selects the hiring entity to
 * load timesheets for.
 *
 * Wired into the Timesheets page (`/timesheets`) at the top of the
 * filter bar. The page-level filter gating is:
 *   1. EntityPicker required → 2. PeriodPicker activated → 3. Grid hydrates.
 *
 * Loads `tenants/{tid}/entities` once, sorted by name. Returns the full
 * `HiringEntity` doc to the caller (not just the id) so the
 * `<PeriodPicker />` downstream can branch on `payPeriodPolicy.policyType`
 * without a second fetch.
 *
 * Sec 5/6/7 only — the route enforces, this component just renders.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  CircularProgress,
  FormHelperText,
  TextField,
} from '@mui/material';
import { collection, getDocs } from 'firebase/firestore';

import { db } from '../../firebase';
import type { HiringEntity } from '../../types/recruiter/hiringEntity';

export interface EntityPickerProps {
  tenantId: string;
  value: HiringEntity | null;
  onChange: (entity: HiringEntity | null) => void;
  /** Disable the picker (e.g. while a deeper filter is loading). */
  disabled?: boolean;
  /** Render a "Required to continue" helper text below the field. */
  showRequiredHelper?: boolean;
  /** Optional label override; defaults to "Hiring entity". */
  label?: string;
}

/**
 * Loads entities for the current tenant on mount and on tenant changes.
 * Holds the list locally — entities are a small list (typically 1–5
 * per tenant) so we don't memoize across page navigations.
 */
export const EntityPicker: React.FC<EntityPickerProps> = ({
  tenantId,
  value,
  onChange,
  disabled,
  showRequiredHelper = true,
  label = 'Hiring entity',
}) => {
  const [entities, setEntities] = useState<HiringEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setEntities([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    getDocs(collection(db, 'tenants', tenantId, 'entities'))
      .then((snap) => {
        if (cancelled) return;
        const list: HiringEntity[] = snap.docs
          .map((d) => {
            const data = d.data() as Partial<HiringEntity> & { name?: string };
            return {
              id: d.id,
              tenantId,
              name: typeof data.name === 'string' && data.name.trim().length > 0
                ? data.name
                : d.id,
              workerType: (data.workerType ?? 'mixed') as HiringEntity['workerType'],
              evereeApprovalGroupId: data.evereeApprovalGroupId,
              evereeEmbedEventHandlerName: data.evereeEmbedEventHandlerName,
              payrollSettings: data.payrollSettings,
              payPeriodPolicy: data.payPeriodPolicy,
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setEntities(list);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        // Non-fatal: leave the picker empty + show helper.
        console.warn('[EntityPicker] failed to load entities', err);
        setError('Unable to load hiring entities. Refresh to retry.');
        setEntities([]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // Keep the selection valid: if the loaded list doesn't contain the
  // current value (e.g. tenant switch), clear it.
  useEffect(() => {
    if (!value) return;
    const stillExists = entities.some((e) => e.id === value.id);
    if (!stillExists && entities.length > 0) {
      onChange(null);
    }
  }, [entities, value, onChange]);

  const helperText = useMemo(() => {
    if (error) return error;
    if (loading) return 'Loading hiring entities…';
    if (!value && showRequiredHelper) return 'Required to load timesheets.';
    return undefined;
  }, [error, loading, value, showRequiredHelper]);

  return (
    <Box sx={{ minWidth: 280 }}>
      <Autocomplete<HiringEntity, false, false, false>
        size="small"
        options={entities}
        value={value}
        loading={loading}
        disabled={disabled || loading}
        getOptionLabel={(option) => option.name}
        isOptionEqualToValue={(opt, val) => opt.id === val.id}
        onChange={(_e, newVal) => onChange(newVal ?? null)}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            required
            error={Boolean(error)}
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
      {helperText ? (
        <FormHelperText error={Boolean(error)} sx={{ mx: 1 }}>
          {helperText}
        </FormHelperText>
      ) : null}
    </Box>
  );
};

export default EntityPicker;
