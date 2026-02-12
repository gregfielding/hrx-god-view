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
  Chip,
  CircularProgress,
  Alert,
} from '@mui/material';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface Assignment {
  id: string;
  tenantId: string;
  jobOrderId?: string;
  jobPostId?: string;
  jobTitle?: string;
  companyName?: string;
  location?: string;
  payRate?: number;
  startDate?: Date;
  endDate?: Date;
  startTime?: string;
  endTime?: string;
  status: string; // proposed | confirmed | active | declined | cancelled | canceled
  updatedAt?: Date;
}

// Only show assignments that have been offered (Assigned) and then either Confirmed or Declined/Cancelled.
// Excludes "Placed" (placement-only, no assignment doc).
const ASSIGNMENT_STATUSES_TO_SHOW = ['proposed', 'confirmed', 'active', 'declined', 'cancelled', 'canceled'];

function getStatusDisplay(status: string): { label: string; color: 'default' | 'primary' | 'success' | 'error' | 'warning' } {
  const s = (status || '').toLowerCase();
  switch (s) {
    case 'confirmed':
    case 'active':
      return { label: 'Confirmed', color: 'success' };
    case 'declined':
      return { label: 'Declined', color: 'error' };
    case 'cancelled':
    case 'canceled':
      return { label: 'Cancelled', color: 'error' };
    case 'proposed':
    default:
      return { label: 'Assigned', color: 'primary' };
  }
}

const MyAssignments: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAssignments();
  }, [user?.uid]);

  const loadAssignments = async () => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      const tenantIds: string[] = [];
      const userData = userSnap.exists() ? userSnap.data() : null;
      if (userData?.tenantIds && typeof userData.tenantIds === 'object') {
        tenantIds.push(...Object.keys(userData.tenantIds));
      }
      if (tenantIds.length === 0) {
        tenantIds.push('BCiP2bQ9CgVOCTfV6MhD'); // c1 tenant
      }

      const loaded: Assignment[] = [];
      const seenIds = new Set<string>();

      for (const tenantId of tenantIds) {
        const assignmentsRef = collection(db, 'tenants', tenantId, 'assignments');
        const byUserId = query(assignmentsRef, where('userId', '==', user.uid));
        const byCandidateId = query(assignmentsRef, where('candidateId', '==', user.uid));
        const snapshots = await Promise.all([getDocs(byUserId), getDocs(byCandidateId)]);

        for (const snapshot of snapshots) {
          for (const docSnap of snapshot.docs) {
            if (seenIds.has(docSnap.id)) continue;
            const data = docSnap.data() as any;
            const status = (data.status || 'proposed').toLowerCase();
            if (!ASSIGNMENT_STATUSES_TO_SHOW.includes(status)) continue;

            seenIds.add(docSnap.id);

            let startDate: Date | undefined;
            let endDate: Date | undefined;
            let updatedAt: Date | undefined;
            if (data.startDate) {
              const d = data.startDate;
              startDate = typeof d === 'string' ? new Date(d) : (d?.toDate ? d.toDate() : new Date(d));
            }
            if (data.endDate) {
              const d = data.endDate;
              endDate = typeof d === 'string' ? new Date(d) : (d?.toDate ? d.toDate() : new Date(d));
            }
            if (data.updatedAt?.toDate) updatedAt = data.updatedAt.toDate();

            loaded.push({
              id: docSnap.id,
              tenantId,
              jobOrderId: data.jobOrderId,
              jobPostId: data.jobPostId,
              jobTitle: data.jobTitle || data.shiftTitle || '',
              companyName: data.companyName || data.companyTitle || '',
              location: data.worksiteName || data.locationNickname || data.location || '',
              payRate: data.payRate != null ? Number(data.payRate) : undefined,
              startDate,
              endDate,
              startTime: data.startTime,
              endTime: data.endTime,
              status,
              updatedAt,
            });
          }
        }
      }

      loaded.sort((a, b) => {
        const aTime = a.updatedAt || a.startDate ? (a.updatedAt || a.startDate)!.getTime() : 0;
        const bTime = b.updatedAt || b.startDate ? (b.updatedAt || b.startDate)!.getTime() : 0;
        return bTime - aTime;
      });

      setAssignments(loaded);
    } catch (err: any) {
      console.error('Error loading assignments:', err);
      setError(err?.message || 'Failed to load assignments');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  const handleRowClick = (assignment: Assignment) => {
    const base = window.location.pathname.startsWith('/c1') ? '/c1' : `/${assignment.tenantId}`;
    navigate(`${base}/assignments/${assignment.id}`);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {assignments.length === 0 ? (
        <Box sx={{ p: 3 }}>
          <Alert severity="info">
            You don&apos;t have any assignments yet. When you&apos;re offered a position, it will appear here as Assigned—then you can accept (Confirmed) or decline.
          </Alert>
        </Box>
      ) : (
        <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 0 }}>
          <Table>
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                <TableCell sx={{ fontWeight: 600 }}>Job Title</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Location</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Pay Rate</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Start Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>End Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {assignments.map((assignment) => {
                const statusDisplay = getStatusDisplay(assignment.status);
                return (
                  <TableRow
                    key={`${assignment.tenantId}-${assignment.id}`}
                    hover
                    sx={{
                      cursor: 'pointer',
                      '&:hover': { backgroundColor: 'action.hover' },
                    }}
                    onClick={() => handleRowClick(assignment)}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {assignment.jobTitle || 'Untitled Assignment'}
                      </Typography>
                      {assignment.companyName && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {assignment.companyName}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {assignment.location || 'N/A'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {assignment.payRate != null ? `$${Number(assignment.payRate)}/hr` : 'N/A'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {assignment.startDate ? formatDate(assignment.startDate) : 'N/A'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {assignment.endDate ? formatDate(assignment.endDate) : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={statusDisplay.label}
                        color={statusDisplay.color}
                        size="small"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default MyAssignments;
