import React, { useEffect, useState } from 'react';
import { Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Snackbar, Alert } from '@mui/material';
import { collection, query, where, getDocs, orderBy, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';

interface UserAssignmentsTableProps {
  assignments: any[];
  showAgency?: boolean;
}

export const UserAssignmentsTable: React.FC<UserAssignmentsTableProps> = ({ assignments, showAgency = true }) => (
  <TableContainer component={Paper}>
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Title</TableCell>
          {showAgency && <TableCell>Agency</TableCell>}
          <TableCell>Worksite</TableCell>
          <TableCell>Start Date</TableCell>
          <TableCell>End Date</TableCell>
          <TableCell>Status</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {assignments.length === 0 ? (
          <TableRow><TableCell colSpan={showAgency ? 6 : 5}>No assignments found.</TableCell></TableRow>
        ) : (
          assignments.map(a => (
            <TableRow key={a.id}>
              <TableCell>{a.shiftTitle || '-'}</TableCell>
              {showAgency && <TableCell>{a.agencyName || a.agencyId || '-'}</TableCell>}
              <TableCell>{a.worksiteName || a.worksiteNickname || a.worksiteTitle || '-'}</TableCell>
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
        orderBy('startDate', 'desc')
      );
      const snapshot = await getDocs(q);
      // Optionally, fetch agency and worksite names if not present
      const assignmentsWithNames = await Promise.all(snapshot.docs.map(async docSnap => {
        const data = docSnap.data();
        let agencyName = data.agencyName;
        let worksiteName = data.worksiteName || data.worksiteNickname || data.worksiteTitle;
        if (!agencyName && data.agencyId) {
          const agencySnap = await getDoc(doc(db, 'agencies', data.agencyId));
          agencyName = agencySnap.exists() ? agencySnap.data().name : data.agencyId;
        }
        // Fetch worksite nickname for the first locationId if available
        if (!worksiteName && data.customerId && data.locationIds && data.locationIds.length > 0) {
          const worksiteSnap = await getDoc(doc(db, 'customers', data.customerId, 'locations', data.locationIds[0]));
          worksiteName = worksiteSnap.exists() ? worksiteSnap.data().nickname || worksiteSnap.data().title : data.locationIds[0];
        }
        return { id: docSnap.id, ...data, agencyName, worksiteName };
      }));
      setAssignments(assignmentsWithNames);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch assignments');
    }
    setLoading(false);
  };

  // Determine if any assignment has an agency
  const showAgency = assignments.some(a => a.agencyId);

  return (
    <Box sx={{ p: 2, width: '100%' }}>
      <Typography variant="h6" gutterBottom>Assignment History</Typography>
      <UserAssignmentsTable assignments={assignments} showAgency={showAgency} />
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>{error}</Alert>
      </Snackbar>
    </Box>
  );
};

export default UserAssignmentsTab; 