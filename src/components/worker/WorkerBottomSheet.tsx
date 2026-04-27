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
      PaperProps={{
        sx: {
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          maxHeight: '88vh',
          overflow: 'hidden',
        },
      }}
    >
      <Box sx={{ px: 2, pt: 1.5 }}>
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
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          <IconButton aria-label={t('common.close')} onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Stack>
      </Box>

      <Box sx={{ px: 2, pb: 2, overflowY: 'auto', flex: 1 }}>
        {children}
      </Box>

      {footer ? (
        <Box
          sx={{
            px: 2,
            py: 1.5,
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          {footer}
        </Box>
      ) : null}
    </Drawer>
  );
};

export default WorkerBottomSheet;
