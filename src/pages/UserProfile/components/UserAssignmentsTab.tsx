import React, { useEffect, useState } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Snackbar,
  Alert,
  TableSortLabel,
} from '@mui/material';
import { collection, query, where, getDocs, orderBy, doc, getDoc } from 'firebase/firestore';

import { db } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import AssignmentsTable from '../../../componentBlocks/AssignmentsTable';

interface UserAssignmentsTableProps {
  assignments: any[];
  showAgency?: boolean;
  showFullAgencyTable?: boolean;
}

export const UserAssignmentsTable: React.FC<UserAssignmentsTableProps> = ({
  assignments,
  showAgency = true,
  showFullAgencyTable = false,
}) => {
  const [sortField, setSortField] = useState<string>('startDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedAssignments = [...assignments].sort((a, b) => {
    let aValue = a[sortField];
    let bValue = b[sortField];
    if (aValue === undefined) aValue = '';
    if (bValue === undefined) bValue = '';
    if (sortField === 'startDate' || sortField === 'endDate') {
      aValue = new Date(aValue);
      bValue = new Date(bValue);
      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
    }
    aValue = (aValue || '').toString().toLowerCase();
    bValue = (bValue || '').toString().toLowerCase();
    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <TableContainer component={Paper}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {showFullAgencyTable ? (
              <>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'firstName'}
                    direction={sortDirection}
                    onClick={() => handleSort('firstName')}
                  >
                    First Name
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'lastName'}
                    direction={sortDirection}
                    onClick={() => handleSort('lastName')}
                  >
                    Last Name
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'jobOrderTitle'}
                    direction={sortDirection}
                    onClick={() => handleSort('jobOrderTitle')}
                  >
                    Job Order Title
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'customerName'}
                    direction={sortDirection}
                    onClick={() => handleSort('customerName')}
                  >
                    Customer
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'worksiteName'}
                    direction={sortDirection}
                    onClick={() => handleSort('worksiteName')}
                  >
                    Worksite
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'jobTitle'}
                    direction={sortDirection}
                    onClick={() => handleSort('jobTitle')}
                  >
                    Job Title
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'shiftTitle'}
                    direction={sortDirection}
                    onClick={() => handleSort('shiftTitle')}
                  >
                    Shift Title
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'startDate'}
                    direction={sortDirection}
                    onClick={() => handleSort('startDate')}
                  >
                    Start Date
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'endDate'}
                    direction={sortDirection}
                    onClick={() => handleSort('endDate')}
                  >
                    End Date
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'status'}
                    direction={sortDirection}
                    onClick={() => handleSort('status')}
                  >
                    Status
                  </TableSortLabel>
                </TableCell>
              </>
            ) : (
              <>
                <TableCell>Title</TableCell>
                {showAgency && <TableCell>Agency</TableCell>}
                <TableCell>Worksite</TableCell>
                <TableCell>Start Date</TableCell>
                <TableCell>End Date</TableCell>
                <TableCell>Status</TableCell>
              </>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedAssignments.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showFullAgencyTable ? 10 : showAgency ? 6 : 5}>
                No assignments found.
              </TableCell>
            </TableRow>
          ) : showFullAgencyTable ? (
            sortedAssignments.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.firstName || '-'}</TableCell>
                <TableCell>{a.lastName || '-'}</TableCell>
                <TableCell>{a.jobOrderTitle || '-'}</TableCell>
                <TableCell>{a.customerName || '-'}</TableCell>
                <TableCell>{a.worksiteName || '-'}</TableCell>
                <TableCell>{a.jobTitle || '-'}</TableCell>
                <TableCell>{a.shiftTitle || '-'}</TableCell>
                <TableCell>{a.startDate || '-'}</TableCell>
                <TableCell>{a.endDate || '-'}</TableCell>
                <TableCell>{a.status || '-'}</TableCell>
              </TableRow>
            ))
          ) : (
            sortedAssignments.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.shiftTitle || '-'}</TableCell>
                {showAgency && <TableCell>{a.agencyName || a.tenantId || '-'}</TableCell>}
                <TableCell>{a.worksiteName || '-'}</TableCell>
                <TableCell>{a.startDate || '-'}</TableCell>
                <TableCell>{a.endDate || '-'}</TableCell>
                <TableCell>{a.status || '-'}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

const UserAssignmentsTab: React.FC<{ userId: string; tenantId?: string | null }> = ({
  userId,
  tenantId,
}) => {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAssignments();
    // eslint-disable-next-line
  }, [userId, tenantId]);

  const fetchAssignments = async () => {
    setLoading(true);
    setError('');
    if (!tenantId) {
      setAssignments([]);
      setLoading(false);
      setError('Select a tenant context to load assignments.');
      return;
    }
    try {
      const col = collection(db, p.assignments(tenantId));
      const [byUser, byCandidate] = await Promise.all([
        getDocs(query(col, where('userId', '==', userId), orderBy('startDate', 'desc'))),
        getDocs(query(col, where('candidateId', '==', userId))),
      ]);
      const byId = new Map<string, { id: string; data: () => Record<string, unknown> }>();
      byUser.docs.forEach((d) => byId.set(d.id, d));
      byCandidate.docs.forEach((d) => {
        if (!byId.has(d.id)) byId.set(d.id, d);
      });
      const merged = Array.from(byId.values()).sort((a, b) => {
        const sa = String((a.data() as { startDate?: string }).startDate || '');
        const sb = String((b.data() as { startDate?: string }).startDate || '');
        return sb.localeCompare(sa);
      });
      const assignmentsWithNames = await Promise.all(
        merged.map(async (docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          let tenantName = data.tenantName as string | undefined;
          let worksiteName =
            (data.worksiteName as string) ||
            (data.worksiteNickname as string) ||
            (data.worksiteTitle as string);
          if (!tenantName) {
            const tenantSnap = await getDoc(doc(db, 'tenants', tenantId));
            tenantName = tenantSnap.exists() ? (tenantSnap.data().name as string) : tenantId;
          }
          const locIds = data.locationIds as string[] | undefined;
          if (!worksiteName && locIds && locIds.length > 0) {
            const worksiteSnap = await getDoc(doc(db, 'tenants', tenantId, 'locations', locIds[0]));
            worksiteName = worksiteSnap.exists()
              ? ((worksiteSnap.data().nickname || worksiteSnap.data().title) as string)
              : locIds[0];
          }
          return { id: docSnap.id, ...data, tenantName, worksiteName };
        }),
      );
      setAssignments(assignmentsWithNames);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch assignments');
    }
    setLoading(false);
  };

  const showTenant = assignments.some((a) => a.tenantId);

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <AssignmentsTable assignments={assignments} showAgency={showTenant} />
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default UserAssignmentsTab;
