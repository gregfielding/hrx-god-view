/**
 * /reports/accounts-receivable — A/R Aging in the report library.
 *
 * Thin wrapper over QboArDashboardCard (same data the Global Invoicing
 * page shows: QuickBooks AgedReceivables via the level-7-gated
 * getQboDashboard callable). The route in App.tsx carries
 * GlobalInvoicingGuard so only level 7 lands here.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, IconButton, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RequestQuoteOutlinedIcon from '@mui/icons-material/RequestQuoteOutlined';

import PageHeader from '../../components/PageHeader';
import QboArDashboardCard from '../../components/settings/QboArDashboardCard';

const ArAgingReportPage: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton size="small" aria-label="Back to reports" onClick={() => navigate('/reports')}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <RequestQuoteOutlinedIcon fontSize="small" />
            <span>A/R Aging</span>
          </Box>
        }
        subtitle={
          <Typography variant="body2" color="text.secondary">
            QuickBooks aged receivables by customer. Invoice-level detail lives on each
            account&apos;s Invoicing tab and the Invoicing page.
          </Typography>
        }
      />
      <QboArDashboardCard includeDso />
    </Box>
  );
};

export default ArAgingReportPage;
