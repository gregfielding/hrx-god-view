import React, { useState, useEffect } from 'react';
import { Box } from '@mui/material';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import QualificationsStep from '../../../components/apply/steps/QualificationsStep';

type Props = {
  uid: string;
};

const QualificationsTab: React.FC<Props> = ({ uid }) => {
  const [qualificationsData, setQualificationsData] = useState<any>({});

  useEffect(() => {
    if (!uid) return;

    // Listen to user document for qualifications data
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setQualificationsData({
          skills: data.skills || [],
          languages: data.languages || [],
          workHistory: data.workHistory || [],
          experienceSummary: data.experienceSummary || '',
          bio: data.bio || '',
        });
      }
    });

    return () => unsubscribe();
  }, [uid]);

  const handleChange = async (updated: any) => {
    // The QualificationsStep component handles its own saving to Firestore
    // This is just for local state sync if needed
    setQualificationsData((prev: any) => ({ ...prev, ...updated }));
  };

  return (
    <Box>
      <QualificationsStep 
        value={qualificationsData} 
        onChange={handleChange}
        context="profile"
      />
    </Box>
  );
};

export default QualificationsTab;

