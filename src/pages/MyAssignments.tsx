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
  Alert
} from '@mui/material';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface Assignment {
  id: string;
  tenantId: string;
  jobTitle?: string;
  companyName?: string;
  location?: string;
  startDate?: Date;
  endDate?: Date;
  status: string;
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

      // TODO: Load assignments from Firestore
      // For now, just set empty array
      setAssignments([]);
      
    } catch (err: any) {
      console.error('Error loading assignments:', err);
      setError(err.message || 'Failed to load assignments');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string): 'default' | 'primary' | 'success' | 'error' | 'warning' => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'success';
      case 'completed':
        return 'default';
      case 'pending':
        return 'warning';
      case 'cancelled':
        return 'error';
      default:
        return 'default';
    }
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
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
            You don't have any active assignments yet. Check back soon!
          </Alert>
        </Box>
      ) : (
        <TableContainer component={Paper} elevation={0} sx={{ borderRadius: 0 }}>
          <Table>
            <TableHead>
              <TableRow sx={{ backgroundColor: 'grey.100' }}>
                <TableCell sx={{ fontWeight: 600 }}>Job Title</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Location</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Start Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>End Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {assignments.map((assignment) => (
                <TableRow 
                  key={assignment.id}
                  hover
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': {
                      backgroundColor: 'action.hover'
                    }
                  }}
                  onClick={() => {
                    // Navigate to assignment details (can be updated later)
                    navigate(`/c1/jobs-board`);
                  }}
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
                      {assignment.startDate ? formatDate(assignment.startDate) : 'N/A'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {assignment.endDate ? formatDate(assignment.endDate) : 'Ongoing'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={assignment.status.charAt(0).toUpperCase() + assignment.status.slice(1)} 
                      color={getStatusColor(assignment.status)}
                      size="small"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default MyAssignments;

