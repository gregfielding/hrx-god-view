import React from 'react';
import { Alert, ButtonBase, Typography } from '@mui/material';

export interface ProfileTabPointerAlertProps {
  message: string;
  onNavigate: () => void;
  'data-testid'?: string;
}

/**
 * Compact inline pointer for mobile (full-width tap) and desktop.
 */
const ProfileTabPointerAlert: React.FC<ProfileTabPointerAlertProps> = ({ message, onNavigate, 'data-testid': testId }) => (
  <Alert
    severity="info"
    variant="outlined"
    icon={false}
    data-testid={testId}
    sx={{
      py: 0.75,
      alignItems: 'stretch',
      '& .MuiAlert-message': { width: '100%', padding: 0 },
    }}
  >
    <ButtonBase
      onClick={onNavigate}
      focusRipple
      sx={{
        width: '100%',
        justifyContent: 'flex-start',
        textAlign: 'left',
        display: 'block',
        borderRadius: 1,
        px: 0.5,
        py: 0.25,
      }}
    >
      <Typography variant="body2" component="span" sx={{ lineHeight: 1.45 }}>
        {message}
      </Typography>
    </ButtonBase>
  </Alert>
);

export default ProfileTabPointerAlert;
