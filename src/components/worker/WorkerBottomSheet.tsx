import React from 'react';
import {
  Box,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { t } from '../../i18n';

interface WorkerBottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const WorkerBottomSheet: React.FC<WorkerBottomSheetProps> = ({
  open,
  title,
  onClose,
  children,
  footer,
}) => {
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      // Sit ABOVE the worker nav drawer (z 1301) and the mobile hamburger
      // (z 1400) — on desktop the permanent sidebar was covering the left
      // edge of this sheet (incl. the Cancel button). 1402 clears both.
      sx={{ zIndex: 1402 }}
      PaperProps={{
        sx: {
          // Anchor explicitly + clamp width so a stray min-width child can never push the sheet
          // off-screen horizontally on small mobile viewports (was clipping the Confirm/Cancel
          // buttons for some workers).
          left: 0,
          right: 0,
          width: '100%',
          maxWidth: '100vw',
          boxSizing: 'border-box',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          // 100dvh keeps the footer visible on iOS Safari when the URL bar is showing; vh
          // would let it slip below the live viewport.
          maxHeight: '88dvh',
          // Vertical scroll lives on the body Box below; clamp horizontal here so wide
          // children (long location strings, checkbox labels) wrap instead of overflowing.
          overflowX: 'hidden',
          overflowY: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Box sx={{ px: 2, pt: 1.5, width: '100%', boxSizing: 'border-box', flexShrink: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
          <Box
            sx={{
              width: 40,
              height: 4,
              borderRadius: 999,
              bgcolor: 'grey.400',
            }}
          />
        </Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Typography variant="h6" sx={{ fontWeight: 700, minWidth: 0, wordBreak: 'break-word' }}>
            {title}
          </Typography>
          <IconButton aria-label={t('common.close')} onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Stack>
      </Box>

      <Box
        sx={{
          px: 2,
          pb: 2,
          width: '100%',
          boxSizing: 'border-box',
          overflowX: 'hidden',
          overflowY: 'auto',
          flex: 1,
          minHeight: 0,
        }}
      >
        {children}
      </Box>

      {footer ? (
        <Box
          sx={{
            px: 2,
            pt: 1.5,
            // Reserve space for the iOS home indicator / Android nav bar so the buttons stay
            // tappable inside a PWA. Falls back to 12px on browsers without env() support.
            pb: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
            width: '100%',
            boxSizing: 'border-box',
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            flexShrink: 0,
          }}
        >
          {footer}
        </Box>
      ) : null}
    </Drawer>
  );
};

export default WorkerBottomSheet;
