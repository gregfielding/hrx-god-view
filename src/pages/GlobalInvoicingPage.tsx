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
      <ExpensifyCardExportCard />
      <Card sx={{ maxWidth: 640, mt: 2 }}>
        <CardContent>
          <Typography variant="body1" color="text.secondary">
            This view is for admins (security level 7) and will include:
          </Typography>
          <Box component="ul" sx={{ mt: 1, pl: 2 }}>
            <li><Typography variant="body2" color="text.secondary">All invoices from all accounts</Typography></li>
            <li><Typography variant="body2" color="text.secondary">Reporting and analytics</Typography></li>
            <li><Typography variant="body2" color="text.secondary">Creating and managing invoices</Typography></li>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            These features will be built out over time. For account-specific invoicing (QuickBooks), open an account and use the Invoicing tab (available to levels 5, 6, and 7).
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default GlobalInvoicingPage;
