import React, { useRef, useState } from 'react';
import { Box, Avatar, IconButton, Tooltip } from '@mui/material';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import { storage, db } from '../../../firebase';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import ClearIcon from '@mui/icons-material/Clear';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';

interface CustomerProfileHeaderProps {
  uid: string; // Firestore customer document ID
  name: string;
  avatarUrl: string;
  onAvatarUpdated: (url: string) => void;
}

const CustomerProfileHeader: React.FC<CustomerProfileHeaderProps> = ({
  uid,
  name,
  avatarUrl,
  onAvatarUpdated,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [hover, setHover] = useState(false);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  // const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
  //   if (e.target.files && e.target.files[0]) {
  //     const file = e.target.files[0];
  //     const storageRef = ref(storage, `avatars/customer_${uid}.jpg`);
  //     await uploadBytes(storageRef, file);
  //     const downloadURL = await getDownloadURL(storageRef);
  //     await updateDoc(doc(db, 'tenants', uid), { avatar: downloadURL });
  //     onAvatarUpdated(downloadURL);
  //   }
  // };

  // const handleDeleteAvatar = async () => {
  //   const storageRef = ref(storage, `avatars/customer_${uid}.jpg`);
  //   await deleteObject(storageRef);
  //   await updateDoc(doc(db, 'tenants', uid), { avatar: '' });
  //   onAvatarUpdated('');
  // };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const storageRef = ref(storage, `avatars/customer_${uid}.jpg`);

      try {
        await uploadBytes(storageRef, file);

        const downloadURL = await getDownloadURL(storageRef);
        console.log(downloadURL);
        console.log(uid);
        await updateDoc(doc(db, 'tenants', uid), { avatar: downloadURL });
        onAvatarUpdated(downloadURL);
      } catch (error) {
        console.error('Error uploading avatar:', error);
        alert('Failed to upload avatar. See console for details.');
      }
    }
  };

  const handleDeleteAvatar = async () => {
    const storageRef = ref(storage, `avatars/customer_${uid}.jpg`);

    try {
      await deleteObject(storageRef);
      await updateDoc(doc(db, 'tenants', uid), { avatar: '' });
      onAvatarUpdated('');
    } catch (error) {
      console.error('Error deleting avatar:', error);
      alert('Failed to delete avatar. See console for details.');
    }
  };

  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase();

  const navigate = useNavigate();

  return (
    <Box display="flex" justifyContent="space-between" alignItems="center">
      <Box display="flex" alignItems="space-between" gap={2}>
        <Box
          position="relative"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <Avatar src={avatarUrl || undefined} sx={{ width: 60, height: 60, fontSize: '1.5rem' }}>
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
            <Tooltip title="Upload avatar">
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
            </Tooltip>
          )}

          {hover && avatarUrl && (
            <Tooltip title="Remove avatar">
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
            </Tooltip>
          )}
        </Box>

        <Box>
          <h2>{name}</h2>
        </Box>
      </Box>
      <Tooltip title="Back to Customers">
        <IconButton onClick={() => navigate('/tenants')}>
          <ArrowBackIcon sx={{ color: 'inherit' }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

export default CustomerProfileHeader;
