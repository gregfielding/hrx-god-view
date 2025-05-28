// src/components/Toast.tsx
import React from 'react';
import { Snackbar, Alert } from '@mui/material';

type ToastProps = {
  open: boolean;
  onClose: () => void;
  severity?: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
};

const Toast: React.FC<ToastProps> = ({
  open,
  onClose,
  severity = 'info',
  message,
  duration = 3000,
}) => {
  return (
    <Snackbar
      open={open}
      autoHideDuration={duration}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert onClose={onClose} severity={severity} sx={{ width: '100%' }}>
        {message}
      </Alert>
    </Snackbar>
  );
};

export default Toast;
