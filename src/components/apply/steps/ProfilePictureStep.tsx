import React, { useState, useRef } from 'react';
import { Box, Button, Typography, Avatar, IconButton, CircularProgress, Alert, Paper, useTheme, useMediaQuery } from '@mui/material';
import { CameraAlt, PhotoCamera, Upload, Delete } from '@mui/icons-material';
import { uploadBytes, ref as storageRef, getDownloadURL } from 'firebase/storage';
import { storage } from '../../../firebase';
import { useT } from '../../../i18n';

interface Props {
  value: {
    profilePicture?: string;
  };
  onChange: (value: { profilePicture?: string }) => void;
}

const ProfilePictureStep: React.FC<Props> = ({ value, onChange }) => {
  const t = useT();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const handleFileSelect = (file: File) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError(t('apply.pleaseSelectImage'));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError(t('apply.imageTooLarge'));
      return;
    }

    uploadImage(file);
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    setError(null);

    try {
      // Create a unique filename
      const timestamp = Date.now();
      const fileName = `profile-pictures/${timestamp}-${file.name}`;
      const imageRef = storageRef(storage, fileName);

      // Upload the file
      const snapshot = await uploadBytes(imageRef, file);
      
      // Get the download URL
      const downloadURL = await getDownloadURL(snapshot.ref);
      
      // Update the form value
      onChange({ profilePicture: downloadURL });
    } catch (err) {
      console.error('Error uploading image:', err);
      setError(t('apply.failedToUploadImage'));
    } finally {
      setUploading(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleCameraInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleRemovePicture = () => {
    onChange({ profilePicture: undefined });
    setError(null);
  };

  const handleTakePhoto = () => {
    cameraInputRef.current?.click();
  };

  const handleUploadPhoto = () => {
    fileInputRef.current?.click();
  };

  return (
    <Box>
      <Typography
        variant="h6"
        gutterBottom
        sx={{ fontSize: isMobile ? '1rem' : undefined, fontWeight: isMobile ? 500 : undefined }}
      >
        {t('apply.profilePictureTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: isMobile ? 2 : 3 }}>
        {t('apply.profilePictureSubtext')}
      </Typography>
      {!value.profilePicture && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('apply.photoRequired')}
        </Alert>
      )}

      {/* Current Profile Picture */}
      {value.profilePicture && (
        <Paper
          elevation={isMobile ? 0 : 2}
          sx={{
            p: { xs: 2, md: 3 },
            mb: 3,
            textAlign: 'center',
            borderRadius: 2,
            border: isMobile ? '1px solid' : undefined,
            borderColor: isMobile ? 'divider' : undefined
          }}
        >
          <Typography variant="subtitle2" gutterBottom>
            {t('apply.currentProfilePicture')}
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            <Avatar
              src={value.profilePicture}
              sx={{ width: 120, height: 120 }}
            />
          </Box>
          <Button
            variant="outlined"
            color="error"
            startIcon={<Delete />}
            onClick={handleRemovePicture}
            size="small"
          >
            {t('apply.removePicture')}
          </Button>
        </Paper>
      )}

      {/* Upload Options */}
      <Paper
        elevation={isMobile ? 0 : 2}
        sx={{
          p: { xs: 2, md: 3 },
          borderRadius: 2,
          border: isMobile ? '1px solid' : undefined,
          borderColor: isMobile ? 'divider' : undefined
        }}
      >
        <Typography variant="subtitle2" gutterBottom>
          {value.profilePicture ? t('apply.updateProfilePicture') : t('apply.addProfilePicture')}
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
          {/* Take Photo Button */}
          <Button
            variant="contained"
            startIcon={<PhotoCamera />}
            onClick={handleTakePhoto}
            disabled={uploading}
            sx={{ minWidth: 150 }}
          >
            {t('apply.takePhoto')}
          </Button>

          {/* Upload Photo Button */}
          <Button
            variant="outlined"
            startIcon={<Upload />}
            onClick={handleUploadPhoto}
            disabled={uploading}
            sx={{ minWidth: 150 }}
          >
            {t('apply.uploadPhoto')}
          </Button>
        </Box>

        {/* Upload Progress */}
        {uploading && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mt: 2 }}>
            <CircularProgress size={20} sx={{ mr: 1 }} />
            <Typography variant="body2">Uploading...</Typography>
          </Box>
        )}

        {/* Error Message */}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {/* File Inputs (Hidden) */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          accept="image/*"
          style={{ display: 'none' }}
        />
        <input
          type="file"
          ref={cameraInputRef}
          onChange={handleCameraInputChange}
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
        />

        {/* Tips */}
        <Box sx={{ mt: 3, p: 2, backgroundColor: 'grey.50', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary">
            <strong>Tips for a great profile picture:</strong>
          </Typography>
          <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
            <li>Use a clear, well-lit photo</li>
            <li>Look professional and friendly</li>
            <li>Ensure your face is clearly visible</li>
            <li>Use a neutral or professional background</li>
          </ul>
        </Box>
      </Paper>
    </Box>
  );
};

export default ProfilePictureStep;
