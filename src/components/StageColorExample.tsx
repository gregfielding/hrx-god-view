import React from 'react';
import { Chip, Box, Typography, Paper } from '@mui/material';

import { getStageColorHex, getTextContrastColor } from '../utils/crmStageColors';

// Example usage as specified in the implementation instructions
const StageColorExample: React.FC = () => {
  const sampleDeals = [
    { id: 1, stage: 'Discovery' },
    { id: 2, stage: 'Qualification' },
    { id: 3, stage: 'Scoping' },
    { id: 4, stage: 'Proposal Drafted' },
    { id: 5, stage: 'Proposal Review' },
    { id: 6, stage: 'Negotiation' },
    { id: 7, stage: 'Verbal Agreement' },
    { id: 8, stage: 'Closed – Won' },
    { id: 9, stage: 'Closed – Lost' },
    { id: 10, stage: 'Onboarding' },
    { id: 11, stage: 'Live Account' },
    { id: 12, stage: 'Dormant' },
  ];

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        🎨 CRM Stage Color Implementation Example
      </Typography>
      
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        This demonstrates the exact implementation pattern specified in the color assignment guide.
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Implementation Pattern:
        </Typography>
        <Box component="pre" sx={{ 
          backgroundColor: '#f5f5f5', 
          p: 2, 
          borderRadius: 1, 
          overflow: 'auto',
          fontSize: '0.875rem'
        }}>
{`<Chip
  label={deal.stage}
  style={{ 
    backgroundColor: getStageColorHex(deal.stage), 
    color: getTextContrastColor(getStageColorHex(deal.stage)) 
  }}
/>`}
        </Box>
      </Paper>

      <Typography variant="h6" gutterBottom>
        All Stages with New Color Scheme:
      </Typography>
      
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {sampleDeals.map((deal) => (
          <Chip
            key={deal.id}
            label={deal.stage}
            style={{ 
              backgroundColor: getStageColorHex(deal.stage), 
              color: getTextContrastColor(getStageColorHex(deal.stage)),
              fontWeight: 600
            }}
          />
        ))}
      </Box>

      <Paper sx={{ p: 3, mt: 3 }}>
        <Typography variant="h6" gutterBottom>
          Color Mapping Summary:
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 2 }}>
          {sampleDeals.map((deal) => {
            const backgroundColor = getStageColorHex(deal.stage);
            const textColor = getTextContrastColor(backgroundColor);
            return (
              <Box key={deal.id} sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 2,
                p: 1,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1
              }}>
                <Box sx={{ 
                  width: 20, 
                  height: 20, 
                  borderRadius: '50%', 
                  backgroundColor,
                  border: 1,
                  borderColor: 'divider'
                }} />
                <Typography variant="body2" sx={{ minWidth: 120 }}>
                  {deal.stage}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {backgroundColor}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Text: {textColor}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Paper>
    </Box>
  );
};

export default StageColorExample; 