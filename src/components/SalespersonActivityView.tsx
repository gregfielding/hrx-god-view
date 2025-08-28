import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemIcon,
  Chip,
  Grid,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Tabs,
  Tab,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow
} from '@mui/material';
import {
  Email as EmailIcon,
  Task as TaskIcon,
  Phone as PhoneIcon,
  Event as EventIcon,
  SmartToy as AIIcon,
  CalendarToday as CalendarIcon,
  FilterList as FilterIcon,
  TrendingUp as TrendingIcon,
  BarChart as BarChartIcon,
  Close as CloseIcon,
  Flag as FlagIcon
} from '@mui/icons-material';
import { format, subDays, eachDayOfInterval, isSameDay } from 'date-fns';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';

import {
  loadSalespersonActivities,
  getSalespersonActivitySummary,
  UnifiedActivityItem
} from '../utils/activityService';

interface SalespersonActivityViewProps {
  tenantId: string;
  salespersonId: string;
  salespersonName?: string;
  salespersonEmail?: string;
  salesTeam?: any[];
  onSalespersonChange?: (salespersonId: string) => void;
}

interface ActivitySummary {
  totalActivities: number;
  todosCompleted: number;
  emailsSent: number;
  appointmentsHeld: number;
  notesCreated: number;
  lastActivityDate?: Date;
}

const SalespersonActivityView: React.FC<SalespersonActivityViewProps> = ({
  tenantId,
  salespersonId,
  salespersonName = 'Salesperson',
  salespersonEmail,
  salesTeam = [],
  onSalespersonChange
}) => {
  const [activities, setActivities] = useState<UnifiedActivityItem[]>([]);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [individualSummaries, setIndividualSummaries] = useState<{[key: string]: ActivitySummary}>({});
  const [loading, setLoading] = useState(true);


  const [dateRange, setDateRange] = useState<{
    startDate: Date | null;
    endDate: Date | null;
  }>({
    startDate: subDays(new Date(), 30), // Last 30 days
    endDate: new Date()
  });
  const [selectedDateRange, setSelectedDateRange] = useState<string>('30'); // Default to 30 days
  const [activityFilter, setActivityFilter] = useState<string>('all');

  const [selectedSalesperson, setSelectedSalesperson] = useState<string>(salespersonId);
  const [selectedActivity, setSelectedActivity] = useState<UnifiedActivityItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Helper functions for salesperson dropdown (same as in DealsTab)
  const getSalespersonKey = (sp: any): string => {
    return sp?.id || sp?.uid || sp?.userId || sp?.userID || sp?.docId || sp?.email || '';
  };

  const getSalespersonDisplay = (sp: any): string => {
    const fullName = [sp?.firstName, sp?.lastName].filter(Boolean).join(' ').trim();
    return (
      sp?.name ||
      sp?.displayName ||
      (fullName || '') ||
      sp?.email ||
      sp?.username ||
      getSalespersonKey(sp)
    );
  };

  // Filter salesTeam to only include specific emails
  const filteredSalesTeam = useMemo(() => {
    const allowedEmails = [
      'dm@c1staffing.com',
      'g.fielding@c1staffing.com', 
      'i.castaneda@c1staffing.com',
      'j.robinson@c1staffing.com'
    ];
    
    return salesTeam.filter(salesperson => {
      const email = salesperson?.email?.toLowerCase();
      return email && allowedEmails.includes(email);
    });
  }, [salesTeam]);

  // Helper function to get salesperson color
  const getSalespersonColor = (email: string): string => {
    switch (email.toLowerCase()) {
      case 'dm@c1staffing.com':
        return '#1976d2'; // Blue
      case 'g.fielding@c1staffing.com':
        return '#2e7d32'; // Green
      case 'i.castaneda@c1staffing.com':
        return '#ed6c02'; // Orange
      case 'j.robinson@c1staffing.com':
        return '#9c27b0'; // Purple
      default:
        return '#666666'; // Gray
    }
  };

  const getCurrentSalespersonInfo = () => {
    if (selectedSalesperson === 'compare_all') {
      return {
        name: 'Compare All',
        email: ''
      };
    }
    if (selectedSalesperson === salespersonId) {
      return {
        name: salespersonName,
        email: salespersonEmail
      };
    }
    const salesperson = filteredSalesTeam.find(sp => getSalespersonKey(sp) === selectedSalesperson);
    return {
      name: salesperson ? getSalespersonDisplay(salesperson) : 'Unknown Salesperson',
      email: salesperson?.email || ''
    };
  };

  const activityTypes = [
    { value: 'all', label: 'All Activities', icon: <TrendingIcon /> },
    { value: 'todos', label: 'Todos', icon: <TaskIcon /> },
    { value: 'emails', label: 'Emails', icon: <EmailIcon /> },
    { value: 'appointments', label: 'Appointments', icon: <EventIcon /> }
  ];

  const loadActivities = async () => {
    setLoading(true);
    try {
      if (selectedSalesperson === 'compare_all') {
        // Load activities and summaries for all filtered salespeople
        const allActivitiesPromises = filteredSalesTeam.map(salesperson => 
          loadSalespersonActivities(tenantId, getSalespersonKey(salesperson), {
            limit: 5000,
            includeTasks: true,
            includeEmails: true,
            includeNotes: false,
            includeAIActivities: false,
            includeCalls: true,
            includeMeetings: true,
            onlyCompletedTasks: true,
            startDate: dateRange.startDate || undefined,
            endDate: dateRange.endDate || undefined
          })
        );
        
        const allSummaryPromises = filteredSalesTeam.map(salesperson =>
          getSalespersonActivitySummary(
            tenantId,
            getSalespersonKey(salesperson),
            dateRange.startDate || undefined,
            dateRange.endDate || undefined
          )
        );
        
        const [allActivitiesArrays, allSummaryData] = await Promise.all([
          Promise.all(allActivitiesPromises),
          Promise.all(allSummaryPromises)
        ]);
        
        const combinedActivities = allActivitiesArrays.flat();
        
        // Sort by timestamp (most recent first)
        combinedActivities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        
        // Create individual summaries map
        const individualSummariesMap: {[key: string]: ActivitySummary} = {};
        filteredSalesTeam.forEach((salesperson, index) => {
          const key = getSalespersonKey(salesperson);
          individualSummariesMap[key] = allSummaryData[index];
        });
        
        // Create a combined summary
        const combinedSummary: ActivitySummary = {
          totalActivities: combinedActivities.length,
          todosCompleted: combinedActivities.filter(a => a.type === 'task').length,
          emailsSent: combinedActivities.filter(a => a.type === 'email').length,
          appointmentsHeld: combinedActivities.filter(a => a.type === 'task' && a.metadata?.taskType === 'appointment').length,
          notesCreated: 0, // Notes are no longer included
          lastActivityDate: combinedActivities.length > 0 ? combinedActivities[0].timestamp : undefined
        };
        
        setActivities(combinedActivities);
        setSummary(combinedSummary);
        setIndividualSummaries(individualSummariesMap);
      } else {
        // Load activities for single salesperson
        const [activitiesData, summaryData] = await Promise.all([
          loadSalespersonActivities(tenantId, selectedSalesperson, {
            limit: 5000, // Get all activities within date range
            includeTasks: true,
            includeEmails: true,
            includeNotes: false,
            includeAIActivities: false,
            includeCalls: true,
            includeMeetings: true,
            onlyCompletedTasks: true,
            startDate: dateRange.startDate || undefined,
            endDate: dateRange.endDate || undefined
          }),
          getSalespersonActivitySummary(
            tenantId,
            selectedSalesperson,
            dateRange.startDate || undefined,
            dateRange.endDate || undefined
          )
        ]);

        setActivities(activitiesData);
        setSummary(summaryData);
        setIndividualSummaries({}); // Clear individual summaries for single salesperson view
      }
    } catch (error) {
      console.error('Failed to load salesperson activities:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to update date range based on selected option
  const updateDateRange = (rangeOption: string) => {
    const today = new Date();
    let startDate: Date;
    
    switch (rangeOption) {
      case 'today':
        startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        break;
      case '3':
        startDate = subDays(today, 3);
        break;
      case '7':
        startDate = subDays(today, 7);
        break;
      case '30':
        startDate = subDays(today, 30);
        break;
      case '90':
        startDate = subDays(today, 90);
        break;
      default:
        startDate = subDays(today, 30);
    }
    
    setDateRange({
      startDate,
      endDate: today
    });
  };

  // Effect to update date range when selectedDateRange changes
  useEffect(() => {
    updateDateRange(selectedDateRange);
  }, [selectedDateRange]);

  // Debounced effect for date range changes to prevent excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      loadActivities();
    }, 300); // 300ms delay

    return () => clearTimeout(timer);
  }, [tenantId, selectedSalesperson, dateRange]);

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'email':
        return <EmailIcon color="primary" />;
      case 'task':
        return <TaskIcon color="success" />;
      case 'call':
        return <PhoneIcon color="secondary" />;
      case 'meeting':
        return <EventIcon color="warning" />;
      case 'ai_activity':
        return <AIIcon color="error" />;
      default:
        return <TrendingIcon />;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'email':
        return 'primary';
      case 'task':
        return 'success';
      case 'call':
        return 'secondary';
      case 'meeting':
        return 'warning';
      case 'ai_activity':
        return 'error';
      default:
        return 'default';
    }
  };

  // Helper function to get activity category
  const getActivityCategory = (activity: UnifiedActivityItem): string => {
    if (activity.source === 'email_logs') return 'emails';
    if (activity.source === 'tasks') {
      // Check if it's an appointment based on classification
      const taskData = activity as any;
      return taskData.metadata?.classification === 'appointment' ? 'appointments' : 'todos';
    }
    return 'todos'; // Default fallback
  };

  // Helper function to get display title
  const getActivityDisplayTitle = (activity: UnifiedActivityItem): string => {
    const category = getActivityCategory(activity);
    
    if (category === 'todos') {
      const taskType = activity.metadata?.taskType || 'other';
      return `${activity.title} (${formatTaskType(taskType)})`;
    }
    
    if (category === 'emails') {
      const subject = activity.metadata?.subject || 'No subject';
      const direction = activity.metadata?.direction || 'sent';
      return `${direction === 'outbound' ? 'Sent to' : 'Received from'} CRM Contact: ${subject}`;
    }
    
    if (category === 'appointments') {
      return activity.title;
    }
    
    return activity.title;
  };

  // Helper function to get display label
  const getActivityDisplayLabel = (activity: UnifiedActivityItem): string => {
    const category = getActivityCategory(activity);
    
    if (category === 'todos') {
      const taskType = activity.metadata?.taskType || 'other';
      return formatTaskType(taskType);
    }
    
    return category;
  };

  // Helper function to format task types
  const formatTaskType = (type: string): string => {
    const typeMap: Record<string, string> = {
      'phone_call': 'Phone Call',
      'linkedin_message': 'LinkedIn',
      'research': 'Research',
      'proposal_work': 'Proposal',
      'follow_up': 'Follow-up',
      'email': 'Email Task',
      'meeting': 'Meeting Task',
      'other': 'Other'
    };
    return typeMap[type] || 'Other';
  };

  const filteredActivities = activities.filter(activity => {
    if (activityFilter === 'all') return true;
    const category = getActivityCategory(activity);
    return category === activityFilter;
  });

  // Process activities for chart data
  const chartData = useMemo(() => {
    if (!dateRange.startDate || !dateRange.endDate || activities.length === 0) {
      return [];
    }

    // Create array of all days in the date range
    const daysInRange = eachDayOfInterval({
      start: dateRange.startDate,
      end: dateRange.endDate
    });

    // Group activities by day
    const activitiesByDay = daysInRange.map(day => {
      const dayActivities = activities.filter(activity => 
        activity.timestamp && isSameDay(activity.timestamp, day)
      );

      return {
        date: format(day, 'MMM dd'),
        fullDate: day,
        total: dayActivities.length,
        todos: dayActivities.filter(a => getActivityCategory(a) === 'todos').length,
        emails: dayActivities.filter(a => getActivityCategory(a) === 'emails').length,
        appointments: dayActivities.filter(a => getActivityCategory(a) === 'appointments').length,
      };
    });

    return activitiesByDay;
  }, [activities, dateRange.startDate, dateRange.endDate]);

  // Calculate individual salesperson chart data for Compare All view
  const individualChartData = useMemo(() => {
    if (selectedSalesperson !== 'compare_all' || !activities.length || !dateRange.startDate || !dateRange.endDate) {
      return [];
    }

    const days = eachDayOfInterval({
      start: dateRange.startDate,
      end: dateRange.endDate
    });

    const activitiesByDay = days.map(day => {
      const dayActivities = activities.filter(activity => 
        activity.timestamp && isSameDay(activity.timestamp, day)
      );

      // Create data point with individual salesperson counts
      const dataPoint: any = {
        date: format(day, 'MMM dd'),
        fullDate: day
      };

      // Add count for each salesperson
      filteredSalesTeam.forEach(salesperson => {
        const salespersonKey = getSalespersonKey(salesperson);
        const salespersonActivities = dayActivities.filter(activity => 
          activity.salespersonId === salespersonKey
        );
        const displayName = getSalespersonDisplay(salesperson);
        dataPoint[displayName] = salespersonActivities.length;
      });

      return dataPoint;
    });

    return activitiesByDay;
  }, [activities, dateRange.startDate, dateRange.endDate, selectedSalesperson, filteredSalesTeam]);

  // Calculate goals hit percentage (weekdays with 5+ activities)
  const goalsHit = useMemo(() => {
    if (!chartData.length) return { count: 0, percentage: 0 };
    
    const weekdays = chartData.filter(day => {
      // Check if it's a weekday (Monday = 1, Friday = 5)
      const dayOfWeek = day.fullDate.getDay();
      return dayOfWeek >= 1 && dayOfWeek <= 5;
    });
    
    const daysWithGoal = weekdays.filter(day => {
      // Check if it has 30 or more activities
      return day.total >= 30;
    });
    
    const percentage = weekdays.length > 0 ? Math.round((daysWithGoal.length / weekdays.length) * 100) : 0;
    
    return {
      count: daysWithGoal.length,
      percentage: percentage
    };
  }, [chartData]);





  const handleSalespersonChange = (newSalespersonId: string) => {
    setSelectedSalesperson(newSalespersonId);
    if (onSalespersonChange) {
      onSalespersonChange(newSalespersonId);
    }
  };

  const handleActivityClick = (activity: UnifiedActivityItem) => {
    setSelectedActivity(activity);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedActivity(null);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <Typography>Loading activities...</Typography>
      </Box>
    );
  }

  return (
    <Box>


        {/* Salesperson Dropdown and Filters */}
        <Paper sx={{ p: 2, mb: 3 }}>
          <form onSubmit={(e) => e.preventDefault()}>
            <Grid container spacing={2} alignItems="center">
            {/* Salesperson Dropdown */}
            {filteredSalesTeam.length > 0 && (
              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Select Salesperson</InputLabel>
                  <Select
                    value={selectedSalesperson}
                    onChange={(e) => handleSalespersonChange(e.target.value)}
                    label="Select Salesperson"
                    sx={{
                      borderRadius: '6px',
                      backgroundColor: 'white',
                      '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: '#E5E7EB',
                      },
                      '&:hover .MuiOutlinedInput-notchedOutline': {
                        borderColor: '#D1D5DB',
                      },
                    }}
                  >
                    {/* Compare All option */}
                    <MenuItem value="compare_all">
                      Compare All
                    </MenuItem>
                    
                    {/* Individual salespeople */}
                    {filteredSalesTeam.map((salesperson) => {
                      const key = getSalespersonKey(salesperson);
                      const label = getSalespersonDisplay(salesperson);
                      return (
                        <MenuItem key={key} value={key}>
                          {label}
                        </MenuItem>
                      );
                    })}
                  </Select>
                </FormControl>
              </Grid>
            )}
            

            
            {/* Date Range Filter */}
            <Grid item xs={12} sm={6} md={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Date Range</InputLabel>
                <Select
                  value={selectedDateRange}
                  onChange={(e) => setSelectedDateRange(e.target.value)}
                  label="Date Range"
                  startAdornment={<CalendarIcon sx={{ mr: 1, color: 'text.secondary' }} />}
                >
                  <MenuItem value="today">Today</MenuItem>
                  <MenuItem value="3">Last 3 Days</MenuItem>
                  <MenuItem value="7">Last 7 Days</MenuItem>
                  <MenuItem value="30">Last 30 Days</MenuItem>
                  <MenuItem value="90">Last 90 Days</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            </Grid>
          </form>
        </Paper>

        {/* Activity Summary Cards */}
        {summary && (
          <Grid container spacing={2} mb={3}>
            {selectedSalesperson === 'compare_all' ? (
              // Individual salesperson widgets for Compare All
              <>
                {filteredSalesTeam.map((salesperson) => {
                  const key = getSalespersonKey(salesperson);
                  const individualSummary = individualSummaries[key];
                  const color = getSalespersonColor(salesperson.email);
                  const displayName = getSalespersonDisplay(salesperson);
                  
                  return (
                    <Grid item xs={12} sm={6} md={2.4} key={key}>
                      <Card>
                        <CardContent sx={{ textAlign: 'center' }}>
                          <Typography 
                            variant="h6" 
                            fontWeight="bold"
                            sx={{ color: color, mb: 1 }}
                          >
                            {displayName}
                          </Typography>
                          <Typography variant="h4" fontWeight="bold" sx={{ color: color }}>
                            {individualSummary?.totalActivities || 0}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            Total Activities
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  );
                })}
                {/* Goals Hit widget for Compare All */}
                <Grid item xs={12} sm={6} md={2.4}>
                  <Card>
                    <CardContent sx={{ textAlign: 'center' }}>
                      <Typography 
                        variant="h6" 
                        fontWeight="bold"
                        sx={{
                          color: goalsHit.percentage >= 80 ? '#2e7d32' : // Green
                                 goalsHit.percentage >= 70 ? '#ed6c02' : // Light orange
                                 goalsHit.percentage >= 60 ? '#d84315' : // Dark orange
                                 '#d32f2f', // Red
                          mb: 1
                        }}
                      >
                        Team
                      </Typography>
                      <Typography 
                        variant="h4" 
                        fontWeight="bold"
                        sx={{
                          color: goalsHit.percentage >= 80 ? '#2e7d32' : // Green
                                 goalsHit.percentage >= 70 ? '#ed6c02' : // Light orange
                                 goalsHit.percentage >= 60 ? '#d84315' : // Dark orange
                                 '#d32f2f' // Red
                        }}
                      >
                        {goalsHit.percentage}%
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        30/Day Goal Hit
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </>
            ) : (
              // Regular summary cards for individual salesperson
              <>
                <Grid item xs={12} sm={6} md={2}>
                  <Card>
                    <CardContent sx={{ textAlign: 'center' }}>
                      <Typography variant="h4" color="primary" fontWeight="bold">
                        {summary.totalActivities}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Total Activities
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={2}>
                  <Card>
                    <CardContent sx={{ textAlign: 'center' }}>
                      <Typography variant="h4" color="success.main" fontWeight="bold">
                        {summary.todosCompleted}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Todos Completed
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={2}>
                  <Card>
                    <CardContent sx={{ textAlign: 'center' }}>
                      <Typography variant="h4" color="primary" fontWeight="bold">
                        {summary.emailsSent}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Emails Sent
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={2}>
                  <Card>
                    <CardContent sx={{ textAlign: 'center' }}>
                      <Typography variant="h4" color="warning.main" fontWeight="bold">
                        {summary.appointmentsHeld}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Appointments Held
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>

                <Grid item xs={12} sm={6} md={2}>
                  <Card>
                    <CardContent sx={{ textAlign: 'center' }}>
                      <Typography 
                        variant="h4" 
                        fontWeight="bold"
                        sx={{
                          color: goalsHit.percentage >= 80 ? '#2e7d32' : // Green
                                 goalsHit.percentage >= 70 ? '#ed6c02' : // Light orange
                                 goalsHit.percentage >= 60 ? '#d84315' : // Dark orange
                                 '#d32f2f' // Red
                        }}
                      >
                        {goalsHit.percentage}%
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        30/Day Goal Hit
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </>
            )}
          </Grid>
        )}

        {/* Activity Chart */}
        {(chartData.length > 0 || individualChartData.length > 0) && (
          <Paper sx={{ p: 3, mb: 3 }}>
            <Box display="flex" alignItems="center" gap={1} mb={2}>
              {selectedSalesperson === 'compare_all' ? (
                <TrendingIcon color="primary" />
              ) : (
                <BarChartIcon color="primary" />
              )}
              <Typography variant="h6" fontWeight={700}>
                Daily Activity Overview
              </Typography>
            </Box>
            <ResponsiveContainer width="100%" height={300}>
              {selectedSalesperson === 'compare_all' ? (
                // Line chart for Compare All view
                <LineChart data={individualChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip 
                    formatter={(value: any, name: string) => [
                      value, 
                      name
                    ]}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  {filteredSalesTeam.map((salesperson) => {
                    const displayName = getSalespersonDisplay(salesperson);
                    const color = getSalespersonColor(salesperson.email);
                    return (
                      <Line
                        key={displayName}
                        type="monotone"
                        dataKey={displayName}
                        stroke={color}
                        strokeWidth={2}
                        dot={{ fill: color, strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6, stroke: color, strokeWidth: 2 }}
                        name={displayName}
                      />
                    );
                  })}
                </LineChart>
              ) : (
                // Bar chart for individual salesperson view
                <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip 
                    formatter={(value: any, name: string) => [
                      value, 
                      name.charAt(0).toUpperCase() + name.slice(1)
                    ]}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Bar dataKey="total" fill="#1976d2" name="Total Activities" />
                  <Bar dataKey="todos" fill="#2e7d32" name="Todos" />
                  <Bar dataKey="emails" fill="#1976d2" name="Emails" />
                  <Bar dataKey="appointments" fill="#ed6c02" name="Appointments" />
                </BarChart>
              )}
            </ResponsiveContainer>
          </Paper>
        )}

        {/* Activity Type Tabs */}
        <Paper sx={{ mb: 2 }}>
          <Tabs
            value={activityFilter}
            onChange={(e, newValue) => setActivityFilter(newValue)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              borderBottom: 1,
              borderColor: 'divider',
              '& .MuiTab-root': {
                borderRadius: 0,
                textTransform: 'none',
                fontWeight: 500,
                minHeight: 48,
              },
              '& .Mui-selected': {
                color: 'primary.main',
                fontWeight: 600,
              },
            }}
          >
            {activityTypes.map((type) => (
              <Tab
                key={type.value}
                value={type.value}
                label={
                  <Box display="flex" alignItems="center" gap={1}>
                    {type.icon}
                    {type.label}
                  </Box>
                }
              />
            ))}
          </Tabs>
        </Paper>

        {/* Activity Table */}
        <Paper>
          <TableContainer sx={{ maxHeight: 600 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 50, fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Activity</TableCell>
                  <TableCell sx={{ width: 180, fontWeight: 600 }}>Date/Time</TableCell>
                  <TableCell sx={{ width: 100, fontWeight: 600 }}>Category</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredActivities.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} sx={{ textAlign: 'center', py: 4 }}>
                      <Typography color="text.secondary">
                        No activities found for the selected criteria.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredActivities.map((activity, index) => (
                    <TableRow
                      key={activity.id}
                      onClick={() => handleActivityClick(activity)}
                      sx={{
                        cursor: 'pointer',
                        '&:hover': {
                          backgroundColor: 'action.hover',
                        },
                        backgroundColor: index % 2 === 0 ? 'background.paper' : 'action.hover',
                        '&:last-child td': { border: 0 },
                      }}
                    >
                      <TableCell sx={{ py: 1 }}>
                        <Box display="flex" alignItems="center" justifyContent="center">
                          {getActivityIcon(activity.type)}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography variant="body2" fontWeight="medium" noWrap>
                          {getActivityDisplayTitle(activity).length > 72 
                            ? getActivityDisplayTitle(activity).substring(0, 72) + '...'
                            : getActivityDisplayTitle(activity)
                          }
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1, width: 180 }}>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {activity.timestamp && !isNaN(activity.timestamp.getTime()) 
                            ? format(activity.timestamp, 'MMM dd, yyyy HH:mm')
                            : 'Unknown date'
                          }
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Chip
                          label={getActivityDisplayLabel(activity)}
                          size="small"
                          color={getActivityColor(activity.type) as any}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>

        {/* Activity Detail Dialog */}
        <Dialog
          open={dialogOpen}
          onClose={handleCloseDialog}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>
            <Box display="flex" alignItems="center" justifyContent="space-between">
              <Box display="flex" alignItems="center" gap={1}>
                {selectedActivity && getActivityIcon(selectedActivity.type)}
                <Typography variant="h6">
                  {selectedActivity?.title || 'Activity Details'}
                </Typography>
              </Box>
              <IconButton onClick={handleCloseDialog} size="small">
                <CloseIcon />
              </IconButton>
            </Box>
          </DialogTitle>
          <DialogContent>
            {selectedActivity && (
              <Box>
                {/* Activity Header */}
                <Box mb={3}>
                  <Typography variant="h6" gutterBottom>
                    {getActivityDisplayTitle(selectedActivity)}
                  </Typography>
                  <Box display="flex" alignItems="center" gap={2} mb={1}>
                    <Chip
                      label={getActivityDisplayLabel(selectedActivity)}
                      size="small"
                      color={getActivityColor(selectedActivity.type) as any}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {selectedActivity.timestamp && !isNaN(selectedActivity.timestamp.getTime()) 
                        ? format(selectedActivity.timestamp, 'MMM dd, yyyy HH:mm')
                        : 'Unknown date'
                      }
                    </Typography>
                  </Box>
                </Box>

                {/* Activity Content */}
                {selectedActivity.source === 'email_logs' && (
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                      Email Details
                    </Typography>
                    <Box mb={2}>
                      <Typography variant="body2" fontWeight="medium">
                        From: {selectedActivity.metadata?.from || 'Unknown'}
                      </Typography>
                      <Typography variant="body2" fontWeight="medium">
                        To: {selectedActivity.metadata?.to || 'Unknown'}
                      </Typography>
                      <Typography variant="body2" fontWeight="medium">
                        Subject: {selectedActivity.metadata?.subject || 'No subject'}
                      </Typography>
                    </Box>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                      Message Content
                    </Typography>
                    <Box 
                      sx={{ 
                        p: 2, 
                        backgroundColor: 'grey.50', 
                        borderRadius: 1,
                        maxHeight: 400,
                        overflow: 'auto'
                      }}
                    >
                      <Typography variant="body2" component="pre" sx={{ 
                        whiteSpace: 'pre-wrap', 
                        fontFamily: 'inherit',
                        margin: 0
                      }}>
                        {selectedActivity.metadata?.bodySnippet || selectedActivity.metadata?.body || selectedActivity.description || 'No content available'}
                      </Typography>
                    </Box>
                  </Box>
                )}

                {selectedActivity.source === 'contact_notes' && (
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                      Note Content
                    </Typography>
                    <Box 
                      sx={{ 
                        p: 2, 
                        backgroundColor: 'grey.50', 
                        borderRadius: 1,
                        maxHeight: 400,
                        overflow: 'auto'
                      }}
                    >
                      <Typography variant="body2" component="pre" sx={{ 
                        whiteSpace: 'pre-wrap', 
                        fontFamily: 'inherit',
                        margin: 0
                      }}>
                        {selectedActivity.description || 'No content available'}
                      </Typography>
                    </Box>
                  </Box>
                )}

                {selectedActivity.source === 'tasks' && (
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                      Task Details
                    </Typography>
                    <Box mb={2}>
                      <Typography variant="body2" fontWeight="medium">
                        Type: {selectedActivity.metadata?.taskType || 'General'}
                      </Typography>
                      {selectedActivity.metadata?.priority && (
                        <Typography variant="body2" fontWeight="medium">
                          Priority: {selectedActivity.metadata.priority}
                        </Typography>
                      )}
                    </Box>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                      Task Description
                    </Typography>
                    <Box 
                      sx={{ 
                        p: 2, 
                        backgroundColor: 'grey.50', 
                        borderRadius: 1,
                        maxHeight: 400,
                        overflow: 'auto'
                      }}
                    >
                      <Typography variant="body2" component="pre" sx={{ 
                        whiteSpace: 'pre-wrap', 
                        fontFamily: 'inherit',
                        margin: 0
                      }}>
                        {selectedActivity.description || 'No description available'}
                      </Typography>
                    </Box>
                  </Box>
                )}

                {/* Metadata */}
                {(selectedActivity.metadata?.contactId || selectedActivity.metadata?.dealId) && (
                  <Box mt={3}>
                    <Divider sx={{ mb: 2 }} />
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                      Related Entities
                    </Typography>
                    {selectedActivity.metadata?.contactId && (
                      <Typography variant="body2">
                        Contact ID: {selectedActivity.metadata.contactId}
                      </Typography>
                    )}
                    {selectedActivity.metadata?.dealId && (
                      <Typography variant="body2">
                        Deal ID: {selectedActivity.metadata.dealId}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDialog}>Close</Button>
          </DialogActions>
        </Dialog>
      </Box>
  );
};

export default SalespersonActivityView;
