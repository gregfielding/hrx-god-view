import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Chip,
  Button,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
} from '@mui/material';
import { Search, LocationOn, Business, Schedule } from '@mui/icons-material';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

interface JobOrder {
  id: string;
  title: string;
  description: string;
  location: string;
  customer: string;
  startDate: string;
  endDate: string;
  status: string;
  type: string;
  hourlyRate?: number;
  requirements?: string[];
}

const JobsBoard: React.FC = () => {
  const { tenantId } = useAuth();
  const [jobOrders, setJobOrders] = useState<JobOrder[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<JobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  // Load job orders from Firestore
  useEffect(() => {
    if (!tenantId) return;

    const jobOrdersRef = collection(db, 'tenants', tenantId, 'jobOrders');
    const q = query(
      jobOrdersRef,
      where('status', 'in', ['open', 'active', 'pending']),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const jobs: JobOrder[] = [];
      snapshot.forEach((doc) => {
        jobs.push({ id: doc.id, ...doc.data() } as JobOrder);
      });
      setJobOrders(jobs);
      setFilteredJobs(jobs);
      setLoading(false);
    }, (error) => {
      console.error('Error loading job orders:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [tenantId]);

  // Filter jobs based on search and filters
  useEffect(() => {
    let filtered = jobOrders;

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(job =>
        job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.customer.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(job => job.status === statusFilter);
    }

    // Type filter
    if (typeFilter !== 'all') {
      filtered = filtered.filter(job => job.type === typeFilter);
    }

    setFilteredJobs(filtered);
  }, [jobOrders, searchTerm, statusFilter, typeFilter]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'success';
      case 'active': return 'primary';
      case 'pending': return 'warning';
      default: return 'default';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'full-time': return 'primary';
      case 'part-time': return 'secondary';
      case 'contract': return 'info';
      case 'temporary': return 'warning';
      default: return 'default';
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Loading jobs board...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Typography variant="h6" gutterBottom>
        Jobs Board
      </Typography>

      {/* Filters */}
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              placeholder="Search jobs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                label="Status"
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <MenuItem value="all">All Statuses</MenuItem>
                <MenuItem value="open">Open</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Type</InputLabel>
              <Select
                value={typeFilter}
                label="Type"
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <MenuItem value="all">All Types</MenuItem>
                <MenuItem value="full-time">Full Time</MenuItem>
                <MenuItem value="part-time">Part Time</MenuItem>
                <MenuItem value="contract">Contract</MenuItem>
                <MenuItem value="temporary">Temporary</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <Typography variant="body2" color="text.secondary">
              {filteredJobs.length} jobs found
            </Typography>
          </Grid>
        </Grid>
      </Paper>

      {/* Jobs Grid */}
      {filteredJobs.length === 0 ? (
        <Alert severity="info">
          No jobs found matching your criteria. Try adjusting your filters or search terms.
        </Alert>
      ) : (
        <Grid container spacing={3}>
          {filteredJobs.map((job) => (
            <Grid item xs={12} md={6} lg={4} key={job.id}>
              <Card elevation={2} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Typography variant="h6" component="h3" sx={{ fontWeight: 600 }}>
                      {job.title}
                    </Typography>
                    <Chip
                      label={job.status}
                      color={getStatusColor(job.status) as any}
                      size="small"
                    />
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, flexGrow: 1 }}>
                    {job.description.length > 150 
                      ? `${job.description.substring(0, 150)}...` 
                      : job.description
                    }
                  </Typography>

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Business sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary">
                      {job.customer}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <LocationOn sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary">
                      {job.location}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Schedule sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary">
                      {new Date(job.startDate).toLocaleDateString()} - {new Date(job.endDate).toLocaleDateString()}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Chip
                      label={job.type}
                      color={getTypeColor(job.type) as any}
                      size="small"
                    />
                    {job.hourlyRate && (
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        ${job.hourlyRate}/hr
                      </Typography>
                    )}
                  </Box>

                  <Box sx={{ mt: 2 }}>
                    <Button
                      variant="contained"
                      fullWidth
                      size="small"
                    >
                      View Details
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
};

export default JobsBoard; 