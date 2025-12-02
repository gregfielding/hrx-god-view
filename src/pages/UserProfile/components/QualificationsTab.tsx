import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent } from '@mui/material';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import QualificationsStep from '../../../components/apply/steps/QualificationsStep';
import BioStep from '../../../components/apply/steps/BioStep';
import EducationStep from '../../../components/apply/steps/EducationStep';
import WorkExperienceStep from '../../../components/apply/steps/WorkExperienceStep';
import ShiftPreferencesCard from './ShiftPreferencesCard';

type Props = {
  uid: string;
};

const QualificationsTab: React.FC<Props> = ({ uid }) => {
  const [qualificationsData, setQualificationsData] = useState<any>({});
  const [bioData, setBioData] = useState<any>({});
  const [educationData, setEducationData] = useState<any>({});
  const [workExperienceData, setWorkExperienceData] = useState<any>({});

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
        const educationArray = Array.isArray(data.education) ? data.education : [];
        const certificationsArray = Array.isArray(data.certifications) ? data.certifications : [];
        setEducationData({
          education: educationArray,
          certifications: certificationsArray,
        });
        setWorkExperienceData({
          workExperience: data.workExperience || data.workHistory || [],
          workHistory: data.workHistory || data.workExperience || [],
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

  const handleEducationChange = async (updated: any) => {
    // The EducationStep component handles its own saving to Firestore
    // This is just for local state sync if needed
    setEducationData((prev: any) => ({ ...prev, ...updated }));
  };

  const handleWorkExperienceChange = async (updated: any) => {
    // The WorkExperienceStep component handles its own saving to Firestore
    // This is just for local state sync if needed
    setWorkExperienceData((prev: any) => ({ ...prev, ...updated }));
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

      <Card variant="outlined" sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 1 }}>
        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
          <EducationStep 
            value={educationData} 
            onChange={handleEducationChange}
            context="profile"
            showOnly="education"
          />
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 1 }}>
        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
          <EducationStep 
            value={educationData} 
            onChange={handleEducationChange}
            context="profile"
            showOnly="certifications"
          />
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 4, bgcolor: 'background.paper', borderRadius: 1 }}>
        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
          <WorkExperienceStep 
            value={workExperienceData} 
            onChange={handleWorkExperienceChange}
            context="profile"
          />
        </CardContent>
      </Card>

      <QualificationsStep 
        value={qualificationsData} 
        onChange={handleChange}
        context="profile"
        profileUid={uid}
      />

      <ShiftPreferencesCard uid={uid} />
    </Box>
  );
};

export default QualificationsTab;

