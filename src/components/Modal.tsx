import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  fullWidth?: boolean;
  showCloseButton?: boolean;
  variant?: 'default' | 'compact';
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  children,
  actions,
  maxWidth = 'md',
  fullWidth = true,
  showCloseButton = true,
  variant = 'default'
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      PaperProps={{
        sx: {
          borderRadius: 16,
          border: '1px solid rgba(0,0,0,.08)',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15)',
          overflow: 'hidden'
        }
      }}
      BackdropProps={{
        sx: {
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(4px)'
        }
      }}
    >
      <DialogTitle
        sx={{
          p: variant === 'compact' ? 2 : 3,
          pb: variant === 'compact' ? 1 : 2,
          borderBottom: '1px solid rgba(0,0,0,.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2
        }}
      >
        <Typography
          variant="h6"
          sx={{
            fontWeight: 600,
            color: '#0B0D12',
            flex: 1
          }}
        >
          {title}
        </Typography>
        
        {showCloseButton && (
          <IconButton
            onClick={onClose}
            sx={{
              color: '#8B94A3',
              '&:hover': {
                backgroundColor: '#F7F9FC',
                color: '#4A90E2'
              }
            }}
          >
            <CloseIcon />
          </IconButton>
        )}
      </DialogTitle>
      
      <DialogContent
        sx={{
          p: variant === 'compact' ? 2 : 3,
          '&:first-of-type': {
            pt: variant === 'compact' ? 2 : 3
          }
        }}
      >
        {children}
      </DialogContent>
      
      {actions && (
        <DialogActions
          sx={{
            p: variant === 'compact' ? 2 : 3,
            pt: variant === 'compact' ? 1 : 2,
            borderTop: '1px solid rgba(0,0,0,.06)',
            gap: 1,
            justifyContent: 'flex-end'
          }}
        >
          {actions}
        </DialogActions>
      )}
    </Dialog>
  );
};

// Convenience component for confirmation dialogs
interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'info'
}) => {
  const getVariantColors = () => {
    switch (variant) {
      case 'danger':
        return { bg: '#FDECEC', color: '#D14343' };
      case 'warning':
        return { bg: '#FFF7E6', color: '#B88207' };
      default:
        return { bg: '#E8F3FC', color: '#1F6FC9' };
    }
  };

  const colors = getVariantColors();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="sm"
    >
      <Box sx={{ mb: 2 }}>
        <Typography variant="body1" sx={{ color: '#5A6372', lineHeight: 1.6 }}>
          {message}
        </Typography>
      </Box>
      
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <Button
          variant="outlined"
          onClick={onClose}
          sx={{
            borderRadius: 999,
            px: 3
          }}
        >
          {cancelText}
        </Button>
        
        <Button
          variant="contained"
          onClick={onConfirm}
          sx={{
            borderRadius: 999,
            px: 3,
            backgroundColor: colors.color,
            '&:hover': {
              backgroundColor: variant === 'danger' ? '#B91C1C' : 
                           variant === 'warning' ? '#A16207' : '#1F6FC9'
            }
          }}
        >
          {confirmText}
        </Button>
      </Box>
    </Modal>
  );
};
