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
  Tooltip,
  ToggleButtonGroup,
  ToggleButton,
  LinearProgress,
  Skeleton,
} from '@mui/material';
import Applications from './Applications';
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
  TrendingDown as TrendingDownIcon,
  TrendingFlat as TrendingFlatIcon,
  FilterList as FilterListIcon,
  ArrowForward as ArrowForwardIcon,
  Dashboard as DashboardIcon,
} from '@mui/icons-material';

import { useAuth } from '../contexts/AuthContext';
import TasksDashboard from '../components/TasksDashboard';
import CalendarWidget from '../components/CalendarWidget';
import JobOrdersManagement from '../components/recruiter/JobOrdersManagement';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';

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
        <Box sx={{ p: 0 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

type DateRange = 'week' | 'mtd' | '30d' | '90d';

const RecruiterDashboard: React.FC = () => {
  const { tenantId, user } = useAuth();
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState<any>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>('mtd');
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
  
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

  // Jobs Board metrics
  const [jobsBoardMetrics, setJobsBoardMetrics] = useState({
    activePosts: 4,
    newApplicantsToday: 12,
    applicantsTrend: [8, 12, 15, 10, 14, 11, 12], // 7-day trend
  });

  // Contact data for task cards
  const [preloadedContacts, setPreloadedContacts] = useState<any[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

  useEffect(() => {
    if (tenantId) {
      loadUserData();
      loadKPIs();
      loadContacts();
    }
  }, [tenantId, dateRange]);

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

  const loadContacts = async () => {
    if (!tenantId) return;
    
    setLoadingContacts(true);
    try {
      console.log('🔍 Loading contacts for RecruiterDashboard...');
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const contactsQuery = query(contactsRef, orderBy('createdAt', 'desc'), limit(100));
      const contactsSnapshot = await getDocs(contactsQuery);
      
      const contactsData = contactsSnapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      }));
      
      console.log('✅ Loaded contacts for RecruiterDashboard:', contactsData.length);
      setPreloadedContacts(contactsData);
    } catch (error) {
      console.error('Error loading contacts:', error);
      setPreloadedContacts([]);
    } finally {
      setLoadingContacts(false);
    }
  };

  const loadKPIs = async () => {
    if (!tenantId) return;
    
    setLoading(true);
    try {
      // Simulate loading delay for better UX
      await new Promise(resolve => setTimeout(resolve, 500));
      
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

  const handleDateRangeChange = (event: React.MouseEvent<HTMLElement>, newRange: DateRange | null) => {
    if (newRange !== null) {
      setDateRange(newRange);
    }
  };

  const handleKPICardClick = (cardType: string) => {
    // Track telemetry event
    console.log('dashboard.card.click', { cardId: cardType, range: dateRange });
    
    // Navigate to appropriate tab with filters
    switch (cardType) {
      case 'openJobOrders':
        setTabValue(1); // Job Orders tab
        // TODO: Apply filters: status=open, owner=me
        break;
      case 'candidatesInProcess':
        setTabValue(2); // Candidates tab
        // TODO: Apply filters: stage ∈ {Screened, Submitted, Interview}
        break;
      case 'interviewsThisWeek':
        setTabValue(4); // Pipeline tab
        // TODO: Apply calendar filter for interviews
        break;
      case 'placementsMTD':
        setTabValue(4); // Pipeline tab
        // TODO: Apply filters: dateRange=MTD
        break;
      case 'timeToFill':
        setTabValue(4); // Pipeline tab
        // TODO: Show time-to-fill reports
        break;
      case 'submittalsPerJob':
        setTabValue(3); // Applications tab
        // TODO: Open saved report for last 30 days
        break;
      case 'complianceAlerts':
        setTabValue(2); // Candidates tab
        // TODO: Apply filters: complianceStatus=red|yellow
        break;
      default:
        break;
    }
  };

  const getTrendIcon = (trend: { value: number; isPositive: boolean }) => {
    if (trend.value === 0) return <TrendingFlatIcon />;
    return trend.isPositive ? <TrendingUpIcon /> : <TrendingDownIcon />;
  };

  const getTrendTooltip = (cardType: string, trend: { value: number; isPositive: boolean }) => {
    const periodMap = {
      'week': 'this week vs last week',
      'mtd': 'this month vs last month',
      '30d': 'last 30 days vs prior 30 days',
      '90d': 'last 90 days vs prior 90 days'
    };
    
    const period = periodMap[dateRange];
    const direction = trend.isPositive ? 'up' : 'down';
    return `${Math.abs(trend.value)}% ${direction} vs ${period}`;
  };

  const KPICard = ({ 
    title, 
    value, 
    subtitle, 
    icon, 
    color, 
    trend,
    cardType,
    emptyState = false
  }: { 
    title: string; 
    value: string | number; 
    subtitle?: string;
    icon: React.ReactNode; 
    color: string;
    trend?: { value: number; isPositive: boolean };
    cardType: string;
    emptyState?: boolean;
  }) => (
    <Card 
      sx={{ 
        height: '100%', 
        position: 'relative', 
        overflow: 'visible',
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: 3,
        },
        '&:focus': {
          outline: '2px solid',
          outlineColor: color,
          outlineOffset: '2px',
        }
      }}
      onClick={() => handleKPICardClick(cardType)}
      tabIndex={0}
      role="button"
      aria-label={`Click to view ${title.toLowerCase()}`}
      onKeyPress={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleKPICardClick(cardType);
        }
      }}
    >
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
          <Box sx={{ color }}>
            {icon}
          </Box>
          {trend && (
            <Tooltip title={getTrendTooltip(cardType, trend)}>
              <Chip
                icon={getTrendIcon(trend)}
                label={`${trend.isPositive ? '+' : ''}${trend.value}%`}
                size="small"
                color={trend.isPositive ? 'success' : 'error'}
                sx={{ fontSize: '0.75rem' }}
              />
            </Tooltip>
          )}
        </Box>
        
        {loading ? (
          <Skeleton variant="text" width="60%" height={40} />
        ) : (
          <Typography variant="h4" component="div" sx={{ color, fontWeight: 'bold', mb: 0.5 }}>
            {value}
          </Typography>
        )}
        
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
          {title}
        </Typography>
        
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}

        {emptyState && (
          <Button 
            variant="outlined" 
            size="small" 
            startIcon={<AddIcon />}
            sx={{ mt: 2, fontSize: '0.75rem' }}
            onClick={(e) => {
              e.stopPropagation();
              handleKPICardClick(cardType);
            }}
          >
            Create first {title}
          </Button>
        )}

        <Box sx={{ position: 'absolute', top: 8, right: 8, opacity: 0.3 }}>
          <ArrowForwardIcon fontSize="small" />
        </Box>
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

  const SparklineChart = ({ data, color }: { data: number[]; color: string }) => {
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min;
    
    return (
      <Box sx={{ display: 'flex', alignItems: 'flex-end', height: 20, gap: 1 }}>
        {data.map((value, index) => (
          <Box
            key={index}
            sx={{
              width: 3,
              height: range > 0 ? ((value - min) / range) * 16 + 4 : 10,
              backgroundColor: color,
              borderRadius: '1px',
            }}
          />
        ))}
      </Box>
    );
  };

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
      {/* Top Navigation Menu - Matching CRM Style */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ 
          display: 'flex', 
          gap: { xs: 2, sm: 3.5, md: 4 },
          flexWrap: 'nowrap',
          overflowX: 'auto',
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: '#F1F3F5',
          py: 1.5,
          scrollBehavior: 'smooth'
        }}>
          <Box 
            sx={{ 
              cursor: 'pointer', 
              position: 'relative',
              px: 1,
              py: 1,
              transition: 'color 200ms ease-in',
              '&:hover': {
                color: '#111827',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  bottom: -3,
                  left: '20%',
                  right: '20%',
                  height: '1px',
                  bgcolor: '#D1D5DB',
                  transition: 'width 200ms ease-in'
                }
              }
            }}
            onClick={() => handleTabChange({} as any, 0)}
          >
            <Typography 
              variant="body1" 
              sx={{ 
                fontSize: { xs: '14px', sm: '15px' },
                fontWeight: tabValue === 0 ? 600 : 500,
                lineHeight: '20px',
                color: tabValue === 0 ? '#0B63C5' : '#4B5563',
                textTransform: 'none',
                position: 'relative',
                pb: tabValue === 0 ? 1 : 0
              }}
            >
              Dashboard
            </Typography>
            {tabValue === 0 && (
              <Box 
                sx={{ 
                  position: 'absolute',
                  bottom: -3,
                  left: '17.5%',
                  right: '17.5%',
                  height: '2px',
                  bgcolor: '#0B63C5',
                  transition: 'width 200ms ease-in'
                }} 
              />
            )}
          </Box>
          
          <Box 
            sx={{ 
              cursor: 'pointer', 
              position: 'relative',
              px: 1,
              py: 1,
              transition: 'color 200ms ease-in',
              '&:hover': {
                color: '#111827',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  bottom: -3,
                  left: '20%',
                  right: '20%',
                  height: '1px',
                  bgcolor: '#D1D5DB',
                  transition: 'width 200ms ease-in'
                }
              }
            }}
            onClick={() => handleTabChange({} as any, 1)}
          >
            <Typography 
              variant="body1" 
              sx={{ 
                fontSize: { xs: '14px', sm: '15px' },
                fontWeight: tabValue === 1 ? 600 : 500,
                lineHeight: '20px',
                color: tabValue === 1 ? '#0B63C5' : '#4B5563',
                textTransform: 'none',
                position: 'relative',
                pb: tabValue === 1 ? 1 : 0
              }}
            >
              Job Orders
            </Typography>
            {tabValue === 1 && (
              <Box 
                sx={{ 
                  position: 'absolute',
                  bottom: -3,
                  left: '17.5%',
                  right: '17.5%',
                  height: '2px',
                  bgcolor: '#0B63C5',
                  transition: 'width 200ms ease-in'
                }} 
              />
            )}
          </Box>
          
          <Box 
            sx={{ 
              cursor: 'pointer', 
              position: 'relative',
              px: 1,
              py: 1,
              transition: 'color 200ms ease-in',
              '&:hover': {
                color: '#111827',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  bottom: -3,
                  left: '20%',
                  right: '20%',
                  height: '1px',
                  bgcolor: '#D1D5DB',
                  transition: 'width 200ms ease-in'
                }
              }
            }}
            onClick={() => handleTabChange({} as any, 2)}
          >
            <Typography 
              variant="body1" 
              sx={{ 
                fontSize: { xs: '14px', sm: '15px' },
                fontWeight: tabValue === 2 ? 600 : 500,
                lineHeight: '20px',
                color: tabValue === 2 ? '#0B63C5' : '#4B5563',
                textTransform: 'none',
                position: 'relative',
                pb: tabValue === 2 ? 1 : 0
              }}
            >
              Candidates
            </Typography>
            {tabValue === 2 && (
              <Box 
                sx={{ 
                  position: 'absolute',
                  bottom: -3,
                  left: '17.5%',
                  right: '17.5%',
                  height: '2px',
                  bgcolor: '#0B63C5',
                  transition: 'width 200ms ease-in'
                }} 
              />
            )}
          </Box>
          
          <Box 
            sx={{ 
              cursor: 'pointer', 
              position: 'relative',
              px: 1,
              py: 1,
              transition: 'color 200ms ease-in',
              '&:hover': {
                color: '#111827',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  bottom: -3,
                  left: '20%',
                  right: '20%',
                  height: '1px',
                  bgcolor: '#D1D5DB',
                  transition: 'width 200ms ease-in'
                }
              }
            }}
            onClick={() => handleTabChange({} as any, 3)}
          >
            <Typography 
              variant="body1" 
              sx={{ 
                fontSize: { xs: '14px', sm: '15px' },
                fontWeight: tabValue === 3 ? 600 : 500,
                lineHeight: '20px',
                color: tabValue === 3 ? '#0B63C5' : '#4B5563',
                textTransform: 'none',
                position: 'relative',
                pb: tabValue === 3 ? 1 : 0
              }}
            >
              Applications
            </Typography>
            {tabValue === 3 && (
              <Box 
                sx={{ 
                  position: 'absolute',
                  bottom: -3,
                  left: '17.5%',
                  right: '17.5%',
                  height: '2px',
                  bgcolor: '#0B63C5',
                  transition: 'width 200ms ease-in'
                }} 
              />
            )}
          </Box>
          
          <Box 
            sx={{ 
              cursor: 'pointer', 
              position: 'relative',
              px: 1,
              py: 1,
              transition: 'color 200ms ease-in',
              '&:hover': {
                color: '#111827',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  bottom: -3,
                  left: '20%',
                  right: '20%',
                  height: '1px',
                  bgcolor: '#D1D5DB',
                  transition: 'width 200ms ease-in'
                }
              }
            }}
            onClick={() => handleTabChange({} as any, 4)}
          >
            <Typography 
              variant="body1" 
              sx={{ 
                fontSize: { xs: '14px', sm: '15px' },
                fontWeight: tabValue === 4 ? 600 : 500,
                lineHeight: '20px',
                color: tabValue === 4 ? '#0B63C5' : '#4B5563',
                textTransform: 'none',
                position: 'relative',
                pb: tabValue === 4 ? 1 : 0
              }}
            >
              Pipeline
            </Typography>
            {tabValue === 4 && (
              <Box 
                sx={{ 
                  position: 'absolute',
                  bottom: -3,
                  left: '17.5%',
                  right: '17.5%',
                  height: '2px',
                  bgcolor: '#0B63C5',
                  transition: 'width 200ms ease-in'
                }} 
              />
            )}
          </Box>
          
          <Box 
            sx={{ 
              cursor: 'pointer', 
              position: 'relative',
              px: 1,
              py: 1,
              transition: 'color 200ms ease-in',
              '&:hover': {
                color: '#111827',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  bottom: -3,
                  left: '20%',
                  right: '20%',
                  height: '1px',
                  bgcolor: '#D1D5DB',
                  transition: 'width 200ms ease-in'
                }
              }
            }}
            onClick={() => handleTabChange({} as any, 5)}
          >
            <Typography 
              variant="body1" 
              sx={{ 
                fontSize: { xs: '14px', sm: '15px' },
                fontWeight: tabValue === 5 ? 600 : 500,
                lineHeight: '20px',
                color: tabValue === 5 ? '#0B63C5' : '#4B5563',
                textTransform: 'none',
                position: 'relative',
                pb: tabValue === 5 ? 1 : 0
              }}
            >
              Jobs Board
            </Typography>
            {tabValue === 5 && (
              <Box 
                sx={{ 
                  position: 'absolute',
                  bottom: -3,
                  left: '17.5%',
                  right: '17.5%',
                  height: '2px',
                  bgcolor: '#0B63C5',
                  transition: 'width 200ms ease-in'
                }} 
              />
            )}
          </Box>
        </Box>
      </Box>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        {/* Dashboard Tab - All the current content */}
        <Box>
          {/* Personalized Welcome Header */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
              Welcome back, {loadingUser ? '...' : (userData?.firstName || 'Recruiter')}!
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Here's your recruitment dashboard overview
            </Typography>
          </Box>

          {/* Date Range Switcher */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 3 }}>
            <ToggleButtonGroup
              value={dateRange}
              exclusive
              onChange={handleDateRangeChange}
              size="small"
              aria-label="date range"
            >
              <ToggleButton value="week" aria-label="this week">
                This Week
              </ToggleButton>
              <ToggleButton value="mtd" aria-label="month to date">
                MTD
              </ToggleButton>
              <ToggleButton value="30d" aria-label="last 30 days">
                Last 30d
              </ToggleButton>
              <ToggleButton value="90d" aria-label="last 90 days">
                Last 90d
              </ToggleButton>
            </ToggleButtonGroup>
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
                cardType="openJobOrders"
                emptyState={kpis.openJobOrders === 0}
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
                cardType="candidatesInProcess"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KPICard
                title="Interviews This Week"
                value={kpis.interviewsThisWeek}
                subtitle="Scheduled"
                icon={<EventIcon sx={{ fontSize: 32 }} />}
                color="#ff9800"
                cardType="interviewsThisWeek"
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
                cardType="placementsMTD"
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
                cardType="timeToFill"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KPICard
                title="Submittals per Job"
                value={kpis.submittalsPerJob}
                subtitle="Quality candidates"
                icon={<TrendingUpIcon sx={{ fontSize: 32 }} />}
                color="#795548"
                cardType="submittalsPerJob"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KPICard
                title="Placement Goal"
                value={`${kpis.placementGoal}%`}
                subtitle="Monthly target"
                icon={<AssessmentIcon sx={{ fontSize: 32 }} />}
                color="#e91e63"
                cardType="placementGoal"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KPICard
                title="Compliance Alerts"
                value={kpis.complianceAlerts}
                subtitle="Requires attention"
                icon={<WarningIcon sx={{ fontSize: 32 }} />}
                color="#f44336"
                cardType="complianceAlerts"
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
                        onClick={() => setTabValue(2)}
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
                        preloadedContacts={preloadedContacts}
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
                        title="Create Job Order"
                        icon={<AddIcon />}
                        onClick={() => setTabValue(1)}
                        color="primary"
                        variant="contained"
                      />
                      <QuickActionButton
                        title="Add Candidate"
                        icon={<AddIcon />}
                        onClick={() => setTabValue(2)}
                        color="secondary"
                      />
                      <QuickActionButton
                        title="Create Job Post"
                        icon={<AddIcon />}
                        onClick={() => setTabValue(5)}
                        color="success"
                      />
                      <QuickActionButton
                        title="Open Candidate Pipeline"
                        icon={<TimelineIcon />}
                        onClick={() => setTabValue(4)}
                        color="info"
                      />
                    </Box>
                  </CardContent>
                </Card>

                {/* Enhanced Jobs Board Widget */}
                <Card>
                  <CardHeader 
                    title="Jobs Board" 
                    titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                  />
                  <CardContent>
                    <Box sx={{ textAlign: 'center', py: 2 }}>
                      <Typography variant="h4" color="primary" fontWeight="bold">
                        {jobsBoardMetrics.activePosts}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Active Posts
                      </Typography>
                      
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 2 }}>
                        <Typography variant="h6" color="success.main" fontWeight="bold">
                          {jobsBoardMetrics.newApplicantsToday}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          New Applicants Today
                        </Typography>
                      </Box>
                      
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" color="text.secondary" display="block">
                          Applicants (7-day trend)
                        </Typography>
                        <SparklineChart data={jobsBoardMetrics.applicantsTrend} color="#4caf50" />
                      </Box>
                      
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Button 
                          variant="outlined" 
                          size="small" 
                          onClick={() => setTabValue(5)}
                        >
                          Manage Posts
                        </Button>
                        <Button 
                          variant="contained" 
                          size="small" 
                          startIcon={<AddIcon />}
                          onClick={() => setTabValue(5)}
                        >
                          + New Evergreen Post
                        </Button>
                      </Box>
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
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <JobOrdersManagement />
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
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

      <TabPanel value={tabValue} index={3}>
        <Applications />
      </TabPanel>

      <TabPanel value={tabValue} index={4}>
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

      <TabPanel value={tabValue} index={5}>
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
