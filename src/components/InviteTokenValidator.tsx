import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Container,
  Paper,
} from '@mui/material';
import { CheckCircle, Error, Business } from '@mui/icons-material';

interface InviteTokenData {
  valid: boolean;
  token: string;
  type: 'Customer' | 'Agency';
  orgId: string;
  role: 'Worker' | 'Applicant';
  orgDetails: {
    id: string;
    name: string;
    type: string;
  } | null;
  createdAt: any;
  expiresAt: any;
  error?: string;
}

const InviteTokenValidator: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [tokenData, setTokenData] = useState<InviteTokenData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    validateToken();
  }, [token]);

  const validateToken = async () => {
    if (!token) {
      setError('No invite token provided');
      setLoading(false);
      return;
    }

    try {
      const functions = getFunctions();
      const validateInviteToken = httpsCallable(functions, 'validateInviteToken');

      const result = await validateInviteToken({ token });
      const data = result.data as InviteTokenData;

      setTokenData(data);

      if (!data.valid) {
        setError(data.error || 'Invalid invite token');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to validate invite token');
    } finally {
      setLoading(false);
    }
  };

  const handleGetStarted = () => {
    if (tokenData?.valid) {
      navigate('/onboarding/profile', {
        state: {
          token: tokenData.token,
          orgData: tokenData.orgDetails,
          role: tokenData.role,
          type: tokenData.type,
          orgId: tokenData.orgId,
        },
      });
    }
  };

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Box display="flex" flexDirection="column" alignItems="center" gap={3}>
          <CircularProgress size={60} />
          <Typography variant="h6" color="text.secondary">
            Validating your invite...
          </Typography>
        </Box>
      </Container>
    );
  }

  if (error || !tokenData?.valid) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Error color="error" sx={{ fontSize: 64, mb: 2 }} />
            <Typography variant="h4" gutterBottom color="error">
              Invalid Invite
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              {error || tokenData?.error || 'This invite link is not valid or has expired.'}
            </Typography>
            <Button variant="contained" onClick={() => navigate('/')} sx={{ mt: 2 }}>
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ mt: 4 }}>
      <Paper elevation={3} sx={{ p: 4, textAlign: 'center' }}>
        <CheckCircle color="success" sx={{ fontSize: 80, mb: 3 }} />

        <Typography variant="h3" gutterBottom sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          You've Been Invited!
        </Typography>

        <Box sx={{ my: 4 }}>
          <Business sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
          <Typography variant="h5" gutterBottom>
            {tokenData.orgDetails?.name || 'Unknown Organization'}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            has invited you to join HRX as a {tokenData.role}
          </Typography>
        </Box>

        <Box
          sx={{
            bgcolor: 'grey.50',
            p: 3,
            borderRadius: 2,
            mb: 4,
            textAlign: 'left',
          }}
        >
          <Typography variant="h6" gutterBottom>
            What you'll get:
          </Typography>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>Access to work assignments and schedules</li>
            <li>Direct communication with your team</li>
            <li>Mobile app for on-the-go access</li>
            <li>Secure profile and work history</li>
          </ul>
        </Box>

        <Button
          variant="contained"
          size="large"
          onClick={handleGetStarted}
          sx={{
            px: 6,
            py: 2,
            fontSize: '1.1rem',
            borderRadius: 3,
          }}
        >
          Get Started
        </Button>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
          This invite expires on {tokenData.expiresAt?.toDate().toLocaleDateString()}
        </Typography>
      </Paper>
    </Container>
  );
};

export default InviteTokenValidator;
