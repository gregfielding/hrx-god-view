import React from 'react';
import { Card, Box, Typography, Chip, ToggleButtonGroup, ToggleButton } from '@mui/material';
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

type Deal = {
  id: string;
  name: string;
  stage: string;
  probability?: number;
  estimatedRevenue?: number;
  owner?: string;
};

interface PipelineBubbleChartProps {
  deals: Deal[];
  stages: string[];
  owners: { id: string; name: string }[];
  onDealClick?: (dealId: string) => void;
  colorMode?: 'owner' | 'health';
}

const stageIndexMap = (stages: string[]) => {
  const m: Record<string, number> = {};
  stages.forEach((s, i) => (m[s] = i + 1));
  return m;
};

const ownerColor = (ownerId?: string) => {
  if (!ownerId) return '#9CA3AF';
  const palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
  let hash = 0;
  for (let i = 0; i < ownerId.length; i++) hash = ownerId.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
};

const healthColor = (probability: number): string => {
  if (probability <= 25) return '#ef4444'; // red
  if (probability <= 50) return '#f59e0b'; // amber
  if (probability <= 75) return '#10b981'; // light green
  return '#047857'; // strong green
};

const PipelineBubbleChart: React.FC<PipelineBubbleChartProps> = ({ deals, stages, owners, onDealClick, colorMode = 'owner' }) => {
  const [weightMode, setWeightMode] = React.useState<'value' | 'count'>('value');
  const stageToIndex = React.useMemo(() => stageIndexMap(stages), [stages]);

  const chartData = React.useMemo(() => {
    return deals.map((d) => ({
      id: d.id,
      name: d.name,
      stage: d.stage,
      stageIdx: stageToIndex[d.stage] || 0,
      probability: typeof d.probability === 'number' ? d.probability : 50,
      value: Number(d.estimatedRevenue) || 1000,
      owner: d.owner,
      color: colorMode === 'owner' ? ownerColor(d.owner) : healthColor(typeof d.probability === 'number' ? d.probability : 50)
    }));
  }, [deals, stageToIndex, colorMode]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const p = payload[0]?.payload;
      return (
        <Box sx={{ bgcolor: 'background.paper', p: 1.5, borderRadius: 1, boxShadow: 2 }}>
          <Typography variant="subtitle2" fontWeight={700}>{p.name}</Typography>
          <Typography variant="caption" color="text.secondary">Stage: {p.stage}</Typography><br/>
          <Typography variant="caption">Probability: {p.probability}%</Typography><br/>
          <Typography variant="caption">Value: ${p.value.toLocaleString()}</Typography>
        </Box>
      );
    }
    return null;
  };

  return (
    <Card sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6" fontWeight={700}>Pipeline — Bubble Chart</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={weightMode}
          onChange={(e, v) => v && setWeightMode(v)}
        >
          <ToggleButton value="value">Size by Value</ToggleButton>
          <ToggleButton value="count">Uniform Size</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        X: Stage • Y: Probability • Size: {weightMode === 'value' ? 'Deal Value' : 'Equal'} • Color: Owner
      </Typography>
      <Box sx={{ width: '100%', height: 360 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="stageIdx"
              tickFormatter={(v: number) => stages[v - 1] || ''}
              ticks={stages.map((_, i) => i + 1)}
              domain={[1, stages.length]}
            />
            <YAxis type="number" dataKey="probability" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <ZAxis type="number" dataKey={weightMode === 'value' ? 'value' : undefined as any} range={[80, 400]} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Scatter
              name="Deals"
              data={chartData}
              fill="#1976d2"
              shape={(props: any) => {
                const { cx, cy, node, payload } = props;
                const r = node?.props?.r || 8;
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={payload.color}
                    opacity={0.85}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onDealClick && onDealClick(payload.id)}
                  />
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </Box>
      <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {colorMode === 'owner' ? (
          owners.map((o) => (
            <Chip key={o.id} size="small" label={o.name} sx={{ bgcolor: ownerColor(o.id), color: '#fff' }} />
          ))
        ) : (
          <>
            <Chip size="small" label="0–25%" sx={{ bgcolor: healthColor(10), color: '#fff' }} />
            <Chip size="small" label="26–50%" sx={{ bgcolor: healthColor(40), color: '#fff' }} />
            <Chip size="small" label="51–75%" sx={{ bgcolor: healthColor(60), color: '#fff' }} />
            <Chip size="small" label="76–100%" sx={{ bgcolor: healthColor(90), color: '#fff' }} />
          </>
        )}
      </Box>
    </Card>
  );
};

export default PipelineBubbleChart;


