/**
 * Canonical sub-page header for worker screens (worker-app redesign,
 * Greg 2026-08-23): back arrow + h5 title in a row, optional body2
 * description below. Top-level tab pages (Home / Find Shifts / Schedule /
 * Earnings / Profile) use a plain h5 with no back — this header is for
 * every screen one level down. The arrow is an IconButton for the 44px
 * tap target; `edge="start"` + ml keeps the glyph on the content edge.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, IconButton, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useT } from '../../i18n';

interface WorkerPageHeaderProps {
  title: React.ReactNode;
  /** Route for the back arrow. Omit to use history back. */
  backTo?: string;
  description?: React.ReactNode;
  /** Right-aligned slot (e.g. a "mark all read" text button). */
  action?: React.ReactNode;
}

const WorkerPageHeader: React.FC<WorkerPageHeaderProps> = ({
  title,
  backTo,
  description,
  action,
}) => {
  const navigate = useNavigate();
  const t = useT();
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <IconButton
          aria-label={t('common.back')}
          edge="start"
          onClick={() => (backTo ? navigate(backTo) : navigate(-1))}
          sx={{ color: 'text.secondary', ml: -1 }}
        >
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" component="h1" sx={{ flexGrow: 1, minWidth: 0 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {description ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {description}
        </Typography>
      ) : null}
    </Box>
  );
};

export default WorkerPageHeader;
