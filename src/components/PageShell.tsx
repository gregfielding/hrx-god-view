import React from 'react';
import { Box, Typography, Breadcrumbs, Link } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

interface PageShellProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export const PageShell: React.FC<PageShellProps> = ({
  title,
  subtitle,
  breadcrumbs,
  actions,
  children
}) => {
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Sticky header */}
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 1200,
          backgroundColor: 'background.paper',
          borderBottom: '1px solid rgba(0,0,0,.06)',
          px: { xs: 2, md: 4 },
          py: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* Breadcrumbs */}
          {breadcrumbs && breadcrumbs.length > 0 && (
            <Breadcrumbs 
              sx={{ 
                mb: 1,
                '& .MuiBreadcrumbs-separator': { color: '#8B94A3' },
                '& .MuiLink-root': { 
                  color: '#8B94A3',
                  textDecoration: 'none',
                  '&:hover': { color: '#4A90E2' }
                }
              }}
            >
              {breadcrumbs.map((crumb, index) => (
                <Link
                  key={index}
                  component={crumb.href ? RouterLink : 'span'}
                  to={crumb.href}
                  color="inherit"
                  sx={{ 
                    fontWeight: index === breadcrumbs.length - 1 ? 600 : 400,
                    color: index === breadcrumbs.length - 1 ? 'text.primary' : 'text.secondary'
                  }}
                >
                  {crumb.label}
                </Link>
              ))}
            </Breadcrumbs>
          )}
          
          {/* Title and subtitle */}
          <Typography 
            variant="h4" 
            sx={{ 
              fontWeight: 600, 
              color: 'text.primary',
              fontSize: { xs: '1.5rem', md: '2rem' },
              lineHeight: 1.2,
              mb: subtitle ? 0.5 : 0
            }}
          >
            {title}
          </Typography>
          
          {subtitle && (
            <Typography 
              variant="subtitle1" 
              sx={{ 
                color: 'text.secondary',
                fontSize: '1rem',
                fontWeight: 400
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>
        
        {/* Actions */}
        {actions && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            {actions}
          </Box>
        )}
      </Box>

      {/* Scrollable content */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          px: { xs: 2, md: 4 },
          py: 3,
        }}
      >
        {children}
      </Box>
    </Box>
  );
};
