import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent } from '@mui/material';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import WorkExperienceStep from '../../../components/apply/steps/WorkExperienceStep';

type Props = {
  uid: string;
};

const WorkExperienceTab: React.FC<Props> = ({ uid }) => {
  const [workExperienceData, setWorkExperienceData] = useState<any>({});

  useEffect(() => {
    if (!uid) return;

    // Listen to user document for work experience data
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setWorkExperienceData({
          workExperience: data.workExperience || data.workHistory || [],
          workHistory: data.workHistory || data.workExperience || [],
        });
      }
    });

    return () => unsubscribe();
  }, [uid]);

  const handleChange = async (updated: any) => {
    // The WorkExperienceStep component handles its own saving to Firestore
    // This is just for local state sync if needed
    setWorkExperienceData((prev: any) => ({ ...prev, ...updated }));
  };

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <WorkExperienceStep 
          value={workExperienceData} 
          onChange={handleChange}
          context="profile"
          jobPosting={null}
        />
      </CardContent>
    </Card>
  );
};

export default WorkExperienceTab;

