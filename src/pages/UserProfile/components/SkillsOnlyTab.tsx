import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent } from '@mui/material';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import SkillsStep from '../../../components/apply/steps/SkillsStep';

type Props = {
  uid: string;
};

const SkillsOnlyTab: React.FC<Props> = ({ uid }) => {
  const [skillsData, setSkillsData] = useState<any>({});

  useEffect(() => {
    if (!uid) return;

    // Listen to user document for skills data
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setSkillsData({
          skills: data.skills || [],
        });
      }
    });

    return () => unsubscribe();
  }, [uid]);

  const handleChange = async (updated: any) => {
    // The SkillsStep component handles its own saving to Firestore
    // This is just for local state sync if needed
    setSkillsData((prev: any) => ({ ...prev, ...updated }));
  };

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <SkillsStep 
          value={skillsData} 
          onChange={handleChange}
          context="profile"
        />
      </CardContent>
    </Card>
  );
};

export default SkillsOnlyTab;

