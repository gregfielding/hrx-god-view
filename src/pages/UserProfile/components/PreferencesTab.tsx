import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent } from '@mui/material';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import JobPreferencesStep from '../../../components/apply/steps/JobPreferencesStep';

type Props = {
  uid: string;
};

const PreferencesTab: React.FC<Props> = ({ uid }) => {
  const [preferencesData, setPreferencesData] = useState<any>({});

  useEffect(() => {
    if (!uid) return;

    // Listen to user document for preferences data
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setPreferencesData({
          availableToStartDate: data.availableToStartDate || '',
          availabilityNotes: data.preferences?.availabilityNotes || '',
          shiftPreferences: data.preferences?.shiftPreferences || [],
          industryPreferences: data.preferences?.industryPreferences || [],
          targetPay: data.preferences?.targetPay || '',
          shift: data.preferences?.shift || '',
        });
      }
    });

    return () => unsubscribe();
  }, [uid]);

  const handleChange = async (updated: any) => {
    // The JobPreferencesStep component handles its own saving to Firestore
    // This is just for local state sync if needed
    setPreferencesData((prev: any) => ({ ...prev, ...updated }));
  };

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <JobPreferencesStep 
          value={preferencesData} 
          onChange={handleChange}
        />
      </CardContent>
    </Card>
  );
};

export default PreferencesTab;

