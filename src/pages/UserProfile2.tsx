import React, { useEffect, useState, useCallback } from 'react';
import {
  Box,
  TextField,
  Typography,
  Button,
  Avatar,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Slider,
  Snackbar,
  Alert,
  Grid,
} from '@mui/material';
import { useParams } from 'react-router-dom';
import { db, storage } from '../firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import Cropper, { Area } from 'react-easy-crop';
import { useAuth } from '../contexts/AuthContext';

const UserProfile = () => {
  const { uid } = useParams<{ uid: string }>();
  const { currentUser, role, setAvatarUrl } = useAuth();
  const isSelf = currentUser?.uid === uid;
  const isAdmin = role === 'admin' || role === 'god';

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    role: 'worker',
    avatar: '',
  });
  const [message, setMessage] = useState('');
  const [showCropModal, setShowCropModal] = useState(false);
  const [imageSrc, setImageSrc] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [formChanged, setFormChanged] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      const userRef = doc(db, 'users', uid!);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        setForm(userSnap.data() as any);
      }
    };
    fetchData();
  }, [uid]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setFormChanged(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const userRef = doc(db, 'users', uid!);
    await updateDoc(userRef, form);
    setMessage('Profile updated successfully');
    setShowToast(true);
    setFormChanged(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        setImageSrc(reader.result as string);
        setShowCropModal(true);
      });
      reader.readAsDataURL(file);
    }
  };

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const getCroppedImageBlob = (imageSrc: string, crop: Area): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.src = imageSrc;
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = crop.width;
        canvas.height = crop.height;
        const ctx = canvas.getContext('2d');

        if (!ctx) return reject(new Error('Canvas context not available'));

        ctx.drawImage(
          image,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          0,
          0,
          crop.width,
          crop.height,
        );

        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('Failed to create blob'));
          resolve(blob);
        }, 'image/jpeg');
      };
      image.onerror = reject;
    });
  };

  const handleCropSave = async () => {
    if (!croppedAreaPixels || !imageSrc) return;

    try {
      const croppedImageBlob = await getCroppedImageBlob(imageSrc, croppedAreaPixels);
      const avatarRef = ref(storage, `avatars/${uid}.jpg`);
      await uploadBytes(avatarRef, croppedImageBlob);
      const avatarURL = await getDownloadURL(avatarRef);

      const userRef = doc(db, 'users', uid!);
      await updateDoc(userRef, { avatar: avatarURL });

      setForm((prev) => ({ ...prev, avatar: avatarURL }));
      setMessage('Avatar updated!');
      setShowCropModal(false);
      setShowToast(true);
      if (setAvatarUrl) setAvatarUrl(avatarURL);
    } catch (error) {
      console.error('Avatar upload error:', error);
      setMessage('Failed to update avatar');
      setShowToast(true);
    }
  };

  const handleDeleteAvatar = async () => {
    try {
      const avatarRef = ref(storage, `avatars/${uid}.jpg`);
      await deleteObject(avatarRef);
      const userRef = doc(db, 'users', uid!);
      await updateDoc(userRef, { avatar: '' });
      setForm((prev) => ({ ...prev, avatar: '' }));
      setMessage('Avatar deleted!');
      setShowToast(true);
      if (setAvatarUrl) setAvatarUrl('');
    } catch (error) {
      console.error('Delete avatar error:', error);
      setMessage('Failed to delete avatar');
      setShowToast(true);
    }
  };

  const initials = `${form.firstName?.[0] ?? ''}${form.lastName?.[0] ?? ''}`.toUpperCase();

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" mb={2}>
        User Profile
      </Typography>
      <Box component="form" onSubmit={handleSubmit} noValidate sx={{ mt: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar src={form.avatar} sx={{ width: 120, height: 120 }}>
              {!form.avatar && initials}
            </Avatar>
            <Typography variant="h6">
              {form.firstName} {form.lastName}
            </Typography>
          </Grid>
          {form.avatar ? (
            <Grid item xs={12} sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <Button variant="outlined" color="error" size="small" onClick={handleDeleteAvatar}>
                Delete
              </Button>
              <Button variant="outlined" size="small" onClick={() => setShowCropModal(true)}>
                Replace
              </Button>
            </Grid>
          ) : (
            <Grid item xs={12} sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <Button variant="outlined" size="small" component="label">
                Add Avatar
                <input type="file" accept="image/*" hidden onChange={handleImageUpload} />
              </Button>
            </Grid>
          )}
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              name="firstName"
              label="First Name"
              value={form.firstName}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              name="lastName"
              label="Last Name"
              value={form.lastName}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              name="email"
              label="Email"
              value={form.email}
              onChange={handleChange}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              name="phone"
              label="Phone"
              value={form.phone}
              onChange={handleChange}
            />
          </Grid>
          {formChanged && (
            <Grid item xs={12}>
              <Button type="submit" variant="contained">
                Save Changes
              </Button>
            </Grid>
          )}
        </Grid>
      </Box>

      <Dialog open={showCropModal} onClose={() => setShowCropModal(false)} fullWidth maxWidth="sm">
        <DialogTitle>Crop Your Avatar</DialogTitle>
        <DialogContent>
          <Box position="relative" width="100%" height={300}>
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </Box>
          <Slider
            value={zoom}
            min={1}
            max={3}
            step={0.1}
            onChange={(_, value) => setZoom(value as number)}
            aria-label="Zoom"
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCropModal(false)}>Cancel</Button>
          <Button onClick={handleCropSave} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={showToast} autoHideDuration={3000} onClose={() => setShowToast(false)}>
        <Alert onClose={() => setShowToast(false)} severity="success" sx={{ width: '100%' }}>
          {message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default UserProfile;
