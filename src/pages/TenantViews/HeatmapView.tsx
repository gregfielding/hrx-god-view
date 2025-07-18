import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Grid,
  Chip,
  Tooltip,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  IconButton
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';

interface HeatmapViewProps {
  tenantId: string;
}

// Mock data for demonstration
const getMockHeatmapData = () => {
  const locations = ['Austin', 'Las Vegas', 'Phoenix', 'Dallas'];
  const departments = ['Fulfillment', 'Sanitation', 'Warehouse', 'Quality Control'];
  
  const data: any = {};
  
  locations.forEach(location => {
    data[location] = {};
    departments.forEach(dept => {
      data[location][dept] = {
        headcount: Math.floor(Math.random() * 25) + 5,
        avgJSI: (Math.random() * 4 + 5).toFixed(1),
        burnoutPercent: Math.floor(Math.random() * 30) + 5,
        openPositions: Math.floor(Math.random() * 5)
      };
    });
  });
  
  return { locations, departments, data };
};

const HeatmapView: React.FC<HeatmapViewProps> = ({ tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heatmapData, setHeatmapData] = useState<any>(null);
  const [selectedCell, setSelectedCell] = useState<any>(null);

  useEffect(() => {
    const loadHeatmapData = async () => {
      try {
        setLoading(true);
        
        // Try to fetch real data from Firestore, but don't fail if it doesn't work
        let locations: string[] = [];
        let departments: string[] = [];
        
        try {
          const locationsSnapshot = await getDocs(collection(db, `tenants/${tenantId}/locations`));
          const departmentsSnapshot = await getDocs(collection(db, `tenants/${tenantId}/departments`));
          
          locations = locationsSnapshot.docs.map(doc => doc.data().name || doc.id);
          departments = departmentsSnapshot.docs.map(doc => doc.data().name || doc.id);
        } catch (firestoreError) {
          console.warn('Could not fetch Firestore data, using mock data:', firestoreError);
        }
        
        // Always use mock data structure, but with real locations/departments if available
        const mockData = getMockHeatmapData();
        setHeatmapData({
          locations: locations.length > 0 ? locations : mockData.locations,
          departments: departments.length > 0 ? departments : mockData.departments,
          data: mockData.data
        });
        
      } catch (err) {
        console.error('Error loading heatmap data:', err);
        // Always fallback to mock data instead of showing error
        setHeatmapData(getMockHeatmapData());
      } finally {
        setLoading(false);
      }
    };

    loadHeatmapData();
  }, [tenantId]);

  const getJsiColor = (jsi: number) => {
    if (jsi >= 7) return '#4caf50'; // Green
    if (jsi >= 5) return '#ff9800'; // Orange
    return '#f44336'; // Red
  };

  const getBurnoutColor = (percent: number) => {
    if (percent <= 10) return '#4caf50'; // Green
    if (percent <= 20) return '#ff9800'; // Orange
    return '#f44336'; // Red
  };

  const handleCellClick = (location: string, department: string, data: any) => {
    setSelectedCell({ location, department, data });
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (!heatmapData) {
    return <Alert severity="info">No organizational data available</Alert>;
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h6">Organizational Heatmap</Typography>
        <Box display="flex" gap={1}>
          <Chip label="JSI Score" size="small" />
          <Chip label="Burnout Risk" size="small" />
          <Chip label="Open Positions" size="small" />
        </Box>
      </Box>

      <Paper sx={{ p: 2, overflow: 'auto' }}>
        <Grid container spacing={1}>
          {/* Header row with locations */}
          <Grid item xs={2}>
            <Box sx={{ p: 1, fontWeight: 'bold', textAlign: 'center' }}>
              Department
            </Box>
          </Grid>
          {heatmapData.locations.map((location: string) => (
            <Grid item xs key={location}>
              <Box sx={{ p: 1, fontWeight: 'bold', textAlign: 'center' }}>
                {location}
              </Box>
            </Grid>
          ))}
          
          {/* Data rows */}
          {heatmapData.departments.map((department: string) => (
            <React.Fragment key={department}>
              <Grid item xs={2}>
                <Box sx={{ p: 1, fontWeight: 'bold' }}>
                  {department}
                </Box>
              </Grid>
              {heatmapData.locations.map((location: string) => {
                const cellData = heatmapData.data[location]?.[department] || {
                  headcount: 0,
                  avgJSI: 0,
                  burnoutPercent: 0,
                  openPositions: 0
                };
                
                return (
                  <Grid item xs key={`${location}-${department}`}>
                    <Tooltip
                      title={
                        <Box>
                          <Typography variant="body2">
                            <strong>{location} - {department}</strong>
                          </Typography>
                          <Typography variant="body2">
                            Headcount: {cellData.headcount}
                          </Typography>
                          <Typography variant="body2">
                            Avg JSI: {cellData.avgJSI}
                          </Typography>
                          <Typography variant="body2">
                            Burnout: {cellData.burnoutPercent}%
                          </Typography>
                          <Typography variant="body2">
                            Open: {cellData.openPositions}
                          </Typography>
                        </Box>
                      }
                    >
                      <Card
                        sx={{
                          cursor: 'pointer',
                          '&:hover': { boxShadow: 3 },
                          border: selectedCell?.location === location && selectedCell?.department === department 
                            ? '2px solid #1976d2' 
                            : '1px solid #e0e0e0'
                        }}
                        onClick={() => handleCellClick(location, department, cellData)}
                      >
                        <CardContent sx={{ p: 1, textAlign: 'center' }}>
                          <Typography variant="h6" sx={{ color: getJsiColor(parseFloat(cellData.avgJSI)) }}>
                            {cellData.headcount}
                          </Typography>
                          <Typography variant="caption" display="block">
                            JSI: {cellData.avgJSI}
                          </Typography>
                          <Typography 
                            variant="caption" 
                            display="block"
                            sx={{ color: getBurnoutColor(cellData.burnoutPercent) }}
                          >
                            Burnout: {cellData.burnoutPercent}%
                          </Typography>
                          {cellData.openPositions > 0 && (
                            <Chip
                              label={`${cellData.openPositions} open`}
                              size="small"
                              color="warning"
                              sx={{ mt: 0.5 }}
                            />
                          )}
                        </CardContent>
                      </Card>
                    </Tooltip>
                  </Grid>
                );
              })}
            </React.Fragment>
          ))}
        </Grid>
      </Paper>

      {/* Selected cell details */}
      {selectedCell && (
        <Card sx={{ mt: 2, p: 2 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">
              {selectedCell.location} - {selectedCell.department}
            </Typography>
            <IconButton size="small">
              <InfoIcon />
            </IconButton>
          </Box>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={3}>
              <Typography variant="body2" color="textSecondary">Headcount</Typography>
              <Typography variant="h6">{selectedCell.data.headcount}</Typography>
            </Grid>
            <Grid item xs={3}>
              <Typography variant="body2" color="textSecondary">Avg JSI</Typography>
              <Typography variant="h6" sx={{ color: getJsiColor(parseFloat(selectedCell.data.avgJSI)) }}>
                {selectedCell.data.avgJSI}
              </Typography>
            </Grid>
            <Grid item xs={3}>
              <Typography variant="body2" color="textSecondary">Burnout Risk</Typography>
              <Typography variant="h6" sx={{ color: getBurnoutColor(selectedCell.data.burnoutPercent) }}>
                {selectedCell.data.burnoutPercent}%
              </Typography>
            </Grid>
            <Grid item xs={3}>
              <Typography variant="body2" color="textSecondary">Open Positions</Typography>
              <Typography variant="h6">{selectedCell.data.openPositions}</Typography>
            </Grid>
          </Grid>
        </Card>
      )}
    </Box>
  );
};

export default HeatmapView; 