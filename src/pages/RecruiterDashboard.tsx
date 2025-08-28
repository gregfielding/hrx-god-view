import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Card,
  CardContent,
  Grid,
  Button,
  Chip,
  Alert,
  CircularProgress,
  Paper,
} from '@mui/material';
import {
  Work as WorkIcon,
  People as PeopleIcon,
  Assignment as AssignmentIcon,
  Timeline as TimelineIcon,
  Business as BusinessIcon,
  Add as AddIcon,
} from '@mui/icons-material';

import { useAuth } from '../contexts/AuthContext';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`recruiter-tabpanel-${index}`}
      aria-labelledby={`recruiter-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

const RecruiterDashboard: React.FC = () => {
  const { tenantId, user } = useAuth();
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    jobOrders: 0,
    candidates: 0,
    applications: 0,
    activePosts: 0,
  });



  useEffect(() => {
    if (tenantId) {
      loadStats();
    }
  }, [tenantId]);

  const loadStats = async () => {
    if (!tenantId) return;
    
    setLoading(true);
    try {
      // For now, use placeholder data until functions are deployed
      setStats({
        jobOrders: 0,
        candidates: 0,
        applications: 0,
        activePosts: 0,
      });
    } catch (error) {
      console.error('Error loading recruiter stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const StatCard = ({ title, value, icon, color }: { title: string; value: number; icon: React.ReactNode; color: string }) => (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="h4" component="div" sx={{ color }}>
              {loading ? <CircularProgress size={24} /> : value.toLocaleString()}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {title}
            </Typography>
          </Box>
          <Box sx={{ color }}>
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );

  const QuickActionButton = ({ title, icon, onClick, color = 'primary' }: { 
    title: string; 
    icon: React.ReactNode; 
    onClick: () => void; 
    color?: 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info';
  }) => (
    <Button
      variant="outlined"
      startIcon={icon}
      onClick={onClick}
      sx={{ 
        height: 60, 
        minWidth: 200,
        borderColor: `${color}.main`,
        color: `${color}.main`,
        '&:hover': {
          borderColor: `${color}.dark`,
          backgroundColor: `${color}.light`,
        }
      }}
    >
      {title}
    </Button>
  );

  return (
    <Box sx={{ width: '100%' }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Recruiter Dashboard
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage job orders, candidates, applications, and recruitment workflows
        </Typography>
      </Box>

      {/* Stats Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Job Orders"
            value={stats.jobOrders}
            icon={<WorkIcon sx={{ fontSize: 40 }} />}
            color="primary.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Candidates"
            value={stats.candidates}
            icon={<PeopleIcon sx={{ fontSize: 40 }} />}
            color="secondary.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Applications"
            value={stats.applications}
            icon={<AssignmentIcon sx={{ fontSize: 40 }} />}
            color="success.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Active Posts"
            value={stats.activePosts}
            icon={<BusinessIcon sx={{ fontSize: 40 }} />}
            color="info.main"
          />
        </Grid>
      </Grid>

      {/* Quick Actions */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Quick Actions
        </Typography>
        <Grid container spacing={2}>
          <Grid item>
            <QuickActionButton
              title="Create Job Order"
              icon={<AddIcon />}
              onClick={() => setTabValue(0)}
              color="primary"
            />
          </Grid>
          <Grid item>
            <QuickActionButton
              title="Add Candidate"
              icon={<AddIcon />}
              onClick={() => setTabValue(1)}
              color="secondary"
            />
          </Grid>
          <Grid item>
            <QuickActionButton
              title="Create Job Post"
              icon={<AddIcon />}
              onClick={() => setTabValue(4)}
              color="success"
            />
          </Grid>
          <Grid item>
            <QuickActionButton
              title="View Pipeline"
              icon={<TimelineIcon />}
              onClick={() => setTabValue(3)}
              color="info"
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tabValue} onChange={handleTabChange} aria-label="recruiter tabs">
          <Tab 
            label={
              <Box display="flex" alignItems="center" gap={1}>
                <WorkIcon />
                Job Orders
              </Box>
            } 
          />
          <Tab 
            label={
              <Box display="flex" alignItems="center" gap={1}>
                <PeopleIcon />
                Candidates
              </Box>
            } 
          />
          <Tab 
            label={
              <Box display="flex" alignItems="center" gap={1}>
                <AssignmentIcon />
                Applications
              </Box>
            } 
          />
          <Tab 
            label={
              <Box display="flex" alignItems="center" gap={1}>
                <TimelineIcon />
                Pipeline
              </Box>
            } 
          />
          <Tab 
            label={
              <Box display="flex" alignItems="center" gap={1}>
                <BusinessIcon />
                Jobs Board
              </Box>
            } 
          />
        </Tabs>
      </Box>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        <Box>
          <Typography variant="h5" gutterBottom>
            Job Orders
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            Job Orders management interface will be implemented here. 
            This will include creating, editing, and managing job orders.
          </Alert>
          <Button variant="contained" startIcon={<AddIcon />}>
            Create New Job Order
          </Button>
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <Box>
          <Typography variant="h5" gutterBottom>
            Candidates
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            Candidate management interface will be implemented here. 
            This will include viewing, editing, and managing candidate profiles.
          </Alert>
          <Button variant="contained" startIcon={<AddIcon />}>
            Add New Candidate
          </Button>
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <Box>
          <Typography variant="h5" gutterBottom>
            Applications
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            Application management interface will be implemented here. 
            This will include reviewing and processing job applications.
          </Alert>
          <Grid container spacing={2}>
            <Grid item>
              <Chip label="New" color="primary" />
            </Grid>
            <Grid item>
              <Chip label="Screened" color="secondary" />
            </Grid>
            <Grid item>
              <Chip label="Advanced" color="success" />
            </Grid>
            <Grid item>
              <Chip label="Hired" color="info" />
            </Grid>
          </Grid>
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={3}>
        <Box>
          <Typography variant="h5" gutterBottom>
            Pipeline
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            Pipeline board will be implemented here. 
            This will include a Kanban-style board for managing candidate stages.
          </Alert>
          <Grid container spacing={2}>
            <Grid item xs={12} md={3}>
              <Paper sx={{ p: 2, bgcolor: 'grey.100' }}>
                <Typography variant="h6">Applicant</Typography>
                <Typography variant="body2" color="text.secondary">
                  {stats.candidates} candidates
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} md={3}>
              <Paper sx={{ p: 2, bgcolor: 'blue.100' }}>
                <Typography variant="h6">Screened</Typography>
                <Typography variant="body2" color="text.secondary">
                  0 candidates
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} md={3}>
              <Paper sx={{ p: 2, bgcolor: 'orange.100' }}>
                <Typography variant="h6">Interview</Typography>
                <Typography variant="body2" color="text.secondary">
                  0 candidates
                </Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} md={3}>
              <Paper sx={{ p: 2, bgcolor: 'green.100' }}>
                <Typography variant="h6">Offer</Typography>
                <Typography variant="body2" color="text.secondary">
                  0 candidates
                </Typography>
              </Paper>
            </Grid>
          </Grid>
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={4}>
        <Box>
          <Typography variant="h5" gutterBottom>
            Jobs Board
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            Jobs Board management interface will be implemented here. 
            This will include creating and managing job posts.
          </Alert>
          <Button variant="contained" startIcon={<AddIcon />}>
            Create Job Post
          </Button>
        </Box>
      </TabPanel>
    </Box>
  );
};

export default RecruiterDashboard;
