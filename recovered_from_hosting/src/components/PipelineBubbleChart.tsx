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
  associations?: {
    salespeople?: Array<{ id: string; name: string }>;
  };
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
  // Use the actual CRM_STAGE_COLORS from the utils
  const stageColor = CRM_STAGE_COLORS[stage];
  if (stageColor) {
    console.log(`getStageColor("${stage}") -> ${stageColor.hex}`);
    return stageColor.hex;
  }
  
  // Fallback for variations
  const stageColors: Record<string, string> = {
    // Exact stage names from CRM_STAGE_COLORS
    'Discovery': '#BBDEFB',
    'Qualification': '#64B5F6',
    'Scoping': '#1E88E5',
    'Proposal Drafted': '#FFE082',
    'Proposal Review': '#FFA726',
    'Negotiation': '#F4511E',
    'Verbal Agreement': '#9CCC65',
    'Closed – Won': '#2E7D32',  // Note: en dash, not hyphen
    'Closed – Lost': '#E53935', // Note: en dash, not hyphen
    'Onboarding': '#BA68C8',
    'Live Account': '#4527A0',
    'Dormant': '#000000',
    
    // Common variations
    'Closing': '#2E7D32', // Map to Closed – Won
    'Closed Won': '#2E7D32',
    'Closed Lost': '#E53935',
    'Live': '#4527A0',
    
    // Lowercase variations
    'discovery': '#BBDEFB',
    'qualification': '#64B5F6', 
    'scoping': '#1E88E5',
    'proposal drafted': '#FFE082',
    'proposal review': '#FFA726',
    'negotiation': '#F4511E',
    'verbal agreement': '#9CCC65',
    'closing': '#2E7D32',
    'closed won': '#2E7D32',
    'closed lost': '#E53935',
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
  
  const color = stageColors[stage];
  console.log(`getStageColor("${stage}") -> ${color || '#7f8c8d'}`);
  return color || '#7f8c8d';
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
    'verbal agreement': 'Verbal Agreement',
    'closed – won': 'Closed – Won',
    'closed – lost': 'Closed – Lost',
    'onboarding': 'Onboarding',
    'live account': 'Live Account',
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
    
    // Verbal Agreement stage variations
    'verbal': 'Verbal Agreement',
    'agreement': 'Verbal Agreement',
    'handshake': 'Verbal Agreement',
    
    // Closed Won stage variations
    'closing': 'Closed – Won',
    'close': 'Closed – Won',
    'closed': 'Closed – Won',
    'closed won': 'Closed – Won',
    'won': 'Closed – Won',
    'signed': 'Closed – Won',
    
    // Closed Lost stage variations
    'lost': 'Closed – Lost',
    'closed lost': 'Closed – Lost',
    'dead': 'Closed – Lost',
    'disqualified': 'Closed – Lost',
    'no opportunity': 'Closed – Lost',
    'not interested': 'Closed – Lost',
    
    // Onboarding stage variations
    'onboard': 'Onboarding',
    'setup': 'Onboarding',
    'implementation': 'Onboarding',
    
    // Live Account stage variations
    'live': 'Live Account',
    'active': 'Live Account',
    'account': 'Live Account',
    'customer': 'Live Account',
    
    // Dormant stage variations
    'inactive': 'Dormant',
    'disengaged': 'Dormant'
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
    console.log('PipelineBubbleChart: Sample deal stages:', deals.slice(0, 10).map(d => ({ name: d.name, stage: d.stage })));
    console.log('PipelineBubbleChart: StageIndexMap:', stageIndexMap);
    
    // Emergency fallback: if no stages available, create a simple distribution
    if (!stages || stages.length === 0) {
      console.warn('PipelineBubbleChart: No stages available, using emergency fallback');
      const emergencyStages = ['Discovery', 'Qualification', 'Scoping', 'Proposal Drafted', 'Proposal Review', 'Negotiation', 'Verbal Agreement', 'Closed – Won', 'Onboarding', 'Live Account'];
      stages = emergencyStages;
    }
    
    const transformedData = deals.map((deal, dealIndex) => {
      const value = Number(deal.estimatedRevenue) || 0;
      const probability = typeof deal.probability === 'number' ? deal.probability : 50;
      
      // Map deal.stage to canonical stage index using variations map
      const rawStage = (deal.stage || '').trim();
      const rawLower = rawStage.toLowerCase();
      
      console.log(`\n--- Processing Deal ${dealIndex + 1}: "${deal.name}" ---`);
      console.log(`  Raw stage: "${rawStage}"`);
      console.log(`  Raw stage (lower): "${rawLower}"`);
      
      // First try exact match
      let stageIdx = stageIndexMap[rawStage];
      console.log(`  Exact match result: ${stageIdx}`);
      
      // Then try lowercase match
      if (!stageIdx) {
        stageIdx = stageIndexMap[rawLower];
        console.log(`  Lowercase match result: ${stageIdx}`);
      }
      
      // Then try partial matching against variations
      if (!stageIdx) {
        for (const [variation, standardStage] of Object.entries(stageVariations)) {
          if (rawLower.includes(variation) || variation.includes(rawLower)) {
            stageIdx = stageIndexMap[standardStage];
            console.log(`  Variation match: "${variation}" -> "${standardStage}" -> ${stageIdx}`);
            break;
          }
        }
      }
      
      // If still no match, try direct stage name matching
      if (!stageIdx) {
        const directMatch = stages.find(stage => 
          stage.toLowerCase() === rawLower || 
          rawLower.includes(stage.toLowerCase()) ||
          stage.toLowerCase().includes(rawLower)
        );
        if (directMatch) {
          stageIdx = stages.indexOf(directMatch) + 1;
          console.log(`  Direct stage match: "${directMatch}" -> ${stageIdx}`);
        }
      }
      
      // Final fallback: probability-based placement
      if (!stageIdx || stageIdx < 1 || stageIdx > stages.length) {
        // Map probability to stage index (0-25% = stage 1, 26-50% = stage 2, etc.)
        const stageIndex = Math.min(stages.length, Math.max(1, Math.ceil((probability / 100) * stages.length)));
        stageIdx = stageIndex;
        console.log(`  Probability fallback: ${probability}% -> stage ${stageIndex}`);
      }
      
      // Emergency fallback: force distribution across stages
      if (!stageIdx || stageIdx < 1 || stageIdx > stages.length) {
        // Simple modulo distribution to ensure we get something
        stageIdx = (dealIndex % stages.length) + 1;
        console.log(`  EMERGENCY FALLBACK: dealIndex ${dealIndex} -> stage ${stageIdx}`);
      }
      
      const assignedStageName = stages[stageIdx - 1] || stages[0] || 'Discovery';
      const color = getStageColor(assignedStageName);
      
      console.log(`  Final stageIdx: ${stageIdx}`);
      console.log(`  Assigned Stage Name: "${assignedStageName}"`);
      console.log(`  Color: ${color}`);
      console.log(`  X Position (stageIdx): ${stageIdx}`);
      console.log(`  Y Position (probability): ${probability}`);

      return {
        id: deal.id,
        name: deal.name,
        stage: deal.stage, // Keep original stage for reference
        assignedStage: assignedStageName, // Add assigned stage
        stageIdx, // X-axis position (1-based)
        probability, // Y-axis position
        value,
        owner: deal.owner,
        companyName: deal.companyName,
        aiHealth: deal.aiHealth,
        color,
        size: calculateBubbleSize(value),
        salespeople: deal.associations?.salespeople || []
      };
    });
    
    console.log('\n=== FINAL CHART DATA SUMMARY ===');
    console.log('PipelineBubbleChart: Final chart data:', transformedData.length, 'items');
    console.log('PipelineBubbleChart: X-axis range should be 1 to', stages.length);
    
    const stageDistribution = transformedData.reduce((acc, item) => {
      acc[`Stage ${item.stageIdx} (${item.assignedStage})`] = (acc[`Stage ${item.stageIdx} (${item.assignedStage})`] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log('PipelineBubbleChart: Stage distribution:', stageDistribution);
    console.log('PipelineBubbleChart: Sample transformed data:', transformedData.slice(0, 3));
    
    // Final safety check: if no data is being generated, force a simple distribution
    if (transformedData.length === 0 && deals.length > 0) {
      console.warn('PipelineBubbleChart: No data generated, forcing simple distribution');
      return deals.map((deal, dealIndex) => {
        const value = Number(deal.estimatedRevenue) || 0;
        const probability = typeof deal.probability === 'number' ? deal.probability : 50;
        const stageIdx = (dealIndex % 10) + 1; // Force distribution across 10 stages
        const assignedStageName = stages[stageIdx - 1] || 'Discovery';
        const color = getStageColor(assignedStageName);
        
        return {
          id: deal.id,
          name: deal.name,
          stage: deal.stage,
          assignedStage: assignedStageName,
          stageIdx,
          probability,
          value,
          owner: deal.owner,
          companyName: deal.companyName,
          aiHealth: deal.aiHealth,
          color,
          size: calculateBubbleSize(value),
          salespeople: deal.associations?.salespeople || []
        };
      });
    }
    
    return transformedData;
  }, [deals, stages, stageIndexMap]);

  // Custom tooltip component
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0]?.payload;
      
      // Get salespeople names
      const salespeopleNames = data.salespeople && data.salespeople.length > 0 
        ? data.salespeople.map((sp: any) => sp.name).join(', ')
        : 'Unassigned';
      
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
            Salespeople: {salespeopleNames}
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
      {/* {renderStageLegend()} */}
      {renderOwnerLegend()}
      {renderHealthLegend()}
    </Card>
  );
};

export default PipelineBubbleChart;


