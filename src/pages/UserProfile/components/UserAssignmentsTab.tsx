import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
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

const UserAssignmentsTab: React.FC<{ userId: string }> = ({ userId }) => {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAssignments();
    // eslint-disable-next-line
  }, [userId]);

  const fetchAssignments = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'assignments'),
        where('userId', '==', userId),
        orderBy('startDate', 'desc'),
      );
      const snapshot = await getDocs(q);
      // Optionally, fetch tenant and worksite names if not present
      const assignmentsWithNames = await Promise.all(
        snapshot.docs.map(async (docSnap) => {
          const data = docSnap.data();
          let tenantName = data.tenantName;
          let worksiteName = data.worksiteName || data.worksiteNickname || data.worksiteTitle;
          if (!tenantName && data.tenantId) {
            const tenantSnap = await getDoc(doc(db, 'tenants', data.tenantId));
            tenantName = tenantSnap.exists() ? tenantSnap.data().name : data.tenantId;
          }
          // Fetch worksite nickname for the first locationId if available
          if (!worksiteName && data.tenantId && data.locationIds && data.locationIds.length > 0) {
            const worksiteSnap = await getDoc(
              doc(db, 'tenants', data.tenantId, 'locations', data.locationIds[0]),
            );
            worksiteName = worksiteSnap.exists()
              ? worksiteSnap.data().nickname || worksiteSnap.data().title
              : data.locationIds[0];
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

  // Determine if any assignment has a tenant
  const showTenant = assignments.some((a) => a.tenantId);

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Typography variant="h6" gutterBottom>
        Assignment History
      </Typography>
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
