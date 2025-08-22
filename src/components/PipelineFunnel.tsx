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
  Chip,
  keyframes
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import AssignmentIcon from '@mui/icons-material/Assignment';
import DescriptionIcon from '@mui/icons-material/Description';
import RateReviewIcon from '@mui/icons-material/RateReview';
import GavelIcon from '@mui/icons-material/Gavel';
import HandshakeIcon from '@mui/icons-material/Handshake';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import BlockIcon from '@mui/icons-material/Block';

import { CRM_STAGE_COLORS } from '../utils/crmStageColors';

// Animation keyframes
const pulseAnimation = keyframes`
  0% { transform: scale(1); }
  50% { transform: scale(1.02); }
  100% { transform: scale(1); }
`;

const flowAnimation = keyframes`
  0% { transform: translateY(0px); opacity: 0.8; }
  50% { transform: translateY(-2px); opacity: 1; }
  100% { transform: translateY(0px); opacity: 0.8; }
`;

interface Stage {
  id: string;
  label: string;
  count: number;
  value: number;
  color: string;
  gradient: string;
  icon: React.ReactNode;
  dropOff?: number;
}

interface PipelineFunnelProps {
  deals: any[];
  onStageClick?: (stage: string) => void;
}

// Stage configuration with enhanced colors, gradients, and icons
const getStageConfig = (stageKey: string): { color: string; gradient: string; icon: React.ReactNode } => {
  const baseColor = CRM_STAGE_COLORS[stageKey]?.hex || '#7f8c8d';
  
  const configs: Record<string, { color: string; gradient: string; icon: React.ReactNode }> = {
    'discovery': {
      color: '#BBDEFB',
      gradient: 'linear-gradient(135deg, #BBDEFB 0%, #90CAF9 100%)',
      icon: <SearchIcon />
    },
    'qualification': {
      color: '#64B5F6',
      gradient: 'linear-gradient(135deg, #64B5F6 0%, #42A5F5 100%)',
      icon: <AssignmentIcon />
    },
    'scoping': {
      color: '#1E88E5',
      gradient: 'linear-gradient(135deg, #1E88E5 0%, #1976D2 100%)',
      icon: <AssignmentIcon />
    },
    'proposalDrafted': {
      color: '#FFE082',
      gradient: 'linear-gradient(135deg, #FFE082 0%, #FFD54F 100%)',
      icon: <DescriptionIcon />
    },
    'proposalReview': {
      color: '#FFA726',
      gradient: 'linear-gradient(135deg, #FFA726 0%, #FF9800 100%)',
      icon: <RateReviewIcon />
    },
    'negotiation': {
      color: '#F4511E',
      gradient: 'linear-gradient(135deg, #F4511E 0%, #E64A19 100%)',
      icon: <GavelIcon />
    },
    'verbalAgreement': {
      color: '#9CCC65',
      gradient: 'linear-gradient(135deg, #9CCC65 0%, #8BC34A 100%)',
      icon: <HandshakeIcon />
    },
    'closedWon': {
      color: '#2E7D32',
      gradient: 'linear-gradient(135deg, #2E7D32 0%, #1B5E20 100%)',
      icon: <CheckCircleIcon />
    },
    'closedLost': {
      color: '#E53935',
      gradient: 'linear-gradient(135deg, #E53935 0%, #C62828 100%)',
      icon: <CancelIcon />
    },
    'onboarding': {
      color: '#BA68C8',
      gradient: 'linear-gradient(135deg, #BA68C8 0%, #9C27B0 100%)',
      icon: <PersonAddIcon />
    },
    'liveAccount': {
      color: '#4527A0',
      gradient: 'linear-gradient(135deg, #4527A0 0%, #311B92 100%)',
      icon: <AccountCircleIcon />
    },
    'dormant': {
      color: '#424242',
      gradient: 'linear-gradient(135deg, #424242 0%, #212121 100%)',
      icon: <BlockIcon />
    }
  };
  
  return configs[stageKey] || { 
    color: baseColor, 
    gradient: `linear-gradient(135deg, ${baseColor} 0%, ${baseColor} 100%)`, 
    icon: <AssignmentIcon /> 
  };
};

const PipelineFunnel: React.FC<PipelineFunnelProps> = ({ 
  deals, 
  onStageClick 
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Helper function to get deal value
  const getDealValue = (deal: any): number => {
    if (typeof deal.estimatedRevenue === 'number') {
      return deal.estimatedRevenue;
    }
    if (typeof deal.value === 'number') {
      return deal.value;
    }
    if (deal.estimatedRevenue) {
      const val = Number(String(deal.estimatedRevenue).replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(val)) {
        return val;
      }
    }
    return 0;
  };

  // Calculate stage data with enhanced styling
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
        const config = getStageConfig(stageKey);
        const dropOff = previousCount > 0 ? 
          Math.round(((previousCount - stageData.count) / previousCount) * 100) : 0;
        
        stages.push({
          id: stageKey,
          label: stageKey.charAt(0).toUpperCase() + stageKey.slice(1).replace(/([A-Z])/g, ' $1'),
          count: stageData.count,
          value: stageData.value,
          color: config.color,
          gradient: config.gradient,
          icon: config.icon,
          dropOff
        });
        
        previousCount = stageData.count;
      }
    });

    return stages;
  };

  const stages = calculateStageData();
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

  // Calculate dynamic height based on deal value
  const getBarHeight = (stage: Stage) => {
    const maxHeight = 300; // Maximum height in pixels
    const minHeight = 40; // Minimum height for visibility
    
    // Calculate height as percentage of max value
    const heightPercent = (stage.value / maxValue) * 100;
    const height = Math.max((heightPercent / 100) * maxHeight, minHeight);
    
    return height;
  };

  const renderMobileFunnel = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {stages.map((stage, index) => {
        const isSelected = false; // Stage selection disabled
        const height = getBarHeight(stage);
        
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
                transition: 'all 0.3s ease-in-out',
                animation: `${pulseAnimation} 3s ease-in-out infinite`,
                '&:hover': {
                  transform: 'translateX(4px) scale(1.02)',
                  boxShadow: theme.shadows[8],
                  animation: 'none'
                }
              }}
              onClick={() => onStageClick?.(stage.id)}
            >
              <CardContent sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Box sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.2)'
                  }}>
                    {React.cloneElement(stage.icon as React.ReactElement, { sx: { fontSize: 16, color: '#FFFFFF' } })}
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: '#FFFFFF' }}>
                    {stage.label}
                  </Typography>
                </Box>
                
                <Box sx={{ 
                  height: 80, 
                  background: stage.gradient,
                  borderRadius: 2,
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                  <Box
                    sx={{
                      height: `${Math.min(height, 80)}px`,
                      width: '100%',
                      background: 'linear-gradient(90deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.7) 100%)',
                      transition: 'height 0.3s ease-in-out',
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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 320 }}>

      

      
              {/* Funnel bars with reference grid */}
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, flex: 1, position: 'relative' }}>
        {/* Reference grid lines */}
        <Box sx={{ 
          position: 'absolute', 
          top: 0, 
          left: 0, 
          right: 0, 
          bottom: 0, 
          pointerEvents: 'none',
          zIndex: 0
        }}>
          {[0, 25, 50, 75, 100].map((percent) => (
            <Box
              key={percent}
              sx={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${percent}%`,
                height: '1px',
                backgroundColor: 'transparent',
                opacity: percent === 0 ? 0.3 : 0.1
              }}
            />
          ))}
        </Box>
        {stages.map((stage, index) => {
          const height = getBarHeight(stage);
          const isSelected = false; // Stage selection disabled
          
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
                    transition: 'all 0.3s ease-in-out',
                    position: 'relative',
                    zIndex: 1,
                    '&:hover': {
                      transform: 'translateY(-8px) scale(1.05)',
                      zIndex: 10
                    }
                  }}
                  onClick={() => onStageClick?.(stage.id)}
                >
                {/* Funnel bar with enhanced styling */}
                <Box
                  sx={{
                    width: '100%',
                    height: `${height}px`,
                    background: stage.gradient,
                    borderRadius: '12px 12px 0 0',
                    border: isSelected ? `3px solid ${theme.palette.primary.main}` : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                    pr: 1,
                    pl: 1,
                    pb: 0,
                    pt: 2,
                    minHeight: 60,
                    minWidth: 100,
                    position: 'relative',
                    boxShadow: theme.shadows[2],
                    animation: `${pulseAnimation} 3s ease-in-out infinite`,
                    '&:hover': {
                      boxShadow: theme.shadows[8],
                      animation: 'none'
                    }
                  }}
                >
                  {/* Icon */}
                  <Box sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    mb: 1
                  }}>
                    {React.cloneElement(stage.icon as React.ReactElement, { sx: { fontSize: 20, color: '#FFFFFF' } })}
                  </Box>
                  
                  {/* Value and Count - Always show both */}
                  <Box sx={{ textAlign: 'center', mb: 1 }}>
                    <Typography variant="h6" fontWeight="bold" sx={{ color: '#FFFFFF', fontSize: '1rem' }}>
                      {formatCurrency(stage.value)}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#FFFFFF', opacity: 0.8, fontSize: '0.6rem' }}>
                      {stage.count} Deals
                    </Typography>
                  </Box>
                </Box>
                
                {/* Stage label */}
                <Typography 
                  variant="caption" 
                  sx={{ 
                    mt: 1,
                    textAlign: 'center',
                    fontWeight: 'bold',
                    fontSize: '0.8rem',
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
    <Card sx={{ p: 2, borderRadius: 2, boxShadow: theme.shadows[2] }}>
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6" fontWeight="bold">
            Pipeline Funnel
          </Typography>
        </Box>
        
        <Typography variant="body2" color="text.secondary">
          {deals.length} total deals • {formatCurrency(stages.reduce((sum, s) => sum + s.value, 0))} total value
        </Typography>
        
        {/* Chart Info */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Each column shows: <strong>Value above, Count below</strong>
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