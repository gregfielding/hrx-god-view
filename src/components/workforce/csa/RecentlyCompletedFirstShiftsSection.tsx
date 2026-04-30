/**
 * RD.1 — Section 2: workers who just finished their first shift.
 *
 * Same column layout as Section 1 but the "shift" column shows the *end*
 * time ("Finished 2h ago") and the status chip is neutral instead of
 * "confirmed" green. Future row-color predictor (work-again likelihood)
 * wires through `row.severity`; v1 always renders neutral.
 */
import React, { useMemo, useState } from 'react';
import {
  Chip,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';

import CsaSectionTable, { ROWS_PER_PAGE_OPTIONS } from './CsaSectionTable';
import CsaWorkerInfoCell from './CsaWorkerInfoCell';
import useCsaRecentlyCompletedFirstShifts from '../../../hooks/useCsaRecentlyCompletedFirstShifts';
import useUserDocsByUids from '../../../hooks/useUserDocsByUids';
import { useTenantRecruiterNamesByUid } from '../../../hooks/useTenantRecruiterNamesByUid';
import { formatAbsoluteTime, formatAge } from '../../../utils/readinessQueue';
import {
  pickAvatarFromUserDoc,
  pickPrimaryRecruiterIdFromUserDoc,
} from './pickFromUserDoc';

export interface RecentlyCompletedFirstShiftsSectionProps {
  tenantId: string | null;
  myWorkerUids: ReadonlySet<string> | null;
}

const headerCellSx = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  color: 'text.secondary',
  letterSpacing: 0.4,
} as const;

const cellSx = { fontSize: 13, py: 1 } as const;

const RecentlyCompletedFirstShiftsSection: React.FC<
  RecentlyCompletedFirstShiftsSectionProps
> = ({ tenantId, myWorkerUids }) => {
  const navigate = useNavigate();
  const { rows, loading, error } = useCsaRecentlyCompletedFirstShifts({
    tenantId,
    myWorkerUids,
  });

  const uids = useMemo(() => rows.map((r) => r.workerUid), [rows]);
  const { docs: userDocs } = useUserDocsByUids(uids);
  const csaNamesByUid = useTenantRecruiterNamesByUid(tenantId);

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(ROWS_PER_PAGE_OPTIONS[0]);

  const visible = useMemo(() => {
    const start = page * rowsPerPage;
    return rows.slice(start, start + rowsPerPage);
  }, [rows, page, rowsPerPage]);

  return (
    <CsaSectionTable
      title="Workers who just finished their first shift"
      totalCount={rows.length}
      loading={loading}
      error={error}
      emptyStateCopy="No first-shift completions in the past week."
      pagination={{
        page,
        rowsPerPage,
        onPageChange: setPage,
        onRowsPerPageChange: (next) => {
          setRowsPerPage(next);
          setPage(0);
        },
      }}
    >
      <TableHead>
        <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
          <TableCell sx={headerCellSx}>Worker</TableCell>
          <TableCell sx={headerCellSx}>Shift</TableCell>
          <TableCell sx={headerCellSx}>CSA</TableCell>
          <TableCell sx={headerCellSx}>Status</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {visible.map((row) => {
          const userDoc = userDocs.get(row.workerUid);
          const csaUid = pickPrimaryRecruiterIdFromUserDoc(userDoc);
          const csaName = csaUid ? csaNamesByUid.get(csaUid) ?? csaUid : '—';

          // Prefer end time for "finished X ago"; fall back to start so a
          // legacy row missing endDate still surfaces a useful timestamp.
          const finishedMs = row.endMs ?? row.startMs;
          const finishedRel = finishedMs ? `Finished ${formatAge(finishedMs)} ago` : '—';
          const finishedAbs = finishedMs ? formatAbsoluteTime(finishedMs) : '';
          const shiftMeta = [row.jobTitle, row.shiftTitle, row.worksiteName]
            .filter(Boolean)
            .join(' · ');

          return (
            <TableRow key={row.id} hover>
              <TableCell sx={cellSx}>
                <CsaWorkerInfoCell
                  workerUid={row.workerUid}
                  firstName={row.firstName}
                  lastName={row.lastName}
                  email={row.email}
                  phone={row.phone}
                  hiringEntityName={row.companyName}
                  avatarUrl={pickAvatarFromUserDoc(userDoc)}
                  onWorkerClick={(uid) => navigate(`/users/${uid}`)}
                />
              </TableCell>
              <TableCell sx={cellSx}>
                <Tooltip title={finishedAbs} placement="top" arrow>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {finishedRel}
                  </Typography>
                </Tooltip>
                {shiftMeta && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ lineHeight: 1.3 }}
                  >
                    {shiftMeta}
                  </Typography>
                )}
              </TableCell>
              <TableCell sx={cellSx}>
                <Typography variant="body2">{csaName}</Typography>
              </TableCell>
              <TableCell sx={cellSx}>
                <Chip
                  label={row.status || 'completed'}
                  size="small"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </CsaSectionTable>
  );
};

export default RecentlyCompletedFirstShiftsSection;
