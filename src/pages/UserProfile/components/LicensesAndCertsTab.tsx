import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Stack,
  TextField,
  IconButton,
  Grid,
  Chip,
  Autocomplete,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Visibility as ViewIcon } from '@mui/icons-material';
import { doc, onSnapshot, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../../firebase';
import credentialsSeed from '../../../data/credentialsSeed.json';

type Props = {
  uid: string;
};

interface Certification {
  name: string;
  fileUrl: string;
  fileName: string;
  uploadedAt: Date;
}

const LicensesAndCertsTab: React.FC<Props> = ({ uid }) => {
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [newCertName, setNewCertName] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingCertName, setPendingCertName] = useState('');
  
  // Get suggested credentials from seed data, filtered by active status
  const suggestedCredentials = credentialsSeed
    .filter(c => c.is_active)
    .map(c => `${c.name} (${c.type})`);

  useEffect(() => {
    if (!uid) return;

    // Listen to user document for certifications
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const certs: Certification[] = Array.isArray(data.certifications)
          ? data.certifications
              .filter((c: any) => c && typeof c === 'object' && c.fileUrl)
              .map((c: any) => ({
                name: c.name || 'Unnamed Certificate',
                fileUrl: c.fileUrl || c.downloadUrl,
                fileName: c.fileName || 'file',
                uploadedAt: c.uploadedAt?.toDate?.() || new Date(c.uploadedAt) || new Date(),
              }))
          : [];
        setCertifications(certs);
      }
    });

    return () => unsubscribe();
  }, [uid]);

  const handleAddCertClick = (certName?: string) => {
    const name = certName || newCertName.trim();
    if (!name) {
      alert('Please enter a name for the certificate/license');
      return;
    }
    setPendingCertName(name);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      if (!file || !pendingCertName) return;

      setUploading(true);
      const certSlug = pendingCertName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const path = `users/${uid}/certifications/${certSlug}/${Date.now()}-${file.name}`;
      const fileRef = ref(storage, path);
      
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);

      const certObj = {
        name: pendingCertName,
        fileUrl: url,
        fileName: file.name,
        uploadedAt: new Date(),
      };

      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        certifications: arrayUnion(certObj),
        updatedAt: serverTimestamp(),
      });

      setNewCertName('');
      setPendingCertName('');
    } catch (error) {
      console.error('Error uploading certification:', error);
      alert('Failed to upload certification');
    } finally {
      setUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleDelete = async (cert: Certification) => {
    if (!confirm(`Are you sure you want to delete ${cert.name}?`)) return;

    try {
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        certifications: arrayRemove(cert),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error deleting certification:', error);
      alert('Failed to delete certification');
    }
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  return (
    <Box sx={{ p: 0 }}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 3 }}>
            Licenses & Certifications
          </Typography>

          {/* Add New Certification */}
          <Box sx={{ mb: 4 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
              Add New Certificate or License
            </Typography>
            <Stack direction="row" spacing={2} alignItems="flex-start">
              <Autocomplete
                fullWidth
                freeSolo
                options={suggestedCredentials}
                value={newCertName}
                onInputChange={(_, newValue) => setNewCertName(newValue)}
                onChange={(_, newValue) => {
                  if (newValue) {
                    setNewCertName(newValue);
                  }
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Certificate/License Name"
                    placeholder="Type or search from 60+ standard credentials..."
                    helperText="Start typing to search licenses and certifications"
                  />
                )}
                filterSelectedOptions
              />
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => handleAddCertClick()}
                disabled={!newCertName.trim() || uploading}
                sx={{ minWidth: 120, height: 56 }}
              >
                {uploading ? 'Uploading...' : 'Upload'}
              </Button>
            </Stack>
          </Box>

          {/* List of Certifications */}
          <Box sx={{ mt: 4 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
              Your Certificates & Licenses ({certifications.length})
            </Typography>
            
            {certifications.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', py: 2 }}>
                No certifications or licenses uploaded yet.
              </Typography>
            ) : (
              <Stack spacing={2}>
                {certifications.map((cert, index) => (
                  <Card key={index} variant="outlined" sx={{ backgroundColor: 'grey.50' }}>
                    <CardContent>
                      <Stack spacing={1}>
                        <Typography variant="body1" sx={{ fontWeight: 600 }}>
                          {cert.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {cert.fileName} • Uploaded {formatDate(cert.uploadedAt)}
                        </Typography>
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            variant="text"
                            startIcon={<ViewIcon />}
                            href={cert.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View
                          </Button>
                          <Button
                            size="small"
                            variant="text"
                            color="error"
                            startIcon={<DeleteIcon />}
                            onClick={() => handleDelete(cert)}
                          >
                            Delete
                          </Button>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </Box>

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileSelected}
          />
        </CardContent>
      </Card>
    </Box>
  );
};

export default LicensesAndCertsTab;

