/**
 * BulkImportFileDropzone — drag-and-drop CSV input for the Bulk
 * Import flow (BI.1.P1).
 *
 * Phase 1 scaffolding only:
 *   - Accepts a single CSV via drag/drop or click-to-browse.
 *   - Captures the File object + an sha256 checksum and bubbles them
 *     to the parent (later parsing pipeline lands in P2 with
 *     `parseAndPreviewBulkInvite`).
 *   - No CSV parsing, no schema validation, no rows previewed yet.
 *   - Reset button lets the recruiter swap files before P2 ships.
 *
 * Visual rules (per BULK_INVITE_PLAN.md §3.2 step 3):
 *   - Empty dashed dropzone with subdued helper text.
 *   - Active drag state highlights the border + background.
 *   - Selected file shows name + size + checksum prefix + reset
 *     affordance.
 *
 * The dropzone is tenant-agnostic — it doesn't care which entity
 * owns the file. The parent (`BulkImportNewTab`) gates the dropzone
 * behind a chosen entity so the recruiter can't drop a file before
 * scope is selected.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MiB hard cap (P2 will refine)

export interface SelectedBulkImportFile {
  file: File;
  /** Hex SHA-256 of the file bytes; will be persisted on the future job doc. */
  checksum: string;
}

export interface BulkImportFileDropzoneProps {
  disabled?: boolean;
  onSelected?: (selection: SelectedBulkImportFile | null) => void;
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const BulkImportFileDropzone: React.FC<BulkImportFileDropzoneProps> = ({
  disabled,
  onSelected,
}) => {
  const theme = useTheme();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [hashing, setHashing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedBulkImportFile | null>(null);

  useEffect(() => {
    onSelected?.(selected);
  }, [selected, onSelected]);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    setError(null);

    if (file.size > MAX_BYTES) {
      setError(`File is too large (${formatBytes(file.size)}). Limit is ${formatBytes(MAX_BYTES)}.`);
      return;
    }
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.csv')) {
      setError('File must be a .csv export.');
      return;
    }

    try {
      setHashing(true);
      const checksum = await sha256Hex(file);
      setSelected({ file, checksum });
    } catch (err) {
      setError('Failed to read file. Try again or pick a different file.');
    } finally {
      setHashing(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      if (disabled || hashing) return;
      void handleFiles(event.dataTransfer.files);
    },
    [disabled, hashing, handleFiles],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (disabled || hashing) return;
      setIsDragOver(true);
    },
    [disabled, hashing],
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragOver(false);
    },
    [],
  );

  const handleClickToBrowse = useCallback(() => {
    if (disabled || hashing) return;
    inputRef.current?.click();
  }, [disabled, hashing]);

  const handleReset = useCallback(() => {
    setSelected(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const dropzoneActive = !disabled && !hashing;
  const dropzoneBorder = isDragOver
    ? theme.palette.primary.main
    : selected
    ? theme.palette.success.main
    : alpha(theme.palette.text.primary, 0.2);
  const dropzoneBackground = isDragOver
    ? alpha(theme.palette.primary.main, 0.06)
    : 'transparent';

  return (
    <Stack spacing={1.5}>
      <Box
        role="button"
        tabIndex={dropzoneActive ? 0 : -1}
        aria-disabled={!dropzoneActive}
        onClick={handleClickToBrowse}
        onKeyDown={(e) => {
          if (!dropzoneActive) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClickToBrowse();
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        sx={{
          border: `2px dashed ${dropzoneBorder}`,
          borderRadius: 1.5,
          p: 4,
          textAlign: 'center',
          bgcolor: dropzoneBackground,
          cursor: dropzoneActive ? 'pointer' : 'not-allowed',
          opacity: dropzoneActive ? 1 : 0.55,
          transition:
            'border-color 120ms ease-out, background-color 120ms ease-out',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            void handleFiles(e.target.files);
          }}
        />
        <Stack alignItems="center" spacing={1.5}>
          {hashing ? (
            <CircularProgress size={28} />
          ) : (
            <CloudUploadIcon
              sx={{ fontSize: 36, color: alpha(theme.palette.text.primary, 0.45) }}
            />
          )}
          <Box>
            <Typography variant="body1" sx={{ fontWeight: 500 }}>
              {selected ? selected.file.name : 'Drag CSV here, or click to browse'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {selected
                ? `${formatBytes(selected.file.size)} · sha-256 ${selected.checksum.slice(0, 12)}…`
                : 'One file per entity, up to ~5,000 rows. CSV only.'}
            </Typography>
          </Box>
          {selected && (
            <Button
              size="small"
              variant="text"
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
            >
              Choose a different file
            </Button>
          )}
        </Stack>
      </Box>

      {error && (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      )}
    </Stack>
  );
};

export default BulkImportFileDropzone;
