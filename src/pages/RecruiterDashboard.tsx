import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Card,
  CardContent,
  CardHeader,
  Grid,
  Button,
  Chip,
  Alert,
  CircularProgress,
  Paper,
  IconButton,
  Divider,
} from '@mui/material';
import {
  Work as WorkIcon,
  People as PeopleIcon,
  Assignment as AssignmentIcon,
  Timeline as TimelineIcon,
  Business as BusinessIcon,
  Add as AddIcon,
  Event as EventIcon,
  Schedule as ScheduleIcon,
  TrendingUp as TrendingUpIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  CalendarToday as CalendarTodayIcon,
  Assessment as AssessmentIcon,
  Message as MessageIcon,
} from '@mui/icons-material';

import { useAuth } from '../contexts/AuthContext';
import TasksDashboard from '../components/TasksDashboard';
import CalendarWidget from '../components/CalendarWidget';

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
  const [userData, setUserData] = useState<any>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  
  // Enhanced recruiter-specific KPIs
  const [kpis, setKpis] = useState({
    openJobOrders: 0,
    candidatesInProcess: 0,
    interviewsThisWeek: 0,
    placementsMTD: 0,
    timeToFill: 0,
    submittalsPerJob: 0,
    placementGoal: 0,
    complianceAlerts: 0,
  });

  useEffect(() => {
    if (tenantId) {
      loadUserData();
      loadKPIs();
    }
  }, [tenantId]);

  const loadUserData = async () => {
    if (!tenantId || !user?.uid) return;
    
    setLoadingUser(true);
    try {
      // For now, use placeholder data
      setUserData({
        firstName: user?.displayName?.split(' ')[0] || 'Recruiter',
        lastName: user?.displayName?.split(' ').slice(1).join(' ') || '',
      });
    } catch (error) {
      console.error('Error loading user data:', error);
    } finally {
      setLoadingUser(false);
    }
  };

  const loadKPIs = async () => {
    if (!tenantId) return;
    
    setLoading(true);
    try {
      // For now, use placeholder data until functions are deployed
      setKpis({
        openJobOrders: 12,
        candidatesInProcess: 45,
        interviewsThisWeek: 8,
        placementsMTD: 3,
        timeToFill: 14,
        submittalsPerJob: 4.2,
        placementGoal: 75,
        complianceAlerts: 2,
      });
    } catch (error) {
      console.error('Error loading recruiter KPIs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const KPICard = ({ 
    title, 
    value, 
    subtitle, 
    icon, 
    color, 
    trend 
  }: { 
    title: string; 
    value: string | number; 
    subtitle?: string;
    icon: React.ReactNode; 
    color: string;
    trend?: { value: number; isPositive: boolean };
  }) => (
    <Card sx={{ height: '100%', position: 'relative', overflow: 'visible' }}>
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
          <Box sx={{ color }}>
            {icon}
          </Box>
          {trend && (
            <Chip
              label={`${trend.isPositive ? '+' : ''}${trend.value}%`}
              size="small"
              color={trend.isPositive ? 'success' : 'error'}
              sx={{ fontSize: '0.75rem' }}
            />
          )}
        </Box>
        <Typography variant="h4" component="div" sx={{ color, fontWeight: 'bold', mb: 0.5 }}>
          {loading ? <CircularProgress size={24} /> : value}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </CardContent>
    </Card>
  );

  const QuickActionButton = ({ 
    title, 
    icon, 
    onClick, 
    color = 'primary',
    variant = 'outlined'
  }: { 
    title: string; 
    icon: React.ReactNode; 
    onClick: () => void; 
    color?: 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info';
    variant?: 'outlined' | 'contained';
  }) => (
    <Button
      variant={variant}
      startIcon={icon}
      onClick={onClick}
      sx={{ 
        height: 56, 
        minWidth: 180,
        fontWeight: 600,
        ...(variant === 'outlined' ? {
          borderColor: `${color}.main`,
          color: `${color}.main`,
          '&:hover': {
            borderColor: `${color}.dark`,
            backgroundColor: `${color}.light`,
          }
        } : {
          backgroundColor: `${color}.main`,
          '&:hover': {
            backgroundColor: `${color}.dark`,
          }
        })
      }}
    >
      {title}
    </Button>
  );

  // Memoize the entity object for TasksDashboard
  const tasksEntity = React.useMemo(() => ({
    id: user?.uid || 'dashboard',
    name: 'My Recruiter Tasks',
    associations: {
      deals: [],
      companies: [],
      contacts: [],
      salespeople: [user?.uid]
    }
  }), [user?.uid]);

  return (
    <Box sx={{ width: '100%' }}>
      {/* Personalized Welcome Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
          Welcome back, {loadingUser ? '...' : (userData?.firstName || 'Recruiter')}!
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Here's your recruitment dashboard overview
        </Typography>
      </Box>

      {/* Enhanced KPI Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Open Job Orders"
            value={kpis.openJobOrders}
            subtitle="vs. 15 last month"
            icon={<WorkIcon sx={{ fontSize: 32 }} />}
            color="#1976d2"
            trend={{ value: -20, isPositive: false }}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Candidates in Process"
            value={kpis.candidatesInProcess}
            subtitle="Active pipeline"
            icon={<PeopleIcon sx={{ fontSize: 32 }} />}
            color="#9c27b0"
            trend={{ value: 12, isPositive: true }}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Interviews This Week"
            value={kpis.interviewsThisWeek}
            subtitle="Scheduled"
            icon={<EventIcon sx={{ fontSize: 32 }} />}
            color="#ff9800"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Placements MTD"
            value={kpis.placementsMTD}
            subtitle={`${kpis.placementGoal}% of goal`}
            icon={<CheckCircleIcon sx={{ fontSize: 32 }} />}
            color="#4caf50"
            trend={{ value: 8, isPositive: true }}
          />
        </Grid>
      </Grid>

      {/* Secondary KPI Row */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Avg Time to Fill"
            value={`${kpis.timeToFill} days`}
            subtitle="Industry avg: 18 days"
            icon={<ScheduleIcon sx={{ fontSize: 32 }} />}
            color="#607d8b"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Submittals per Job"
            value={kpis.submittalsPerJob}
            subtitle="Quality candidates"
            icon={<TrendingUpIcon sx={{ fontSize: 32 }} />}
            color="#795548"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Placement Goal"
            value={`${kpis.placementGoal}%`}
            subtitle="Monthly target"
            icon={<AssessmentIcon sx={{ fontSize: 32 }} />}
            color="#e91e63"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KPICard
            title="Compliance Alerts"
            value={kpis.complianceAlerts}
            subtitle="Requires attention"
            icon={<WarningIcon sx={{ fontSize: 32 }} />}
            color="#f44336"
          />
        </Grid>
      </Grid>

      {/* To-Dos and Calendar Layout (mirroring CRM) */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} md={4}>
          {/* Left Column - To-Dos & Quick Actions */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* To-Dos Widget */}
            <Card>
              <CardHeader 
                title="To-Dos" 
                action={
                  <IconButton 
                    size="small" 
                    title="Add new task"
                    onClick={() => setTabValue(1)}
                  >
                    <AddIcon />
                  </IconButton>
                }
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
              />
              <CardContent sx={{ p: 0 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <TasksDashboard
                    entityId={user?.uid || 'dashboard'}
                    entityType="salesperson"
                    tenantId={tenantId}
                    entity={tasksEntity}
                    preloadedContacts={[]}
                    preloadedSalespeople={[]}
                    preloadedCompany={null}
                    preloadedDeals={[]}
                    preloadedCompanies={[]}
                    showOnlyTodos={true}
                  />
                </Box>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card>
              <CardHeader 
                title="Quick Actions" 
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
              />
              <CardContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <QuickActionButton
                    title="+ Create Job Order"
                    icon={<AddIcon />}
                    onClick={() => setTabValue(0)}
                    color="primary"
                    variant="contained"
                  />
                  <QuickActionButton
                    title="+ Add Candidate"
                    icon={<AddIcon />}
                    onClick={() => setTabValue(1)}
                    color="secondary"
                  />
                  <QuickActionButton
                    title="+ Create Job Post"
                    icon={<AddIcon />}
                    onClick={() => setTabValue(4)}
                    color="success"
                  />
                  <QuickActionButton
                    title="View Candidate Pipeline"
                    icon={<TimelineIcon />}
                    onClick={() => setTabValue(3)}
                    color="info"
                  />
                </Box>
              </CardContent>
            </Card>

            {/* Jobs Board Widget */}
            <Card>
              <CardHeader 
                title="Jobs Board" 
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
              />
              <CardContent>
                <Box sx={{ textAlign: 'center', py: 2 }}>
                  <Typography variant="h4" color="primary" fontWeight="bold">
                    4
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Active Posts
                  </Typography>
                  <Typography variant="h6" color="success.main" fontWeight="bold">
                    12
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    New Applicants Today
                  </Typography>
                  <Button 
                    variant="outlined" 
                    size="small" 
                    onClick={() => setTabValue(4)}
                    sx={{ mt: 1 }}
                  >
                    Manage Posts
                  </Button>
                </Box>
              </CardContent>
            </Card>
          </Box>
        </Grid>
        
        <Grid item xs={12} md={8}>
          {/* Calendar Widget */}
          <CalendarWidget
            userId={user?.uid || ''}
            tenantId={tenantId}
            preloadedContacts={[]}
            preloadedSalespeople={[]}
            preloadedCompanies={[]}
            preloadedDeals={[]}
          />
        </Grid>
      </Grid>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
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
            Candidate Pipeline
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
                  {kpis.candidatesInProcess} candidates
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
