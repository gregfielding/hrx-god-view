/**
 * WcCodeSelect — THE workers'-comp class-code picker (Greg 2026-08-05:
 * "the WC code field EVERYWHERE should be the same reusable component").
 *
 * Reads the WC matrix (`tenants/{t}/workers_comp_rates`) keyed by worksite
 * STATE + hiring ENTITY: entity-scoped rows (docs carrying `hiringEntityId`)
 * win over generic rows for that entity; the 8040 placeholder is always
 * offered (synthetic $2.35 when the state has no row — matches the server's
 * fallback and the WC monthly report). Catalog titles come from
 * `workers_comp_class_codes`. Free-typing an unlisted code stays allowed.
 *
 * `onChange(code, rate)` fires with the matrix rate for a picked option
 * (null for free-typed codes the matrix doesn't rate — the server-side
 * resolution chain is the authority at save time).
 *
 * Adopted so far: EditWorkersCompDialog (grid), FixAssignmentDialog,
 * JobOrderForm (career + gig position WC fields). Still to migrate:
 * CsvTimesheetImport inline cells, WorkersCompMonthlyCard.
 */

import React, { useEffect, useState } from 'react';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { normalizeStateCode } from '../../utils/unemploymentRates';

export interface WcCodeOption {
  code: string;
  title: string;
  rate: number | null;
  /** True when the rate came from a row scoped to the given hiring entity. */
  entityScoped: boolean;
}

export const PLACEHOLDER_8040_RATE = 2.35;

interface Props {
  tenantId: string;
  /** 2-letter worksite state. Empty → no options load (free text only). */
  state?: string | null;
  /** Entity-scoped matrix rows for this entity win over generic rows. */
  hiringEntityId?: string | null;
  value: string;
  onChange: (code: string, rate: number | null) => void;
  label?: string;
  helperText?: React.ReactNode;
  placeholder?: string;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}

const WcCodeSelect: React.FC<Props> = ({
  tenantId,
  state,
  hiringEntityId,
  value,
  onChange,
  label,
  helperText,
  placeholder,
  size = 'medium',
  fullWidth = true,
  disabled = false,
  autoFocus = false,
}) => {
  const [options, setOptions] = useState<WcCodeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const stateCode = normalizeStateCode(state ?? '').trim().toUpperCase();
  const entityId = String(hiringEntityId ?? '').trim();

  useEffect(() => {
    if (!tenantId || !stateCode) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [rateSnap, catSnap] = await Promise.all([
          getDocs(
            query(collection(db, 'tenants', tenantId, 'workers_comp_rates'), where('state', '==', stateCode)),
          ),
          getDocs(collection(db, 'tenants', tenantId, 'workers_comp_class_codes')),
        ]);
        const titleByCode = new Map<string, string>();
        catSnap.forEach((d) => {
          const v = d.data() as Record<string, unknown>;
          const c = typeof v.code === 'string' ? v.code.trim() : '';
          if (c) titleByCode.set(c, typeof v.title === 'string' ? v.title.trim() : '');
        });
        // Entity-scoped rows win over generic; within a tier, highest rate.
        const entityRate = new Map<string, number>();
        const genericRate = new Map<string, number>();
        rateSnap.forEach((d) => {
          const v = d.data() as Record<string, unknown>;
          const c = typeof v.code === 'string' ? v.code.trim() : '';
          if (!c) return;
          const rowEntity = typeof v.hiringEntityId === 'string' ? v.hiringEntityId.trim() : '';
          const r = Number(v.rate);
          if (!Number.isFinite(r)) return;
          if (rowEntity) {
            if (entityId && rowEntity === entityId) {
              entityRate.set(c, Math.max(entityRate.get(c) ?? 0, r));
            }
            // Rows scoped to a DIFFERENT entity are ignored entirely.
          } else {
            genericRate.set(c, Math.max(genericRate.get(c) ?? 0, r));
          }
        });
        const codes = new Set<string>([...entityRate.keys(), ...genericRate.keys()]);
        const opts: WcCodeOption[] = [...codes]
          .map((c) => ({
            code: c,
            title: titleByCode.get(c) ?? '',
            rate: entityRate.has(c) ? entityRate.get(c)! : genericRate.get(c) ?? null,
            entityScoped: entityRate.has(c),
          }))
          .sort((a, b) => a.code.localeCompare(b.code));
        if (!opts.some((o) => o.code === '8040')) {
          opts.push({
            code: '8040',
            title: 'Placeholder (carrier code pending)',
            rate: PLACEHOLDER_8040_RATE,
            entityScoped: false,
          });
        }
        if (!cancelled) setOptions(opts);
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, stateCode, entityId]);

  return (
    <Autocomplete<WcCodeOption, false, false, true>
      freeSolo
      disabled={disabled}
      fullWidth={fullWidth}
      size={size}
      options={options}
      loading={loading}
      inputValue={value}
      onInputChange={(_, v) => {
        const match = options.find((o) => o.code === v.trim());
        onChange(v, match?.rate ?? null);
      }}
      onChange={(_, v) => {
        if (v && typeof v !== 'string') onChange(v.code, v.rate);
        else if (typeof v === 'string') {
          const match = options.find((o) => o.code === v.trim());
          onChange(v, match?.rate ?? null);
        }
      }}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.code)}
      filterOptions={(opts, s) => {
        const q = s.inputValue.trim().toLowerCase();
        if (!q) return opts;
        return opts.filter(
          (o) => o.code.toLowerCase().includes(q) || o.title.toLowerCase().includes(q),
        );
      }}
      renderOption={(props, o) => (
        <li {...props} key={o.code}>
          <Box>
            <Typography variant="body2" fontFamily="monospace" fontWeight={600}>
              {o.code}
            </Typography>
            {(o.title || o.rate != null) && (
              <Typography variant="caption" color="text.secondary">
                {o.title}
                {o.rate != null
                  ? `${o.title ? ' · ' : ''}$${o.rate.toFixed(2)} rate${o.entityScoped ? ' (entity)' : ''}`
                  : ''}
              </Typography>
            )}
          </Box>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label ?? (stateCode ? `WC class code (${stateCode})` : 'WC class code')}
          placeholder={placeholder ?? 'e.g. 8044'}
          autoFocus={autoFocus}
          helperText={
            helperText ??
            (stateCode
              ? `Codes rated for ${stateCode} from your WC matrix — the rate follows the code.`
              : 'No worksite state resolved — codes load once a state is known.')
          }
        />
      )}
    />
  );
};

export default WcCodeSelect;
