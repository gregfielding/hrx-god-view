import React, { useState } from 'react';
import { IconButton, Tooltip, Stack, Snackbar, Alert } from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import MessageIcon from '@mui/icons-material/Message';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EmailIcon from '@mui/icons-material/Email';
import { formatPhoneNumber } from '../../../utils/formatPhone';

interface ContactActionButtonsProps {
  phone?: string;
  email?: string;
  compact?: boolean; // If true, shows only icons without labels
}

const ContactActionButtons: React.FC<ContactActionButtonsProps> = ({
  phone,
  email,
  compact = false,
}) => {
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(`${label} copied to clipboard`);
      setTimeout(() => setCopySuccess(null), 3000);
    } catch (err) {
      console.error('Failed to copy:', err);
      setCopySuccess('Failed to copy');
      setTimeout(() => setCopySuccess(null), 3000);
    }
  };

  const formatPhoneForSMS = (phoneNumber: string): string => {
    // Remove all non-digits
    const digits = phoneNumber.replace(/\D/g, '');
    // Add +1 for US numbers if not already present
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    return phoneNumber;
  };

  const handleSMS = (phoneNumber: string) => {
    const smsNumber = formatPhoneForSMS(phoneNumber);
    window.open(`sms:${smsNumber}`, '_blank');
  };

  if (!phone && !email) {
    return null;
  }

  return (
    <>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        {phone && (
          <>
            <Tooltip title="Call">
              <IconButton
                size="small"
                href={`tel:${phone.replace(/\D/g, '')}`}
                component="a"
                sx={{
                  color: 'primary.main',
                  '&:hover': {
                    bgcolor: 'action.hover',
                  },
                }}
              >
                <PhoneIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Send SMS">
              <IconButton
                size="small"
                onClick={() => handleSMS(phone)}
                sx={{
                  color: 'primary.main',
                  '&:hover': {
                    bgcolor: 'action.hover',
                  },
                }}
              >
                <MessageIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Copy phone number">
              <IconButton
                size="small"
                onClick={() => handleCopy(formatPhoneNumber(phone), 'Phone number')}
                sx={{
                  color: 'primary.main',
                  '&:hover': {
                    bgcolor: 'action.hover',
                  },
                }}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
        
        {email && (
          <>
            <Tooltip title="Send email">
              <IconButton
                size="small"
                href={`mailto:${email}`}
                component="a"
                sx={{
                  color: 'primary.main',
                  '&:hover': {
                    bgcolor: 'action.hover',
                  },
                }}
              >
                <EmailIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Copy email">
              <IconButton
                size="small"
                onClick={() => handleCopy(email, 'Email')}
                sx={{
                  color: 'primary.main',
                  '&:hover': {
                    bgcolor: 'action.hover',
                  },
                }}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Stack>

      <Snackbar
        open={!!copySuccess}
        autoHideDuration={3000}
        onClose={() => setCopySuccess(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setCopySuccess(null)} severity="success" sx={{ width: '100%' }}>
          {copySuccess}
        </Alert>
      </Snackbar>
    </>
  );
};

export default ContactActionButtons;

