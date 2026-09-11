import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';
import { RACE_ETHNICITY_CODES, SEX_CODES } from '../../../shared/illinoisAiHiring';

type Props = { open: boolean; onClose: () => void };

const pick = (codes: readonly string[], value: unknown): string =>
  typeof value === 'string' && codes.includes(value) ? value : '';

/**
 * Voluntary self-identification (Illinois AI-in-hiring, Greg 2026-09-10).
 * Answers live in eeo_self_identifications/{uid}, readable only by the worker
 * and HRX — never on the users doc recruiters see. This is separate from the
 * EEO fields removed from the apply wizard in W.3 (2026-04-29).
 * Flutter parity: VoluntarySelfIdScreen.
 */
const VoluntarySelfIdDialog: React.FC<Props> = ({ open, onClose }) => {
  const t = useT();
  const { user } = useAuth();
  const [race, setRace] = useState('');
  const [sex, setSex] = useState('');
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user?.uid) return;
    let cancelled = false;
    setLoading(true);
    setSaved(false);
    setError(null);
    getDoc(doc(db, 'eeo_self_identifications', user.uid))
      .then((snap) => {
        if (cancelled) return;
        const data = snap.data() ?? {};
        setExists(snap.exists());
        setRace(pick(RACE_ETHNICITY_CODES, data.raceEthnicity));
        setSex(pick(SEX_CODES, data.sex));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, user?.uid]);

  const save = async () => {
    if (!user?.uid) return;
    setSaving(true);
    setError(null);
    try {
      await setDoc(
        doc(db, 'eeo_self_identifications', user.uid),
        {
          uid: user.uid,
          raceEthnicity: race || null,
          sex: sex || null,
          version: 1,
          source: 'web',
          updatedAt: serverTimestamp(),
          ...(exists ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true },
      );
      setExists(true);
      setSaved(true);
    } catch (e) {
      const code = (e as { code?: string })?.code ?? 'unknown';
      setError(t('aiHiring.saveFailed', { code }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{t('aiHiring.selfIdCta')}</DialogTitle>
      <DialogContent>
        {!user?.uid ? (
          <Alert severity="info">{t('aiHiring.signInToRequest')}</Alert>
        ) : loading ? (
          <Stack alignItems="center" sx={{ py: 3 }}>
            <CircularProgress size={28} />
          </Stack>
        ) : (
          <Stack spacing={2.5} sx={{ pt: 0.5 }}>
            <Typography variant="body2">{t('aiHiring.selfIdIntro')}</Typography>
            <FormControl disabled={saving}>
              <FormLabel>{t('aiHiring.raceLabel')}</FormLabel>
              <RadioGroup value={race} onChange={(e) => setRace(e.target.value)}>
                {RACE_ETHNICITY_CODES.map((code) => (
                  <FormControlLabel key={code} value={code} control={<Radio size="small" />} label={t(`aiHiring.race.${code}`)} />
                ))}
              </RadioGroup>
            </FormControl>
            <FormControl disabled={saving}>
              <FormLabel>{t('aiHiring.sexLabel')}</FormLabel>
              <RadioGroup value={sex} onChange={(e) => setSex(e.target.value)}>
                {SEX_CODES.map((code) => (
                  <FormControlLabel key={code} value={code} control={<Radio size="small" />} label={t(`aiHiring.sex.${code}`)} />
                ))}
              </RadioGroup>
            </FormControl>
            {saved ? <Alert severity="success">{t('aiHiring.saved')}</Alert> : null}
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {saved ? t('aiHiring.done') : t('aiHiring.cancel')}
        </Button>
        {user?.uid && !saved ? (
          <Button variant="contained" onClick={() => void save()} disabled={saving || loading || (!race && !sex)}>
            {t('aiHiring.saveAnswers')}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
};

export default VoluntarySelfIdDialog;
