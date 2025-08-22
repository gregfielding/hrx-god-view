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

// Stage color mapping (consistent with funnel)
const getStageColor = (stage: string): string => {
  const stageColors: Record<string, string> = {
    // Exact stage names from funnel chart
    'Discovery': '#BBDEFB',
    'Qualification': '#64B5F6', 
    'Scoping': '#1E88E5',
    'Proposal Drafted': '#FFE082',
    'Proposal Review': '#FFA726',
    'Negotiation': '#F4511E',
    'Onboarding': '#BA68C8',
    'Dormant': '#424242',
    
    // Lowercase variations
    'discovery': '#BBDEFB',
    'qualification': '#64B5F6', 
    'scoping': '#1E88E5',
    'proposal drafted': '#FFE082',
    'proposal review': '#FFA726',
    'negotiation': '#F4511E',
    'onboarding': '#BA68C8',
    'dormant': '#424242',
    
    // Legacy variations
    'proposalDrafted': '#FFE082',
    'proposalReview': '#FFA726',
    'verbalAgreement': '#9CCC65',
    'closedWon': '#2E7D32',
    'closedLost': '#E53935',
    'liveAccount': '#4527A0'
  };
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
  const [sizeMode, setSizeMode] = React.useState<'value' | 'uniform'>('value');

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
    console.log('PipelineBubbleChart: StageIndexMap:', stageIndexMap);
    console.log('PipelineBubbleChart: Unique deal stages:', [...new Set(deals.map(d => d.stage))]);
    console.log('PipelineBubbleChart: Deal stages with counts:', deals.reduce((acc, d) => {
      acc[d.stage] = (acc[d.stage] || 0) + 1;
      return acc;
    }, {} as Record<string, number>));
    
    const transformedData = deals.map((deal) => {
      console.log('PipelineBubbleChart: Deal stage:', deal.stage, 'Stage index:', stageIndexMap[deal.stage]);
      const value = Number(deal.estimatedRevenue) || 0;
      const probability = typeof deal.probability === 'number' ? deal.probability : 50;
      
      // Determine color based on mode
      let color: string;
      switch (colorMode) {
        case 'stage':
          color = getStageColor(deal.stage);
          break;
        case 'owner':
          color = ownerColor(deal.owner);
          break;
        case 'health':
          color = healthColor(probability);
          break;
        default:
          color = getStageColor(deal.stage);
      }

      // Enhanced stage mapping with better fallback logic
      let stageIdx = stageIndexMap[deal.stage];
      let mappingMethod = 'direct';
      
      // If no direct match, try comprehensive matching
      if (!stageIdx) {
        const dealStageLower = deal.stage.toLowerCase();
        
        // First, try exact case-insensitive match with stages
        const exactMatch = stages.find(stage => 
          stage.toLowerCase() === dealStageLower
        );
        if (exactMatch) {
          stageIdx = stageIndexMap[exactMatch];
          mappingMethod = 'exact_case_insensitive';
        }
        
        // If still no match, try partial matching with stages
        if (!stageIdx) {
          const partialMatch = stages.find(stage => 
            dealStageLower.includes(stage.toLowerCase()) ||
            stage.toLowerCase().includes(dealStageLower)
          );
          if (partialMatch) {
            stageIdx = stageIndexMap[partialMatch];
            mappingMethod = 'partial_match';
          }
        }
        
        // If still no match, try variations mapping
        if (!stageIdx) {
          for (const [variation, standardStage] of Object.entries(stageVariations)) {
            if (dealStageLower.includes(variation) || variation.includes(dealStageLower)) {
              const mappedStage = stageIndexMap[standardStage];
              if (mappedStage) {
                stageIdx = mappedStage;
                mappingMethod = `variation_${variation}`;
                break;
              }
            }
          }
        }
        
        // If still no match, try to find any stage that contains the deal stage
        if (!stageIdx) {
          for (const stage of stages) {
            if (dealStageLower.includes(stage.toLowerCase()) || 
                stage.toLowerCase().includes(dealStageLower)) {
              stageIdx = stageIndexMap[stage];
              mappingMethod = 'contains_match';
              break;
            }
          }
        }
        
        // If still no match, distribute across stages based on deal properties
        if (!stageIdx) {
          // Use deal probability to determine stage - higher probability = later stage
          if (probability >= 80) {
            stageIdx = Math.min(stages.length, 7); // Onboarding or later
          } else if (probability >= 60) {
            stageIdx = Math.min(stages.length, 6); // Negotiation or later
          } else if (probability >= 40) {
            stageIdx = Math.min(stages.length, 5); // Proposal Review or later
          } else if (probability >= 20) {
            stageIdx = Math.min(stages.length, 4); // Proposal Drafted or later
          } else if (probability >= 10) {
            stageIdx = Math.min(stages.length, 3); // Scoping or later
          } else {
            stageIdx = Math.min(stages.length, 2); // Qualification or later
          }
          mappingMethod = 'probability_based';
        }
      }
      
      // Debug logging for stage mapping
      console.log(`PipelineBubbleChart: Deal "${deal.name}" stage "${deal.stage}" mapped to index ${stageIdx} (${stages[stageIdx - 1] || 'unknown'}) using method: ${mappingMethod}`);

      return {
        id: deal.id,
        name: deal.name,
        stage: deal.stage,
        stageIdx,
        probability,
        value,
        owner: deal.owner,
        companyName: deal.companyName,
        aiHealth: deal.aiHealth,
        color,
        // Calculate bubble size
        size: sizeMode === 'value' ? calculateBubbleSize(value) : 40
      };
    }); // Include all deals, don't filter out
    
    console.log('PipelineBubbleChart: Final chart data:', transformedData.length, 'items');
    console.log('PipelineBubbleChart: Stage distribution:', transformedData.reduce((acc, item) => {
      acc[item.stageIdx] = (acc[item.stageIdx] || 0) + 1;
      return acc;
    }, {} as Record<number, number>));
    
    return transformedData;
  }, [deals, stageIndexMap, colorMode, sizeMode]);

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
        <ToggleButtonGroup
          size="small"
          exclusive
          value={sizeMode}
          onChange={(e, v) => v && setSizeMode(v)}
        >
          <ToggleButton value="value">Size by Value</ToggleButton>
          <ToggleButton value="uniform">Uniform Size</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        X: Stage • Y: Probability • Size: {sizeMode === 'value' ? 'Deal Value' : 'Equal'} • Color: {colorMode === 'stage' ? 'Stage' : colorMode === 'owner' ? 'Owner' : 'Health'}
      </Typography>
      
      <Box sx={{ width: '100%', height: 400 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              type="number"
              dataKey="stageIdx"
              tickFormatter={(value: number) => stages[value - 1] || ''}
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


