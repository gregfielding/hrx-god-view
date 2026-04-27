import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent } from '@mui/material';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import EducationStep from '../../../components/apply/steps/EducationStep';

type Props = {
  uid: string;
};

const EducationTab: React.FC<Props> = ({ uid }) => {
  const [educationData, setEducationData] = useState<any>({});

  useEffect(() => {
    if (!uid) return;

    // Listen to user document for education data
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const educationArray = Array.isArray(data.education) ? data.education : [];
        const certificationsArray = Array.isArray(data.certifications) ? data.certifications : [];
        console.log('📚 EducationTab: Received education data:', {
          educationCount: educationArray.length,
          education: educationArray,
          certificationsCount: certificationsArray.length
        });
        setEducationData({
          education: educationArray,
          certifications: certificationsArray,
        });
      }
    });

    return () => unsubscribe();
  }, [uid]);

  const handleChange = async (updated: any) => {
    // The EducationStep component handles its own saving to Firestore
    // This is just for local state sync if needed
    setEducationData((prev: any) => ({ ...prev, ...updated }));
  };

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <EducationStep 
          value={educationData} 
          onChange={handleChange}
          context="profile"
        />
      </CardContent>
    </Card>
  );
};

export default EducationTab;

