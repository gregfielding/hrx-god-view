/**
 * Bottom sheet drawer for worker UI (mobile-friendly).
 * Use for optional filters, quick actions, secondary content. Not for critical confirmations.
 * Animation: 180ms translateY(100%) → 0 with backdrop fade. See docs/WORKER_INTERACTION_SYSTEM.md §4.
 */

import React from 'react';
import { Drawer, Box, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

const BOTTOM_SHEET_DURATION_MS = 180;
const MOTION_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export interface WorkerBottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Min height when open (e.g. '40vh'). Default 40vh. */
  minHeight?: string;
}

const WorkerBottomSheet: React.FC<WorkerBottomSheetProps> = ({
  open,
  onClose,
  title,
  children,
  minHeight = '40vh',
}) => {
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      transitionDuration={{ enter: BOTTOM_SHEET_DURATION_MS, exit: BOTTOM_SHEET_DURATION_MS }}
      PaperProps={{
        sx: {
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          minHeight,
          maxHeight: '90vh',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.08)',
          paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
        },
      }}
      ModalProps={{
        keepMounted: true,
        slotProps: {
          backdrop: {
            sx: {
              backgroundColor: 'rgba(0,0,0,0.3)',
              transition: `opacity ${BOTTOM_SHEET_DURATION_MS}ms ${MOTION_EASING}`,
            },
          },
        },
      }}
    >
      {/* Drag handle */}
      <Box
        sx={{
          pt: 1.5,
          pb: 0.5,
          display: 'flex',
          justifyContent: 'center',
          cursor: 'grab',
          '&:active': { cursor: 'grabbing' },
        }}
        onClick={onClose}
        aria-hidden
      >
        <Box
          sx={{
            width: 40,
            height: 4,
            borderRadius: 2,
            bgcolor: 'grey.300',
          }}
        />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, pb: 1 }}>
        {title ? (
          <Typography variant="h6" sx={{ fontWeight: 600, fontSize: 18 }}>
            {title}
          </Typography>
        ) : (
          <span />
        )}
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', px: 2, pb: 2 }}>{children}</Box>
    </Drawer>
  );
};

export default WorkerBottomSheet;
