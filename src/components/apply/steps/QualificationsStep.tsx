import React from 'react';
import { Box, Typography, TextField, Card, CardHeader, CardContent, Button, Stack } from '@mui/material';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../../firebase';
import { logger } from '../../../utils/logger';
import onetSkills from '../../../data/onetSkills.json';
import onetJobTitles from '../../../data/onetJobTitles.json';
import SkillsTab from '../../../pages/UserProfile/components/SkillsTab/SkillsTab';

type Props = {
  value: any;
  onChange: (v: any) => void;
};

const QualificationsStep: React.FC<Props> = ({ value, onChange }) => {
  logger.debug('QualificationsStep - value:', value);
  
  // Transform the qualifications data into user-like format for SkillsTab
  const userData = {
    ...value,
    skills: value?.skills || [],
    certifications: value?.certifications || [],
    languages: value?.languages || [],
    education: value?.education || [],
    workHistory: value?.workHistory || [],
    salaryExpectations: value?.salaryExpectations || {}
  };
  
  logger.debug('QualificationsStep - transformed userData:', userData);
  
  const [tempBio, setTempBio] = React.useState<string>(value?.bio || '');
  React.useEffect(() => {
    setTempBio(value?.bio || '');
  }, [value?.bio]);

  // Live-read user bio from Firestore (simple onSnapshot). If the local value is empty, hydrate from DB.
  React.useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const userRef = doc(db, 'users', currentUser.uid);
    const unsub = onSnapshot(userRef, (snap) => {
      const bioFromDb = (snap.data() as any)?.bio || '';
      if (!value?.bio && !tempBio && bioFromDb) {
        setTempBio(bioFromDb);
        onChange({ ...value, bio: bioFromDb });
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTempBio(e.target.value);
  };

  const handleSaveBio = () => {
    onChange({ ...value, bio: tempBio });
    try {
      const uid = auth.currentUser?.uid;
      if (uid) {
        const userRef = doc(db, 'users', uid);
        updateDoc(userRef, { bio: tempBio });
      }
    } catch {}
  };

  return (
    <Box>
      {/* Bio card */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardHeader
          title={<Typography variant="h6">Professional Bio</Typography>}
          action={
            <Button variant="contained" size="small" onClick={handleSaveBio} disabled={(tempBio || '') === (value?.bio || '')}>
              Save
            </Button>
          }
        />
        <CardContent>
          <TextField
            fullWidth
            multiline
            minRows={6}
            placeholder="Write a short bio about yourself. You can edit the one we generated from your resume."
            value={tempBio}
            onChange={handleBioChange}
          />
        </CardContent>
      </Card>

      {/* Skills & Industry sections render their own cards; no outer container */}
      <SkillsTab
        user={userData}
        onUpdate={(updated) => onChange(updated)}
        onetSkills={onetSkills as any}
        onetJobTitles={onetJobTitles as any}
      />
    </Box>
  );
};

export default QualificationsStep;


