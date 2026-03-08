import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Box, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

type Props = {
  compact?: boolean;
};

function hasCompleteHomeAddress(userData: any): boolean {
  const addressInfo = userData?.addressInfo || {};
  const address = userData?.address || {};

  const street = addressInfo.streetAddress || address.street || '';
  const city = addressInfo.city || address.city || userData?.city || '';
  const state = addressInfo.state || address.state || userData?.state || '';
  const zip = addressInfo.zip || addressInfo.zipCode || address.zipCode || address.zip || userData?.zipCode || '';
  const homeLat = addressInfo.homeLat ?? address.homeLat ?? address.coordinates?.lat ?? address.coordinates?.latitude ?? userData?.homeLat;
  const homeLng = addressInfo.homeLng ?? address.homeLng ?? address.coordinates?.lng ?? address.coordinates?.longitude ?? userData?.homeLng;

  return !!(street && city && state && zip && typeof homeLat === 'number' && typeof homeLng === 'number');
}

const MissingHomeAddressAlert: React.FC<Props> = ({ compact = false }) => {
  const { user, securityLevel } = useAuth();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);

  const shouldCheck = useMemo(() => {
    const level = Number.parseInt(String(securityLevel ?? '0'), 10) || 0;
    return !!user?.uid && level <= 4;
  }, [user?.uid, securityLevel]);

  useEffect(() => {
    let cancelled = false;

    if (!shouldCheck || !user?.uid) {
      setShow(false);
      return;
    }

    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) {
          if (!cancelled) setShow(true);
          return;
        }
        const userData = snap.data();
        if (!cancelled) setShow(!hasCompleteHomeAddress(userData));
      } catch {
        if (!cancelled) setShow(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shouldCheck, user?.uid]);

  if (!show || !user?.uid) return null;

  return (
    <Alert
      severity="warning"
      sx={{ mb: compact ? 1.5 : 2 }}
      action={
        <Button
          color="inherit"
          size="small"
          onClick={() => navigate(`/users/${user.uid}?editHomeAddress=1#home-address`)}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          Add home address
        </Button>
      }
    >
      <Box>
        <Typography variant="body2" fontWeight={600}>
          Home address missing
        </Typography>
        <Typography variant="body2">
          Add your home address so we can match you to nearby jobs and Smart Groups.
        </Typography>
      </Box>
    </Alert>
  );
};

export default MissingHomeAddressAlert;
