/**
 * RD.1 — Section 1: workers starting their first shift in the next 72h.
 *
 * Renders one row per (worker × confirmed-upcoming-shift). Columns:
 *   - Worker info (avatar + name + email/phone + hiring entity)
 *   - Shift details (start time + worksite + role)
 *   - CSA name (the worker's `primaryRecruiterId`, resolved via tenant map)
 *   - Assignment status
 *
 * v1 ignores the `severity` field on each row (always `'normal'`); the
 * future row-color predictor wires in by switching on `row.severity`.
 */
import React, { useMemo, useState } from 'react';
import {
  Chip,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';

import CsaSectionTable, { ROWS_PER_PAGE_OPTIONS } from './CsaSectionTable';
import CsaWorkerInfoCell from './CsaWorkerInfoCell';
import useCsaUpcomingFirstShifts from '../../../hooks/useCsaUpcomingFirstShifts';
import useUserDocsByUids from '../../../hooks/useUserDocsByUids';
import { useTenantRecruiterNamesByUid } from '../../../hooks/useTenantRecruiterNamesByUid';
import { formatAbsoluteTime } from '../../../utils/readinessQueue';
import {
  pickAvatarFromUserDoc,
  pickPrimaryRecruiterIdFromUserDoc,
} from './pickFromUserDoc';

export interface UpcomingFirstShiftsSectionProps {
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

const UpcomingFirstShiftsSection: React.FC<UpcomingFirstShiftsSectionProps> = ({
  tenantId,
  myWorkerUids,
}) => {
  const navigate = useNavigate();
  const { rows, loading, error } = useCsaUpcomingFirstShifts({ tenantId, myWorkerUids });

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
      title="Workers starting their first shift in the next 72 hours"
      totalCount={rows.length}
      loading={loading}
      error={error}
      emptyStateCopy="No workers starting first shifts in the next 72 hours."
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
          // Fall back to the uid string only when the recruiter map hasn't
          // resolved yet — avoids rendering a raw uid in the steady state.
          const csaName = csaUid ? csaNamesByUid.get(csaUid) ?? csaUid : '—';
          const startLabel = row.startMs ? formatAbsoluteTime(row.startMs) : 'Time TBD';
          const shiftMeta = [row.jobTitle, row.shiftTitle, row.worksiteName]
            .filter(Boolean)
            .join(' · ');

          return (
            <TableRow
              key={row.id}
              hover
              // TODO RD.1 phase 2: row background reflects `row.severity`
              // once messaging cadence engagement signals predict show-up
              // likelihood. v1 always renders neutral.
            >
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
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {startLabel}
                </Typography>
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
                  label={row.status || 'confirmed'}
                  size="small"
                  color="success"
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

export default UpcomingFirstShiftsSection;
