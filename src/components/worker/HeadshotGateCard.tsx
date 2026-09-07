/**
 * Inline photo uploader shown when the Accept-shift headshot gate blocks a
 * worker (`HEADSHOT_MISSING` / `HEADSHOT_REJECTED`). Lives on the surfaces that
 * call `respondToAssignment` — first the SMS one-click accept page — so the
 * worker can add a photo and finish accepting without leaving the page.
 *
 * Why this exists: the gate was pulled in June 2026 because the SMS link
 * surfaced a bare error with no way forward. Re-arming it (2026-09-06) is only
 * safe because this card turns the dead end into a two-tap fix.
 *
 * Writes the same shape as the profile page uploader
 * (`WorkerBasicIdentityCard`): Storage `avatars/{uid}.jpg` (overwrite), then
 * `users/{uid}.avatar` + `workerProfile.photoUrl`. The Vision verifier keys on
 * `avatar`. Flutter parity: `headshot_gate_bottom_sheet.dart` →
 * `HeadshotCaptureScreen`.
 */
import React, { useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { PhotoCamera, Upload } from '@mui/icons-material';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, storage } from '../../firebase';
import { useT } from '../../i18n';
import {
  formatHeadshotGateError,
  type FormattedHeadshotGateError,
} from '../../utils/avatarVerification/formatHeadshotGateError';
import { downscaleImage } from '../../utils/downscaleImage';

interface Props {
  uid: string;
  gate: FormattedHeadshotGateError;
  /** Called with the new download URL once Firestore has the photo. */
  onUploaded: (url: string) => void;
  onDismiss?: () => void;
}

// Pre-downscale cap only — the file is shrunk to a ≤1280px JPEG before
// upload (see utils/downscaleImage). The old 5 MB cap refused phone photos
// and large PNGs outright ("Image must be smaller than 5MB") and the photo
// never reached Storage — Greg's first Claim Shift test, 2026-09-06.
const MAX_BYTES = 25 * 1024 * 1024;

/** Reasons the Accept/Claim gate blocks on (mirror of HEADSHOT_BLOCKING_REJECTION_REASONS). */
const BLOCKING_REASONS = new Set(['no_face', 'multiple_faces', 'inappropriate', 'manual_override']);

const HeadshotGateCard: React.FC<Props> = ({ uid, gate, onUploaded, onDismiss }) => {
  const t = useT();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t('apply.pleaseSelectImage'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('apply.imageTooLarge'));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const blob = await downscaleImage(file);
      const target = storageRef(storage, `avatars/${uid}.jpg`);
      await uploadBytes(target, blob, { contentType: blob.type || 'image/jpeg' });
      const url = await getDownloadURL(target);
      await updateDoc(doc(db, 'users', uid), {
        avatar: url,
        'workerProfile.photoUrl': url,
        updatedAt: serverTimestamp(),
      });
      // Force a fresh verdict on THIS file and wait for it. The user-doc
      // trigger only re-verifies when the avatar URL string changes, and an
      // overwrite of the same storage path can hand back the same URL —
      // leaving the previous photo's rejection glued to the new picture.
      // reverifyAvatar allows self-calls and returns the decision inline.
      try {
        const reverify = httpsCallable(functions, 'reverifyAvatar');
        const res = await reverify({ userId: uid });
        const verdict = (res.data || {}) as { status?: string; rejectionReason?: string | null };
        if (verdict.status === 'rejected' && verdict.rejectionReason && BLOCKING_REASONS.has(verdict.rejectionReason)) {
          const formatted = formatHeadshotGateError({
            code: 'functions/failed-precondition',
            details: { code: 'HEADSHOT_REJECTED', status: 'rejected', rejectionReason: verdict.rejectionReason },
          });
          setError(formatted?.message || t('apply.failedToUploadImage'));
          return;
        }
      } catch (verifyErr) {
        // Verification hiccup is not an upload failure — the server gate
        // lets pending / errored records through, so continue.
        console.warn('[HeadshotGateCard] reverify failed (continuing)', verifyErr);
      }
      onUploaded(url);
    } catch (err) {
      console.error('[HeadshotGateCard] upload failed', err);
      const code = (err as { code?: string })?.code ? ` (${(err as { code?: string }).code})` : '';
      setError(`${t('apply.failedToUploadImage')}${code}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Alert
      severity={gate.code === 'HEADSHOT_REJECTED' ? 'warning' : 'info'}
      icon={<PhotoCamera />}
      onClose={onDismiss}
      sx={{ mb: 2, '& .MuiAlert-message': { width: '100%' } }}
    >
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {t('apply.headshotTitle')}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1.5 }}>
        {gate.message}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button
          variant="contained"
          startIcon={<PhotoCamera />}
          onClick={() => cameraRef.current?.click()}
          disabled={uploading}
        >
          {t('apply.takePhoto')}
        </Button>
        <Button
          variant="outlined"
          startIcon={<Upload />}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {t('apply.uploadPhoto')}
        </Button>
        {uploading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2">{t('avatarVerification.checkingFull')}</Typography>
          </Box>
        )}
      </Stack>
      {error && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
          {error}
        </Typography>
      )}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="user"
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </Alert>
  );
};

export default HeadshotGateCard;
