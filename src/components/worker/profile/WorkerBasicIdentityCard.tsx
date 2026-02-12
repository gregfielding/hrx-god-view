/**
 * Worker Job Readiness — Basic Identity card: avatar (upload/replace), name, contact, DOB, home address.
 * Persists to users/{uid}. Replaces need for separate "My Profile" for workers.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Avatar,
  IconButton,
  TextField,
  Grid,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Autocomplete } from '@react-google-maps/api';
import { storage, db } from '../../../firebase';
import { formatPhoneNumber } from '../../../utils/formatPhone';
import { geocodeAddress } from '../../../utils/geocodeAddress';
import ImageCropDialog from '../../common/ImageCropDialog';

export interface WorkerBasicIdentityForm {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
  homeLat?: number | null;
  homeLng?: number | null;
}

const defaultForm: WorkerBasicIdentityForm = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  dateOfBirth: '',
  streetAddress: '',
  city: '',
  state: '',
  zip: '',
  homeLat: null,
  homeLng: null,
};

function fromUserDoc(data: Record<string, unknown> | null): WorkerBasicIdentityForm {
  if (!data) return defaultForm;
  const addr = (data.addressInfo as Record<string, unknown>) || {};
  const dob = (data.dob ?? data.dateOfBirth) as string | undefined;
  const dobStr = typeof dob === 'string' ? dob : dob ? String(dob) : '';
  const homeLat = addr.homeLat != null && typeof addr.homeLat === 'number' ? addr.homeLat : null;
  const homeLng = addr.homeLng != null && typeof addr.homeLng === 'number' ? addr.homeLng : null;
  return {
    firstName: (data.firstName as string) ?? '',
    lastName: (data.lastName as string) ?? '',
    phone: (data.phone as string) ?? '',
    email: (data.email as string) ?? '',
    dateOfBirth: dobStr,
    streetAddress: (addr.streetAddress as string) ?? '',
    city: (addr.city as string) ?? (data.city as string) ?? '',
    state: (addr.state as string) ?? (data.state as string) ?? '',
    zip: (addr.zip as string) ?? (addr.zipCode as string) ?? '',
    homeLat,
    homeLng,
  };
}

export interface WorkerBasicIdentityCardProps {
  uid: string;
  userDoc: Record<string, unknown> | null;
  avatarUrl: string;
  onAvatarUpdated: (url: string) => void;
}

const WorkerBasicIdentityCard: React.FC<WorkerBasicIdentityCardProps> = ({
  uid,
  userDoc,
  avatarUrl,
  onAvatarUpdated,
}) => {
  const [form, setForm] = useState<WorkerBasicIdentityForm>(() => fromUserDoc(userDoc));
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [pendingImageSrc, setPendingImageSrc] = useState<string | null>(null);
  const [isGoogleMapsLoaded, setIsGoogleMapsLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocompleteRef = useRef<any>(null);
  const formRef = useRef(form);
  formRef.current = form;

  const checkGoogleMapsLoaded = useCallback(() => {
    const loaded = !!(window as any).google?.maps?.places;
    if (loaded) setIsGoogleMapsLoaded(true);
    else setTimeout(checkGoogleMapsLoaded, 100);
  }, []);

  useEffect(() => {
    checkGoogleMapsLoaded();
  }, [checkGoogleMapsLoaded]);

  useEffect(() => {
    setForm(fromUserDoc(userDoc));
  }, [userDoc]);

  const persist = useCallback(
    async (updates: Partial<WorkerBasicIdentityForm>) => {
      if (!uid) return;
      const userRef = doc(db, 'users', uid);
      const payload: Record<string, unknown> = {
        updatedAt: serverTimestamp(),
        ...(updates.firstName !== undefined && { firstName: updates.firstName }),
        ...(updates.lastName !== undefined && { lastName: updates.lastName }),
        ...(updates.phone !== undefined && { phone: updates.phone }),
        ...(updates.email !== undefined && { email: updates.email }),
        ...(updates.dateOfBirth !== undefined && { dateOfBirth: updates.dateOfBirth, dob: updates.dateOfBirth }),
      };
      if (
        updates.streetAddress !== undefined ||
        updates.city !== undefined ||
        updates.state !== undefined ||
        updates.zip !== undefined ||
        updates.homeLat !== undefined ||
        updates.homeLng !== undefined
      ) {
        const current = (userDoc?.addressInfo as Record<string, unknown>) || {};
        const f = formRef.current;
        const homeLat = updates.homeLat !== undefined ? updates.homeLat : f.homeLat;
        const homeLng = updates.homeLng !== undefined ? updates.homeLng : f.homeLng;
        payload.addressInfo = {
          ...current,
          streetAddress: updates.streetAddress ?? f.streetAddress,
          city: updates.city ?? f.city,
          state: updates.state ?? f.state,
          zip: updates.zip ?? f.zip,
          homeLat: homeLat ?? null,
          homeLng: homeLng ?? null,
        };
      }
      await updateDoc(userRef, payload);
    },
    [uid, userDoc]
  );

  const handleChange = useCallback(
    (field: keyof WorkerBasicIdentityForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => persist({ [field]: value }), 600);
    },
    [persist]
  );

  const handlePhoneChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/\D/g, '');
      const formatted = raw.length >= 10 ? formatPhoneNumber(raw.slice(-10)) : e.target.value;
      setForm((prev) => ({ ...prev, phone: formatted }));
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => persist({ phone: formatted }), 600);
    },
    [persist]
  );

  const handleAutocompleteLoad = useCallback((autocomplete: any) => {
    autocompleteRef.current = autocomplete;
  }, []);

  const handlePlaceChanged = useCallback(() => {
    const autocomplete = autocompleteRef.current;
    if (!autocomplete?.getPlace) return;
    const place = autocomplete.getPlace();
    if (!place?.address_components || !place.geometry?.location) return;
    const components = place.address_components;
    const get = (types: string[]) =>
      components.find((c: any) => types.every((t: string) => c.types?.includes(t)))?.long_name || '';
    const streetAddress = `${get(['street_number'])} ${get(['route'])}`.trim();
    const city = get(['locality']) || get(['sublocality']) || get(['postal_town']);
    const state = get(['administrative_area_level_1']);
    const zip = get(['postal_code']);
    const lat = typeof place.geometry.location.lat === 'function'
      ? place.geometry.location.lat()
      : place.geometry.location.lat;
    const lng = typeof place.geometry.location.lng === 'function'
      ? place.geometry.location.lng()
      : place.geometry.location.lng;
    const next = {
      streetAddress: streetAddress || formRef.current.streetAddress,
      city: city || formRef.current.city,
      state: state || formRef.current.state,
      zip: zip || formRef.current.zip,
      homeLat: lat,
      homeLng: lng,
    };
    setForm((prev) => ({ ...prev, ...next }));
    persist({ ...next });
  }, [persist]);

  const handleAddressBlur = useCallback(async () => {
    const f = formRef.current;
    if ((f.homeLat != null && f.homeLng != null) || !f.streetAddress || !f.city || !f.state) return;
    try {
      const full = [f.streetAddress, f.city, f.state, f.zip].filter(Boolean).join(', ');
      const { lat, lng } = await geocodeAddress(full);
      setForm((prev) => ({ ...prev, homeLat: lat, homeLng: lng }));
      persist({ homeLat: lat, homeLng: lng });
    } catch {
      // ignore geocode failure (user may have typed partial address)
    }
  }, [persist]);

  useEffect(() => () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); }, []);

  const initials = `${form.firstName?.[0] ?? ''}${form.lastName?.[0] ?? ''}`.toUpperCase() || '?';

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const src = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result ?? ''));
        r.onerror = () => reject(new Error('Failed to read file'));
        r.readAsDataURL(file);
      });
      setPendingImageSrc(src);
      setCropOpen(true);
    } catch (err) {
      console.error('Avatar file read error:', err);
    }
    e.target.value = '';
  };

  const handleConfirmCroppedAvatar = async (blob: Blob) => {
    setAvatarBusy(true);
    try {
      const storageRef = ref(storage, `avatars/${uid}.jpg`);
      await uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg' });
      const downloadURL = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'users', uid), { avatar: downloadURL, updatedAt: serverTimestamp() });
      onAvatarUpdated(downloadURL);
      setCropOpen(false);
      setPendingImageSrc(null);
    } catch (err) {
      console.error('Avatar upload error:', err);
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <>
      <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
        <CardContent sx={{ py: 3, px: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={avatarUrl || undefined}
                sx={{ width: 72, height: 72, fontSize: '1.5rem' }}
              >
                {!avatarUrl && initials}
              </Avatar>
              <IconButton
                size="small"
                onClick={handleAvatarClick}
                disabled={avatarBusy}
                sx={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  bgcolor: 'background.paper',
                  boxShadow: 1,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
                aria-label="Upload or replace photo"
              >
                <CameraAltIcon fontSize="small" />
              </IconButton>
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {form.firstName || form.lastName ? `${form.firstName} ${form.lastName}`.trim() : 'Your profile'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Update your name, contact info, and address below.
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <PersonIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Basic Identity
            </Typography>
          </Box>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="First name"
                value={form.firstName}
                onChange={handleChange('firstName')}
                onBlur={() => persist({ firstName: form.firstName })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Last name"
                value={form.lastName}
                onChange={handleChange('lastName')}
                onBlur={() => persist({ lastName: form.lastName })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Phone"
                type="tel"
                value={form.phone}
                onChange={handlePhoneChange}
                onBlur={() => persist({ phone: form.phone })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Email"
                type="email"
                value={form.email}
                onChange={handleChange('email')}
                onBlur={() => persist({ email: form.email })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                size="small"
                label="Date of birth"
                type="date"
                value={form.dateOfBirth}
                onChange={handleChange('dateOfBirth')}
                onBlur={() => persist({ dateOfBirth: form.dateOfBirth })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
          </Grid>

          <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 3, mb: 1 }}>
            Home address
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              {isGoogleMapsLoaded ? (
                <Autocomplete
                  onLoad={handleAutocompleteLoad}
                  onPlaceChanged={handlePlaceChanged}
                  options={{
                    componentRestrictions: { country: 'us' },
                    fields: ['address_components', 'geometry'],
                  }}
                >
                  <TextField
                    fullWidth
                    size="small"
                    label="Street address"
                    value={form.streetAddress}
                    onChange={handleChange('streetAddress')}
                    onBlur={() => {
                      persist({ streetAddress: form.streetAddress });
                      handleAddressBlur();
                    }}
                    autoComplete="off"
                    inputProps={{
                      autoComplete: 'off',
                      autoCorrect: 'off',
                      autoCapitalize: 'off',
                      spellCheck: 'false',
                    }}
                  />
                </Autocomplete>
              ) : (
                <TextField
                  fullWidth
                  size="small"
                  label="Street address"
                  value={form.streetAddress}
                  onChange={handleChange('streetAddress')}
                  onBlur={() => {
                    persist({ streetAddress: form.streetAddress });
                    handleAddressBlur();
                  }}
                />
              )}
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                size="small"
                label="City"
                value={form.city}
                onChange={handleChange('city')}
                onBlur={() => persist({ city: form.city })}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                size="small"
                label="State"
                value={form.state}
                onChange={handleChange('state')}
                onBlur={() => persist({ state: form.state })}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                size="small"
                label="ZIP"
                value={form.zip}
                onChange={handleChange('zip')}
                onBlur={() => persist({ zip: form.zip })}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <ImageCropDialog
        open={cropOpen}
        imageSrc={pendingImageSrc}
        aspect={1}
        cropShape="round"
        confirmLabel={avatarBusy ? 'Saving…' : 'Save'}
        loading={avatarBusy}
        onCancel={() => {
          if (!avatarBusy) {
            setCropOpen(false);
            setPendingImageSrc(null);
          }
        }}
        onConfirm={handleConfirmCroppedAvatar}
      />
    </>
  );
};

export default WorkerBasicIdentityCard;
