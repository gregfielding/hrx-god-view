import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Stack
} from '@mui/material';
import { CRM_STAGE_COLORS, getAllStages, getStageStatistics, isActiveStage, isWonStage, isLostStage, getTextContrastColor } from '../utils/crmStageColors';
import StageChip from './StageChip';

// Sample data for demo
const sampleDeals = [
  { stage: "Discovery" },
  { stage: "Qualification" },
  { stage: "Scoping" },
  { stage: "Proposal Drafted" },
  { stage: "Proposal Review" },
  { stage: "Negotiation" },
  { stage: "Verbal Agreement" },
  { stage: "Closed – Won" },
  { stage: "Closed – Lost" },
  { stage: "Onboarding" },
  { stage: "Live Account" },
  { stage: "Dormant" },
  { stage: "Discovery" },
  { stage: "Qualification" },
  { stage: "Closed – Won" },
];

const StageColorDemo: React.FC = () => {
  const stats = getStageStatistics(sampleDeals);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        🎨 CRM Stage Color System Demo
      </Typography>
      
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        This demo showcases the complete CRM stage color mapping system with consistent visual representation across the application.
      </Typography>

      {/* All Stages Display */}
      <Card sx={{ mb: 4 }}>
        <CardHeader title="All Available Stages" />
        <CardContent>
          <Grid container spacing={2}>
            {getAllStages().map((stage) => {
              const stageInfo = CRM_STAGE_COLORS[stage];
              return (
                <Grid item xs={12} sm={6} md={4} key={stage}>
                  <Paper sx={{ p: 2, border: 1, borderColor: 'divider' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                      <StageChip stage={stage} useCustomColors={true} />
                      <Box sx={{ 
                        width: 20, 
                        height: 20, 
                        borderRadius: '50%', 
                        backgroundColor: stageInfo.hex,
                        border: 1,
                        borderColor: 'divider'
                      }} />
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {stageInfo.description}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      HEX: {stageInfo.hex}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Text: {getTextContrastColor(stageInfo.hex)}
                    </Typography>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        </CardContent>
      </Card>

      {/* Statistics */}
      <Card sx={{ mb: 4 }}>
        <CardHeader title="Stage Statistics (Sample Data)" />
        <CardContent>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>Summary</Typography>
              <Stack spacing={1}>
                <Typography>Total Deals: {stats.total}</Typography>
                <Typography>Active Deals: {stats.activeCount}</Typography>
                <Typography>Won Deals: {stats.wonCount}</Typography>
                <Typography>Lost Deals: {stats.lostCount}</Typography>
              </Stack>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>Stage Breakdown</Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Stage</TableCell>
                      <TableCell align="right">Count</TableCell>
                      <TableCell align="right">%</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(stats.counts).map(([stage, count]) => (
                      <TableRow key={stage}>
                        <TableCell>
                          <StageChip stage={stage} showTooltip={false} size="small" useCustomColors={true} />
                        </TableCell>
                        <TableCell align="right">{count}</TableCell>
                        <TableCell align="right">{stats.percentages[stage].toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Stage Categories */}
      <Card sx={{ mb: 4 }}>
        <CardHeader title="Stage Categories" />
        <CardContent>
          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <Typography variant="h6" gutterBottom color="primary">
                🔵 Early Stages
              </Typography>
              <Stack spacing={1}>
                {["Discovery", "Qualification", "Scoping"].map((stage) => (
                  <StageChip key={stage} stage={stage} useCustomColors={true} />
                ))}
              </Stack>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="h6" gutterBottom color="warning.main">
                🟡 Mid Stages
              </Typography>
              <Stack spacing={1}>
                {["Proposal Drafted", "Proposal Review", "Negotiation"].map((stage) => (
                  <StageChip key={stage} stage={stage} useCustomColors={true} />
                ))}
              </Stack>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="h6" gutterBottom color="success.main">
                ✅ Winning Stages
              </Typography>
              <Stack spacing={1}>
                {["Verbal Agreement", "Closed – Won"].map((stage) => (
                  <StageChip key={stage} stage={stage} useCustomColors={true} />
                ))}
              </Stack>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="h6" gutterBottom color="error.main">
                ❌ Losing Stage
              </Typography>
              <Stack spacing={1}>
                {["Closed – Lost"].map((stage) => (
                  <StageChip key={stage} stage={stage} useCustomColors={true} />
                ))}
              </Stack>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="h6" gutterBottom color="secondary.main">
                🚀 Account Stages
              </Typography>
              <Stack spacing={1}>
                {["Onboarding", "Live Account"].map((stage) => (
                  <StageChip key={stage} stage={stage} useCustomColors={true} />
                ))}
              </Stack>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="h6" gutterBottom color="text.primary">
                ⚫ Dormant
              </Typography>
              <Stack spacing={1}>
                {["Dormant"].map((stage) => (
                  <StageChip key={stage} stage={stage} useCustomColors={true} />
                ))}
              </Stack>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Usage Examples */}
      <Card>
        <CardHeader title="Usage Examples" />
        <CardContent>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>In Dropdowns</Typography>
              <Paper sx={{ p: 2, border: 1, borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Stage selection in forms:
                </Typography>
                <Stack spacing={1}>
                  {["Discovery", "Qualification", "Scoping"].map((stage) => (
                    <Box key={stage} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <StageChip stage={stage} showTooltip={false} size="small" useCustomColors={true} />
                      <Typography variant="body2">{stage}</Typography>
                    </Box>
                  ))}
                </Stack>
              </Paper>
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom>In Tables</Typography>
              <Paper sx={{ p: 2, border: 1, borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Stage display in data tables:
                </Typography>
                <Stack spacing={1}>
                  {["Closed – Won", "Negotiation", "Proposal Review"].map((stage) => (
                    <Box key={stage} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Typography variant="body2" sx={{ minWidth: 100 }}>Deal #{Math.floor(Math.random() * 1000)}</Typography>
                      <StageChip stage={stage} showTooltip={false} size="small" useCustomColors={true} />
                    </Box>
                  ))}
                </Stack>
              </Paper>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    </Box>
  );
};

export default StageColorDemo; 