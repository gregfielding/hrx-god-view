/**
 * Stacked review layout for I-9 supporting documents inside the staff drawer (not used on the full page table).
 */
import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

/** Classify uploaded file for inline preview (browser-safe). */
export function classifyUploadedFileForPreview(
  contentType: string | null | undefined,
  fileName: string | null | undefined,
): 'pdf' | 'image' | 'heic' | 'unsupported' {
  const ct = (contentType || '').toLowerCase().trim();
  const fn = (fileName || '').toLowerCase().trim();
  if (ct.includes('pdf') || fn.endsWith('.pdf')) return 'pdf';
  if (ct.includes('heic') || ct.includes('heif') || fn.endsWith('.heic') || fn.endsWith('.heif')) return 'heic';
  if (ct.startsWith('image/')) {
    if (ct.includes('heic') || ct.includes('heif')) return 'heic';
    return 'image';
  }
  if (/\.(jpe?g|png|gif|webp)$/i.test(fn)) return 'image';
  return 'unsupported';
}

export function InlineDocumentPreviewBlock(props: {
  category: 'pdf' | 'image' | 'heic' | 'unsupported';
  signedUrl: string | null;
  loading: boolean;
  fileLabel: string;
  /** MIME type / extension hint for compact copy (e.g. HEIC). */
  mimeHint?: string;
  onOpenFull: () => void;
  onRetry?: () => void;
}): React.ReactElement {
  const { category, signedUrl, loading, fileLabel, mimeHint, onOpenFull, onRetry } = props;

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: { xs: 280, sm: 360 },
          bgcolor: 'action.hover',
          borderRadius: 2,
          border: '1px dashed',
          borderColor: 'divider',
        }}
      >
        <CircularProgress size={36} />
      </Box>
    );
  }

  if (category === 'heic' || category === 'unsupported') {
    return (
      <Stack spacing={1.5}>
        <Paper
          variant="outlined"
          sx={{
            borderRadius: 2,
            overflow: 'hidden',
            bgcolor: 'grey.50',
            minHeight: { xs: 200, sm: 240 },
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, textAlign: 'center' }}>
            {category === 'heic'
              ? 'HEIC / HEIF previews are not shown in the browser.'
              : 'Inline preview is not available for this file type.'}
          </Typography>
        </Paper>
        <Alert severity="warning" variant="outlined" sx={{ py: 1 }}>
          <Typography variant="body2" component="div" sx={{ fontWeight: 600, mb: 0.5 }}>
            {category === 'heic' ? 'HEIC / HEIF — no inline preview' : 'Preview unavailable'}
          </Typography>
          {mimeHint ? (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
              File type: {mimeHint}
            </Typography>
          ) : null}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Open the file in a new tab to review it. If the worker can, ask them to re-upload as PDF or JPG for easier
            review next time.
          </Typography>
          <Button size="small" variant="contained" startIcon={<OpenInNewIcon />} onClick={onOpenFull}>
            Open file
          </Button>
        </Alert>
      </Stack>
    );
  }

  if (!signedUrl) {
    return (
      <Box
        sx={{
          minHeight: { xs: 200, sm: 280 },
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'action.hover',
          borderRadius: 2,
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Preview could not be loaded. Use Open file.
        </Typography>
        {onRetry ? (
          <Button size="small" sx={{ ml: 1 }} onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </Box>
    );
  }

  if (category === 'pdf') {
    return (
      <Box
        sx={{
          borderRadius: 2,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'grey.900',
          height: { xs: 400, sm: 480, md: 520 },
          maxHeight: '55vh',
          width: '100%',
          minWidth: 0,
          maxWidth: '100%',
        }}
      >
        <iframe
          title={fileLabel || 'Document preview'}
          src={signedUrl}
          style={{
            width: '100%',
            height: '100%',
            border: 0,
            display: 'block',
            maxWidth: '100%',
          }}
        />
      </Box>
    );
  }

  // image (e.g. image/jpeg, image/png)
  return (
    <Box
      onClick={onOpenFull}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpenFull();
      }}
      sx={{
        borderRadius: 2,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'grey.100',
        cursor: 'pointer',
        maxHeight: { xs: 420, sm: 520 },
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      <Box
        component="img"
        src={signedUrl}
        alt=""
        sx={{
          maxWidth: '100%',
          maxHeight: { xs: 420, sm: 520 },
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
          display: 'block',
        }}
      />
    </Box>
  );
}
