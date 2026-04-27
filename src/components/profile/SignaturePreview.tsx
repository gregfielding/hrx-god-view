/**
 * Signature Preview Component (v2)
 * 
 * Displays a live preview of the email signature with logo support.
 */

import React, { useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  Box,
  Typography,
  Button,
  Snackbar,
  Alert,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { buildSignatureData, renderHtmlSignature, SignatureData } from '../../utils/signature';
import { useAuth } from '../../contexts/AuthContext';

interface SignaturePreviewProps {
  user: {
    fullName?: string;
    firstName?: string;
    lastName?: string;
    jobTitle?: string;
    phoneNumber?: string;
    phone?: string;
    email: string;
    pronouns?: string;
    officeLocation?: string;
    location?: string;
    includeConfidentialityNotice?: boolean;
    enableEmailSignature?: boolean;
  } | null;
  tenant: {
    avatar?: string;
    website?: string;
    companyName?: string;
  } | null;
}

export const SignaturePreview: React.FC<SignaturePreviewProps> = ({ user, tenant }) => {
  const [copySuccess, setCopySuccess] = useState(false);

  const signatureData = useMemo(() => {
    if (!user) return null;
    return buildSignatureData(user, tenant);
  }, [user, tenant]);

  const signatureHtml = useMemo(() => {
    if (!signatureData || !user?.enableEmailSignature) {
      return '';
    }
    return renderHtmlSignature(signatureData);
  }, [signatureData, user?.enableEmailSignature]);

  const handleCopyHtml = async () => {
    try {
      await navigator.clipboard.writeText(signatureHtml);
      setCopySuccess(true);
    } catch (error) {
      console.error('Failed to copy signature HTML:', error);
    }
  };

  if (!user) {
    return (
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Signature Preview
          </Typography>
          <Typography color="textSecondary">Loading profile…</Typography>
        </CardContent>
      </Card>
    );
  }

  if (!user.enableEmailSignature) {
    return (
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Signature Preview
          </Typography>
          <Typography color="textSecondary">
            Email signature is currently disabled. Turn it on above to see a preview.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" gutterBottom sx={{ mb: 0 }}>
            Signature Preview
          </Typography>
          {signatureHtml && (
            <Button
              size="small"
              startIcon={<ContentCopyIcon />}
              onClick={handleCopyHtml}
              variant="outlined"
            >
              Copy HTML
            </Button>
          )}
        </Box>
        <Typography color="textSecondary" sx={{ mb: 2 }}>
          This is how your email signature will appear in outgoing messages.
        </Typography>

        {!signatureHtml || (!signatureData?.fullName && !signatureData?.email) ? (
          <Typography variant="body2" color="text.secondary">
            Complete your profile details above to generate your signature.
          </Typography>
        ) : (
          <Box
            sx={{
              borderRadius: 3,
              p: 3,
              bgcolor: '#F7F7F9',
            }}
          >
            <Box
              sx={{
                borderRadius: 3,
                bgcolor: '#FFFFFF',
                p: 3,
                display: 'inline-block',
                maxWidth: 520,
              }}
            >
              <div dangerouslySetInnerHTML={{ __html: signatureHtml }} />
            </Box>
          </Box>
        )}
      </CardContent>
      <Snackbar
        open={copySuccess}
        autoHideDuration={3000}
        onClose={() => setCopySuccess(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setCopySuccess(false)} severity="success" sx={{ width: '100%' }}>
          Signature HTML copied to clipboard. Paste into Gmail → Settings → Signature.
        </Alert>
      </Snackbar>
    </Card>
  );
};

