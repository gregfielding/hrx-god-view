import React, { useCallback, useMemo, useState } from 'react';
import Cropper from 'react-easy-crop';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Slider,
  Typography,
} from '@mui/material';

import { getCroppedBlobFromImageSrc } from '../../utils/cropImage';

type CropArea = { x: number; y: number; width: number; height: number };

export type ImageCropDialogProps = {
  open: boolean;
  title?: string;
  imageSrc: string | null;
  aspect?: number;
  cropShape?: 'rect' | 'round';
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (blob: Blob) => Promise<void> | void;
  loading?: boolean;
};

const ImageCropDialog: React.FC<ImageCropDialogProps> = ({
  open,
  title = 'Crop image',
  imageSrc,
  aspect = 1,
  cropShape = 'round',
  confirmLabel = 'Save',
  onCancel,
  onConfirm,
  loading = false,
}) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<CropArea | null>(null);
  const [saving, setSaving] = useState(false);

  const effectiveLoading = loading || saving;

  const onCropComplete = useCallback((_: any, croppedArea: CropArea) => {
    setCroppedAreaPixels(croppedArea);
  }, []);

  const canSave = useMemo(() => !!imageSrc && !!croppedAreaPixels && !effectiveLoading, [imageSrc, croppedAreaPixels, effectiveLoading]);

  const handleSave = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setSaving(true);
    try {
      const blob = await getCroppedBlobFromImageSrc(imageSrc, croppedAreaPixels, 'image/jpeg', 0.9);
      await onConfirm(blob);
    } finally {
      setSaving(false);
    }
  }, [imageSrc, croppedAreaPixels, onConfirm]);

  return (
    <Dialog open={open} onClose={effectiveLoading ? undefined : onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            height: 360,
            bgcolor: 'grey.900',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              cropShape={cropShape}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              showGrid={false}
            />
          )}
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Zoom
          </Typography>
          <Slider
            value={zoom}
            min={1}
            max={3}
            step={0.05}
            onChange={(_, v) => setZoom(v as number)}
            disabled={effectiveLoading}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={effectiveLoading}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={!canSave}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ImageCropDialog;

