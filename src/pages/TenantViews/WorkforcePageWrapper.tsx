import React from 'react';
import { Box, Breadcrumbs, Link, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';

interface WorkforcePageWrapperProps {
  children: React.ReactNode;
  breadcrumbPath: Array<{ label: string; href?: string }>;
}

const WorkforcePageWrapper: React.FC<WorkforcePageWrapperProps> = ({ 
  children, 
  breadcrumbPath 
}) => {
  return (
    <Box sx={{ p: 0 }}>
      {breadcrumbPath.length > 0 && (
        <Breadcrumbs 
          separator={<NavigateNextIcon fontSize="small" />} 
          aria-label="breadcrumb"
          sx={{ mb: 3 }}
        >
          {breadcrumbPath.map((item, index) => (
            item.href ? (
              <Link
                key={index}
                component={RouterLink}
                to={item.href}
                color={index === breadcrumbPath.length - 1 ? "text.primary" : "inherit"}
                underline={index === breadcrumbPath.length - 1 ? "none" : "hover"}
                sx={{
                  fontWeight: index === breadcrumbPath.length - 1 ? 600 : 400,
                  textDecoration: 'none',
                  '&:hover': {
                    textDecoration: index === breadcrumbPath.length - 1 ? 'none' : 'underline'
                  }
                }}
              >
                {item.label}
              </Link>
            ) : (
              <Typography
                key={index}
                color={index === breadcrumbPath.length - 1 ? "text.primary" : "inherit"}
                sx={{
                  fontWeight: index === breadcrumbPath.length - 1 ? 600 : 400,
                }}
              >
                {item.label}
              </Typography>
            )
          ))}
        </Breadcrumbs>
      )}
      {children}
    </Box>
  );
};

export default WorkforcePageWrapper;
