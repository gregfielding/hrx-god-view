import React from 'react';
import { Box, Card, CardContent, Typography, Link } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export interface WorkerStatusCardProps {
  icon: React.ReactNode;
  title: string;
  stat: string | number;
  subtext: string;
  ctaLabel: string;
  ctaTo: string;
}

const WorkerStatusCard: React.FC<WorkerStatusCardProps> = ({ icon, title, stat, subtext, ctaLabel, ctaTo }) => (
  <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none', height: '100%' }}>
    <CardContent sx={{ py: 2, px: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center' }}>{icon}</Box>
        <Typography variant="subtitle2" color="text.secondary">
          {title}
        </Typography>
      </Box>
      <Typography variant="h6" sx={{ fontWeight: 600 }}>
        {stat}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1 }}>
        {subtext}
      </Typography>
      <Link component={RouterLink} to={ctaTo} variant="body2" fontWeight={600}>
        {ctaLabel}
      </Link>
    </CardContent>
  </Card>
);

export default WorkerStatusCard;
