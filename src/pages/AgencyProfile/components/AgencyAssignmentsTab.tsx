import React, { useEffect, useState } from 'react';
import { Box, Typography, Snackbar, Alert } from '@mui/material';
import { collection, query, where, getDocs, orderBy, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { UserAssignmentsTable } from '../../UserProfile/components/UserAssignmentsTab';

const AgencyAssignmentsTab: React.FC<{ agencyId: string }> = ({ agencyId }) => {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAssignments();
    // eslint-disable-next-line
  }, [agencyId]);

  const fetchAssignments = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'assignments'),
        where('agencyId', '==', agencyId),
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

  return (
    <Box sx={{ p: 2, width: '100%' }}>
      <Typography variant="h6" gutterBottom>All Assignments for Agency</Typography>
      <UserAssignmentsTable assignments={assignments} showAgency={false} />
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>{error}</Alert>
      </Snackbar>
    </Box>
  );
};

export default AgencyAssignmentsTab; 