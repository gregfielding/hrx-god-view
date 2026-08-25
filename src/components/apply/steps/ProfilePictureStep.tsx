import React, { useState, useRef } from 'react';
import { Box, Button, Typography, Avatar, CircularProgress, Alert, Paper, useTheme, useMediaQuery, Stack } from '@mui/material';
import { PhotoCamera, Upload, Delete } from '@mui/icons-material';
import { uploadBytes, ref as storageRef, getDownloadURL } from 'firebase/storage';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, storage } from '../../../firebase';
import { useT } from '../../../i18n';
import AvatarVerificationStatus from '../../avatar/AvatarVerificationStatus';
import { useAvatarVerification } from '../../../hooks/useAvatarVerification';

interface Props {
  value: {
    profilePicture?: string;
  };
  onChange: (value: { profilePicture?: string }) => void;
  /**
   * When provided, the step writes `users/{userId}.avatar = downloadURL` immediately on
   * upload so the Cloud Function headshot verifier (`onUserAvatarChangedVerify`) can run
   * and the worker sees live quality feedback before continuing. Without it, the wizard
   * still persists the avatar on step-exit, so verification just runs a step later.
   */
  userId?: string;
}

const ProfilePictureStep: React.FC<Props> = ({ value, onChange, userId }) => {
  const t = useT();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Subscribe to Firestore-side verification. No-op when userId is absent (e.g. early
  // wizard steps where auth has not yet attached a uid).
  const { verification, isPending, loading: verificationLoading } = useAvatarVerification(userId);

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

      // Persist to the user doc right away if we know the uid — this triggers the Cloud
      // Function headshot verifier so the user sees live quality feedback on THIS step.
      // The wizard still does its own authoritative write on step-exit; duplicate merge
      // writes are harmless and the verifier dedupes via an avatar-URL echo check.
      if (userId) {
        try {
          await setDoc(
            doc(db, 'users', userId),
            { avatar: downloadURL, updatedAt: serverTimestamp() },
            { merge: true },
          );
        } catch (persistErr) {
          // Non-fatal: the wizard will re-attempt the write on Next. Log and continue so
          // the upload itself still appears successful.
          console.warn('ProfilePictureStep: failed to persist avatar for live verification', persistErr);
        }
      }
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

  // Retake CTA target. Cameras are preferred on mobile; desktop falls through to file picker.
  const handleRetake = () => {
    if (isMobile) handleTakePhoto();
    else handleUploadPhoto();
  };

  // Show verification UI only when we've actually persisted the current picture, i.e. the
  // Firestore user doc has the matching avatar URL. Without a userId we can't subscribe,
  // so verification feedback only shows up once the wizard writes the field (next step).
  const showVerificationUi = Boolean(userId && value.profilePicture);

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        {t('apply.headshotTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('apply.headshotSubtitle')}
      </Typography>

      {/* Current Headshot */}
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
          {showVerificationUi && (
            <Box sx={{ mb: 2 }}>
              <AvatarVerificationStatus
                verification={verification}
                isPending={isPending || uploading}
                loading={verificationLoading}
                onRetake={handleRetake}
                audience="worker"
              />
            </Box>
          )}
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
      <Box>
        {/* Quieter than the nav CTA on purpose — Submit/Next stays the loudest
            action on the screen (Greg 2026-08-25). */}
        <Stack spacing={1} sx={{ maxWidth: 240, mx: 'auto', mt: 1 }}>
          <Button
            variant="contained"
            startIcon={<PhotoCamera />}
            onClick={handleTakePhoto}
            disabled={uploading}
            fullWidth
          >
            {t('apply.takePhoto')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<Upload />}
            onClick={handleUploadPhoto}
            disabled={uploading}
            fullWidth
          >
            {t('apply.uploadPhoto')}
          </Button>
        </Stack>

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
          // `user` opens the front-facing camera on mobile — the right default for a
          // headshot (a selfie, not a rear-camera scene).
          capture="user"
          style={{ display: 'none' }}
        />
      </Box>

      {/* The Accept-shift gate later enforces a verified headshot when it matters. */}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        {t('apply.headshotLaterHint')}
      </Typography>
    </Box>
  );
};

export default ProfilePictureStep;
