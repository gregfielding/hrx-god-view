import React from 'react';
import { Box, Typography, Grid, Card, CardContent, Button } from '@mui/material';
import { Assessment, TrendingUp, People, Assignment } from '@mui/icons-material';

import { useAuth } from '../contexts/AuthContext';

const Reports: React.FC = () => {
  const { activeTenant } = useAuth();

  const reportCards = [
    {
      title: 'Job Satisfaction Insights',
      description: 'View worker satisfaction scores and risk analysis',
      icon: <Assessment />,
      path: '/admin/job-satisfaction-insights',
      color: '#4CAF50'
    },
    {
      title: 'Workforce Analytics',
      description: 'Comprehensive workforce performance and engagement metrics',
      icon: <People />,
      path: '/admin/ai-analytics',
      color: '#2196F3'
    },
    {
      title: 'Assignment Reports',
      description: 'Track job orders, assignments, and completion rates',
      icon: <Assignment />,
      path: '/assignments',
      color: '#FF9800'
    },
    {
      title: 'Performance Trends',
      description: 'Historical performance data and trend analysis',
      icon: <TrendingUp />,
      path: '/admin/ai-context',
      color: '#9C27B0'
    }
  ];

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Reports & Analytics
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Access comprehensive reports and analytics for {activeTenant?.name || 'your organization'}.
      </Typography>

      <Grid container spacing={3}>
        {reportCards.map((card, index) => (
          <Grid item xs={12} sm={6} md={4} key={index}>
            <Card 
              sx={{ 
                height: '100%',
                transition: 'transform 0.2s',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: 4
                }
              }}
            >
              <CardContent sx={{ textAlign: 'center', p: 3 }}>
                <Box 
                  sx={{ 
                    display: 'flex', 
                    justifyContent: 'center', 
                    mb: 2,
                    color: card.color
                  }}
                >
                  {React.cloneElement(card.icon, { sx: { fontSize: 48 } })}
                </Box>
                <Typography variant="h6" gutterBottom>
                  {card.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {card.description}
                </Typography>
                <Button 
                  variant="outlined" 
                  fullWidth
                  href={card.path}
                  sx={{ borderColor: card.color, color: card.color }}
                >
                  View Report
                </Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default Reports; 