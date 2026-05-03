/**
 * ShiftsCalendar — calendar tab body for /shifts.
 *
 * Filters rows via the same outlet context as `ShiftsList`, then renders
 * `ShiftsCalendarView`.
 */

import React, { useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import ShiftsCalendarView from '../components/shifts/ShiftsCalendarView';
import { useFavorites } from '../hooks/useFavorites';
import { todayIsoLocal, shiftRowOverlapsDateRange } from '../utils/shifts/shiftRow';
import type { ShiftsOutletContext } from './Shifts';

const ShiftsCalendar: React.FC = () => {
  const { tenantId } = useAuth();
  const ctx = useOutletContext<ShiftsOutletContext | null>();
  const search = (ctx?.search ?? '').trim().toLowerCase();
  const showFavoritesOnly = ctx?.showFavoritesOnly ?? false;
  const accountFilter = ctx?.accountFilter ?? 'all';
  const statusFilter = ctx?.statusFilter ?? 'all';
  const jobTypeFilter = ctx?.jobTypeFilter ?? 'all';
  const dateFilterStartIso = ctx?.dateFilterStartIso ?? null;
  const dateFilterEndIso = ctx?.dateFilterEndIso ?? null;
  const allRows = ctx?.rows ?? [];

  const { isFavorite } = useFavorites('shifts');

  const rows = useMemo(() => {
    const todayIso = todayIsoLocal();
    return allRows.filter((r) => {
      if (showFavoritesOnly && !isFavorite(`${r.jobOrder.id}:${r.shift.id}`)) {
        return false;
      }
      if (accountFilter !== 'all' && r.jobOrder.companyName !== accountFilter) {
        return false;
      }
      if (statusFilter !== 'all' && (r.shift.status ?? 'open') !== statusFilter) {
        return false;
      }
      if (jobTypeFilter !== 'all' && r.jobOrder.jobType !== jobTypeFilter) {
        return false;
      }
      if (
        !shiftRowOverlapsDateRange(r, dateFilterStartIso, dateFilterEndIso, todayIso)
      ) {
        return false;
      }
      if (!search) return true;
      const haystack = [
        r.shift.shiftTitle,
        r.shift.defaultJobTitle,
        r.jobOrder.jobTitle,
        r.jobOrder.jobOrderNumber,
        r.jobOrder.companyName,
        r.jobOrder.worksiteName,
        r.jobOrder.worksiteAddress?.city,
        r.jobOrder.worksiteAddress?.state,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [
    allRows,
    search,
    showFavoritesOnly,
    accountFilter,
    statusFilter,
    jobTypeFilter,
    dateFilterStartIso,
    dateFilterEndIso,
    isFavorite,
  ]);

  return (
    <ShiftsCalendarView
      tenantId={tenantId}
      rows={rows}
      loading={ctx?.loading ?? false}
      error={ctx?.error ?? null}
    />
  );
};

export default ShiftsCalendar;
