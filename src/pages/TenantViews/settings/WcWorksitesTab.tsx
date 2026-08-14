/**
 * WC Worksites tab (Greg 2026-08-14) — every insured worksite location on
 * the InSource policy, from the carrier's "Sub Client History" schedule
 * loaded into workers_comp_policy_locations. Read-only reference table:
 * filter by entity/state, search by name/city/street. Reload the schedule
 * server-side when InSource issues an updated report.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';

interface PolicyLocation {
  id: string;
  clientName: string;
  hiringEntityId: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  classCodeState: string;
  classCode: string;
  rate: number | null;
  source: string;
}

const ENTITY_LABEL: Record<string, string> = {
  c1_select_llc: 'C1 Select',
  c1_events_llc: 'C1 Events',
  c1_workforce_llc: 'C1 Workforce',
  c1_medstaff_llc: 'C1 Medstaff',
  c1_resources_llc: 'C1 Resources',
};

const WcWorksitesTab: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [rows, setRows] = useState<PolicyLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    getDocs(collection(db, 'tenants', tenantId, 'workers_comp_policy_locations'))
      .then((snap) => {
        if (cancelled) return;
        const out: PolicyLocation[] = [];
        snap.forEach((d) => {
          const v = d.data() as Record<string, any>;
          out.push({
            id: d.id,
            clientName: String(v.clientName ?? ''),
            hiringEntityId: String(v.hiringEntityId ?? ''),
            name: String(v.name ?? ''),
            street: String(v.street ?? ''),
            city: String(v.city ?? ''),
            state: String(v.state ?? ''),
            zip: String(v.zip ?? ''),
            classCodeState: String(v.classCodeState ?? ''),
            classCode: String(v.classCode ?? ''),
            rate: typeof v.rate === 'number' ? v.rate : null,
            source: String(v.source ?? ''),
          });
        });
        out.sort(
          (a, b) =>
            a.clientName.localeCompare(b.clientName) ||
            a.state.localeCompare(b.state) ||
            a.name.localeCompare(b.name),
        );
        setRows(out);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const entities = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.hiringEntityId))).sort(),
    [rows],
  );
  const states = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.state).filter(Boolean))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (entityFilter === 'all' || r.hiringEntityId === entityFilter) &&
        (stateFilter === 'all' || r.state === stateFilter) &&
        (!q ||
          `${r.name} ${r.street} ${r.city} ${r.zip} ${r.classCode}`.toLowerCase().includes(q)),
    );
  }, [rows, entityFilter, stateFilter, search]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!rows) {
    return (
      <Stack alignItems="center" sx={{ py: 6 }}>
        <CircularProgress size={28} />
      </Stack>
    );
  }
  if (rows.length === 0) {
    return (
      <Alert severity="info">
        No insured locations loaded yet — import the carrier&apos;s Sub Client History schedule.
      </Alert>
    );
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Every worksite location on the InSource policy, from the carrier&apos;s Sub Client History
        schedule. A job at a site that isn&apos;t listed here needs a coverage request before
        workers start (the 8040 Placeholders tab tracks the active ones).
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <Chip label={`${rows.length} insured locations`} />
        <Chip label={`${states.length} states`} />
        {entities.map((e) => (
          <Chip
            key={e}
            variant={entityFilter === e ? 'filled' : 'outlined'}
            color={entityFilter === e ? 'primary' : 'default'}
            label={`${ENTITY_LABEL[e] ?? e}: ${rows.filter((r) => r.hiringEntityId === e).length}`}
            onClick={() => setEntityFilter(entityFilter === e ? 'all' : e)}
          />
        ))}
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          select
          size="small"
          label="State"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          sx={{ minWidth: 110 }}
        >
          <MenuItem value="all">All states</MenuItem>
          {states.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Search name / address / code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 260 }}
        />
        {(entityFilter !== 'all' || stateFilter !== 'all' || search) && (
          <Chip
            label={`${filtered.length} shown`}
            onDelete={() => {
              setEntityFilter('all');
              setStateFilter('all');
              setSearch('');
            }}
          />
        )}
      </Stack>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Entity</TableCell>
            <TableCell>State</TableCell>
            <TableCell>Worksite</TableCell>
            <TableCell>Address</TableCell>
            <TableCell>Class code</TableCell>
            <TableCell align="right">Rate</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filtered.map((r) => (
            <TableRow key={r.id} hover>
              <TableCell>{ENTITY_LABEL[r.hiringEntityId] ?? r.clientName}</TableCell>
              <TableCell>
                <Typography variant="body2" fontWeight={600}>
                  {r.state || '—'}
                </Typography>
              </TableCell>
              <TableCell>{r.name}</TableCell>
              <TableCell>
                <Typography variant="body2">
                  {[r.street, r.city].filter(Boolean).join(', ')}
                  {r.zip ? ` ${r.zip}` : ''}
                </Typography>
              </TableCell>
              <TableCell>
                {r.classCode ? (
                  <Chip
                    size="small"
                    label={
                      r.classCodeState && r.classCodeState !== r.state
                        ? `${r.classCode} (${r.classCodeState})`
                        : r.classCode
                    }
                  />
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell align="right">{r.rate != null ? `$${r.rate.toFixed(2)}` : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};

export default WcWorksitesTab;
