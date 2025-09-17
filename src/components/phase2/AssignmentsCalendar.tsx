import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Paper,
  IconButton,
  Tooltip,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Today as TodayIcon,
  Person as PersonIcon,
  Work as WorkIcon
} from '@mui/icons-material';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, addWeeks, subWeeks, isToday } from 'date-fns';
import { Assignment, AssignmentStatus } from '../../types/phase2';
import { getAssignmentService } from '../../services/phase2/assignmentService';

interface AssignmentsCalendarProps {
  tenantId: string;
  jobOrderId?: string; // If provided, only show assignments for this job order
  onAssignmentClick?: (assignment: Assignment) => void;
}

const AssignmentsCalendar: React.FC<AssignmentsCalendarProps> = ({
  tenantId,
  jobOrderId,
  onAssignmentClick
}) => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus | 'all'>('all');

  const assignmentService = getAssignmentService();

  useEffect(() => {
    loadAssignments();
  }, [tenantId, jobOrderId, currentWeek, statusFilter]);

  const loadAssignments = async () => {
    try {
      setLoading(true);
      
      const weekStart = startOfWeek(currentWeek);
      const weekEnd = endOfWeek(currentWeek);
      
      const filters = {
        status: statusFilter !== 'all' ? statusFilter : undefined,
        dateRange: {
          start: format(weekStart, 'yyyy-MM-dd'),
          end: format(weekEnd, 'yyyy-MM-dd')
        }
      };

      const data = jobOrderId 
        ? await assignmentService.getAssignmentsByJobOrder(tenantId, jobOrderId, filters)
        : await assignmentService.getAllAssignments(tenantId, filters);

      setAssignments(data);
    } catch (error) {
      console.error('Error loading assignments:', error);
    } finally {
      setLoading(false);
    }
  };

  const getWeekDays = () => {
    const weekStart = startOfWeek(currentWeek);
    const weekEnd = endOfWeek(currentWeek);
    return eachDayOfInterval({ start: weekStart, end: weekEnd });
  };

  const getAssignmentsForDay = (date: Date) => {
    return assignments.filter(assignment => {
      const startDate = new Date(assignment.startDate);
      const endDate = assignment.endDate ? new Date(assignment.endDate) : new Date('2099-12-31');
      return date >= startDate && date <= endDate;
    });
  };

  const getStatusColor = (status: AssignmentStatus): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch (status) {
      case 'proposed': return 'info';
      case 'confirmed': return 'primary';
      case 'active': return 'success';
      case 'completed': return 'secondary';
      case 'ended': return 'default';
      case 'canceled': return 'error';
      default: return 'default';
    }
  };

  const handlePreviousWeek = () => {
    setCurrentWeek(subWeeks(currentWeek, 1));
  };

  const handleNextWeek = () => {
    setCurrentWeek(addWeeks(currentWeek, 1));
  };

  const handleToday = () => {
    setCurrentWeek(new Date());
  };

  const weekDays = getWeekDays();

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5">
          Assignments Calendar
        </Typography>
        
        <Stack direction="row" spacing={2} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={statusFilter}
              label="Status"
              onChange={(e) => setStatusFilter(e.target.value as AssignmentStatus | 'all')}
            >
              <MenuItem value="all">All Statuses</MenuItem>
              <MenuItem value="proposed">Proposed</MenuItem>
              <MenuItem value="confirmed">Confirmed</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="completed">Completed</MenuItem>
              <MenuItem value="ended">Ended</MenuItem>
              <MenuItem value="canceled">Canceled</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Box>

      {/* Week Navigation */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <IconButton onClick={handlePreviousWeek}>
              <ChevronLeftIcon />
            </IconButton>
            
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="h6">
                {format(weekDays[0], 'MMM dd')} - {format(weekDays[6], 'MMM dd, yyyy')}
              </Typography>
              <IconButton onClick={handleToday} size="small">
                <TodayIcon />
              </IconButton>
            </Box>
            
            <IconButton onClick={handleNextWeek}>
              <ChevronRightIcon />
            </IconButton>
          </Box>
        </CardContent>
      </Card>

      {/* Calendar Grid */}
      <Card>
        <CardContent>
          <Grid container spacing={1}>
            {/* Day Headers */}
            {weekDays.map((day, index) => (
              <Grid item xs key={index}>
                <Paper 
                  sx={{ 
                    p: 1, 
                    textAlign: 'center',
                    bgcolor: isToday(day) ? 'primary.main' : 'grey.100',
                    color: isToday(day) ? 'white' : 'text.primary'
                  }}
                >
                  <Typography variant="body2" fontWeight="medium">
                    {format(day, 'EEE')}
                  </Typography>
                  <Typography variant="h6">
                    {format(day, 'd')}
                  </Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>

          {/* Assignments Grid */}
          <Grid container spacing={1} sx={{ mt: 1 }}>
            {weekDays.map((day, dayIndex) => {
              const dayAssignments = getAssignmentsForDay(day);
              
              return (
                <Grid item xs key={dayIndex}>
                  <Paper 
                    sx={{ 
                      p: 1, 
                      minHeight: 200,
                      bgcolor: isToday(day) ? 'primary.50' : 'white',
                      border: isToday(day) ? '2px solid' : '1px solid',
                      borderColor: isToday(day) ? 'primary.main' : 'grey.300'
                    }}
                  >
                    {loading ? (
                      <Typography variant="body2" color="text.secondary">
                        Loading...
                      </Typography>
                    ) : dayAssignments.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No assignments
                      </Typography>
                    ) : (
                      <Stack spacing={1}>
                        {dayAssignments.slice(0, 3).map((assignment) => (
                          <Tooltip 
                            key={assignment.id}
                            title={
                              <Box>
                                <Typography variant="body2" fontWeight="medium">
                                  Candidate: {assignment.candidateId}
                                </Typography>
                                <Typography variant="body2">
                                  Status: {assignment.status}
                                </Typography>
                                <Typography variant="body2">
                                  Worksite: {assignment.worksite}
                                </Typography>
                                <Typography variant="body2">
                                  Pay: ${assignment.payRate}/hr
                                </Typography>
                              </Box>
                            }
                          >
                            <Chip
                              label={`${assignment.candidateId}`}
                              color={getStatusColor(assignment.status)}
                              size="small"
                              onClick={() => onAssignmentClick?.(assignment)}
                              sx={{ 
                                cursor: 'pointer',
                                width: '100%',
                                justifyContent: 'flex-start'
                              }}
                            />
                          </Tooltip>
                        ))}
                        {dayAssignments.length > 3 && (
                          <Typography variant="caption" color="text.secondary">
                            +{dayAssignments.length - 3} more
                          </Typography>
                        )}
                      </Stack>
                    )}
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Status Legend
          </Typography>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <Chip label="Proposed" color="info" size="small" />
            <Chip label="Confirmed" color="primary" size="small" />
            <Chip label="Active" color="success" size="small" />
            <Chip label="Completed" color="secondary" size="small" />
            <Chip label="Ended" color="default" size="small" />
            <Chip label="Canceled" color="error" size="small" />
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
};

export default AssignmentsCalendar;
