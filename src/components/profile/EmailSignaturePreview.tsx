/**
 * Email Signature Preview Component
 * 
 * Displays a live preview of the email signature with logo support.
 */

import React, { useMemo, useState } from 'react';
import {
  Card,
  CardHeader,
  CardContent,
  Box,
  Typography,
  Button,
  Snackbar,
  Alert,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { buildEmailSignatureHtml, UserProfileForSignature } from '../../utils/emailSignatureBuilder';
import { useEmailBrandingSettings } from '../../hooks/useEmailBrandingSettings';
import { EmailSignatureData } from '../../utils/emailSignature';

interface EmailSignaturePreviewProps {
  enabled: boolean;
  data: EmailSignatureData;
}

export const EmailSignaturePreview: React.FC<EmailSignaturePreviewProps> = ({
  enabled,
  data,
}) => {
  const branding = useEmailBrandingSettings();
  const [copySuccess, setCopySuccess] = useState(false);

  const signatureHtml = useMemo(() => {
    if (!enabled) {
      return '';
    }

    const profile: UserProfileForSignature = {
      fullName: data.fullName || '',
      jobTitle: data.jobTitle || '',
      phoneNumber: data.phone || '',
      email: data.email || '',
      officeLocation: data.officeLocation,
      pronouns: data.pronouns,
      includeConfidentialityNotice: data.includeConfidentialityNotice || false,
    };

    return buildEmailSignatureHtml(profile, branding);
  }, [enabled, data, branding]);

  const handleCopyHtml = async () => {
    try {
      await navigator.clipboard.writeText(signatureHtml);
      setCopySuccess(true);
    } catch (error) {
      console.error('Failed to copy signature HTML:', error);
    }
  };

  return (
    <Card variant="outlined" sx={{ mt: 3 }}>
      <CardHeader
        title="Signature Preview"
        subheader="This is how your email signature will appear in outgoing messages."
        action={
          signatureHtml && (
            <Button
              size="small"
              startIcon={<ContentCopyIcon />}
              onClick={handleCopyHtml}
              variant="outlined"
            >
              Copy HTML
            </Button>
          )
        }
      />
      <CardContent>
        {!enabled ? (
          <Typography variant="body2" color="text.secondary">
            Enable your email signature to see a preview.
          </Typography>
        ) : !signatureHtml || (!data.fullName && !data.email) ? (
          <Typography variant="body2" color="text.secondary">
            Complete your profile details above to generate your signature.
          </Typography>
        ) : (
          <Box
            sx={{
              borderRadius: 2,
              bgcolor: 'grey.50',
              p: 2,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <Box
              sx={{
                bgcolor: 'background.paper',
                borderRadius: 1,
                px: 3,
                py: 2,
                maxWidth: 680,
                width: '100%',
                boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.03)',
              }}
            >
              <div
                // Email HTML uses inline styles; we trust our own generator
                dangerouslySetInnerHTML={{ __html: signatureHtml }}
              />
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

