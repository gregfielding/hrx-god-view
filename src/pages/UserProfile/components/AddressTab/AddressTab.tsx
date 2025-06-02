import React, { useEffect, useState, useCallback } from 'react';
import { Box, Grid, Typography } from '@mui/material';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../../../firebase';

import AddressFormFields from './AddressFormFields';
import MapWithMarkers from './MapWithMarkers';

type Props = { uid: string };

const AddressTab: React.FC<Props> = ({ uid }) => {
  const [addressInfo, setAddressInfo] = useState<any>({
    homeLat: null,
    homeLng: null,
    workLat: 38.8977, // Default: White House
    workLng: -77.0365,
    currentLat: null,
    currentLng: null,
  });

  useEffect(() => {
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setAddressInfo(data.addressInfo || {});
      }
    });
    return () => unsubscribe();
  }, [uid]);

  const handleAddressChange = useCallback(
    async (updatedAddressInfo: any) => {
      setAddressInfo(updatedAddressInfo);
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, { addressInfo: updatedAddressInfo });
    },
    [uid],
  );

  return (
    <Box sx={{ p: 2 }}>
      <Grid container spacing={4}>
        {/* Home and Work Address Fields */}
        <Grid item xs={12} md={6}>
          <Typography variant="h6" gutterBottom sx={{ pl: 1, pb: 1 }}>
            Home Address
          </Typography>
          <AddressFormFields uid={uid} formData={addressInfo} onFormChange={handleAddressChange} />
        </Grid>
        <Grid item xs={12} md={6}>
          <Typography variant="h6" gutterBottom sx={{ pl: 0, pb: 1 }}>
            Work Address
          </Typography>
          <p>Work address is set to the White House by default.</p>
        </Grid>
      </Grid>
      <Grid container spacing={4}>
        <Grid item xs={12} md={12}>
          <MapWithMarkers
            homeLat={addressInfo.homeLat}
            homeLng={addressInfo.homeLng}
            workLat={addressInfo.workLat}
            workLng={addressInfo.workLng}
            currentLat={addressInfo.currentLat}
            currentLng={addressInfo.currentLng}
          />
        </Grid>
      </Grid>
    </Box>
  );
};

export default AddressTab;
