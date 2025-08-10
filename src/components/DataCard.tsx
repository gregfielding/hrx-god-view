import React from 'react';
import { Box, Typography, Paper, Chip } from '@mui/material';
import { TrendingUp, TrendingDown } from '@mui/icons-material';

interface DataCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: {
    value: number;
    isPositive: boolean;
    period: string;
  };
  status?: 'success' | 'warning' | 'error' | 'info';
  icon?: React.ReactNode;
  onClick?: () => void;
}

export const DataCard: React.FC<DataCardProps> = ({
  title,
  value,
  subtitle,
  trend,
  status,
  icon,
  onClick
}) => {
  const getStatusColor = () => {
    switch (status) {
      case 'success':
        return { bg: '#E7F7F0', color: '#1E9E6A' };
      case 'warning':
        return { bg: '#FFF7E6', color: '#B88207' };
      case 'error':
        return { bg: '#FDECEC', color: '#D14343' };
      case 'info':
        return { bg: '#E8F3FC', color: '#1F6FC9' };
      default:
        return { bg: '#F7F9FC', color: '#5A6372' };
    }
  };

  const statusColors = getStatusColor();

  return (
    <Paper
      sx={{
        borderRadius: 12,
        border: '1px solid rgba(0,0,0,.08)',
        backgroundColor: '#FFFFFF',
        padding: 3,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 200ms ease-in-out',
        '&:hover': onClick ? {
          borderColor: 'rgba(0,0,0,.12)',
          transform: 'translateY(-2px)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
        } : {},
      }}
      onClick={onClick}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography
            variant="caption"
            sx={{
              color: '#8B94A3',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              mb: 0.5
            }}
          >
            {title}
          </Typography>
          
          <Typography
            variant="h4"
            sx={{
              fontWeight: 700,
              color: '#0B0D12',
              lineHeight: 1.2
            }}
          >
            {value}
          </Typography>
          
          {subtitle && (
            <Typography
              variant="body2"
              sx={{
                color: '#5A6372',
                mt: 0.5
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>
        
        {icon && (
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: 12,
              backgroundColor: statusColors.bg,
              color: statusColors.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            {icon}
          </Box>
        )}
      </Box>
      
      {trend && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {trend.isPositive ? (
            <TrendingUp sx={{ fontSize: 16, color: '#1E9E6A' }} />
          ) : (
            <TrendingDown sx={{ fontSize: 16, color: '#D14343' }} />
          )}
          
          <Typography
            variant="caption"
            sx={{
              color: trend.isPositive ? '#1E9E6A' : '#D14343',
              fontWeight: 600
            }}
          >
            {trend.value > 0 ? '+' : ''}{trend.value}%
          </Typography>
          
          <Typography
            variant="caption"
            sx={{
              color: '#8B94A3'
            }}
          >
            vs {trend.period}
          </Typography>
        </Box>
      )}
    </Paper>
  );
};
