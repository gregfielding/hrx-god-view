import React, { useState, useEffect } from 'react';
import { Box } from '@mui/material';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import ResumeStep from '../../../components/apply/steps/ResumeStep';

type Props = {
  uid: string;
};

const ResumeTab: React.FC<Props> = ({ uid }) => {
  const { tenantId } = useAuth();
  const [resumeData, setResumeData] = useState<any>({});

  useEffect(() => {
    if (!uid) return;

    // Listen to user document for resume data
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setResumeData({
          resume: data.resume || null,
          resumeFileName: data.resumeFileName || data.resume?.fileName || '',
          resumeStoragePath: data.resumeStoragePath || data.resume?.storagePath || '',
        });
      }
    });

    return () => unsubscribe();
  }, [uid]);

  const handleChange = async (updated: any) => {
    // The ResumeStep component handles its own saving to Firestore
    // This is just for local state sync if needed
    setResumeData((prev: any) => ({ ...prev, ...updated }));
  };

  return (
    <Box>
      <ResumeStep 
        tenantId={tenantId || ''}
        value={resumeData} 
        onChange={handleChange}
      />
    </Box>
  );
};

export default ResumeTab;

