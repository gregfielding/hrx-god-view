/**
 * Global Invoicing – security level 7 only.
 * Sidebar "Invoicing" ($) links here. Will show all invoices across accounts,
 * reporting, and creating invoices. Built out over time.
 */

import React from 'react';
import { Box, Card, CardContent, Typography } from '@mui/material';
import ReceiptIcon from '@mui/icons-material/Receipt';
import PageHeader from '../components/PageHeader';
import ConnectQuickBooksCard from '../components/settings/ConnectQuickBooksCard';
import ExpensifyCardExportCard from '../components/settings/ExpensifyCardExportCard';
import QboArDashboardCard from '../components/settings/QboArDashboardCard';

const GlobalInvoicingPage: React.FC = () => {
  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ReceiptIcon fontSize="small" />
            <span>Invoicing</span>
          </Box>
        }
      />
      <ConnectQuickBooksCard />
      <QboArDashboardCard />
      <ExpensifyCardExportCard />
      <Card sx={{ maxWidth: 640, mt: 2 }}>
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            For account-specific invoicing, open an account and use its Invoicing tab (levels 5, 6,
            and 7) — invoice history, payments, A/R aging, and the QuickBooks customer mapping live
            there.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default GlobalInvoicingPage;
