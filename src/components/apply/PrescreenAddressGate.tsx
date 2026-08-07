/**
 * ADDR-2 — home-address gate shown on the worker AI prescreen when the
 * signed-in user's profile has no home address. Catches the "account shell"
 * cohort: workers who created an account, abandoned the apply wizard, and
 * re-enter through the prescreen SMS link — they'd otherwise never revisit
 * the wizard's address step. Reuses the wizard's AddressStep (Google Places
 * dropdown + manual-entry geocode fallback) and writes the exact same
 * user-doc shape the wizard writes on submit: `address` / `addressInfo` /
 * top-level city/state/zip/homeLat/homeLng for legacy readers, plus the
 * canonical structured `homeAddress` (with coordinates) that the radius
 * blasts and Everee preflight read.
 */
import React, { useState } from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import AddressStep from './steps/AddressStep';
import { isApplyHomeAddressValid } from '../../utils/applyHomeAddressValid';
import { buildCanonicalHomeAddressFromWizardPersonal } from '../../utils/buildCanonicalHomeAddress';

type Props = {
  uid: string;
  title: string;
  body: string;
  saveLabel: string;
  savingLabel: string;
  onSaved: () => void;
};

const PrescreenAddressGate: React.FC<Props> = ({ uid, title, body, saveLabel, savingLabel, onSaved }) => {
  const [personal, setPersonal] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addressValid = isApplyHomeAddressValid(personal);

  const save = async () => {
    if (!addressValid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const str = (v: unknown): string => String(v ?? '').trim();
      const profileUpdate: Record<string, unknown> = { updatedAt: serverTimestamp() };
      const addr: Record<string, unknown> = {};
      if (personal.street) addr.street = str(personal.street);
      if (personal.unit) addr.unit = str(personal.unit);
      if (personal.city) addr.city = str(personal.city);
      if (personal.state) addr.state = str(personal.state);
      if (personal.zip) addr.zipCode = str(personal.zip);
      if (personal.homeLat !== undefined && personal.homeLng !== undefined) {
        addr.coordinates = { lat: Number(personal.homeLat), lng: Number(personal.homeLng) };
      }
      profileUpdate.address = addr;
      if (addr.city) profileUpdate.city = addr.city;
      if (addr.state) profileUpdate.state = addr.state;
      if (addr.zipCode) profileUpdate.zipCode = addr.zipCode;
      profileUpdate.addressInfo = {
        ...(personal.street ? { streetAddress: str(personal.street) } : {}),
        ...(personal.unit ? { unitNumber: str(personal.unit) } : {}),
        ...(personal.city ? { city: str(personal.city) } : {}),
        ...(personal.state ? { state: str(personal.state) } : {}),
        ...(personal.zip ? { zip: str(personal.zip) } : {}),
        ...(personal.homeLat !== undefined && personal.homeLng !== undefined
          ? { homeLat: Number(personal.homeLat), homeLng: Number(personal.homeLng) }
          : {}),
      };
      if (personal.homeLat !== undefined && personal.homeLng !== undefined) {
        profileUpdate.homeLat = Number(personal.homeLat);
        profileUpdate.homeLng = Number(personal.homeLng);
      }
      const canonicalHomeAddress = buildCanonicalHomeAddressFromWizardPersonal(personal);
      if (canonicalHomeAddress) profileUpdate.homeAddress = canonicalHomeAddress;
      await setDoc(doc(db, 'users', uid), profileUpdate, { merge: true });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper elevation={0} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={1.5}>
        <Typography variant="h6" fontWeight={700} component="h2">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.45 }}>
          {body}
        </Typography>
        <Box>
          <AddressStep value={personal} onChange={setPersonal} />
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        <Button
          fullWidth
          variant="contained"
          size="large"
          disabled={!addressValid || saving}
          onClick={() => void save()}
          sx={{ py: 1.25, fontWeight: 600 }}
        >
          {saving ? savingLabel : saveLabel}
        </Button>
      </Stack>
    </Paper>
  );
};

export default PrescreenAddressGate;
