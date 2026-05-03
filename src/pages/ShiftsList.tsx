/**
 * ShiftsList — list-view tab body for /shifts.
 *
 * Wraps `ShiftsTable` with outlet context from `Shifts.tsx`.
 */

import React from 'react';
import { useOutletContext } from 'react-router-dom';

import ShiftsTable from '../components/shifts/ShiftsTable';
import { useAuth } from '../contexts/AuthContext';
import type { ShiftsOutletContext } from './Shifts';

const ShiftsList: React.FC = () => {
  const { tenantId } = useAuth();
  const ctx = useOutletContext<ShiftsOutletContext | null>();

  return (
    <ShiftsTable
      tenantId={tenantId}
      rows={ctx?.rows ?? []}
      loading={ctx?.loading ?? false}
      error={ctx?.error ?? null}
      search={ctx?.search ?? ''}
      showFavoritesOnly={ctx?.showFavoritesOnly ?? false}
      accountFilter={ctx?.accountFilter ?? 'all'}
      statusFilter={ctx?.statusFilter ?? 'all'}
      jobTypeFilter={ctx?.jobTypeFilter ?? 'all'}
      dateFilterStartIso={ctx?.dateFilterStartIso ?? null}
      dateFilterEndIso={ctx?.dateFilterEndIso ?? null}
      accountFilterDisabled={false}
    />
  );
};

export default ShiftsList;
