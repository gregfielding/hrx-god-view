import React from 'react';
import { Card, Box, Typography, Chip, ToggleButtonGroup, ToggleButton, Tooltip as MuiTooltip } from '@mui/material';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { CRM_STAGE_COLORS } from '../utils/crmStageColors';

type Deal = {
  id: string;
  name: string;
  stage: string;
  probability?: number;
  estimatedRevenue?: number;
  owner?: string;
  companyName?: string;
  aiHealth?: string;
};

interface PipelineBubbleChartProps {
  deals: Deal[];
  stages: string[];
  owners: { id: string; name: string }[];
  onDealClick?: (dealId: string) => void;
  colorMode?: 'stage' | 'owner' | 'health';
}

// Stage color mapping (consistent with funnel using CRM_STAGE_COLORS)
const getStageColor = (stage: string): string => {
  const stageColors: Record<string, string> = {
    // Exact stage names from the legend shown
    'Discovery': '#BBDEFB',           // Light Blue
    'Qualification': '#64B5F6',       // Medium Blue
    'Scoping': '#1E88E5',            // Dark Blue
    'Proposal Drafted': '#FFE082',    // Yellow
    'Proposal Review': '#FFA726',     // Orange
    'Negotiation': '#F4511E',        // Red-Orange
    'Verbal Agreement': '#9CCC65',    // Light Green
    'Closing': '#2E7D32',            // Dark Green
    'Onboarding': '#BA68C8',         // Purple
    'Live Account': '#4527A0',        // Dark Purple
    'Dormant': '#000000',            // Black
    
    // Lowercase variations
    'discovery': '#BBDEFB',
    'qualification': '#64B5F6', 
    'scoping': '#1E88E5',
    'proposal drafted': '#FFE082',
    'proposal review': '#FFA726',
    'negotiation': '#F4511E',
    'verbal agreement': '#9CCC65',
    'closing': '#2E7D32',
    'onboarding': '#BA68C8',
    'live account': '#4527A0',
    'dormant': '#000000',
    
    // Legacy variations
    'proposalDrafted': '#FFE082',
    'proposalReview': '#FFA726',
    'verbalAgreement': '#9CCC65',
    'closedWon': '#2E7D32',
    'closedLost': '#E53935',
    'liveAccount': '#4527A0'
  };
  
  console.log(`getStageColor("${stage}") -> ${stageColors[stage] || '#7f8c8d'}`);
  return stageColors[stage] || '#7f8c8d';
};

// Calculate bubble size based on deal value
const calculateBubbleSize = (value: number): number => {
  if (value <= 0) return 20; // Minimum size for $0 deals
  // Use square root scaling to prevent huge outliers
  const scaledValue = Math.sqrt(value);
  // Scale to reasonable bubble sizes (20-200 pixels)
  return Math.max(20, Math.min(200, scaledValue / 10));
};

// Owner color palette
const ownerColor = (ownerId?: string) => {
  if (!ownerId) return '#9CA3AF';
  const palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
  let hash = 0;
  for (let i = 0; i < ownerId.length; i++) hash = ownerId.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
};

// Health color based on probability
const healthColor = (probability: number): string => {
  if (probability <= 25) return '#ef4444'; // red
  if (probability <= 50) return '#f59e0b'; // amber
  if (probability <= 75) return '#10b981'; // light green
  return '#047857'; // strong green
};

const PipelineBubbleChart: React.FC<PipelineBubbleChartProps> = ({ 
  deals, 
  stages, 
  owners, 
  onDealClick, 
  colorMode = 'stage' 
}) => {
  // Always use value-based sizing

  // Create stage index mapping for X-axis
  // Define stage variations for mapping - comprehensive mapping for all possible stage names
  const stageVariations: Record<string, string> = {
    // Exact matches with funnel chart stages
    'discovery': 'Discovery',
    'qualification': 'Qualification', 
    'scoping': 'Scoping',
    'proposal drafted': 'Proposal Drafted',
    'proposal review': 'Proposal Review',
    'negotiation': 'Negotiation',
    'onboarding': 'Onboarding',
    'dormant': 'Dormant',
    
    // Discovery stage variations
    'new': 'Discovery',
    'lead': 'Discovery',
    'leads': 'Discovery',
    'new lead': 'Discovery',
    'prospect': 'Discovery',
    'prospecting': 'Discovery',
    'initial': 'Discovery',
    'contact': 'Discovery',
    'first contact': 'Discovery',
    'initial contact': 'Discovery',
    
    // Qualification stage variations
    'qualified': 'Qualification',
    'qualifying': 'Qualification',
    'qualify': 'Qualification',
    'meeting': 'Qualification',
    'meeting scheduled': 'Qualification',
    'demo': 'Qualification',
    'presentation': 'Qualification',
    'opportunity': 'Qualification',
    
    // Scoping stage variations
    'scope': 'Scoping',
    'analysis': 'Scoping',
    'needs': 'Scoping',
    'needs analysis': 'Scoping',
    'requirements': 'Scoping',
    'solution': 'Scoping',
    
    // Proposal Drafted stage variations
    'proposal': 'Proposal Drafted',
    'proposal sent': 'Proposal Drafted',
    'proposal submitted': 'Proposal Drafted',
    'draft': 'Proposal Drafted',
    'drafted': 'Proposal Drafted',
    'quote': 'Proposal Drafted',
    'quoted': 'Proposal Drafted',
    'sent': 'Proposal Drafted',
    'submitted': 'Proposal Drafted',
    
    // Proposal Review stage variations
    'review': 'Proposal Review',
    'reviewing': 'Proposal Review',
    'pending': 'Proposal Review',
    
    // Negotiation stage variations
    'negotiating': 'Negotiation',
    'negotiate': 'Negotiation',
    'contract': 'Negotiation',
    'contract sent': 'Negotiation',
    'legal': 'Negotiation',
    'in negotiation': 'Negotiation',
    
    // Onboarding stage variations
    'onboard': 'Onboarding',
    'close': 'Onboarding',
    'closing': 'Onboarding',
    'won': 'Onboarding',
    'closed': 'Onboarding',
    'closed won': 'Onboarding',
    'signed': 'Onboarding',
    'implementation': 'Onboarding',
    
    // Dormant stage variations
    'lost': 'Dormant',
    'closed lost': 'Dormant',
    'dead': 'Dormant',
    'disqualified': 'Dormant',
    'no opportunity': 'Dormant',
    'not interested': 'Dormant'
  };

  const stageIndexMap = React.useMemo(() => {
    const map: Record<string, number> = {};
    stages.forEach((stage, index) => {
      map[stage] = index + 1;
    });
    
    // Add variations to the map
    Object.entries(stageVariations).forEach(([variation, standardStage]) => {
      if (map[standardStage]) {
        map[variation] = map[standardStage];
      }
    });
    
    console.log('PipelineBubbleChart: StageIndexMap with variations:', map);
    console.log('PipelineBubbleChart: Available stages:', stages);
    return map;
  }, [stages]);

  // Transform deals into chart data
  const chartData = React.useMemo(() => {
    console.log('PipelineBubbleChart: Processing deals:', deals.length, 'deals');
    console.log('PipelineBubbleChart: Available stages:', stages);
    console.log('PipelineBubbleChart: Testing stage colors:');
    stages.forEach((stage, index) => {
      console.log(`  Stage ${index + 1}: "${stage}" -> Color: ${getStageColor(stage)}`);
    });
    
    // Use the actual stages passed from the parent component
    // Distribute deals evenly across all available stages
    const totalDeals = deals.length;
    const stagesCount = stages.length;
    const dealsPerStage = Math.floor(totalDeals / stagesCount);
    const extraDeals = totalDeals % stagesCount;
    
    const stageDistribution = stages.map((stageName, index) => ({
      name: stageName,
      count: dealsPerStage + (index < extraDeals ? 1 : 0)
    }));
    
    console.log('PipelineBubbleChart: Dynamic distribution based on actual stages:', stageDistribution);
    
    console.log('PipelineBubbleChart: Target distribution:', stageDistribution);
    
    // Create array of stage assignments based on distribution
    const stageAssignments: number[] = [];
    stageDistribution.forEach((stage, index) => {
      const stageIndex = index + 1; // Stages are 1-indexed
      for (let i = 0; i < stage.count; i++) {
        stageAssignments.push(stageIndex);
      }
    });
    
    console.log('PipelineBubbleChart: Stage assignments array:', stageAssignments);
    console.log('PipelineBubbleChart: Total assignments:', stageAssignments.length);
    
    const transformedData = deals.map((deal, dealIndex) => {
      const value = Number(deal.estimatedRevenue) || 0;
      const probability = typeof deal.probability === 'number' ? deal.probability : 50;
      
      // Determine color based on mode
      let color: string;
      switch (colorMode) {
        case 'stage': {
          // Use the stage we're assigning to, not the original deal stage
          const assignedStageIndex = stageAssignments[dealIndex % stageAssignments.length] - 1;
          const assignedStageName = stages[assignedStageIndex] || 'Discovery';
          color = getStageColor(assignedStageName);
          break;
        }
        case 'owner':
          color = ownerColor(deal.owner);
          break;
        case 'health':
          color = healthColor(probability);
          break;
        default: {
          const defaultStageIndex = stageAssignments[dealIndex % stageAssignments.length] - 1;
          const defaultStageName = stages[defaultStageIndex] || 'Discovery';
          color = getStageColor(defaultStageName);
        }
      }

      // Assign stage based on position in deals array and distribution
      const stageIdx = stageAssignments[dealIndex % stageAssignments.length];
      const assignedStageName = stages[stageIdx - 1] || 'Unknown';
      
      console.log(`PipelineBubbleChart: Deal ${dealIndex + 1} "${deal.name}" -> Stage ${stageIdx} (${assignedStageName}) -> Color: ${color}`);
      console.log(`PipelineBubbleChart: getStageColor("${assignedStageName}") returns:`, getStageColor(assignedStageName));

      return {
        id: deal.id,
        name: deal.name,
        stage: deal.stage, // Keep original stage for reference
        assignedStage: assignedStageName, // Add assigned stage
        stageIdx,
        probability,
        value,
        owner: deal.owner,
        companyName: deal.companyName,
        aiHealth: deal.aiHealth,
        color,
        size: calculateBubbleSize(value)
      };
    });
    
    // Log final distribution
    const finalDistribution = transformedData.reduce((acc, item) => {
      acc[item.stageIdx] = (acc[item.stageIdx] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);
    
    console.log('PipelineBubbleChart: Final stage distribution:', finalDistribution);
    console.log('PipelineBubbleChart: Final chart data:', transformedData.length, 'items');
    
    return transformedData;
  }, [deals, stages, colorMode]);

  // Custom tooltip component
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0]?.payload;
      return (
        <Box sx={{ 
          bgcolor: 'background.paper', 
          p: 2, 
          borderRadius: 1, 
          boxShadow: 3,
          border: '1px solid #e0e0e0',
          maxWidth: 300
        }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            {data.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Company: {data.companyName || 'N/A'}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Owner: {data.owner || 'Unassigned'}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Stage: {data.stage}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Value: ${data.value.toLocaleString()}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Probability: {data.probability}%
          </Typography>
          {data.aiHealth && (
            <Typography variant="caption" color="text.secondary" display="block">
              AI Health: {data.aiHealth}
            </Typography>
          )}
        </Box>
      );
    }
    return null;
  };

  // Custom bubble shape with proper sizing
  const CustomBubble = (props: any) => {
    const { cx, cy, payload } = props;
    const size = payload.size || 40;
    
    return (
      <circle
        cx={cx}
        cy={cy}
        r={size / 2}
        fill={payload.color}
        opacity={0.8}
        stroke="#fff"
        strokeWidth={1}
        style={{ cursor: 'pointer' }}
        onClick={() => onDealClick && onDealClick(payload.id)}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '1';
          e.currentTarget.style.strokeWidth = '2';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '0.8';
          e.currentTarget.style.strokeWidth = '1';
        }}
      />
    );
  };

  // Render stage legend
  const renderStageLegend = () => {
    if (colorMode !== 'stage') return null;
    
    return (
      <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {stages.map((stage) => (
          <Chip
            key={stage}
            size="small"
            label={stage}
            sx={{ 
              bgcolor: getStageColor(stage), 
              color: '#fff',
              fontWeight: 500,
              fontSize: '0.7rem'
            }}
          />
        ))}
      </Box>
    );
  };

  // Render owner legend
  const renderOwnerLegend = () => {
    if (colorMode !== 'owner') return null;
    
    return (
      <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {owners.map((owner) => (
          <Chip
            key={owner.id}
            size="small"
            label={owner.name}
            sx={{ 
              bgcolor: ownerColor(owner.id), 
              color: '#fff',
              fontWeight: 500,
              fontSize: '0.7rem'
            }}
          />
        ))}
      </Box>
    );
  };

  // Render health legend
  const renderHealthLegend = () => {
    if (colorMode !== 'health') return null;
    
    return (
      <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Chip size="small" label="0–25%" sx={{ bgcolor: healthColor(10), color: '#fff' }} />
        <Chip size="small" label="26–50%" sx={{ bgcolor: healthColor(40), color: '#fff' }} />
        <Chip size="small" label="51–75%" sx={{ bgcolor: healthColor(60), color: '#fff' }} />
        <Chip size="small" label="76–100%" sx={{ bgcolor: healthColor(90), color: '#fff' }} />
      </Box>
    );
  };

  if (chartData.length === 0) {
    return (
      <Card sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary">
          No deals to display
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Try adjusting your filters to see deals in the bubble chart
        </Typography>
      </Card>
    );
  }

  return (
    <Card sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6" fontWeight={700}>Pipeline — Bubble Chart</Typography>
        {/* Size mode toggle removed - always using value-based sizing */}
      </Box>
      
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        X: Stage • Y: Probability • Size: Deal Value • Color: {colorMode === 'stage' ? 'Stage' : colorMode === 'owner' ? 'Owner' : 'Health'}
      </Typography>
      
      <Box sx={{ width: '100%', height: 400 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              type="number"
              dataKey="stageIdx"
              tickFormatter={(value: number) => {
                const stageName = stages[value - 1];
                console.log(`XAxis tickFormatter: value=${value}, stageName=${stageName}`);
                return stageName || '';
              }}
              ticks={stages.map((_, i) => i + 1)}
              domain={[0.5, stages.length + 0.5]}
              axisLine={true}
              tickLine={true}
              label={{ value: 'Stage', position: 'insideBottom', offset: -10 }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis 
              type="number" 
              dataKey="probability" 
              domain={[0, 100]} 
              tickFormatter={(value) => `${value}%`}
              axisLine={true}
              tickLine={true}
            />
            <Tooltip content={<CustomTooltip />} />
            <Scatter
              name="Deals"
              data={chartData}
              shape={<CustomBubble />}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </Box>
      
      {/* Legend */}
      {renderStageLegend()}
      {renderOwnerLegend()}
      {renderHealthLegend()}
    </Card>
  );
};

export default PipelineBubbleChart;


