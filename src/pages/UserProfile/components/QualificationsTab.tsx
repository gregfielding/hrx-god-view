import React, { useState, useEffect } from 'react';
import { Box, Divider, Card, CardContent } from '@mui/material';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import QualificationsStep from '../../../components/apply/steps/QualificationsStep';
import BioStep from '../../../components/apply/steps/BioStep';

type Props = {
  uid: string;
};

const QualificationsTab: React.FC<Props> = ({ uid }) => {
  const [qualificationsData, setQualificationsData] = useState<any>({});
  const [bioData, setBioData] = useState<any>({});

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
        setBioData({
          professionalBio: data.professionalBio || data.bio || '',
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

  const handleBioChange = (updated: any) => {
    setBioData((prev: any) => ({ ...prev, ...updated }));
  };

  return (
    <Box>
      <Card variant="outlined" sx={{ mb: 4, bgcolor: 'background.paper' }}>
        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
          <BioStep 
            value={bioData} 
            onChange={handleBioChange}
          />
        </CardContent>
      </Card>
      <Divider sx={{ my: 4 }} />
      <QualificationsStep 
        value={qualificationsData} 
        onChange={handleChange}
        context="profile"
        profileUid={uid}
      />
    </Box>
  );
};

export default QualificationsTab;

