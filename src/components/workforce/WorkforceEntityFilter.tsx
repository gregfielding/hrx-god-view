/**
 * Hiring entity dropdown for the Workforce queue (spec §3 — "Select /
 * Workforce / Events / All"). The actual entity options aren't hard-coded;
 * we derive them from the rows we've actually loaded so tenants without an
 * Events arm don't see a pointless option.
 *
 * Behavior:
 *   - Single-select. Multi-select would let CSAs slice "Select + Events" but
 *     adds a chip cluster the spec doesn't budget for; punt to a follow-up
 *     if a CSA requests it.
 *   - `'all'` is always present and is the default.
 *   - Options are sorted alphabetically by display name (stable across
 *     reloads — the entity ids themselves are not user-friendly).
 */

import React, { useMemo } from 'react';
import { FormControl, MenuItem, Select } from '@mui/material';

import type { QueueRow } from '../../utils/readinessQueue';

interface WorkforceEntityFilterProps {
  value: string | 'all';
  onChange: (next: string | 'all') => void;
  /** Source rows used to derive the entity option list (typically `allRows`). */
  rows: ReadonlyArray<QueueRow>;
}

interface EntityOption {
  id: string;
  label: string;
}

const WorkforceEntityFilter: React.FC<WorkforceEntityFilterProps> = ({
  value,
  onChange,
  rows,
}) => {
  const options = useMemo<EntityOption[]>(() => {
    const byId = new Map<string, EntityOption>();
    for (const row of rows) {
      if (!row.hiringEntityId) continue;
      if (!byId.has(row.hiringEntityId)) {
        byId.set(row.hiringEntityId, {
          id: row.hiringEntityId,
          label: row.hiringEntityName || row.hiringEntityId,
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    );
  }, [rows]);

  return (
    <FormControl size="small" sx={{ minWidth: 160 }}>
      <Select
        value={value}
        displayEmpty
        onChange={(e) => onChange(e.target.value as string | 'all')}
        sx={{
          fontSize: '13px',
          '& .MuiOutlinedInput-notchedOutline': {
            borderRadius: '999px',
          },
        }}
        renderValue={(selected) => {
          if (selected === 'all') return 'All entities';
          const opt = options.find((o) => o.id === selected);
          return opt?.label || (selected as string);
        }}
      >
        <MenuItem value="all">All entities</MenuItem>
        {options.map((opt) => (
          <MenuItem key={opt.id} value={opt.id}>
            {opt.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};

export default WorkforceEntityFilter;
