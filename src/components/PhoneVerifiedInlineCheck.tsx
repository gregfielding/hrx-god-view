import React from 'react';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { Tooltip } from '@mui/material';

/** Small green check between formatted phone and copy — Twilio / `phoneVerified` on user doc. */
export function PhoneVerifiedInlineCheck({ verified }: { verified: boolean }) {
  if (!verified) return null;
  return (
    <Tooltip title="Phone verified" arrow placement="top">
      <CheckCircleIcon
        sx={{ fontSize: 14, color: 'success.main', flexShrink: 0 }}
        aria-label="Phone verified"
      />
    </Tooltip>
  );
}
