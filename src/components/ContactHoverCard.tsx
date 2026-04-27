/**
 * Contact Hover Card Component
 * 
 * Displays contact information in a popover when hovering over contact pills
 */

import React from 'react';
import {
  Popover,
  Box,
  Typography,
  Stack,
  Divider,
  Link,
  Chip,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import BusinessIcon from '@mui/icons-material/Business';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

export interface ParticipantContact {
  email: string;
  contactId?: string;
  contactName?: string;
  companyId?: string;
  companyName?: string;
  userId?: string;
  userName?: string;
  dealIds?: string[];
}

interface ContactHoverCardProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  contact: ParticipantContact;
  tenantId: string;
}

const ContactHoverCard: React.FC<ContactHoverCardProps> = ({
  open,
  anchorEl,
  onClose,
  contact,
  tenantId,
}) => {
  const displayName = contact.contactName || contact.userName || contact.email.split('@')[0];
  const isLinked = !!(contact.contactId || contact.userId);

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'left',
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'left',
      }}
      sx={{
        mt: 1,
      }}
    >
      <Box sx={{ p: 2, minWidth: 280, maxWidth: 320 }}>
        <Stack spacing={1.5}>
          {/* Header */}
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <PersonIcon fontSize="small" color="action" />
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {displayName}
              </Typography>
              {isLinked && (
                <Chip
                  label={contact.contactId ? 'CRM Contact' : 'User'}
                  size="small"
                  color="primary"
                  sx={{ height: 20, fontSize: '0.65rem' }}
                />
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {contact.email}
            </Typography>
          </Box>

          <Divider />

          {/* Company */}
          {contact.companyName && (
            <Box>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <BusinessIcon fontSize="small" color="action" />
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {contact.companyName}
                </Typography>
              </Stack>
              {contact.companyId && (
                <Link
                  href={`/companies/${contact.companyId}`}
                  target="_blank"
                  rel="noopener"
                  sx={{
                    fontSize: '0.75rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                    textDecoration: 'none',
                    '&:hover': {
                      textDecoration: 'underline',
                    },
                  }}
                >
                  View Company
                  <OpenInNewIcon fontSize="inherit" />
                </Link>
              )}
            </Box>
          )}

          {/* Actions */}
          <Divider />
          <Stack spacing={0.5}>
            {contact.contactId && (
              <Link
                href={`/contacts/${contact.contactId}`}
                target="_blank"
                rel="noopener"
                sx={{
                  fontSize: '0.875rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  textDecoration: 'none',
                  color: 'primary.main',
                  '&:hover': {
                    textDecoration: 'underline',
                  },
                }}
              >
                <PersonIcon fontSize="small" />
                View Contact Profile
                <OpenInNewIcon fontSize="small" />
              </Link>
            )}
            {contact.userId && (
              <Link
                href={`/users/${contact.userId}`}
                target="_blank"
                rel="noopener"
                sx={{
                  fontSize: '0.875rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  textDecoration: 'none',
                  color: 'primary.main',
                  '&:hover': {
                    textDecoration: 'underline',
                  },
                }}
              >
                <PersonIcon fontSize="small" />
                View User Profile
                <OpenInNewIcon fontSize="small" />
              </Link>
            )}
            {!isLinked && (
              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                Not linked to CRM or system user
              </Typography>
            )}
          </Stack>
        </Stack>
      </Box>
    </Popover>
  );
};

export default ContactHoverCard;




