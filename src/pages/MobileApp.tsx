import React from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  Button,
  Grid,
  Card,
  CardContent,
  CardActions,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Chip,
} from '@mui/material';
import {
  PhoneIphone,
  Download,
  QrCode2,
  CheckCircle,
  Star,
  Security,
  Notifications,
  Schedule,
  Assignment,
  Person,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';

const MobileApp: React.FC = () => {
  const { user, activeTenant } = useAuth();

  const features = [
    {
      icon: <Schedule />,
      title: 'Flexible Scheduling',
      description: 'View and manage your work schedule on the go',
    },
    {
      icon: <Assignment />,
      title: 'Job Assignments',
      description: 'See your current assignments and job details',
    },
    {
      icon: <Notifications />,
      title: 'Real-time Notifications',
      description: 'Get instant updates about schedule changes and new assignments',
    },
    {
      icon: <Person />,
      title: 'Profile Management',
      description: 'Update your profile and preferences easily',
    },
    {
      icon: <Security />,
      title: 'Secure Access',
      description: 'Biometric login and secure data transmission',
    },
    {
      icon: <Star />,
      title: 'Better Experience',
      description: 'Optimized for mobile with intuitive interface',
    },
  ];

  const downloadLinks = {
    ios: 'https://apps.apple.com/app/hrx-one/id123456789',
    android: 'https://play.google.com/store/apps/details?id=com.hrxone.app',
  };

  const handleDownload = (platform: 'ios' | 'android') => {
    window.open(downloadLinks[platform], '_blank');
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom sx={{ mb: 4 }}>
        HRX One Mobile App
      </Typography>

      <Grid container spacing={4}>
        {/* Main Download Section */}
        <Grid item xs={12} md={6}>
          <Paper elevation={3} sx={{ p: 4, textAlign: 'center', height: 'fit-content' }}>
            <PhoneIphone sx={{ fontSize: 80, color: 'primary.main', mb: 2 }} />
            <Typography variant="h5" gutterBottom>
              Download the Mobile App
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              Get the best experience with our mobile app. Available for iOS and Android devices.
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
              <Button
                variant="contained"
                size="large"
                startIcon={<Download />}
                onClick={() => handleDownload('ios')}
                sx={{ py: 1.5 }}
              >
                Download for iOS
              </Button>
              <Button
                variant="contained"
                size="large"
                startIcon={<Download />}
                onClick={() => handleDownload('android')}
                sx={{ py: 1.5 }}
              >
                Download for Android
              </Button>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
              <QrCode2 sx={{ fontSize: 20 }} />
              <Typography variant="body2" color="text.secondary">
                Scan QR code to download
              </Typography>
            </Box>
          </Paper>
        </Grid>

        {/* Features Section */}
        <Grid item xs={12} md={6}>
          <Typography variant="h6" gutterBottom>
            Why Use the Mobile App?
          </Typography>
          <Grid container spacing={2}>
            {features.map((feature, index) => (
              <Grid item xs={12} sm={6} key={index}>
                <Card sx={{ height: '100%' }}>
                  <CardContent sx={{ textAlign: 'center', py: 2 }}>
                    <Box sx={{ color: 'primary.main', mb: 1 }}>
                      {feature.icon}
                    </Box>
                    <Typography variant="subtitle2" gutterBottom>
                      {feature.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {feature.description}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Grid>

        {/* System Requirements */}
        <Grid item xs={12}>
          <Paper elevation={2} sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              System Requirements
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" gutterBottom>
                  iOS Requirements
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText primary="iOS 13.0 or later" />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText primary="iPhone 6s or later" />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText primary="iPad (5th generation) or later" />
                  </ListItem>
                </List>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" gutterBottom>
                  Android Requirements
                </Typography>
                <List dense>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText primary="Android 8.0 (API level 26) or later" />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText primary="2GB RAM minimum" />
                  </ListItem>
                  <ListItem>
                    <ListItemIcon>
                      <CheckCircle color="success" />
                    </ListItemIcon>
                    <ListItemText primary="100MB available storage" />
                  </ListItem>
                </List>
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        {/* Support Section */}
        <Grid item xs={12}>
          <Paper elevation={2} sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Need Help?
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
              If you're having trouble with the mobile app, our support team is here to help.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Chip
                label="Contact Support"
                color="primary"
                variant="outlined"
                onClick={() => window.open('/help', '_blank')}
              />
              <Chip
                label="User Guide"
                color="primary"
                variant="outlined"
                onClick={() => window.open('/help', '_blank')}
              />
              <Chip
                label="FAQ"
                color="primary"
                variant="outlined"
                onClick={() => window.open('/help', '_blank')}
              />
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default MobileApp; 