import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Card,
  CardContent,
  Grid,
  Alert,
  CircularProgress,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
} from '@mui/material';
import {
  Assignment,
  Schedule,
  LocationOn,
  Business,
  CheckCircle,
  Pending,
  Cancel,
  Info,
} from '@mui/icons-material';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';

interface Assignment {
  id: string;
  userId: string;
  jobOrderId: string;
  shiftId?: string;
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  jobTitle: string;
  hourlyRate?: number;
  totalHours?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  jobOrder?: {
    title: string;
    description: string;
    customer: string;
  };
}

const WorkerAssignments: React.FC = () => {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (user?.uid) {
      loadAssignments();
    }
  }, [user]);

  const loadAssignments = async () => {
    if (!user?.uid) return;

    setLoading(true);
    setError(null);

    try {
      const assignmentsRef = collection(db, 'assignments');
      const q = query(
        assignmentsRef,
        where('userId', '==', user.uid),
        orderBy('startDate', 'desc')
      );
      
      const snapshot = await getDocs(q);
      const assignmentsData: Assignment[] = [];

      for (const doc of snapshot.docs) {
        const data = doc.data() as Assignment;
        assignmentsData.push({
          id: doc.id,
          ...data,
        });
      }

      setAssignments(assignmentsData);
    } catch (err: any) {
      console.error('Error loading assignments:', err);
      setError(err.message || 'Failed to load assignments');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'pending':
        return 'warning';
      case 'completed':
        return 'info';
      case 'cancelled':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle />;
      case 'pending':
        return <Pending />;
      case 'completed':
        return <CheckCircle />;
      case 'cancelled':
        return <Cancel />;
      default:
        return <Info />;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatTime = (timeString: string) => {
    return new Date(`2000-01-01T${timeString}`).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const handleAssignmentClick = (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedAssignment(null);
  };

  const getUpcomingAssignments = () => {
    const now = new Date();
    return assignments.filter(assignment => {
      const startDate = new Date(assignment.startDate);
      return startDate >= now && assignment.status !== 'cancelled';
    });
  };

  const getPastAssignments = () => {
    const now = new Date();
    return assignments.filter(assignment => {
      const startDate = new Date(assignment.startDate);
      return startDate < now || assignment.status === 'cancelled';
    });
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom sx={{ mb: 4 }}>
        My Assignments
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" color="primary">
                {getUpcomingAssignments().length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Upcoming Assignments
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" color="success.main">
                {assignments.filter(a => a.status === 'active').length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Active Assignments
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" color="info.main">
                {assignments.filter(a => a.status === 'completed').length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Completed
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" color="warning.main">
                {assignments.filter(a => a.status === 'pending').length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Pending
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Upcoming Assignments */}
      <Typography variant="h5" gutterBottom sx={{ mb: 2 }}>
        Upcoming Assignments
      </Typography>
      
      {getUpcomingAssignments().length === 0 ? (
        <Alert severity="info" sx={{ mb: 4 }}>
          No upcoming assignments. Check back later for new opportunities!
        </Alert>
      ) : (
        <TableContainer component={Paper} sx={{ mb: 4 }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Job Title</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Time</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {getUpcomingAssignments().map((assignment) => (
                <TableRow key={assignment.id} hover>
                  <TableCell>
                    <Typography variant="subtitle2">
                      {assignment.jobTitle}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {formatDate(assignment.startDate)}
                  </TableCell>
                  <TableCell>
                    {formatTime(assignment.startTime)} - {formatTime(assignment.endTime)}
                  </TableCell>
                  <TableCell>
                    <Box display="flex" alignItems="center" gap={1}>
                      <LocationOn fontSize="small" color="action" />
                      {assignment.location}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      icon={getStatusIcon(assignment.status)}
                      label={assignment.status}
                      color={getStatusColor(assignment.status) as any}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      onClick={() => handleAssignmentClick(assignment)}
                    >
                      View Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Past Assignments */}
      <Typography variant="h5" gutterBottom sx={{ mb: 2 }}>
        Past Assignments
      </Typography>
      
      {getPastAssignments().length === 0 ? (
        <Alert severity="info">
          No past assignments to display.
        </Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Job Title</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Time</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {getPastAssignments().map((assignment) => (
                <TableRow key={assignment.id} hover>
                  <TableCell>
                    <Typography variant="subtitle2">
                      {assignment.jobTitle}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {formatDate(assignment.startDate)}
                  </TableCell>
                  <TableCell>
                    {formatTime(assignment.startTime)} - {formatTime(assignment.endTime)}
                  </TableCell>
                  <TableCell>
                    <Box display="flex" alignItems="center" gap={1}>
                      <LocationOn fontSize="small" color="action" />
                      {assignment.location}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      icon={getStatusIcon(assignment.status)}
                      label={assignment.status}
                      color={getStatusColor(assignment.status) as any}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      onClick={() => handleAssignmentClick(assignment)}
                    >
                      View Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Assignment Details Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        maxWidth="md"
        fullWidth
      >
        {selectedAssignment && (
          <>
            <DialogTitle>
              <Box display="flex" alignItems="center" gap={2}>
                <Assignment color="primary" />
                Assignment Details
              </Box>
            </DialogTitle>
            <DialogContent>
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Typography variant="h6" gutterBottom>
                    Job Information
                  </Typography>
                  <List dense>
                    <ListItem>
                      <ListItemIcon>
                        <Business />
                      </ListItemIcon>
                      <ListItemText
                        primary="Job Title"
                        secondary={selectedAssignment.jobTitle}
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon>
                        <Schedule />
                      </ListItemIcon>
                      <ListItemText
                        primary="Date"
                        secondary={formatDate(selectedAssignment.startDate)}
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon>
                        <Schedule />
                      </ListItemIcon>
                      <ListItemText
                        primary="Time"
                        secondary={`${formatTime(selectedAssignment.startTime)} - ${formatTime(selectedAssignment.endTime)}`}
                      />
                    </ListItem>
                  </List>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="h6" gutterBottom>
                    Location & Status
                  </Typography>
                  <List dense>
                    <ListItem>
                      <ListItemIcon>
                        <LocationOn />
                      </ListItemIcon>
                      <ListItemText
                        primary="Location"
                        secondary={selectedAssignment.location}
                      />
                    </ListItem>
                    <ListItem>
                      <ListItemIcon>
                        {getStatusIcon(selectedAssignment.status)}
                      </ListItemIcon>
                      <ListItemText
                        primary="Status"
                        secondary={
                          <Chip
                            icon={getStatusIcon(selectedAssignment.status)}
                            label={selectedAssignment.status}
                            color={getStatusColor(selectedAssignment.status) as any}
                            size="small"
                          />
                        }
                      />
                    </ListItem>
                    {selectedAssignment.hourlyRate && (
                      <ListItem>
                        <ListItemIcon>
                          <Business />
                        </ListItemIcon>
                        <ListItemText
                          primary="Hourly Rate"
                          secondary={`$${selectedAssignment.hourlyRate}/hr`}
                        />
                      </ListItem>
                    )}
                  </List>
                </Grid>
                {selectedAssignment.notes && (
                  <Grid item xs={12}>
                    <Typography variant="h6" gutterBottom>
                      Notes
                    </Typography>
                    <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                      <Typography variant="body2">
                        {selectedAssignment.notes}
                      </Typography>
                    </Paper>
                  </Grid>
                )}
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCloseDialog}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Container>
  );
};

export default WorkerAssignments; 