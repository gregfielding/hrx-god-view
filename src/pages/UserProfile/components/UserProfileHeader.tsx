import React, { useRef, useState } from 'react';
import { Box, Avatar, IconButton, Tooltip, Button, Typography } from '@mui/material';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import { storage, db } from '../../../firebase'; // adjust path
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import ClearIcon from '@mui/icons-material/Clear';

interface UserProfileHeaderProps {
  uid: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
  onAvatarUpdated: (url: string) => void; // callback to update parent state
  showBackButton?: boolean;
  onBack?: () => void;
}

const UserProfileHeader: React.FC<UserProfileHeaderProps> = ({
  uid,
  firstName,
  lastName,
  avatarUrl,
  onAvatarUpdated,
  showBackButton,
  onBack,
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
      const storageRef = ref(storage, `avatars/${uid}.jpg`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'users', uid), { avatar: downloadURL });
      onAvatarUpdated(downloadURL);
    }
  };

  const handleDeleteAvatar = async () => {
    const storageRef = ref(storage, `avatars/${uid}.jpg`);
    await deleteObject(storageRef);
    await updateDoc(doc(db, 'users', uid), { avatar: '' });
    onAvatarUpdated('');
  };

  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();

  return (
    <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
      <Box display="flex" alignItems="center" gap={2}>
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

        <Typography variant="h4" sx={{ mb: 0 }}>{`${firstName} ${lastName}`}</Typography>
      </Box>

      {showBackButton && (
        <Button variant="outlined" onClick={onBack}>
          &larr; Back
        </Button>
      )}
    </Box>
  );
};

export default UserProfileHeader;
