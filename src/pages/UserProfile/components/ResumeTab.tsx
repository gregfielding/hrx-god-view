import React, { useState, useEffect } from 'react';
import { Box, Typography, Paper, Alert } from '@mui/material';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import ResumeUpload from '../../../components/ResumeUpload';

type Props = {
  uid: string;
  /** Same resolution as other profile tabs — required for admin “parse on behalf of” server checks. */
  tenantId?: string | null;
};

const ResumeTab: React.FC<Props> = ({ uid, tenantId: tenantIdProp }) => {
  const { tenantId: authTenantId, activeTenant } = useAuth();
  const effectiveTenantId = tenantIdProp || authTenantId || activeTenant?.id || undefined;
  const [hasResume, setHasResume] = useState(false);
  const [resumeFileName, setResumeFileName] = useState<string>('');

  useEffect(() => {
    if (!uid) return;

    // Listen to user document for resume data
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const resume = data.resume || null;
        setHasResume(!!resume);
        setResumeFileName(resume?.fileName || '');
      }
    });

    return () => unsubscribe();
  }, [uid]);

  const handleResumeParsed = (parsedData: any) => {
    // ResumeUpload component handles saving to Firestore
    // This callback can be used for additional actions if needed
    console.log('Resume parsed:', parsedData);
  };

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', p: 3 }}>
      <Typography variant="h5" gutterBottom sx={{ mb: 3, fontWeight: 600 }}>
        Resume Upload
      </Typography>

      {hasResume && resumeFileName && (
        <Alert severity="success" sx={{ mb: 3 }}>
          Current resume: <strong>{resumeFileName}</strong>
        </Alert>
      )}

      <Paper sx={{ p: 3 }}>
        <ResumeUpload
          userId={uid}
          tenantId={effectiveTenantId}
          onResumeParsed={handleResumeParsed}
        />
      </Paper>
    </Box>
  );
};

export default ResumeTab;
