import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Stack,
  Button,
  Alert,
} from '@mui/material';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../../firebase';
import { useT } from '../../../i18n';

type Props = {
  value: any;
  onChange: (v: any) => void;
  jobPosting?: any;
  titleOverride?: string;
  subtitleOverride?: string;
  /** When true (e.g. admin/Qualifications edit), show only the textarea + save — no section chrome. */
  compact?: boolean;
  /** Hide caption / heading / info alert (parent already shows section title). */
  hideIntro?: boolean;
  /** Firestore `users/{id}` to update. Defaults to signed-in user (worker / apply wizard). */
  profileUserId?: string;
};

const BioStep: React.FC<Props> = ({
  value,
  onChange,
  titleOverride,
  subtitleOverride,
  compact,
  hideIntro = false,
  profileUserId,
}) => {
  const t = useT();
  const [bio, setBio] = useState<string>(value?.professionalBio || value?.bio || '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    const next = String(value?.professionalBio ?? value?.bio ?? '');
    setBio(next);
  }, [value?.professionalBio, value?.bio]);

  const handleBioChange = (newBio: string) => {
    setBio(newBio);
    onChange({ ...value, professionalBio: newBio, bio: newBio });
    setSaveError(null);
    setJustSaved(false);
  };

  const handleSave = async () => {
    const uid = profileUserId || auth.currentUser?.uid;
    if (!uid) {
      setSaveError(t('profile.signInToComplete'));
      return;
    }
    const trimmed = bio.trim();
    setSaving(true);
    setSaveError(null);
    setJustSaved(false);
    try {
      await updateDoc(doc(db, 'users', uid), {
        professionalBio: trimmed,
        bio: trimmed,
        updatedAt: serverTimestamp(),
      });
      onChange({ ...value, professionalBio: trimmed, bio: trimmed });
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 4000);
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : t('profile.unableToSaveBio')
      );
    } finally {
      setSaving(false);
    }
  };

  const saveLabel = t('profile.saveBio');
  const saveVerb = t('common.save');

  const actions = (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: compact ? 1.5 : 2 }}>
      <Button variant="contained" size={compact ? 'small' : 'medium'} onClick={() => void handleSave()} disabled={saving}>
        {compact ? saveVerb : saveLabel}
      </Button>
      {justSaved ? (
        <Typography variant="body2" color="success.main">
          {t('profile.bioSaved')}
        </Typography>
      ) : null}
    </Stack>
  );

  if (compact) {
    return (
      <Box>
        <TextField
          fullWidth
          multiline
          minRows={3}
          maxRows={8}
          value={bio}
          onChange={(e) => handleBioChange(e.target.value)}
          placeholder={t('profile.bioPlaceholderShort')}
        />
        {saveError ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {saveError}
          </Alert>
        ) : null}
        {actions}
      </Box>
    );
  }

  return (
    <Box>
      {!hideIntro ? (
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
            {t('apply.profileImprovementOptional') || 'Optional — helps recruiters get to know you'}
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            ✍️ {titleOverride || t('profile.tellUsAboutYourself') || 'Tell Us About Yourself'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {subtitleOverride || t('profile.bioOptional') || 'Optional — helps managers get to know you'}
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }} icon={false}>
            {t('apply.microcopyBio') || 'A short bio helps recruiters match you with the right roles.'}
          </Alert>
        </Box>
      ) : null}

      <TextField
        fullWidth
        multiline
        minRows={4}
        maxRows={12}
        value={bio}
        onChange={(e) => handleBioChange(e.target.value)}
        placeholder={t('profile.bioTextareaPlaceholder')}
      />

      {saveError ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {saveError}
        </Alert>
      ) : null}
      {actions}
    </Box>
  );
};

export default BioStep;
