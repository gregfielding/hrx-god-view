import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Chip,
  Link,
  Divider,
  Stack,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import VerifiedIcon from '@mui/icons-material/Verified';

interface Certification {
  name: string;
  issuer?: string;
  dateObtained?: string;
  expirationDate?: string;
  fileUrl?: string;
  fileName?: string;
  uploadedAt?: Date;
}

interface CertificationsModalProps {
  open: boolean;
  onClose: () => void;
  certifications: Certification[];
}

const CertificationsModal: React.FC<CertificationsModalProps> = ({
  open,
  onClose,
  certifications,
}) => {
  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    try {
      const d = date instanceof Date ? date : date?.toDate ? date.toDate() : new Date(date);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return 'N/A';
    }
  };

  const isExpired = (expirationDate?: string) => {
    if (!expirationDate) return false;
    try {
      const expDate = new Date(expirationDate);
      return expDate < new Date();
    } catch {
      return false;
    }
  };

  const isExpiringSoon = (expirationDate?: string) => {
    if (!expirationDate) return false;
    try {
      const expDate = new Date(expirationDate);
      const today = new Date();
      const daysUntilExpiry = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return daysUntilExpiry > 0 && daysUntilExpiry <= 30;
    } catch {
      return false;
    }
  };

  const handleDownload = (cert: Certification) => {
    if (cert.fileUrl) {
      window.open(cert.fileUrl, '_blank');
    }
  };

  if (certifications.length === 0) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <VerifiedIcon color="primary" />
              <Typography variant="h6">Certifications & Licenses</Typography>
            </Box>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <VerifiedIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
            <Typography variant="body1" color="text.secondary">
              No certifications or licenses on file
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <VerifiedIcon color="primary" />
            <Typography variant="h6">
              Certifications & Licenses ({certifications.length})
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <List>
          {certifications.map((cert, index) => {
            const expired = isExpired(cert.expirationDate);
            const expiringSoon = isExpiringSoon(cert.expirationDate);
            
            return (
              <React.Fragment key={index}>
                <ListItem
                  sx={{
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    py: 2,
                  }}
                >
                  <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {cert.name}
                      </Typography>
                      {expired && (
                        <Chip
                          label="Expired"
                          size="small"
                          color="error"
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      )}
                      {expiringSoon && !expired && (
                        <Chip
                          label="Expiring Soon"
                          size="small"
                          color="warning"
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      )}
                    </Box>
                    {cert.fileUrl && (
                      <IconButton
                        size="small"
                        onClick={() => handleDownload(cert)}
                        sx={{ ml: 1 }}
                      >
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                  <Stack spacing={0.5} sx={{ width: '100%', pl: 1 }}>
                    {cert.issuer && (
                      <Typography variant="body2" color="text.secondary">
                        <strong>Issuer:</strong> {cert.issuer}
                      </Typography>
                    )}
                    {cert.dateObtained && (
                      <Typography variant="body2" color="text.secondary">
                        <strong>Date Obtained:</strong> {formatDate(cert.dateObtained)}
                      </Typography>
                    )}
                    {cert.expirationDate && (
                      <Typography 
                        variant="body2" 
                        color={expired ? 'error.main' : expiringSoon ? 'warning.main' : 'text.secondary'}
                      >
                        <strong>Expiration Date:</strong> {formatDate(cert.expirationDate)}
                        {expired && ' (Expired)'}
                        {expiringSoon && !expired && ' (Expiring Soon)'}
                      </Typography>
                    )}
                    {cert.fileName && (
                      <Typography variant="caption" color="text.secondary">
                        File: {cert.fileName}
                      </Typography>
                    )}
                  </Stack>
                </ListItem>
                {index < certifications.length - 1 && <Divider />}
              </React.Fragment>
            );
          })}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default CertificationsModal;

