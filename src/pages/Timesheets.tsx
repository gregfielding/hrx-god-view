/**
 * Timesheets — recruiter/admin timesheet workspace.
 *
 * **Filter gating** (per TS.1 §3.1):
 *   1. Entity dropdown is required.
 *   2. Once an entity is chosen, the period picker activates.
 *   3. Once a period is chosen, the grid hydrates.
 *
 * If a recruiter lands on the page with neither selected, the grid
 * shows a friendly "pick a hiring entity and period" empty state — we
 * never show "0 workers · 0 hrs" before the filter has been narrowed.
 *
 * **Account + Job Order narrowing.** Stacked on top of the base
 * entity+period filter. Both are optional client-side narrows applied
 * post-resolve (see `TimesheetGrid.narrowJobOrderIds`). The page loads
 * the entity's JOs once on entity change and derives both the Account
 * options (unique JO.companyId → companyName) and the Job Order
 * options (filtered by Account when set) from that list.
 *
 * **Toolbar layout.** Matches `/shifts` — `PageHeader` with
 * `hideHeading`, a Show/Hide Filters button row, and a `<Collapse />`
 * containing the four dropdown filters + Clear filters affordance.
 * The top bar title is set to "Timesheets" (replaces the default
 * tenant-name title).
 *
 * Sec 5/6/7 only — gate enforced at `App.tsx` (route) and
 * `menuGenerator.ts` (sidebar). Both must agree.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Collapse,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import { collection, getDocs, query, where } from 'firebase/firestore';

import PageHeader from '../components/PageHeader';
import PeriodPicker from '../components/timesheets/PeriodPicker';
import TimesheetGrid from '../components/timesheets/TimesheetGrid';
import { useAuth } from '../contexts/AuthContext';
import { useSetTopBarTitle } from '../contexts/TopBarTitleContext';
import { db } from '../firebase';
import type { HiringEntity } from '../types/recruiter/hiringEntity';
import type { TimesheetFilter } from '../types/recruiter/timesheet';
import {
  type PeriodRange,
  isValidPeriod,
} from '../utils/timesheets/dateRange';

// Mirrors `/shifts` toolbar styling — 36px-tall, 6px radius, white bg,
// subtle border. Importing the same sx ensures both pages read as one
// visual family.
const filterSelectSx = {
  height: 36,
  borderRadius: '6px',
  backgroundColor: 'white',
  fontSize: '0.875rem',
  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#D1D5DB' },
} as const;

/** Lightweight shape pulled off each JO doc — enough to drive both the
 *  Account and Job Order dropdowns plus the account→JO narrowing. */
interface JobOrderOption {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
}

/** Lightweight shape for a shift under a JO — drives the Shift
 *  dropdown when the recruiter has narrowed to a specific JO. Holds
 *  enough display detail (date + start/end times) that the option
 *  label is self-explanatory in the dropdown menu. */
interface ShiftOption {
  id: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
}

const Timesheets: React.FC = () => {
  const { tenantId } = useAuth();

  const [entities, setEntities] = useState<HiringEntity[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [entity, setEntity] = useState<HiringEntity | null>(null);
  const [period, setPeriod] = useState<PeriodRange | null>(null);

  // Narrowing filters — applied client-side on top of the resolver's
  // entity+period query (see TimesheetGrid.narrowJobOrderIds /
  // narrowShiftId).
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [jobOrderFilter, setJobOrderFilter] = useState<string>('all');
  const [shiftFilter, setShiftFilter] = useState<string>('all');
  const [filtersExpanded, setFiltersExpanded] = useState(true);

  // JO list scoped to the selected entity. Drives the Account dropdown
  // (derived companyId/companyName tuples) and the Job Order dropdown
  // (filtered by the selected Account when set).
  const [jobOrders, setJobOrders] = useState<JobOrderOption[]>([]);
  const [joLoading, setJoLoading] = useState(false);

  // Shifts under the currently-selected JO. Empty when no JO is picked.
  // Refetched on JO change; the dropdown is disabled outside that state.
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);

  // Replace the default tenant-name top-bar title with "Timesheets".
  const topBarTitleNode = useMemo(
    () => (
      <Typography
        component="span"
        sx={{
          fontSize: '20px',
          fontWeight: 600,
          color: 'inherit',
          lineHeight: 1.2,
        }}
      >
        Timesheets
      </Typography>
    ),
    [],
  );
  useSetTopBarTitle(topBarTitleNode);

  /* -------------------------------------------------------------------
   * Entity list — load once per tenant. Small list (typically 1–5 per
   * tenant) so we hold it inline rather than memoizing across pages.
   * ------------------------------------------------------------------- */
  useEffect(() => {
    if (!tenantId) {
      setEntities([]);
      return;
    }
    let cancelled = false;
    setEntitiesLoading(true);
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
        setEntitiesLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[Timesheets] failed to load entities', err);
        setEntities([]);
        setEntitiesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  /* -------------------------------------------------------------------
   * Entity-scoped JO list — refetched whenever the selected entity
   * changes. Drives the Account + Job Order dropdown options. We keep
   * the field set narrow on purpose; this is a UI lookup, not the row
   * source of truth.
   * ------------------------------------------------------------------- */
  useEffect(() => {
    if (!tenantId || !entity) {
      setJobOrders([]);
      return;
    }
    let cancelled = false;
    setJoLoading(true);
    const q = query(
      collection(db, 'tenants', tenantId, 'job_orders'),
      where('hiringEntityId', '==', entity.id),
    );
    getDocs(q)
      .then((snap) => {
        if (cancelled) return;
        const list: JobOrderOption[] = snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const name =
              (typeof data.jobOrderName === 'string' && data.jobOrderName.trim()) ||
              (typeof data.jobTitle === 'string' && data.jobTitle.trim()) ||
              d.id;
            const companyId =
              (typeof data.companyId === 'string' && data.companyId.trim()) ||
              (typeof data.accountId === 'string' && data.accountId.trim()) ||
              '';
            const companyName =
              (typeof data.companyName === 'string' && data.companyName.trim()) ||
              (typeof data.accountName === 'string' && data.accountName.trim()) ||
              '(unknown account)';
            return { id: d.id, name, companyId, companyName };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setJobOrders(list);
        setJoLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[Timesheets] failed to load job orders', err);
        setJobOrders([]);
        setJoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, entity]);

  /* -------------------------------------------------------------------
   * Shift list — loaded on demand whenever a single JO is selected.
   * Cleared (and dropdown disabled) outside that state. Listing every
   * shift in the entity would scale poorly + dilute the dropdown UX;
   * the JO-scoped pattern matches how recruiters think about Events
   * payroll (pick the account → JO → shift → submit).
   * ------------------------------------------------------------------- */
  useEffect(() => {
    if (!tenantId || jobOrderFilter === 'all') {
      setShifts([]);
      setShiftsLoading(false);
      return;
    }
    let cancelled = false;
    setShiftsLoading(true);
    getDocs(
      collection(
        db,
        'tenants',
        tenantId,
        'job_orders',
        jobOrderFilter,
        'shifts',
      ),
    )
      .then((snap) => {
        if (cancelled) return;
        const list: ShiftOption[] = snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const date =
              (typeof data.shiftDate === 'string' && data.shiftDate.trim()) ||
              (typeof data.date === 'string' && data.date.trim()) ||
              null;
            const startTime =
              (typeof data.startTime === 'string' && data.startTime.trim()) ||
              null;
            const endTime =
              (typeof data.endTime === 'string' && data.endTime.trim()) ||
              null;
            return { id: d.id, date, startTime, endTime };
          })
          .sort((a, b) => {
            // Sort by date asc, then start time asc — matches the
            // operational order recruiters scan for daily payroll.
            const dateCmp = (a.date ?? '').localeCompare(b.date ?? '');
            if (dateCmp !== 0) return dateCmp;
            return (a.startTime ?? '').localeCompare(b.startTime ?? '');
          });
        setShifts(list);
        setShiftsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[Timesheets] failed to load shifts', err);
        setShifts([]);
        setShiftsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, jobOrderFilter]);

  /* -------------------------------------------------------------------
   * Derived dropdown option lists.
   *
   * Accounts: unique companyId tuples from the loaded JOs. We key by
   * companyId (not companyName) so renames don't fragment the list.
   *
   * Job Orders: filtered to the selected Account when set.
   * ------------------------------------------------------------------- */
  const accountOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const jo of jobOrders) {
      if (jo.companyId && !map.has(jo.companyId)) {
        map.set(jo.companyId, jo.companyName);
      }
    }
    return Array.from(map.entries())
      .map(([companyId, companyName]) => ({ companyId, companyName }))
      .sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [jobOrders]);

  const jobOrderOptions = useMemo(() => {
    if (accountFilter === 'all') return jobOrders;
    return jobOrders.filter((jo) => jo.companyId === accountFilter);
  }, [jobOrders, accountFilter]);

  /* -------------------------------------------------------------------
   * Narrowing set passed to the grid.
   *
   *   - Both filters "all"           → null (no narrowing)
   *   - jobOrderFilter set           → singleton set with that id
   *   - accountFilter set            → set of all JOs under that account
   *   - both set                     → singleton (JO already constrained
   *                                    by the account-filtered dropdown)
   * ------------------------------------------------------------------- */
  const narrowJobOrderIds = useMemo<Set<string> | null>(() => {
    if (jobOrderFilter !== 'all') {
      return new Set([jobOrderFilter]);
    }
    if (accountFilter !== 'all') {
      return new Set(
        jobOrders
          .filter((jo) => jo.companyId === accountFilter)
          .map((jo) => jo.id),
      );
    }
    return null;
  }, [jobOrderFilter, accountFilter, jobOrders]);

  /* -------------------------------------------------------------------
   * Filter-change side effects.
   *
   * Entity swap → reset period, account, and JO. PeriodPicker will
   * re-seed with the new entity's default on next render.
   *
   * Account swap → if the previously-selected JO is no longer under
   * that account, clear it.
   *
   * Tenant swap → drop everything (rare in practice — tenant-switcher).
   * ------------------------------------------------------------------- */
  const handleEntityChange = useCallback((nextId: string) => {
    const next = entities.find((e) => e.id === nextId) ?? null;
    setEntity(next);
    setPeriod(null);
    setAccountFilter('all');
    setJobOrderFilter('all');
    setShiftFilter('all');
  }, [entities]);

  const handleAccountChange = useCallback((nextId: string) => {
    setAccountFilter(nextId);
    // If the current JO selection isn't under the new account, drop it.
    if (
      nextId !== 'all' &&
      jobOrderFilter !== 'all' &&
      !jobOrders.some((jo) => jo.id === jobOrderFilter && jo.companyId === nextId)
    ) {
      setJobOrderFilter('all');
      setShiftFilter('all');
    }
  }, [jobOrderFilter, jobOrders]);

  const handleJobOrderChange = useCallback((nextId: string) => {
    setJobOrderFilter(nextId);
    // Switching JO invalidates the shift selection — different JO = a
    // different shift collection. Reset to "All Shifts" so we don't
    // leave a stale shift id selected against a JO it doesn't belong to.
    setShiftFilter('all');
  }, []);

  useEffect(() => {
    setEntity(null);
    setPeriod(null);
    setAccountFilter('all');
    setJobOrderFilter('all');
    setShiftFilter('all');
  }, [tenantId]);

  /* -------------------------------------------------------------------
   * Filter assembly — the base resolver filter the grid loads against.
   * Account + JO are layered on top via `narrowJobOrderIds`.
   * ------------------------------------------------------------------- */
  const filter: TimesheetFilter | null = useMemo(() => {
    if (!entity) return null;
    if (!period || !isValidPeriod(period)) return null;
    return {
      kind: 'entity_period',
      hiringEntityId: entity.id,
      periodStart: period.start,
      periodEnd: period.end,
    };
  }, [entity, period]);

  const hasActiveFilters =
    accountFilter !== 'all' ||
    jobOrderFilter !== 'all' ||
    shiftFilter !== 'all';

  const handleClearFilters = useCallback(() => {
    setAccountFilter('all');
    setJobOrderFilter('all');
    setShiftFilter('all');
  }, []);

  /** Single shift id passed to the grid for the third narrowing axis.
   *  `null` means "no shift narrowing" — apply only the JO-set narrow. */
  const narrowShiftId = shiftFilter !== 'all' ? shiftFilter : null;

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" sx={{ maxWidth: 720 }}>
          No active tenant. Switch tenants to load timesheets.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        hideHeading
        dense
        showDivider={false}
        title=""
        filters={
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 0,
              width: '100%',
              minWidth: 0,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                gap: 1.25,
                alignItems: 'center',
                flexWrap: 'wrap',
                rowGap: 1,
              }}
            >
              <Button
                variant="text"
                onClick={() => setFiltersExpanded((o) => !o)}
                sx={{
                  textTransform: 'none',
                  borderRadius: '999px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#0057B8',
                  bgcolor: 'rgba(0, 87, 184, 0.06)',
                  px: 1.25,
                  py: 0.5,
                  minHeight: 30,
                  minWidth: 'auto',
                  lineHeight: 1.2,
                  '&:hover': {
                    bgcolor: 'rgba(0, 87, 184, 0.1)',
                  },
                }}
              >
                {filtersExpanded ? 'Hide Filters' : 'Show Filters'}
              </Button>

              <Divider
                orientation="vertical"
                flexItem
                sx={{ my: 0.5, borderColor: 'rgba(0, 0, 0, 0.08)' }}
              />

              {/* When the filter row is collapsed, mirror the current
                  selection inline so the user isn't blind to what's
                  loaded. Cheap-and-cheerful: just the entity name. */}
              {!filtersExpanded && entity ? (
                <Typography
                  variant="body2"
                  sx={{ color: 'rgba(0, 0, 0, 0.7)' }}
                >
                  {entity.name}
                  {accountFilter !== 'all' ? (
                    <Typography component="span" sx={{ ml: 1, color: 'text.secondary' }}>
                      ·{' '}
                      {accountOptions.find((a) => a.companyId === accountFilter)
                        ?.companyName ?? '…'}
                    </Typography>
                  ) : null}
                  {jobOrderFilter !== 'all' ? (
                    <Typography component="span" sx={{ ml: 1, color: 'text.secondary' }}>
                      ·{' '}
                      {jobOrders.find((j) => j.id === jobOrderFilter)?.name ?? '…'}
                    </Typography>
                  ) : null}
                  {shiftFilter !== 'all' ? (
                    <Typography component="span" sx={{ ml: 1, color: 'text.secondary' }}>
                      ·{' '}
                      {(() => {
                        const s = shifts.find((sh) => sh.id === shiftFilter);
                        if (!s) return '…';
                        return s.date && s.startTime
                          ? `${s.date} ${s.startTime}`
                          : s.date ?? s.id;
                      })()}
                    </Typography>
                  ) : null}
                </Typography>
              ) : null}
            </Box>

            <Collapse in={filtersExpanded} timeout="auto" unmountOnExit>
              <Box
                sx={{
                  display: 'flex',
                  gap: 1.25,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  rowGap: 1,
                  pt: 1.25,
                }}
              >
                <FormControl size="small" sx={{ minWidth: 220, height: 36 }}>
                  {/* `shrink` + `notched` keeps the label floating
                      regardless of value so the "Select an entity"
                      placeholder doesn't collide with the label. */}
                  <InputLabel shrink sx={{ fontSize: '0.875rem' }}>
                    Hiring Entity
                  </InputLabel>
                  <Select
                    value={entity?.id ?? ''}
                    onChange={(e) => handleEntityChange(String(e.target.value))}
                    label="Hiring Entity"
                    notched
                    sx={filterSelectSx}
                    displayEmpty
                    renderValue={(val) => {
                      if (!val) {
                        return (
                          <Typography
                            component="span"
                            sx={{
                              fontSize: '0.875rem',
                              color: 'text.disabled',
                            }}
                          >
                            {entitiesLoading
                              ? 'Loading…'
                              : entities.length === 0
                                ? 'No entities'
                                : 'Select an entity'}
                          </Typography>
                        );
                      }
                      return entities.find((e) => e.id === val)?.name ?? String(val);
                    }}
                  >
                    {entities.map((e) => (
                      <MenuItem key={e.id} value={e.id}>
                        {e.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl
                  size="small"
                  sx={{ minWidth: 200, height: 36 }}
                  disabled={!entity || joLoading}
                >
                  <InputLabel sx={{ fontSize: '0.875rem' }}>Account</InputLabel>
                  <Select
                    value={accountFilter}
                    onChange={(e) => handleAccountChange(String(e.target.value))}
                    label="Account"
                    sx={filterSelectSx}
                  >
                    <MenuItem value="all">All Accounts</MenuItem>
                    {accountOptions.map((a) => (
                      <MenuItem key={a.companyId} value={a.companyId}>
                        {a.companyName}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl
                  size="small"
                  sx={{ minWidth: 220, height: 36 }}
                  disabled={!entity || joLoading}
                >
                  <InputLabel sx={{ fontSize: '0.875rem' }}>Job Order</InputLabel>
                  <Select
                    value={jobOrderFilter}
                    onChange={(e) => handleJobOrderChange(String(e.target.value))}
                    label="Job Order"
                    sx={filterSelectSx}
                  >
                    <MenuItem value="all">All Job Orders</MenuItem>
                    {jobOrderOptions.map((jo) => (
                      <MenuItem key={jo.id} value={jo.id}>
                        {jo.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl
                  size="small"
                  sx={{ minWidth: 200, height: 36 }}
                  disabled={jobOrderFilter === 'all' || shiftsLoading}
                >
                  <InputLabel sx={{ fontSize: '0.875rem' }}>Shift</InputLabel>
                  <Select
                    value={shiftFilter}
                    onChange={(e) => setShiftFilter(String(e.target.value))}
                    label="Shift"
                    sx={filterSelectSx}
                  >
                    <MenuItem value="all">All Shifts</MenuItem>
                    {shifts.map((s) => {
                      // Compose a label that's stable + scannable. We
                      // accept that some legacy shifts may not carry
                      // date or time — fall back to the doc id so the
                      // option is at least selectable.
                      const datePart = s.date ?? '';
                      const timePart =
                        s.startTime && s.endTime
                          ? `${s.startTime}–${s.endTime}`
                          : s.startTime ?? '';
                      const label =
                        datePart && timePart
                          ? `${datePart} · ${timePart}`
                          : datePart || timePart || s.id;
                      return (
                        <MenuItem key={s.id} value={s.id}>
                          {label}
                        </MenuItem>
                      );
                    })}
                  </Select>
                </FormControl>

                {/* PeriodPicker is purposely kept as-is — it owns the
                    entity-specific pay-period logic (weekly arrows /
                    per-event manual mode). Visual fit isn't pixel-
                    perfect with the Select cluster, but the business
                    logic is non-trivial and worth keeping centralized. */}
                {entity ? (
                  <PeriodPicker
                    entity={entity}
                    value={period}
                    onChange={setPeriod}
                    scope={null}
                  />
                ) : (
                  <Typography
                    variant="body2"
                    color="text.disabled"
                    sx={{ pt: 0.5 }}
                  >
                    Period selector activates once a hiring entity is selected.
                  </Typography>
                )}

                <Button
                  variant="text"
                  size="small"
                  disabled={!hasActiveFilters}
                  onClick={handleClearFilters}
                  sx={{
                    textTransform: 'none',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: hasActiveFilters ? '#0057B8' : 'rgba(0, 0, 0, 0.35)',
                    minHeight: 30,
                    minWidth: 'auto',
                    px: 1,
                    '&:hover': {
                      bgcolor: hasActiveFilters
                        ? 'rgba(0, 87, 184, 0.06)'
                        : 'transparent',
                    },
                  }}
                >
                  Clear filters
                </Button>
              </Box>
            </Collapse>
          </Box>
        }
      />

      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          px: { xs: 2, md: 3 },
          pb: 2,
        }}
      >
        <TimesheetGrid
          filter={filter}
          narrowJobOrderIds={narrowJobOrderIds}
          narrowShiftId={narrowShiftId}
        />
      </Box>
    </Box>
  );
};

export default Timesheets;
