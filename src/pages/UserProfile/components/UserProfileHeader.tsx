import React, { useRef, useState } from 'react';
import { Box, Avatar, IconButton, Button, Typography, Stack, Link, Chip, Breadcrumbs } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import ClearIcon from '@mui/icons-material/Clear';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';
import BusinessIcon from '@mui/icons-material/Business';
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined';
import LinkedInIcon from '@mui/icons-material/LinkedIn';
import PersonIcon from '@mui/icons-material/Person';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import PublicIcon from '@mui/icons-material/Public';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';

import { storage, db } from '../../../firebase'; // adjust path

interface UserProfileHeaderProps {
  uid: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  avatarUrl: string;
  onAvatarUpdated: (url: string) => void; // callback to update parent state
  showBackButton?: boolean;
  onBack?: () => void;
  jobTitle?: string;
  phone?: string;
  email?: string;
  workStatus?: string;
  securityLevel?: string; // '0'..'7'
  employmentType?: string;
  departmentName?: string;
  locationName?: string;
  divisionName?: string;
  regionName?: string;
  linkedinUrl?: string;
  canEditAvatar?: boolean;
  managerName?: string;
  managerId?: string;
  showBreadcrumbs?: boolean;
  breadcrumbPath?: Array<{ label: string; href?: string }>;
}

const UserProfileHeader: React.FC<UserProfileHeaderProps> = ({
  uid,
  firstName,
  lastName,
  preferredName,
  avatarUrl,
  onAvatarUpdated,
  showBackButton,
  onBack,
  jobTitle,
  phone,
  email,
  workStatus,
  securityLevel,
  employmentType,
  departmentName,
  locationName,
  divisionName,
  regionName,
  linkedinUrl,
  canEditAvatar,
  managerName,
  managerId,
  showBreadcrumbs = false,
  breadcrumbPath = [],
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [hover, setHover] = useState(false);

  const handleAvatarClick = () => {
    if (!canEditAvatar) return;
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        console.log('🔄 Starting avatar upload...');
        console.log('User ID:', uid);
        console.log('File name:', file.name);
        console.log('File size:', file.size);
        
        // Check authentication
        const auth = getAuth();
        const currentUser = auth.currentUser;
        console.log('Current authenticated user:', currentUser?.uid);
        console.log('Is user authenticated?', !!currentUser);
        
        if (!currentUser) {
          throw new Error('User not authenticated');
        }
        
        const storageRef = ref(storage, `avatars/${uid}.jpg`);
        console.log('Storage path:', `avatars/${uid}.jpg`);
        
        await uploadBytes(storageRef, file);
        console.log('✅ File uploaded successfully');
        
        const downloadURL = await getDownloadURL(storageRef);
        console.log('✅ Download URL obtained:', downloadURL);
        
        await updateDoc(doc(db, 'users', uid), { avatar: downloadURL });
        console.log('✅ Firestore document updated');
        
        onAvatarUpdated(downloadURL);
        console.log('✅ Avatar update complete');
      } catch (err) {
        console.error('❌ Error uploading avatar:', err);
        console.error('Error details:', {
          code: err.code,
          message: err.message,
          stack: err.stack
        });
      }
    }
  };

  const handleDeleteAvatar = async () => {
    try {
      const storageRef = ref(storage, `avatars/${uid}.jpg`);
      await deleteObject(storageRef);
      await updateDoc(doc(db, 'users', uid), { avatar: '' });
      onAvatarUpdated('');
    } catch (err) {
      console.error('Error deleting avatar:', err);
    }
  };

  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();

  const normalizeLinkedInUrl = (url?: string) => {
    if (!url) return '';
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  };

  const getSecurityLabel = (lvl?: string) => {
    switch (lvl) {
      case '7': return 'Admin';
      case '6': return 'Manager';
      case '5': return 'Worker';
      case '4': return 'Hired Staff';
      case '3': return 'Flex';
      case '2': return 'Applicant';
      case '1': return 'Dismissed';
      case '0': return 'Suspended';
      default: return undefined;
    }
  };

  const getWorkStatusColor = (
    status?: string,
  ): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch ((status || '').toLowerCase()) {
      case 'active': return 'success';
      case 'on leave':
      case 'pending': return 'warning';
      case 'terminated':
      case 'suspended': return 'error';
      default: return 'info';
    }
  };

  const getEmploymentTypeColor = (
    type?: string,
  ): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch ((type || '').toLowerCase()) {
      case 'full-time': return 'success';
      case 'part-time': return 'info';
      case 'contract': return 'warning';
      case 'flex': return 'secondary';
      default: return 'default';
    }
  };

  const getEmploymentTypeLabel = (type?: string) => {
    if (!type) return '';
    // Convert "Full-Time" -> "Full Time"
    return String(type).replace(/-/g, ' ');
  };

  const getSecurityColor = (
    lvl?: string,
  ): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' => {
    switch (lvl) {
      case '7': return 'primary'; // Admin
      case '6': return 'secondary'; // Manager
      case '5': return 'info'; // Worker
      case '4': return 'warning'; // Hired Staff
      case '3': return 'info'; // Flex
      case '2': return 'default'; // Applicant
      case '1': return 'error'; // Dismissed
      case '0': return 'error'; // Suspended
      default: return 'default';
    }
  };

  const getSoftChipSx = (
    color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning',
  ) => {
    switch (color) {
      case 'primary':
        return { bgcolor: 'primary.light', color: 'primary.dark' };
      case 'secondary':
        return { bgcolor: 'secondary.light', color: 'secondary.dark' };
      case 'info':
        return { bgcolor: 'info.light', color: 'info.dark' };
      case 'warning':
        return { bgcolor: 'warning.light', color: 'warning.dark' };
      case 'error':
        return { bgcolor: 'error.light', color: 'error.dark' };
      case 'success':
        return { bgcolor: 'success.light', color: 'success.dark' };
      default:
        return { bgcolor: 'grey.100', color: 'text.primary' };
    }
  };

  return (
    <Box mb={3}>
      {showBreadcrumbs && breadcrumbPath.length > 0 && (
        <Breadcrumbs 
          separator={<NavigateNextIcon fontSize="small" />} 
          aria-label="breadcrumb"
          sx={{ mb: 2 }}
        >
          {breadcrumbPath.map((item, index) => (
            item.href ? (
              <Link
                key={index}
                component={RouterLink}
                to={item.href}
                color={index === breadcrumbPath.length - 1 ? "text.primary" : "inherit"}
                underline={index === breadcrumbPath.length - 1 ? "none" : "hover"}
                sx={{
                  fontWeight: index === breadcrumbPath.length - 1 ? 600 : 400,
                  textDecoration: 'none',
                  '&:hover': {
                    textDecoration: index === breadcrumbPath.length - 1 ? 'none' : 'underline'
                  }
                }}
              >
                {item.label}
              </Link>
            ) : (
              <Typography
                key={index}
                color={index === breadcrumbPath.length - 1 ? "text.primary" : "inherit"}
                sx={{
                  fontWeight: index === breadcrumbPath.length - 1 ? 600 : 400,
                }}
              >
                {item.label}
              </Typography>
            )
          ))}
        </Breadcrumbs>
      )}
      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Box display="flex" alignItems="flex-start" gap={3}>
        <Box
          position="relative"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <Avatar 
            src={avatarUrl || undefined} 
            sx={{ width: 128, height: 128, fontSize: '2rem' }}
            onError={(e) => {
              // Handle broken image URLs (like LinkedIn profile photos that no longer exist)
              console.log('Avatar image failed to load, falling back to initials:', avatarUrl);
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
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

          {hover && !avatarUrl && canEditAvatar && (
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

          {hover && avatarUrl && canEditAvatar && (
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
          <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
            {`${firstName} ${lastName}`}
            {preferredName && preferredName !== firstName && ` (${preferredName})`}
          </Typography>
          {Boolean(jobTitle) && (
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 'bold', mt: 0.25 }}>
              {jobTitle}
            </Typography>
          )}
          {(regionName || departmentName || divisionName || locationName || managerName) && (
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              {regionName && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <PublicIcon fontSize="small" color="primary" />
                  <Typography variant="body2" color="text.secondary">{regionName}</Typography>
                </Stack>
              )}
              {departmentName && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <BusinessIcon fontSize="small" color="primary" />
                  <Typography variant="body2" color="text.secondary">{departmentName}</Typography>
                </Stack>
              )}
              {divisionName && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <AccountTreeIcon fontSize="small" color="primary" />
                  <Typography variant="body2" color="text.secondary">{divisionName}</Typography>
                </Stack>
              )}
              {locationName && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <LocationOnOutlinedIcon fontSize="small" color="primary" />
                  <Typography variant="body2" color="text.secondary">{locationName}</Typography>
                </Stack>
              )}
              {managerName && managerId && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <PersonIcon fontSize="small" color="primary" />
                  <Link 
                    component={RouterLink}
                    to={`/users/${managerId}`} 
                    underline="hover" 
                    color="inherit"
                    sx={{ textDecoration: 'none' }}
                  >
                    <Typography variant="body2" color="text.secondary">{managerName}</Typography>
                  </Link>
                </Stack>
              )}
            </Stack>
          )}
          <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
            {email && (
              <Stack direction="row" spacing={1} alignItems="center">
                <EmailOutlinedIcon fontSize="small" color="primary" />
                <Link href={`mailto:${email}`} underline="hover" color="inherit">
                  <Typography variant="body2">{email}</Typography>
                </Link>
              </Stack>
            )}
            {phone && (
              <Stack direction="row" spacing={1} alignItems="center">
                <PhoneOutlinedIcon fontSize="small" color="primary" />
                <Link href={`tel:${phone}`} underline="hover" color="inherit">
                  <Typography variant="body2">{phone}</Typography>
                </Link>
              </Stack>
            )}
          </Stack>
          {linkedinUrl && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
              <LinkedInIcon fontSize="small" color="primary" />
              <Link
                href={normalizeLinkedInUrl(linkedinUrl)}
                target="_blank"
                rel="noopener noreferrer"
                underline="hover"
                color="inherit"
              >
                <Typography variant="body2">{linkedinUrl.replace(/^https?:\/\//i, '')}</Typography>
              </Link>
            </Stack>
          )}
          {(workStatus || securityLevel || employmentType) && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75, flexWrap: 'wrap' }}>
              {workStatus && (
                <>
                  <Typography variant="body2" color="text.secondary">Status:</Typography>
                  <Chip
                    size="small"
                    label={workStatus}
                    color={getWorkStatusColor(workStatus)}
                  />
                </>
              )}
              {getSecurityLabel(securityLevel) && (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>Security Level:</Typography>
                  <Chip
                    size="small"
                    label={getSecurityLabel(securityLevel)!}
                    sx={{ ...getSoftChipSx(getSecurityColor(securityLevel)), fontWeight: 600 }}
                  />
                </>
              )}
              {employmentType && (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>Employment Type:</Typography>
                  <Chip
                    size="small"
                    label={getEmploymentTypeLabel(employmentType)}
                    color={getEmploymentTypeColor(employmentType)}
                  />
                </>
              )}
            </Stack>
          )}
        </Box>
      </Box>

        {/* <Stack direction="row" spacing={2} alignItems="center">
          {showBackButton && (
            <Button variant="outlined" onClick={onBack}>
              &larr; Back to Workforce
            </Button>
          )}
        </Stack> */}
      </Box>
    </Box>
  );
};

export default UserProfileHeader;
