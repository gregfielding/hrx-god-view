import React, { useState, useEffect, useRef } from 'react';
import { Box, Button, TextField, Typography, CircularProgress, Alert } from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { RecaptchaVerifier, signInWithPhoneNumber, ConfirmationResult } from 'firebase/auth';
import { Autocomplete } from '@react-google-maps/api';

import { geocodeAddress } from '../utils/geocodeAddress';
import { auth, db } from '../firebase';

// Allow recaptchaVerifier on the window object
declare global {
  interface Window {
    recaptchaVerifier: RecaptchaVerifier;
    recaptchaWidgetId: number;
  }
}

const formatPhoneNumber = (value: string) => {
  const cleaned = value.replace(/\D/g, '');
  const match = cleaned.match(/(\d{0,3})(\d{0,3})(\d{0,4})/);
  if (!match) return value;
  const [, area, prefix, line] = match;
  if (area && prefix && line) return `(${area}) ${prefix}-${line}`;
  if (area && prefix) return `(${area}) ${prefix}`;
  if (area) return `(${area}`;
  return value;
};

const isValidPhoneNumber = (value: string) => {
  const cleaned = value.replace(/\D/g, '');
  return cleaned.length === 10;
};

const UserOnboarding = () => {
  const { uid } = useParams();
  const navigate = useNavigate();

  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [address, setAddress] = useState({ street: '', city: '', state: '', zip: '' });
  const [verificationSent, setVerificationSent] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const autocompleteRef = useRef<any>(null);

  useEffect(() => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
        callback: (response: any) => {
          console.log('reCAPTCHA solved:', response);
        },
      });

      window.recaptchaVerifier.render().then((widgetId) => {
        window.recaptchaWidgetId = widgetId;
        console.log('reCAPTCHA rendered with widgetId:', widgetId);
      });
    }
  }, []);

  const resetRecaptcha = () => {
    if (window.recaptchaVerifier && window.recaptchaWidgetId !== undefined) {
      (window as any).grecaptcha?.reset(window.recaptchaWidgetId);
      console.log('reCAPTCHA reset.');
    }
  };

  const handleSendCode = async () => {
    setError('');
    setLoading(true);
    try {
      const numericPhone = phone.replace(/\D/g, '');
      const formattedPhone = phone.startsWith('+') ? phone : `+1${numericPhone}`;
      const result = await signInWithPhoneNumber(auth, formattedPhone, window.recaptchaVerifier);
      setConfirmationResult(result);
      setVerificationSent(true);
      setMessage('Verification code sent to your phone.');
    } catch (err: any) {
      console.error('Verification failed:', err);
      resetRecaptcha();
      setError(err.message || 'Failed to send verification code.');
    }
    setLoading(false);
  };

  const handlePhoneChange = (value: string) => {
    const formatted = formatPhoneNumber(value);
    setPhone(formatted);
    setPhoneError(!isValidPhoneNumber(formatted));
  };

  const handleVerifyCode = async () => {
    setError('');
    setLoading(true);
    try {
      if (!confirmationResult) throw new Error('No verification in progress.');
      await confirmationResult.confirm(verificationCode);
      setMessage('Phone verified successfully.');
    } catch (err) {
      console.error(err);
      setError('Invalid verification code.');
    }
    setLoading(false);
  };

  const handlePlaceChanged = () => {
    const place = autocompleteRef.current.getPlace();
    if (!place || !place.geometry) return;
    const components = place.address_components || [];
    const getComponent = (types: string[]) =>
      components.find((comp: any) => types.every((t) => comp.types.includes(t)))?.long_name || '';
    setAddress({
      street: `${getComponent(['street_number'])} ${getComponent(['route'])}`.trim(),
      city: getComponent(['locality']),
      state: getComponent(['administrative_area_level_1']),
      zip: getComponent(['postal_code']),
    });
  };

  const handleSave = async () => {
    if (!phone || phoneError || !address.street || !address.city || !address.state || !address.zip) {
      return;
    }

    setLoading(true);
    setError('');
    try {
      const fullAddress = `${address.street}, ${address.city}, ${address.state} ${address.zip}`;
      const geo = await geocodeAddress(fullAddress);
      
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        phone,
        addressInfo: {
          ...address,
          homeLat: geo.lat,
          homeLng: geo.lng,
        },
        onboardingComplete: true,
        updatedAt: serverTimestamp(),
      });

      setMessage('Profile saved successfully!');
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to save profile');
    }
    setLoading(false);
  };

  return (
    <>
      <Box p={4} maxWidth={500} mx="auto">
        <Typography variant="h5" gutterBottom>
          Complete Your Profile
        </Typography>

        {message && <Alert severity="success">{message}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}

        <TextField
          label="Phone Number"
          fullWidth
          margin="normal"
          value={phone}
          error={phoneError}
          helperText={phoneError ? 'Enter a valid 10-digit US phone number' : ''}
          onChange={(e) => handlePhoneChange(e.target.value)}
          disabled={verificationSent}
        />

        {!verificationSent ? (
          <Button fullWidth onClick={handleSendCode} disabled={loading || !phone || phoneError}>
            {loading ? <CircularProgress size={24} /> : 'Send Verification Code'}
          </Button>
        ) : (
          <>
            <TextField
              label="Verification Code"
              fullWidth
              margin="normal"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
            />
            <Button fullWidth onClick={handleVerifyCode} disabled={loading || !verificationCode}>
              {loading ? <CircularProgress size={24} /> : 'Verify Code'}
            </Button>
          </>
        )}

        <Autocomplete
          onLoad={(ref) => (autocompleteRef.current = ref)}
          onPlaceChanged={handlePlaceChanged}
        >
          <TextField
            label="Street Address"
            fullWidth
            margin="normal"
            value={address.street}
            onChange={(e) => setAddress({ ...address, street: e.target.value })}
          />
        </Autocomplete>
        <TextField
          label="City"
          fullWidth
          margin="normal"
          value={address.city}
          onChange={(e) => setAddress({ ...address, city: e.target.value })}
        />
        <TextField
          label="State"
          fullWidth
          margin="normal"
          value={address.state}
          onChange={(e) => setAddress({ ...address, state: e.target.value })}
        />
        <TextField
          label="Zip Code"
          fullWidth
          margin="normal"
          value={address.zip}
          onChange={(e) => setAddress({ ...address, zip: e.target.value })}
        />

        <Box mt={3}>
          <Button
            variant="contained"
            fullWidth
            onClick={handleSave}
            disabled={
              loading ||
              !phone ||
              phoneError ||
              !address.street ||
              !address.city ||
              !address.state ||
              !address.zip
            }
          >
            {loading ? <CircularProgress size={24} /> : 'Save Profile'}
          </Button>
        </Box>
      </Box>

      <div id="recaptcha-container" style={{ zIndex: 9999 }} />
    </>
  );
};

export default UserOnboarding;
