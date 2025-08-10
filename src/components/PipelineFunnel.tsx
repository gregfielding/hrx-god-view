import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Tooltip,
  useTheme,
  useMediaQuery,
  ToggleButton,
  ToggleButtonGroup,
  Chip
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';

import { CRM_STAGE_COLORS } from '../utils/crmStageColors';

interface Stage {
  id: string;
  label: string;
  count: number;
  value: number;
  color: string;
  dropOff?: number;
}

interface PipelineFunnelProps {
  deals: any[];
  onStageClick?: (stage: string) => void;
  selectedStage?: string;
}

const PipelineFunnel: React.FC<PipelineFunnelProps> = ({ 
  deals, 
  onStageClick, 
  selectedStage 
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [viewMode, setViewMode] = React.useState<'count' | 'value'>('count');

  // Helper function to extract deal value, using high end of ranges
  const getDealValue = (deal: any): number => {
    // First check if we have qualification stage data for calculated ranges
    if (deal.stageData?.qualification) {
      const qualData = deal.stageData.qualification;
      const payRate = qualData.expectedAveragePayRate || 16;
      const markup = qualData.expectedAverageMarkup || 40;
      const timeline = qualData.staffPlacementTimeline;

      if (timeline) {
        // Calculate bill rate: pay rate + markup
        const billRate = payRate * (1 + markup / 100);
        
        // Annual hours per employee (2080 full-time hours)
        const annualHoursPerEmployee = 2080;
        
        // Calculate annual revenue per employee
        const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
        
        // Get starting and 180-day numbers
        const startingCount = timeline.starting || 0;
        const after180DaysCount = timeline.after180Days || timeline.after90Days || timeline.after30Days || startingCount;
        
        if (startingCount > 0 || after180DaysCount > 0) {
          // Use the high end of the range (after180DaysCount)
          return annualRevenuePerEmployee * after180DaysCount;
        }
      }
    }

    // Check for estimatedRevenue field
    if (deal.estimatedRevenue) {
      const value = deal.estimatedRevenue;
      
      // If it's a string that looks like a range (e.g., "$87,360 - $218,400")
      if (typeof value === 'string' && value.includes('-')) {
        const match = value.match(/\$([\d,]+)\s*-\s*\$([\d,]+)/);
        if (match) {
          const high = parseInt(match[2].replace(/,/g, ''));
          return high;
        }
      }
      
      // If it's a simple number
      const numericValue = Number(value);
      if (!isNaN(numericValue)) {
        return numericValue;
      }
    }

    // Check for expectedAnnualRevenueRange field
    if (deal.expectedAnnualRevenueRange) {
      const range = deal.expectedAnnualRevenueRange;
      if (typeof range === 'string' && range.includes('-')) {
        const match = range.match(/\$([\d,]+)\s*-\s*\$([\d,]+)/);
        if (match) {
          const high = parseInt(match[2].replace(/,/g, ''));
          return high;
        }
      }
    }

    return 0;
  };

  // Calculate stage data
  const calculateStageData = (): Stage[] => {
    const stageMap = new Map<string, { count: number; value: number }>();
    
    // Group deals by stage
    deals.forEach(deal => {
      const stage = deal.stage || 'qualification';
      const value = getDealValue(deal);
      
      if (!stageMap.has(stage)) {
        stageMap.set(stage, { count: 0, value: 0 });
      }
      
      const current = stageMap.get(stage)!;
      current.count += 1;
      current.value += value;
    });

    // Convert to array and sort by typical pipeline order
    const stageOrder = [
      'discovery',
      'qualification', 
      'scoping',
      'proposalDrafted',
      'proposalReview',
      'negotiation',
      'verbalAgreement',
      'closedWon',
      'closedLost',
      'onboarding',
      'liveAccount',
      'dormant'
    ];

    const stages: Stage[] = [];
    let previousCount = 0;

    stageOrder.forEach(stageKey => {
      const stageData = stageMap.get(stageKey);
      if (stageData && stageData.count > 0) {
        const stageColor = CRM_STAGE_COLORS[stageKey]?.hex || '#7f8c8d'; // Darker default
        const dropOff = previousCount > 0 ? 
          Math.round(((previousCount - stageData.count) / previousCount) * 100) : 0;
        
        stages.push({
          id: stageKey,
          label: stageKey.charAt(0).toUpperCase() + stageKey.slice(1).replace(/([A-Z])/g, ' $1'),
          count: stageData.count,
          value: stageData.value,
          color: stageColor,
          dropOff
        });
        
        previousCount = stageData.count;
      }
    });

    return stages;
  };

  const stages = calculateStageData();
  const maxCount = Math.max(...stages.map(s => s.count), 1);
  const maxValue = Math.max(...stages.map(s => s.value), 1);

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    } else {
      return `$${value.toLocaleString()}`;
    }
  };

  // Calculate proportional width based on view mode
  const getBarWidth = (stage: Stage) => {
    const metric = viewMode === 'count' ? stage.count : stage.value;
    const maxMetric = viewMode === 'count' ? maxCount : maxValue;
    // Ensure minimum 15% width for visibility, maximum 100%
    return Math.max(Math.min((metric / maxMetric) * 100, 100), 15);
  };

  const renderMobileFunnel = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {stages.map((stage, index) => {
        const isSelected = selectedStage === stage.id;
        const widthPercent = getBarWidth(stage);
        
        return (
          <Tooltip
            key={stage.id}
            title={
              <Box>
                <Typography variant="body2" fontWeight="bold">
                  {stage.label}
                </Typography>
                <Typography variant="body2">
                  {stage.count} Deals
                </Typography>
                <Typography variant="body2">
                  {formatCurrency(stage.value)}
                </Typography>
                {stage.dropOff !== undefined && stage.dropOff > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    ↓{stage.dropOff}% from previous stage
                  </Typography>
                )}
              </Box>
            }
            arrow
          >
            <Card
              sx={{
                cursor: onStageClick ? 'pointer' : 'default',
                border: isSelected ? `2px solid ${theme.palette.primary.main}` : 'none',
                backgroundColor: stage.color,
                color: '#FFFFFF',
                transition: 'all 0.2s ease-in-out',
                '&:hover': {
                  transform: 'translateX(4px)',
                  boxShadow: theme.shadows[4],
                  backgroundColor: theme.palette.action.hover
                }
              }}
              onClick={() => onStageClick?.(stage.id)}
            >
              <CardContent sx={{ p: 2, pb: '16px !important' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Box>
                    <Typography variant="h6" fontWeight="bold" sx={{ mb: 0.5 }}>
                      {stage.label}
                    </Typography>
                    <Typography variant="body2" sx={{ opacity: 0.9, fontWeight: 'bold' }}>
                      {stage.count} Deals
                    </Typography>
                    <Typography variant="body2" sx={{ opacity: 0.9, fontWeight: 'bold' }}>
                      {formatCurrency(stage.value)}
                    </Typography>
                  </Box>
                  
                  <Box sx={{ textAlign: 'right' }}>
                    {stage.dropOff !== undefined && stage.dropOff > 0 && (
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          opacity: 0.8,
                          display: 'block',
                          mb: 0.5,
                          fontStyle: 'italic',
                          fontWeight: 'bold'
                        }}
                      >
                        ↓{stage.dropOff}% from previous
                      </Typography>
                    )}
                    <Typography variant="h6" fontWeight="bold">
                      {Math.round(widthPercent)}%
                    </Typography>
                  </Box>
                </Box>
                
                {/* Progress bar with funnel shape */}
                <Box 
                  sx={{ 
                    mt: 1,
                    height: 6,
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    borderRadius: 3,
                    overflow: 'hidden',
                    position: 'relative'
                  }}
                >
                  <Box
                    sx={{
                      height: '100%',
                      width: `${widthPercent}%`,
                      backgroundColor: 'rgba(255,255,255,0.9)',
                      transition: 'width 0.3s ease-in-out',
                      borderRadius: 3
                    }}
                  />
                </Box>
              </CardContent>
            </Card>
          </Tooltip>
        );
      })}
    </Box>
  );

  const renderDesktopFunnel = () => (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 300, position: 'relative' }}>
      {stages.map((stage, index) => {
        const widthPercent = getBarWidth(stage);
        const isSelected = selectedStage === stage.id;
        
        return (
          <Tooltip
            key={stage.id}
            title={
              <Box>
                <Typography variant="body2" fontWeight="bold">
                  {stage.label}
                </Typography>
                <Typography variant="body2">
                  {stage.count} Deals
                </Typography>
                <Typography variant="body2">
                  {formatCurrency(stage.value)}
                </Typography>
                {stage.dropOff !== undefined && stage.dropOff > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    ↓{stage.dropOff}% from previous stage
                  </Typography>
                )}
              </Box>
            }
            arrow
          >
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                cursor: onStageClick ? 'pointer' : 'default',
                transition: 'all 0.2s ease-in-out',
                '&:hover': {
                  transform: 'translateY(-4px)'
                }
              }}
              onClick={() => onStageClick?.(stage.id)}
            >
              {/* Funnel bar with proportional width */}
              <Box
                sx={{
                  width: `${widthPercent}%`,
                  height: `${widthPercent}%`,
                  backgroundColor: stage.color,
                  borderRadius: '8px 8px 0 0',
                  border: isSelected ? `2px solid ${theme.palette.primary.main}` : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  p: 1,
                  minHeight: 60,
                  minWidth: 80,
                  position: 'relative'
                }}
              >
                <Typography 
                  variant="caption" 
                  sx={{ 
                    color: '#FFFFFF',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    fontSize: '0.7rem'
                  }}
                >
                  {stage.count}
                </Typography>
                <Typography 
                  variant="caption" 
                  sx={{ 
                    color: '#FFFFFF',
                    textAlign: 'center',
                    fontSize: '0.6rem',
                    opacity: 0.9,
                    fontWeight: 'bold'
                  }}
                >
                  {formatCurrency(stage.value)}
                </Typography>
                {stage.dropOff !== undefined && stage.dropOff > 0 && (
                  <Typography 
                    variant="caption" 
                    sx={{ 
                      color: '#FFFFFF',
                      textAlign: 'center',
                      fontSize: '0.6rem',
                      opacity: 0.8,
                      fontStyle: 'italic',
                      fontWeight: 'bold'
                    }}
                  >
                    ↓{stage.dropOff}%
                  </Typography>
                )}
              </Box>
              
              {/* Stage label */}
              <Typography 
                variant="caption" 
                sx={{ 
                  mt: 1,
                  textAlign: 'center',
                  fontWeight: 'bold',
                  fontSize: '0.7rem',
                  color: 'text.secondary'
                }}
              >
                {stage.label}
              </Typography>
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );

  if (stages.length === 0) {
    return (
      <Card sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary">
          No deals found in pipeline
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Create your first opportunity to see the funnel visualization
        </Typography>
      </Card>
    );
  }

  return (
    <Card sx={{ p: 2 }}>
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6" fontWeight="bold">
            Pipeline Funnel
          </Typography>
          
          {/* View Mode Toggle */}
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(e, newMode) => newMode && setViewMode(newMode)}
            size="small"
            sx={{ 
              '& .MuiToggleButton-root': {
                fontSize: '0.75rem',
                px: 1.5
              }
            }}
          >
            <ToggleButton value="count">Count</ToggleButton>
            <ToggleButton value="value">Value</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        
        <Typography variant="body2" color="text.secondary">
          {deals.length} total deals • {formatCurrency(stages.reduce((sum, s) => sum + s.value, 0))} total value
        </Typography>
        
        {/* View Mode Indicator */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Viewing by: <strong>{viewMode === 'count' ? 'Deal Count' : 'Deal Value'}</strong>
          </Typography>
          {onStageClick && (
            <Chip 
              icon={<FilterListIcon />} 
              label="Click stages to filter" 
              size="small" 
              variant="outlined"
              sx={{ fontSize: '0.7rem' }}
            />
          )}
        </Box>
      </Box>
      
      {isMobile ? renderMobileFunnel() : renderDesktopFunnel()}
    </Card>
  );
};

export default PipelineFunnel; 