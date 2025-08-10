import React, { useRef, useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Grid,
  TextField,
  Button,
  Snackbar,
  Alert,
  Tooltip,
  IconButton,
  Avatar,
  Paper,
} from '@mui/material';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import ClearIcon from '@mui/icons-material/Clear';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

import { storage, db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

interface BrandingTabProps {
  tenantId: string;
}

interface BrandingData {
  logo?: string;
  websiteUrl?: string;
  hrEmail?: string;
  accentColor?: string;
  senderName?: string;
  legalFooter?: string;
}

const BrandingTab: React.FC<BrandingTabProps> = ({ tenantId }) => {
  const { user } = useAuth();
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [hover, setHover] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const [branding, setBranding] = useState<BrandingData>({
    logo: '',
    websiteUrl: '',
    hrEmail: '',
    accentColor: '#0057B8',
    senderName: 'HRX Notifications',
    legalFooter: '',
  });

  const [originalBranding, setOriginalBranding] = useState<BrandingData>({
    logo: '',
    websiteUrl: '',
    hrEmail: '',
    accentColor: '#0057B8',
    senderName: 'HRX Notifications',
    legalFooter: '',
  });

  useEffect(() => {
    fetchBrandingData();
  }, [tenantId]);

  const fetchBrandingData = async () => {
    try {
      // Get tenant document for avatar
      const tenantRef = doc(db, 'tenants', tenantId);
      const tenantSnap = await getDoc(tenantRef);
      
      // Get branding settings
      const brandingRef = doc(db, 'tenants', tenantId, 'branding', 'settings');
      const brandingSnap = await getDoc(brandingRef);
      
      let brandingData: BrandingData = {
        logo: '',
        websiteUrl: '',
        hrEmail: '',
        accentColor: '#0057B8',
        senderName: 'HRX Notifications',
        legalFooter: '',
      };
      
      // Use avatar from tenant document if available
      if (tenantSnap.exists()) {
        const tenantData = tenantSnap.data();
        brandingData.logo = tenantData.avatar || '';
      }
      
      // Merge with branding settings
      if (brandingSnap.exists()) {
        const data = brandingSnap.data() as BrandingData;
        brandingData = { ...brandingData, ...data };
      }
      
      setBranding(brandingData);
      setOriginalBranding(brandingData);
    } catch (err) {
      console.error('Failed to fetch branding data:', err);
    }
  };

  const handleLogoClick = () => {
    logoInputRef.current?.click();
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Check authentication
      if (!user) {
        setError('You must be logged in to upload a logo');
        return;
      }
      
      // Validate file size (2MB max)
      if (file.size > 2 * 1024 * 1024) {
        setError('Logo file size must be less than 2MB');
        return;
      }

      // Validate file type
      const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
      if (!validTypes.includes(file.type)) {
        setError('Please upload a PNG, JPG, or SVG file');
        return;
      }

      setLoading(true);
      try {
        const storageRef = ref(storage, `branding/${tenantId}/logo.${file.name.split('.').pop()}`);
        await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(storageRef);
        
        const updatedBranding = { ...branding, logo: downloadURL };
        setBranding(updatedBranding);
        
        // Save to Firestore - save logo as avatar on tenant document
        await setDoc(doc(db, 'tenants', tenantId), { avatar: downloadURL }, { merge: true });
        // Also save to branding settings for other branding data
        await setDoc(doc(db, 'tenants', tenantId, 'branding', 'settings'), updatedBranding, { merge: true });
        setSuccess(true);
      } catch (err) {
        console.error('Error uploading logo:', err);
        setError('Failed to upload logo. Please try again.');
      }
      setLoading(false);
    }
  };

  const handleDeleteLogo = async () => {
    setLoading(true);
    try {
      if (branding.logo) {
        // Extract the file extension from the existing logo URL
        const urlParts = branding.logo.split('/');
        const fileName = urlParts[urlParts.length - 1];
        const fileExtension = fileName.split('.').pop() || 'png';
        const storageRef = ref(storage, `branding/${tenantId}/logo.${fileExtension}`);
        await deleteObject(storageRef);
      }
      
      const updatedBranding = { ...branding, logo: '' };
      setBranding(updatedBranding);
      // Remove avatar from tenant document
      await setDoc(doc(db, 'tenants', tenantId), { avatar: '' }, { merge: true });
      // Also update branding settings
      await setDoc(doc(db, 'tenants', tenantId, 'branding', 'settings'), updatedBranding, { merge: true });
      setSuccess(true);
    } catch (err) {
      console.error('Error deleting logo:', err);
      setError('Failed to delete logo. Please try again.');
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await setDoc(doc(db, 'tenants', tenantId, 'branding', 'settings'), branding, { merge: true });
      setOriginalBranding(branding);
      setSuccess(true);
    } catch (err) {
      console.error('Failed to save branding settings:', err);
      setError('Failed to save branding settings. Please try again.');
    }
    setLoading(false);
  };

  const isChanged = JSON.stringify(branding) !== JSON.stringify(originalBranding);

  const validateUrl = (url: string) => {
    if (!url) return true;
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const validateEmail = (email: string) => {
    if (!email) return true;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const isFormValid = 
    validateUrl(branding.websiteUrl) && 
    validateEmail(branding.hrEmail) && 
    branding.senderName.trim() !== '';

  const initials = tenantId ? tenantId.substring(0, 2).toUpperCase() : 'CO';

  return (
    <Box sx={{ p: 0 }}>
      <Typography variant="h6" gutterBottom>
        Branding Settings
        <Tooltip title="Customize your company's visual identity and communication defaults">
          <IconButton size="small" sx={{ ml: 1 }}>
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Typography>
      
      <Grid container spacing={3}>
        {/* Company Logo Upload */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="subtitle1" gutterBottom>
              Company Logo
              <Tooltip title="Upload your company logo (PNG, JPG, SVG, max 2MB). Used in admin dashboard, worker app, and emails.">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Typography>
            
            <Box
              display="flex"
              flexDirection="column"
              alignItems="center"
              gap={2}
              onMouseEnter={() => setHover(true)}
              onMouseLeave={() => setHover(false)}
            >
              <Box position="relative">
                <Avatar 
                  src={branding.logo || undefined} 
                  sx={{ 
                    width: 120, 
                    height: 120, 
                    fontSize: '2rem',
                    border: '2px solid #e0e0e0'
                  }}
                >
                  {!branding.logo && initials}
                </Avatar>

                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/svg+xml"
                  ref={logoInputRef}
                  style={{ display: 'none' }}
                  onChange={handleLogoUpload}
                />

                {hover && !branding.logo && (
                  <Tooltip title="Upload logo">
                    <IconButton
                      size="small"
                      onClick={handleLogoClick}
                      disabled={loading}
                      sx={{
                        position: 'absolute',
                        bottom: 0,
                        right: 0,
                        backgroundColor: 'white',
                        borderRadius: '50%',
                        boxShadow: 1,
                      }}
                    >
                      <CameraAltIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}

                {hover && branding.logo && (
                  <Tooltip title="Remove logo">
                    <IconButton
                      size="small"
                      onClick={handleDeleteLogo}
                      disabled={loading}
                      sx={{
                        position: 'absolute',
                        bottom: 0,
                        right: 0,
                        backgroundColor: 'white',
                        borderRadius: '50%',
                        boxShadow: 1,
                      }}
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>

              <Button
                variant="outlined"
                startIcon={<CloudUploadIcon />}
                onClick={handleLogoClick}
                disabled={loading}
                size="small"
              >
                {branding.logo ? 'Change Logo' : 'Upload Logo'}
              </Button>
              
              <Typography variant="caption" color="text.secondary" textAlign="center">
                PNG, JPG, SVG • Max 2MB • 1:1 aspect ratio preferred
              </Typography>
            </Box>
          </Paper>
        </Grid>

        {/* Company Information */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="subtitle1" gutterBottom>
              Company Information
            </Typography>
            
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  label="Company Website"
                  value={branding.websiteUrl}
                  onChange={(e) => setBranding({ ...branding, websiteUrl: e.target.value })}
                  fullWidth
                  placeholder="https://example.com"
                  error={!validateUrl(branding.websiteUrl)}
                  helperText={!validateUrl(branding.websiteUrl) ? 'Please enter a valid URL' : 'Your company website for worker reference'}
                />
              </Grid>
              
              <Grid item xs={12}>
                <TextField
                  label="HR Contact Email"
                  value={branding.hrEmail}
                  onChange={(e) => setBranding({ ...branding, hrEmail: e.target.value })}
                  fullWidth
                  placeholder="hr@example.com"
                  error={!validateEmail(branding.hrEmail)}
                  helperText={!validateEmail(branding.hrEmail) ? 'Please enter a valid email' : 'Used in contact links and email footers'}
                />
              </Grid>
              
              <Grid item xs={12}>
                <TextField
                  label="Email Sender Name"
                  value={branding.senderName}
                  onChange={(e) => setBranding({ ...branding, senderName: e.target.value })}
                  fullWidth
                  placeholder="HRX Notifications"
                  helperText="Appears as the 'From' name in system emails"
                />
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        {/* Accent Color */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="subtitle1" gutterBottom>
              Accent Color
              <Tooltip title="Choose your brand color for UI elements like buttons and badges">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Typography>
            
            <Box display="flex" alignItems="center" gap={2}>
              <TextField
                label="Color (HEX)"
                value={branding.accentColor}
                onChange={(e) => setBranding({ ...branding, accentColor: e.target.value })}
                placeholder="#0057B8"
                sx={{ flexGrow: 1 }}
              />
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  backgroundColor: branding.accentColor || '#0057B8',
                  border: '2px solid #e0e0e0',
                  borderRadius: 1,
                }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary">
              Used for buttons, badges, and UI highlights
            </Typography>
          </Paper>
        </Grid>

        {/* Legal Footer */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="subtitle1" gutterBottom>
              Legal Footer / Compliance Text
              <Tooltip title="Text displayed at the bottom of emails and worker portal (markdown supported)">
                <IconButton size="small" sx={{ ml: 1 }}>
                  <HelpOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Typography>
            
            <TextField
              label="Legal Footer"
              value={branding.legalFooter}
              onChange={(e) => setBranding({ ...branding, legalFooter: e.target.value })}
              fullWidth
              multiline
              minRows={4}
              placeholder="Example: This email is confidential and intended for the recipient only. Please do not forward without permission."
              helperText="Markdown supported. Displayed in emails and worker portal footer"
            />
          </Paper>
        </Grid>
      </Grid>

      {/* Save Button */}
      <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={loading || !isChanged || !isFormValid}
        >
          {loading ? 'Saving...' : 'Save Branding Settings'}
        </Button>
        
        {isChanged && (
          <Button
            variant="outlined"
            onClick={() => {
              setBranding(originalBranding);
            }}
          >
            Reset Changes
          </Button>
        )}
      </Box>

      {/* Notifications */}
      <Snackbar open={success} autoHideDuration={3000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Branding settings saved successfully!
        </Alert>
      </Snackbar>
      
      <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default BrandingTab; 