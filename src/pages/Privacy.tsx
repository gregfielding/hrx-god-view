import React from 'react';
import { 
  Box, 
  Typography, 
  Container, 
  Alert,
  Link
} from '@mui/material';

const Privacy: React.FC = () => {
  return (
    <Container maxWidth="md" sx={{ py: 5, pb: 10 }}>
      {/* Header */}
      <Box component="header" sx={{ mb: 3 }}>
        <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1.2, mb: 1.5 }}>
          Privacy Policy
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Effective Date: <time dateTime="2025-10-21">October 21, 2025</time> · Last Updated: <time dateTime="2025-10-21">October 21, 2025</time>
          <br />
          Applies to: C1 Staffing, LLC and its affiliates, including HRX One, HRX Companion, and related products ("we," "us," "our").
        </Typography>
        
        <Alert severity="info" sx={{ mb: 4 }}>
          <Typography variant="body2">
            This Privacy Policy describes how we collect, use, and share your personal information when you use our services.
          </Typography>
        </Alert>
      </Box>

      {/* Content will be populated soon */}
      <Typography variant="body1" color="text.secondary">
        Full Privacy Policy content coming soon...
      </Typography>

      {/* Footer */}
      <Box component="footer" sx={{ mt: 5, pt: 3, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="body2" color="text.secondary">
          © {new Date().getFullYear()} C1 Staffing, LLC and affiliates. All rights reserved. |{' '}
          <Link href="/terms">Terms of Use</Link> |{' '}
          <Link href="/consent">SMS Consent</Link>
        </Typography>
      </Box>
    </Container>
  );
};

export default Privacy;

