import React from 'react';
import {
  Box,
  Typography,
} from '@mui/material';
import {
  Work as WorkIcon,
} from '@mui/icons-material';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import JobOrderForm from '../components/JobOrderForm';

const NewJobOrder: React.FC = () => {
  const breadcrumbItems = [
    {
      label: 'Recruiter',
      href: '/recruiter'
    },
    {
      label: 'Job Orders',
      href: '/recruiter/job-orders'
    },
    {
      label: 'New Job Order'
    }
  ];

  return (
    <Box sx={{ p: 0 }}>
      <BreadcrumbNav items={breadcrumbItems} />
      
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WorkIcon />
          New Job Order
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Create a new job order for your client
        </Typography>
      </Box>

      {/* Form */}
      <JobOrderForm />
    </Box>
  );
};

export default NewJobOrder;
