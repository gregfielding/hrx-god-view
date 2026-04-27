import React, { useRef, useState } from 'react';
import { Box, Avatar, IconButton } from '@mui/material';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import ClearIcon from '@mui/icons-material/Clear';

import { db, storage } from '../../../firebase';

interface AgencyProfileHeaderProps {
  uid: string;
  name: string;
  avatarUrl: string;
  onAvatarUpdated: (url: string) => void;
}

const AgencyProfileHeader: React.FC<AgencyProfileHeaderProps> = ({
  uid,
  name,
  avatarUrl,
  onAvatarUpdated,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [hover, setHover] = useState(false);

  const handleAvatarClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const storageRef = ref(storage, `agency_logos/${uid}.jpg`);
      await uploadBytes(storageRef, file);
      let downloadURL = '';
      let attempts = 0;
      while (attempts < 5) {
        try {
          downloadURL = await getDownloadURL(storageRef);
          break;
        } catch (error) {
          attempts++;
          await new Promise((res) => setTimeout(res, 500)); // wait 500ms
        }
      }
      if (!downloadURL) {
        downloadURL = '/img/default-logo.png';
      }
      await updateDoc(doc(db, 'tenants', uid), { avatar: downloadURL });
      onAvatarUpdated(downloadURL);
    }
  };

  const handleDeleteAvatar = async () => {
    const storageRef = ref(storage, `agency_logos/${uid}.jpg`);
    await deleteObject(storageRef);
    await updateDoc(doc(db, 'tenants', uid), { avatar: '' });
    onAvatarUpdated('');
  };

  const initials = name
    ? name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
    : '';

  return (
    <Box display="flex" alignItems="center" gap={2} sx={{ mb: 2 }}>
      <Box
        position="relative"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <Avatar
          src={avatarUrl || undefined}
          sx={{ width: 80, height: 80, fontSize: 32 }}
          imgProps={{
            onError: (e: any) => {
              e.target.onerror = null;
              e.target.src = '/img/default-logo.png';
            },
          }}
        >
          {!avatarUrl && initials}
        </Avatar>
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        {hover && !avatarUrl && (
          <IconButton
            size="small"
            onClick={handleAvatarClick}
            sx={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              backgroundColor: 'white',
              borderRadius: '50%',
            }}
          >
            <CameraAltIcon fontSize="small" />
          </IconButton>
        )}
        {hover && avatarUrl && (
          <IconButton
            size="small"
            onClick={handleDeleteAvatar}
            sx={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              backgroundColor: 'white',
              borderRadius: '50%',
            }}
          >
            <ClearIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
      <Box>
        <h2>{name}</h2>
      </Box>
    </Box>
  );
};

export default AgencyProfileHeader;
