/**
 * Sender Identity Card Component
 * 
 * Displays sender status (Twilio number and Gmail connection) for a team member
 */

import React, { useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Stack,
  Chip,
  Box,
  Button,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
} from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import EmailIcon from '@mui/icons-material/Email';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import RefreshIcon from '@mui/icons-material/Refresh';
import SendIcon from '@mui/icons-material/Send';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  securityLevel: number;
  gmailConnected?: boolean;
  gmailEmail?: string;
  twilioNumber?: string;
  useMainNumber?: boolean;
}

interface SenderIdentityCardProps {
  tenantId: string;
  teamMember: TeamMember;
  onUpdate?: () => void;
}

const SenderIdentityCard: React.FC<SenderIdentityCardProps> = ({
  tenantId,
  teamMember,
  onUpdate,
}) => {
  const [verifying, setVerifying] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const functions = getFunctions();
  const verifyTwilioNumberFn = httpsCallable(functions, 'verifyTwilioNumber');
  const verifyGmailConnectionFn = httpsCallable(functions, 'verifyGmailConnection');
  const testSenderIdentityFn = httpsCallable(functions, 'testSenderIdentity');

  const handleVerifyTwilio = async () => {
    setVerifying(true);
    setError(null);
    try {
      await verifyTwilioNumberFn({
        tenantId,
        recruiterId: teamMember.id,
      });
      if (onUpdate) onUpdate();
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleVerifyGmail = async () => {
    setVerifying(true);
    setError(null);
    try {
      await verifyGmailConnectionFn({
        userId: teamMember.id,
      });
      if (onUpdate) onUpdate();
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleTestSender = async (senderType: 'gmail' | 'recruiter_sms' | 'system') => {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await testSenderIdentityFn({
        tenantId,
        userId: teamMember.id,
        senderType,
        testRecipient: {
          email: teamMember.email,
          phone: undefined, // Will use user's phone from their profile
        },
      });
      setTestResult(result.data);
      setTestDialogOpen(true);
    } catch (err: any) {
      setError(err.message || 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const getStatusIcon = (status: 'active' | 'pending' | 'error' | 'not_configured') => {
    switch (status) {
      case 'active':
        return <CheckCircleIcon color="success" fontSize="small" />;
      case 'error':
        return <ErrorIcon color="error" fontSize="small" />;
      case 'pending':
        return <WarningIcon color="warning" fontSize="small" />;
      default:
        return <ErrorIcon color="disabled" fontSize="small" />;
    }
  };

  const twilioStatus: 'active' | 'pending' | 'error' | 'not_configured' = teamMember.twilioNumber
    ? teamMember.useMainNumber
      ? 'active'
      : 'active' // Assume active if assigned, verification will update this
    : 'not_configured';

  const gmailStatus: 'active' | 'pending' | 'error' | 'not_configured' = teamMember.gmailConnected
    ? 'active'
    : 'not_configured';

  return (
    <>
      <Card elevation={2} sx={{ height: '100%' }}>
        <CardContent>
          <Stack spacing={2}>
            {/* Header */}
            <Box>
              <Typography variant="h6" fontWeight={600}>
                {teamMember.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {teamMember.email}
              </Typography>
              <Chip
                label={`Level ${teamMember.securityLevel}`}
                size="small"
                sx={{ mt: 0.5 }}
              />
            </Box>

            {/* Twilio Number Status */}
            <Box>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <PhoneIcon fontSize="small" color="primary" />
                <Typography variant="subtitle2" fontWeight={600}>
                  SMS Number
                </Typography>
                {getStatusIcon(twilioStatus)}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {teamMember.twilioNumber
                  ? teamMember.useMainNumber
                    ? 'Using main number'
                    : teamMember.twilioNumber
                  : 'Not assigned'}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                {teamMember.twilioNumber && !teamMember.useMainNumber && (
                  <Tooltip title="Verify number and webhook">
                    <IconButton
                      size="small"
                      onClick={handleVerifyTwilio}
                      disabled={verifying}
                    >
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                {twilioStatus !== 'not_configured' && (
                  <Tooltip title="Test SMS sending">
                    <IconButton
                      size="small"
                      onClick={() => handleTestSender('recruiter_sms')}
                      disabled={testing}
                    >
                      <SendIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            </Box>

            {/* Gmail Status */}
            <Box>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <EmailIcon fontSize="small" color="primary" />
                <Typography variant="subtitle2" fontWeight={600}>
                  Gmail Connection
                </Typography>
                {getStatusIcon(gmailStatus)}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {teamMember.gmailConnected
                  ? `Connected as ${teamMember.gmailEmail || teamMember.email}`
                  : 'Not connected'}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                {teamMember.gmailConnected && (
                  <Tooltip title="Verify Gmail connection">
                    <IconButton
                      size="small"
                      onClick={handleVerifyGmail}
                      disabled={verifying}
                    >
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                {gmailStatus !== 'not_configured' && (
                  <Tooltip title="Test email sending">
                    <IconButton
                      size="small"
                      onClick={() => handleTestSender('gmail')}
                      disabled={testing}
                    >
                      <SendIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            </Box>

            {error && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {error}
              </Alert>
            )}

            {(verifying || testing) && (
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={20} />
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* Test Result Dialog */}
      <Dialog open={testDialogOpen} onClose={() => setTestDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Test Results</DialogTitle>
        <DialogContent>
          {testResult && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Alert
                severity={testResult.success ? 'success' : 'error'}
              >
                {testResult.message}
              </Alert>
              {testResult.results && (
                <Box>
                  <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                    Channel Results:
                  </Typography>
                  {testResult.results.map((result: any, index: number) => (
                    <Alert
                      key={index}
                      severity={result.success ? 'success' : 'error'}
                      sx={{ mb: 1 }}
                    >
                      <Typography variant="body2">
                        <strong>{result.channel.toUpperCase()}:</strong> {result.message}
                      </Typography>
                      {result.messageId && (
                        <Typography variant="caption" color="text.secondary">
                          Message ID: {result.messageId}
                        </Typography>
                      )}
                    </Alert>
                  ))}
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTestDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default SenderIdentityCard;

