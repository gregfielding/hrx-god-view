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
  CircularProgress,
  Container,
} from '@mui/material';
import {
  Search,
  LocationOn,
  Business,
  Schedule,
  AttachMoney,
  Work,
} from '@mui/icons-material';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useNavigate } from 'react-router-dom';

interface PublicJobPosting {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  locationLabel: string;
  companyName: string;
  shiftType?: string;
  employmentType?: string;
  payRange?: { min?: number; max?: number };
  startDate?: string;
  status: string;
  visibility: string;
  createdAt: any;
  slug?: string;
}

const PublicJobsBoard: React.FC = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<PublicJobPosting[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<PublicJobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [shiftFilter, setShiftFilter] = useState('all');
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState('all');

  useEffect(() => {
    loadPublicJobs();
  }, []);

  const loadPublicJobs = async () => {
    try {
      setLoading(true);
      // Query all tenants for public job postings
      // For now, we'll query a specific tenant; in production, use a global index or aggregate collection
      const tenantsSnapshot = await getDocs(collection(db, 'tenants'));
      const allJobs: PublicJobPosting[] = [];

      for (const tenantDoc of tenantsSnapshot.docs) {
        const tenantId = tenantDoc.id;
        const jobPostingsRef = collection(db, 'tenants', tenantId, 'job_postings');
        const publicQuery = query(
          jobPostingsRef,
          where('visibility', '==', 'public'),
          where('status', '==', 'published'),
          orderBy('createdAt', 'desc')
        );
        
        const jobsSnapshot = await getDocs(publicQuery);
        jobsSnapshot.forEach((doc) => {
          const data = doc.data();
          allJobs.push({
            id: doc.id,
            tenantId,
            title: data.title || 'Untitled Position',
            description: data.description || '',
            locationLabel: data.locationLabel || data.location || 'Location not specified',
            companyName: data.companyName || 'Company',
            shiftType: data.shiftType,
            employmentType: data.employmentType,
            payRange: data.payRange,
            startDate: data.startDate,
            status: data.status,
            visibility: data.visibility,
            createdAt: data.createdAt,
            slug: data.slug,
          });
        });
      }

      setJobs(allJobs);
      setFilteredJobs(allJobs);
    } catch (err: any) {
      console.error('Error loading public jobs:', err);
      setError(err.message || 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let filtered = jobs;

    if (searchTerm) {
      filtered = filtered.filter(
        (job) =>
          job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          job.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
          job.locationLabel.toLowerCase().includes(searchTerm.toLowerCase()) ||
          job.companyName.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (locationFilter !== 'all') {
      filtered = filtered.filter((job) => job.locationLabel === locationFilter);
    }

    if (shiftFilter !== 'all') {
      filtered = filtered.filter((job) => job.shiftType === shiftFilter);
    }

    if (employmentTypeFilter !== 'all') {
      filtered = filtered.filter((job) => job.employmentType === employmentTypeFilter);
    }

    setFilteredJobs(filtered);
  }, [jobs, searchTerm, locationFilter, shiftFilter, employmentTypeFilter]);

  const getUniqueLocations = () => {
    return Array.from(new Set(jobs.map((job) => job.locationLabel))).sort();
  };

  const getUniqueShifts = () => {
    return Array.from(new Set(jobs.map((job) => job.shiftType).filter(Boolean))).sort();
  };

  const getUniqueEmploymentTypes = () => {
    return Array.from(new Set(jobs.map((job) => job.employmentType).filter(Boolean))).sort();
  };

  const handleApply = (job: PublicJobPosting) => {
    // Navigate to application page (to be created)
    navigate(`/apply/${job.tenantId}/${job.id}`);
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

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
          Find Your Next Opportunity
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Browse open positions and apply today
        </Typography>
      </Box>

      {/* Filters */}
      <Paper elevation={2} sx={{ p: 3, mb: 4 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              placeholder="Search jobs by title, description, or company..."
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
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Location</InputLabel>
              <Select
                value={locationFilter}
                label="Location"
                onChange={(e) => setLocationFilter(e.target.value)}
              >
                <MenuItem value="all">All Locations</MenuItem>
                {getUniqueLocations().map((location) => (
                  <MenuItem key={location} value={location}>
                    {location}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Shift</InputLabel>
              <Select
                value={shiftFilter}
                label="Shift"
                onChange={(e) => setShiftFilter(e.target.value)}
              >
                <MenuItem value="all">All Shifts</MenuItem>
                {getUniqueShifts().map((shift) => (
                  <MenuItem key={shift} value={shift}>
                    {shift}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl fullWidth>
              <InputLabel>Type</InputLabel>
              <Select
                value={employmentTypeFilter}
                label="Type"
                onChange={(e) => setEmploymentTypeFilter(e.target.value)}
              >
                <MenuItem value="all">All Types</MenuItem>
                {getUniqueEmploymentTypes().map((type) => (
                  <MenuItem key={type} value={type}>
                    {type}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {filteredJobs.length} {filteredJobs.length === 1 ? 'job' : 'jobs'} found
          </Typography>
        </Box>
      </Paper>

      {/* Jobs Grid */}
      {filteredJobs.length === 0 ? (
        <Alert severity="info">
          No jobs found matching your criteria. Try adjusting your filters or search terms.
        </Alert>
      ) : (
        <Grid container spacing={3}>
          {filteredJobs.map((job) => (
            <Grid item xs={12} md={6} key={`${job.tenantId}-${job.id}`}>
              <Card
                elevation={2}
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 4,
                  },
                }}
              >
                <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Typography variant="h6" component="h3" sx={{ fontWeight: 600, flexGrow: 1 }}>
                      {job.title}
                    </Typography>
                    <Chip label="OPEN" color="success" size="small" />
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, flexGrow: 1 }}>
                    {job.description.length > 200
                      ? `${job.description.substring(0, 200)}...`
                      : job.description}
                  </Typography>

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Business sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary">
                      {job.companyName}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <LocationOn sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary">
                      {job.locationLabel}
                    </Typography>
                  </Box>

                  {job.shiftType && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <Schedule sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">
                        {job.shiftType}
                      </Typography>
                    </Box>
                  )}

                  {job.employmentType && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Work sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary">
                        {job.employmentType}
                      </Typography>
                    </Box>
                  )}

                  {job.payRange && (job.payRange.min || job.payRange.max) && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <AttachMoney sx={{ fontSize: 18, color: 'primary.main', mr: 0.5 }} />
                      <Typography variant="body1" color="primary" sx={{ fontWeight: 600 }}>
                        {job.payRange.min && job.payRange.max
                          ? `$${job.payRange.min} - $${job.payRange.max}/hr`
                          : job.payRange.min
                          ? `From $${job.payRange.min}/hr`
                          : `Up to $${job.payRange.max}/hr`}
                      </Typography>
                    </Box>
                  )}

                  <Button variant="contained" fullWidth sx={{ mt: 'auto' }} onClick={() => handleApply(job)}>
                    Apply Now
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Container>
  );
};

export default PublicJobsBoard;
