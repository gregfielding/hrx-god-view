import React from 'react';
import { Box, Typography, Link } from '@mui/material';
import { ChevronRight as ChevronRightIcon } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';

interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface BreadcrumbNavProps {
  items: BreadcrumbItem[];
  variant?: 'default' | 'compact';
}

export const BreadcrumbNav: React.FC<BreadcrumbNavProps> = ({
  items,
  variant = 'default'
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        mb: variant === 'compact' ? 1 : 2,
        flexWrap: 'wrap'
      }}
    >
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <ChevronRightIcon
              sx={{
                fontSize: 16,
                color: '#8B94A3',
                mx: 0.5
              }}
            />
          )}
          
          {index === items.length - 1 ? (
            // Current page (last item)
            <Typography
              variant={variant === 'compact' ? 'body2' : 'body1'}
              sx={{
                color: '#0B0D12',
                fontWeight: 600,
                cursor: 'default'
              }}
            >
              {item.label}
            </Typography>
          ) : (
            // Clickable breadcrumb
            <Link
              component={item.href ? RouterLink : 'button'}
              to={item.href}
              onClick={item.onClick}
              sx={{
                color: '#8B94A3',
                textDecoration: 'none',
                fontWeight: 500,
                cursor: 'pointer',
                '&:hover': {
                  color: '#4A90E2',
                  textDecoration: 'underline'
                },
                '&:focus': {
                  outline: '2px solid #4A90E2',
                  outlineOffset: '2px',
                  borderRadius: '4px'
                }
              }}
            >
              {item.label}
            </Link>
          )}
        </React.Fragment>
      ))}
    </Box>
  );
};
