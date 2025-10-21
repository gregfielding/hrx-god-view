import React, { useState, useEffect } from 'react';
import { Box } from '@mui/material';
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
    <Box>
      <JobPreferencesStep 
        value={preferencesData} 
        onChange={handleChange}
      />
    </Box>
  );
};

export default PreferencesTab;

