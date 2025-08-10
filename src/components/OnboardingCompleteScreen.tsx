import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Container,
  Paper,
  Grid,
  Divider,
  Chip,
} from '@mui/material';
import {
  CheckCircle,
  Download,
  QrCode2,
  Smartphone,
  Email,
  Sms,
} from '@mui/icons-material';

interface CompletionState {
  userProfile: {
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  };
  orgData: {
    name: string;
    type: string;
  } | null;
}

const OnboardingCompleteScreen: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [showQR, setShowQR] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);

  const completionData = location.state as CompletionState;

  const handleDownloadApp = (platform: 'ios' | 'android') => {
    const urls = {
      ios: 'https://apps.apple.com/app/hrx-companion/id123456789',
      android: 'https://play.google.com/store/apps/details?id=com.hrxone.companion',
    };
    window.open(urls[platform], '_blank');
  };

  const handleSendAppLink = async (method: 'email' | 'sms') => {
    setSendingLink(true);

    // Simulate sending link
    setTimeout(() => {
      setSendingLink(false);
      alert(`${method === 'email' ? 'Email' : 'SMS'} sent successfully!`);
    }, 2000);
  };

  const generateQRCode = () => {
    // In production, this would generate a QR code for the app download
    setShowQR(true);
  };

  if (!completionData) {
    navigate('/');
    return null;
  }

  return (
    <Container maxWidth="md" sx={{ mt: 4 }}>
      <Paper elevation={3} sx={{ p: 4, textAlign: 'center' }}>
        <CheckCircle color="success" sx={{ fontSize: 80, mb: 3 }} />

          <Typography variant="h3" gutterBottom sx={{ fontWeight: 'bold', color: 'primary.main' }}>
            You&apos;re All Set!
          </Typography>

        <Typography variant="h6" color="text.secondary" sx={{ mb: 4 }}>
          Welcome to HRX, {completionData.userProfile.firstName}!
        </Typography>

        <Box
          sx={{
            bgcolor: 'success.light',
            color: 'success.contrastText',
            p: 3,
            borderRadius: 2,
            mb: 4,
          }}
        >
          <Typography variant="h6" gutterBottom>
            Account Successfully Created
          </Typography>
          <Typography variant="body1">
            You&apos;re now connected to {completionData.orgData?.name} as a{' '}
            {completionData.userProfile.role}
          </Typography>
        </Box>

        <Divider sx={{ my: 4 }} />

        <Typography variant="h5" gutterBottom>
          Download the HRX Companion App
        </Typography>

        <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
          Get the full HRX experience on your mobile device
        </Typography>

        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} md={6}>
            <Card elevation={2}>
              <CardContent sx={{ textAlign: 'center', py: 3 }}>
                <Smartphone sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  iOS App
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<Download />}
                  onClick={() => handleDownloadApp('ios')}
                  sx={{ mt: 2 }}
                >
                  Download for iOS
                </Button>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card elevation={2}>
              <CardContent sx={{ textAlign: 'center', py: 3 }}>
                <Smartphone sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Android App
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<Download />}
                  onClick={() => handleDownloadApp('android')}
                  sx={{ mt: 2 }}
                >
                  Download for Android
                </Button>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" gutterBottom>
            Desktop Users
          </Typography>
          <Button
            variant="outlined"
            startIcon={<QrCode2 />}
            onClick={generateQRCode}
            sx={{ mr: 2 }}
          >
            Show QR Code
          </Button>

          <Button
            variant="outlined"
            startIcon={<Email />}
            onClick={() => handleSendAppLink('email')}
            disabled={sendingLink}
            sx={{ mr: 2 }}
          >
            Send Link via Email
          </Button>

          <Button
            variant="outlined"
            startIcon={<Sms />}
            onClick={() => handleSendAppLink('sms')}
            disabled={sendingLink}
          >
            Send Link via SMS
          </Button>
        </Box>

        {showQR && (
          <Box
            sx={{
              bgcolor: 'grey.50',
              p: 3,
              borderRadius: 2,
              mb: 4,
              display: 'inline-block',
            }}
          >
            <Typography variant="h6" gutterBottom>
              Scan QR Code
            </Typography>
            <Box
              sx={{
                width: 200,
                height: 200,
                bgcolor: 'white',
                border: '2px solid #ccc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
              }}
            >
              <QrCode2 sx={{ fontSize: 150, color: 'grey.400' }} />
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Point your phone camera at this QR code to download the app
            </Typography>
          </Box>
        )}

        <Divider sx={{ my: 4 }} />

        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" gutterBottom>
            What&apos;s Next?
          </Typography>
          <Grid container spacing={2} justifyContent="center">
            <Grid item>
              <Chip label="Complete your profile" color="primary" />
            </Grid>
            <Grid item>
              <Chip label="View available shifts" color="primary" />
            </Grid>
            <Grid item>
              <Chip label="Connect with your team" color="primary" />
            </Grid>
            <Grid item>
              <Chip label="Set your availability" color="primary" />
            </Grid>
          </Grid>
        </Box>

        <Button
          variant="contained"
          size="large"
          onClick={() => navigate('/dashboard')}
          sx={{
            px: 6,
            py: 2,
            fontSize: '1.1rem',
            borderRadius: 3,
          }}
        >
          Go to Dashboard
        </Button>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
          Need help? Contact support at support@hrxone.com
        </Typography>
      </Paper>
    </Container>
  );
};

export default OnboardingCompleteScreen;
