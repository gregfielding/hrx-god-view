import React from 'react';
import { Box, Typography, Grid, Card, CardContent, CardActionArea, Stack } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import BusinessIcon from '@mui/icons-material/Business';
import EmailIcon from '@mui/icons-material/Email';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import ChatIcon from '@mui/icons-material/Chat';
import { useNavigate } from 'react-router-dom';

const SettingsLanding: React.FC = () => {
  const navigate = useNavigate();

  const settingsCards = [
    {
      title: 'Company Setup',
      description: 'Manage branding, regions, divisions, departments, locations, and organizational structure',
      icon: <BusinessIcon sx={{ fontSize: 40, color: 'primary.main' }} />,
      path: '/settings/company-setup',
      color: '#1976d2',
    },
    {
      title: 'Messaging',
      description: 'Configure SMS and email templates, manage recruiter phone numbers, and set up messaging preferences',
      icon: <EmailIcon sx={{ fontSize: 40, color: 'primary.main' }} />,
      path: '/settings/messaging',
      color: '#1976d2',
    },
    {
      title: 'Sender Management',
      description: 'Manage Twilio number assignments and Gmail connections for your team members',
      icon: <PhoneAndroidIcon sx={{ fontSize: 40, color: 'primary.main' }} />,
      path: '/settings/senders',
      color: '#1976d2',
    },
    {
      title: 'Slack Integration',
      description: 'Connect and manage Slack workspace integration, map users and channels, and configure messaging settings',
      icon: <ChatIcon sx={{ fontSize: 40, color: 'primary.main' }} />,
      path: '/admin/slack',
      color: '#1976d2',
    },
  ];

  return (
    <Box sx={{ p: 2, width: '100%' }}>
      <Box display="flex" alignItems="center" gap={1.5} mb={2}>
        <SettingsIcon sx={{ fontSize: 32, color: 'primary.main' }} />
        <Typography variant="h4" component="h1">
          Settings
        </Typography>
      </Box>

      <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
        Manage your organization's configuration and preferences
      </Typography>

      <Grid container spacing={2}>
        {settingsCards.map((card) => (
          <Grid item xs={12} sm={6} md={6} key={card.path}>
            <Card
              elevation={2}
              sx={{
                height: '100%',
                transition: 'all 0.3s ease',
                '&:hover': {
                  elevation: 4,
                  transform: 'translateY(-4px)',
                },
              }}
            >
              <CardActionArea
                onClick={() => navigate(card.path)}
                sx={{ height: '100%', p: 0 }}
              >
                <CardContent sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <Stack spacing={1.5}>
                    <Box>{card.icon}</Box>
                    <Typography variant="h5" component="h2" fontWeight={600}>
                      {card.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {card.description}
                    </Typography>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default SettingsLanding;

