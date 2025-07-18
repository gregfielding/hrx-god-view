import React, { useEffect, useState } from 'react';
import { Box, Typography, Snackbar, Alert, TextField, Button } from '@mui/material';
import { collection, query, where, getDocs, orderBy, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import AssignmentsTable from '../../../componentBlocks/AssignmentsTable';

const AgencyAssignmentsTab: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    fetchAssignments();
    // eslint-disable-next-line
  }, [tenantId]);

  const fetchAssignments = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'assignments'),
        where('tenantId', '==', tenantId),
        orderBy('startDate', 'desc'),
      );
      const snapshot = await getDocs(q);
      // Fetch all unique customer and worksite pairs
      const assignmentsData = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as any[];
      const pairs = assignmentsData
        .filter(
          (a) =>
            (a as any).tenantId && (a as any).locationIds && (a as any).locationIds.length > 0,
        )
        .map((a) => ({ tenantId: (a as any).tenantId, worksiteId: (a as any).locationIds[0] }));
      const uniquePairs = Array.from(
        new Set(pairs.map((p) => p.tenantId + '|' + p.worksiteId)),
      ).map((key) => {
        const [tenantId, worksiteId] = key.split('|');
        return { tenantId, worksiteId };
      });
      // Fetch all referenced worksites
      const worksiteMap: Record<string, { nickname?: string; city?: string }> = {};
      await Promise.all(
        uniquePairs.map(async ({ tenantId, worksiteId }) => {
          try {
            const locRef = doc(db, 'tenants', tenantId, 'locations', worksiteId);
            const locSnap = await getDoc(locRef);
            if (locSnap.exists()) {
              const data = locSnap.data();
              worksiteMap[worksiteId] = { nickname: data.nickname, city: data.city };
            }
          } catch {}
        }),
      );
      // Fetch all referenced tenants
      const tenantIds = Array.from(
        new Set(assignmentsData.map((a) => (a as any).tenantId).filter(Boolean)),
      );
      const customerMap: Record<string, string> = {};
      await Promise.all(
        tenantIds.map(async (id) => {
          try {
            const snap = await getDoc(doc(db, 'tenants', id));
            if (snap.exists()) customerMap[id] = snap.data().name;
          } catch {}
        }),
      );
      // Add formatted customer and worksite fields
      const assignmentsWithNames = await Promise.all(
        assignmentsData.map(async (_a) => {
          const a = _a as any;
          let agencyName = a.agencyName;
          let worksiteName = '';
          let customerName = '';
          let jobOrderTitle = a.jobOrderTitle;
          // Fetch agency name if missing
          if (!agencyName && a.tenantId) {
            const agencySnap = await getDoc(doc(db, 'tenants', a.tenantId));
            agencyName = agencySnap.exists() ? agencySnap.data().name : a.tenantId;
          }
          // Customer name logic (like JobOrdersTab)
          if (a.tenantId) {
            customerName = customerMap[a.tenantId] || a.customerName || a.tenantId;
          } else {
            customerName = a.customerName || '';
          }
          // Worksite logic (like JobOrdersTab)
          if (a.locationIds && a.locationIds.length > 0) {
            const info = worksiteMap[a.locationIds[0]];
            if (info) {
              if (info.nickname && info.city) worksiteName = `${info.nickname} (${info.city})`;
              else if (info.nickname) worksiteName = info.nickname;
              else if (info.city) worksiteName = info.city;
            } else {
              worksiteName = a.worksiteName || a.worksiteNickname || a.worksiteTitle || '';
            }
          } else {
            worksiteName = a.worksiteName || a.worksiteNickname || a.worksiteTitle || '';
          }
          // Fetch job order title if missing
          if (!jobOrderTitle && a.jobOrderId) {
            const jobOrderSnap = await getDoc(doc(db, 'jobOrders', a.jobOrderId));
            jobOrderTitle = jobOrderSnap.exists() ? jobOrderSnap.data().title : a.jobOrderId;
          }
          return {
            ...a,
            agencyName,
            worksiteName,
            customerName,
            jobOrderTitle,
          };
        }),
      );
      setAssignments(assignmentsWithNames);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch assignments');
    }
    setLoading(false);
  };

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Typography variant="h6" gutterBottom>
        Assignments
      </Typography>
      <Box display="flex" gap={2} mb={2} alignItems="center">
        <TextField
          variant="outlined"
          size="medium"
          placeholder="Search by First or Last Name"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (hasSearched) setHasSearched(false);
          }}
        />
        {search.trim() && !hasSearched && (
          <Button variant="contained" size="large" onClick={() => setHasSearched(true)}>
            SEARCH
          </Button>
        )}
        {hasSearched && (
          <Button
            variant="outlined"
            size="large"
            onClick={() => {
              setSearch('');
              setHasSearched(false);
            }}
          >
            CLEAR
          </Button>
        )}
      </Box>
      {/* Filter assignments by search */}
      <AssignmentsTable
        assignments={assignments.filter((a) => {
          if (!hasSearched || !search.trim()) return true;
          const s = search.trim().toLowerCase();
          return (
            (a.firstName && a.firstName.toLowerCase().includes(s)) ||
            (a.lastName && a.lastName.toLowerCase().includes(s))
          );
        })}
        showAgency={false}
        showFullAgencyTable
      />
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AgencyAssignmentsTab;
