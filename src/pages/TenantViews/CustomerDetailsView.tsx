import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Grid,
  TextField,
  IconButton,
  Card,
  CardContent,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  Select,
  MenuItem,
  Chip,
  Avatar,
  Alert,
  Snackbar,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Business as BusinessIcon,
  Person as PersonIcon,
  LocationOn as LocationIcon,
  Phone as PhoneIcon,
  Email as EmailIcon,
  ArrowBack as ArrowBackIcon,
  CameraAlt as CameraAltIcon,
  Clear as ClearIcon,
  LinkedIn as LinkedInIcon,
} from '@mui/icons-material';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  where,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { Autocomplete } from '@react-google-maps/api';

import { db, storage } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { geocodeAddress } from '../../utils/geocodeAddress';
import IndustrySelector from '../../components/IndustrySelector';

interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  notes: string;
  createdAt: Date;
}

interface WorksiteLocation {
  id: string;
  nickname: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
  lat?: number;
  lng?: number;
  createdAt: Date;
}

interface WorkforceAssociation {
  id: string;
  userId: string;
  userName: string;
  role: string;
  createdAt: Date;
}

interface CustomerDetailsViewProps {
  customer: any;
  tenantId: string;
  onBack: () => void;
  onRemoveCustomer: (customerId: string) => void;
}

const CustomerDetailsView: React.FC<CustomerDetailsViewProps> = ({
  customer,
  tenantId,
  onBack,
  onRemoveCustomer,
}) => {
  const { currentUser, activeTenant } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [worksiteLocations, setWorksiteLocations] = useState<WorksiteLocation[]>([]);
  const [workforceAssociations, setWorkforceAssociations] = useState<WorkforceAssociation[]>([]);
  const [workforceUsers, setWorkforceUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Contact dialog state
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: '',
    notes: '',
  });
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  
  // Worksite dialog state
  const [worksiteDialogOpen, setWorksiteDialogOpen] = useState(false);
  const [worksiteForm, setWorksiteForm] = useState({
    nickname: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    notes: '',
  });
  const [editingWorksite, setEditingWorksite] = useState<WorksiteLocation | null>(null);
  const [autocompleteRef, setAutocompleteRef] = useState<any>(null);
  
  // Success/error messages
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  
  // Remove customer dialog
  const [removeCustomerDialogOpen, setRemoveCustomerDialogOpen] = useState(false);
  
  // Avatar functionality
  const [avatarHover, setAvatarHover] = useState(false);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  
  // Industry editing state
  const [editingIndustry, setEditingIndustry] = useState(false);
  const [editingLocation, setEditingLocation] = useState(false);
  const [editingLinkedIn, setEditingLinkedIn] = useState(false);
  const [industryValue, setIndustryValue] = useState(customer.industry || '');
  const [locationValue, setLocationValue] = useState(customer.companyLocationId || '');
  const [linkedInValue, setLinkedInValue] = useState(customer.linkedInUrl || '');
  const [companyLocations, setCompanyLocations] = useState<any[]>([]);
  
  // Workforce association state
  const [selectedWorkforceUser, setSelectedWorkforceUser] = useState<any>(null);
  const [workforceRole, setWorkforceRole] = useState('');
  
  // Status toggle state
  const [customerStatus, setCustomerStatus] = useState(customer.status !== false); // Default to true if not explicitly false

  useEffect(() => {
    loadContacts();
    loadWorksiteLocations();
    loadCompanyLocations();
    loadWorkforceUsers();
    loadWorkforceAssociations();
  }, [customer.id]);

  const loadContacts = async () => {
    try {
      const contactsRef = collection(db, 'tenants', tenantId, 'customers', customer.id, 'contacts');
      const q = query(contactsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const contactsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate() || new Date(),
      })) as Contact[];
      setContacts(contactsData);
    } catch (error) {
      console.error('Error loading contacts:', error);
    }
  };

  const loadWorksiteLocations = async () => {
    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'customers', customer.id, 'locations');
      const q = query(locationsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const locationsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate() || new Date(),
      })) as WorksiteLocation[];
      setWorksiteLocations(locationsData);
    } catch (error) {
      console.error('Error loading worksite locations:', error);
    }
  };

  const loadCompanyLocations = async () => {
    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'locations');
      const snapshot = await getDocs(locationsRef);
      const locationsData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setCompanyLocations(locationsData);
    } catch (error) {
      console.error('Error loading company locations:', error);
    }
  };

  const loadWorkforceUsers = async () => {
    try {
      const usersRef = collection(db, 'users');
      const q = query(
        usersRef,
        where('tenantId', '==', tenantId),
        where('role', '==', 'Worker')
      );
      const snapshot = await getDocs(q);
      const usersData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setWorkforceUsers(usersData);
    } catch (error) {
      console.error('Error loading workforce users:', error);
    }
  };

  const loadWorkforceAssociations = async () => {
    try {
      const associationsRef = collection(db, 'tenants', tenantId, 'customers', customer.id, 'workforceAssociations');
      const q = query(associationsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const associationsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate() || new Date(),
      })) as WorkforceAssociation[];
      setWorkforceAssociations(associationsData);
    } catch (error) {
      console.error('Error loading workforce associations:', error);
    }
  };

  const handleContactSubmit = async () => {
    if (!contactForm.name.trim()) return;
    
    setLoading(true);
    try {
      const contactData = {
        ...contactForm,
        createdAt: serverTimestamp(),
      };

      if (editingContact) {
        await updateDoc(doc(db, 'tenants', tenantId, 'customers', customer.id, 'contacts', editingContact.id), contactData);
        setSuccessMessage('Contact updated successfully!');
      } else {
        await addDoc(collection(db, 'tenants', tenantId, 'customers', customer.id, 'contacts'), contactData);
        setSuccessMessage('Contact added successfully!');
      }

      setContactDialogOpen(false);
      setContactForm({ name: '', email: '', phone: '', role: '', notes: '' });
      setEditingContact(null);
      loadContacts();
    } catch (error) {
      setErrorMessage('Failed to save contact');
    } finally {
      setLoading(false);
    }
  };

  const handleWorksiteSubmit = async () => {
    if (!worksiteForm.nickname.trim() || !worksiteForm.street.trim()) return;
    
    setLoading(true);
    try {
      const fullAddress = `${worksiteForm.street}, ${worksiteForm.city}, ${worksiteForm.state} ${worksiteForm.zip}`;
      const geo = await geocodeAddress(fullAddress);
      
      const worksiteData = {
        ...worksiteForm,
        lat: geo.lat,
        lng: geo.lng,
        createdAt: serverTimestamp(),
      };

      if (editingWorksite) {
        await updateDoc(doc(db, 'tenants', tenantId, 'customers', customer.id, 'locations', editingWorksite.id), worksiteData);
        setSuccessMessage('Worksite location updated successfully!');
      } else {
        await addDoc(collection(db, 'tenants', tenantId, 'customers', customer.id, 'locations'), worksiteData);
        setSuccessMessage('Worksite location added successfully!');
      }

      setWorksiteDialogOpen(false);
      setWorksiteForm({ nickname: '', street: '', city: '', state: '', zip: '', notes: '' });
      setEditingWorksite(null);
      loadWorksiteLocations();
    } catch (error) {
      setErrorMessage('Failed to save worksite location');
    } finally {
      setLoading(false);
    }
  };

  const handleEditContact = (contact: Contact) => {
    setEditingContact(contact);
    setContactForm({
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      role: contact.role,
      notes: contact.notes,
    });
    setContactDialogOpen(true);
  };

  const handleEditWorksite = (worksite: WorksiteLocation) => {
    setEditingWorksite(worksite);
    setWorksiteForm({
      nickname: worksite.nickname,
      street: worksite.street,
      city: worksite.city,
      state: worksite.state,
      zip: worksite.zip,
      notes: worksite.notes,
    });
    setWorksiteDialogOpen(true);
  };

  const handleDeleteContact = async (contactId: string) => {
    if (window.confirm('Are you sure you want to delete this contact?')) {
      try {
        await deleteDoc(doc(db, 'tenants', tenantId, 'customers', customer.id, 'contacts', contactId));
        setSuccessMessage('Contact deleted successfully!');
        loadContacts();
      } catch (error) {
        setErrorMessage('Failed to delete contact');
      }
    }
  };

  const handleDeleteWorksite = async (worksiteId: string) => {
    if (window.confirm('Are you sure you want to delete this worksite location?')) {
      try {
        await deleteDoc(doc(db, 'tenants', tenantId, 'customers', customer.id, 'locations', worksiteId));
        setSuccessMessage('Worksite location deleted successfully!');
        loadWorksiteLocations();
      } catch (error) {
        setErrorMessage('Failed to delete worksite location');
      }
    }
  };

  const handlePlaceChanged = () => {
    const place = autocompleteRef?.getPlace();
    if (!place || !place.geometry) return;
    
    const components = place.address_components || [];
    const getComponent = (types: string[]) =>
      components.find((comp: any) => types.every((t) => comp.types.includes(t)))?.long_name || '';
    
    setWorksiteForm(prev => ({
      ...prev,
      street: `${getComponent(['street_number'])} ${getComponent(['route'])}`.trim(),
      city: getComponent(['locality']),
      state: getComponent(['administrative_area_level_1']),
      zip: getComponent(['postal_code']),
    }));
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const handleAvatarClick = () => {
    avatarFileInputRef.current?.click();
  };

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const storageRef = ref(storage, `avatars/customer_${customer.id}.jpg`);

      try {
        await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(storageRef);
        await updateDoc(doc(db, 'tenants', tenantId, 'customers', customer.id), { avatar: downloadURL });
        setSuccessMessage('Avatar updated successfully!');
      } catch (error) {
        console.error('Error uploading avatar:', error);
        setErrorMessage('Failed to upload avatar');
      }
    }
  };

  const handleDeleteAvatar = async () => {
    const storageRef = ref(storage, `avatars/customer_${customer.id}.jpg`);

    try {
      await deleteObject(storageRef);
      await updateDoc(doc(db, 'tenants', tenantId, 'customers', customer.id), { avatar: '' });
      setSuccessMessage('Avatar removed successfully!');
    } catch (error) {
      console.error('Error deleting avatar:', error);
      setErrorMessage('Failed to delete avatar');
    }
  };

  const handleSaveIndustry = async () => {
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'customers', customer.id), { industry: industryValue });
      setEditingIndustry(false);
      setSuccessMessage('Industry updated successfully!');
    } catch (error) {
      console.error('Error updating industry:', error);
      setErrorMessage('Failed to update industry');
    }
  };

  const handleSaveLocation = async () => {
    try {
      const updateData: any = {};
      if (locationValue) {
        updateData.companyLocationId = locationValue;
      } else {
        updateData.companyLocationId = null;
      }
      await updateDoc(doc(db, 'tenants', tenantId, 'customers', customer.id), updateData);
      setEditingLocation(false);
      setSuccessMessage('Location association updated successfully!');
    } catch (error) {
      console.error('Error updating location association:', error);
      setErrorMessage('Failed to update location association');
    }
  };

  const handleSaveLinkedIn = async () => {
    try {
      const updateData: any = {};
      if (linkedInValue.trim()) {
        updateData.linkedInUrl = linkedInValue.trim();
      } else {
        updateData.linkedInUrl = null;
      }
      await updateDoc(doc(db, 'tenants', tenantId, 'customers', customer.id), updateData);
      setEditingLinkedIn(false);
      setSuccessMessage('LinkedIn URL updated successfully!');
    } catch (error) {
      console.error('Error updating LinkedIn URL:', error);
      setErrorMessage('Failed to update LinkedIn URL');
    }
  };

  const handleToggleStatus = async () => {
    try {
      const newStatus = !customerStatus;
      await updateDoc(doc(db, 'tenants', tenantId, 'customers', customer.id), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
      setCustomerStatus(newStatus);
      setSuccessMessage(`Customer status updated to ${newStatus ? 'Active' : 'Inactive'}!`);
    } catch (error) {
      console.error('Error updating customer status:', error);
      setErrorMessage('Failed to update customer status');
    }
  };

  const handleAddWorkforceAssociation = async () => {
    if (!selectedWorkforceUser || !workforceRole.trim()) {
      setErrorMessage('Please select a user and enter a role');
      return;
    }

    try {
      setLoading(true);
      const associationData = {
        userId: selectedWorkforceUser.id,
        userName: `${selectedWorkforceUser.firstName} ${selectedWorkforceUser.lastName}`,
        role: workforceRole.trim(),
        createdAt: serverTimestamp(),
      };
      
      await addDoc(collection(db, 'tenants', tenantId, 'customers', customer.id, 'workforceAssociations'), associationData);
      
      setSelectedWorkforceUser(null);
      setWorkforceRole('');
      await loadWorkforceAssociations();
      setSuccessMessage('Workforce association added successfully');
    } catch (error) {
      console.error('Error adding workforce association:', error);
      setErrorMessage('Failed to add workforce association');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveWorkforceAssociation = async (associationId: string) => {
    try {
      setLoading(true);
      await deleteDoc(doc(db, 'tenants', tenantId, 'customers', customer.id, 'workforceAssociations', associationId));
      await loadWorkforceAssociations();
      setSuccessMessage('Workforce association removed successfully');
    } catch (error) {
      console.error('Error removing workforce association:', error);
      setErrorMessage('Failed to remove workforce association');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            position="relative"
            onMouseEnter={() => setAvatarHover(true)}
            onMouseLeave={() => setAvatarHover(false)}
          >
            <Avatar 
              src={customer.avatar || undefined} 
              sx={{ width: 76, height: 76, fontSize: '1.5rem' }}
            >
              {!customer.avatar && getInitials(customer.name)}
            </Avatar>

            <input
              type="file"
              accept="image/*"
              ref={avatarFileInputRef}
              style={{ display: 'none' }}
              onChange={handleAvatarFileChange}
            />

            {avatarHover && !customer.avatar && (
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

            {avatarHover && customer.avatar && (
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
            <Typography variant="h4" sx={{ mb: 0 }}>
              {customer.name}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {customer.address?.street || customer.street}, {customer.address?.city || customer.city}, {customer.address?.state || customer.state}
              </Typography>
              <Chip
                label={customerStatus ? 'Active' : 'Inactive'}             color={customerStatus ? 'success' : 'default'}              size="small"
                variant="filled"
                onClick={handleToggleStatus}
                sx={{ cursor: 'pointer' }}
              />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mt: 0 }}>
              <Typography variant="body2" color="text.secondary">
                LinkedIn:
              </Typography>
              {customer.linkedInUrl ? (
                <Tooltip title="View LinkedIn Profile">
                  <IconButton
                    size="small"
                    onClick={() => window.open(customer.linkedInUrl, '_blank')}
                    sx={{ 
                      color: '#0077b5',
                      '&:hover': { 
                        backgroundColor: 'rgba(0, 119, 181, 0.1)' 
                      }
                    }}
                  >
                    <LinkedInIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <Typography variant="body2" color="text.secondary" fontStyle="italic">
                    LinkedIn URL
                  </Typography>
                  <IconButton size="small" onClick={() => setEditingLinkedIn(true)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
        <Button
          variant="outlined"
          onClick={onBack}
          startIcon={<ArrowBackIcon />}
        >
          Back to Customers
        </Button>
      </Box>

      {/* Contacts Section */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PersonIcon />
            <Typography variant="h6">Contacts</Typography>
          </Box>
          <Button
            startIcon={<AddIcon />}
            onClick={() => {
              setEditingContact(null);
              setContactForm({ name: '', email: '', phone: '', role: '', notes: '' });
              setContactDialogOpen(true);
            }}
          >
            Add Contact
          </Button>
        </Box>
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Contact</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Phone</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Notes</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {contacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                      No contacts added yet. Click "Add Contact" to get started.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Avatar sx={{ width: 32, height: 32, fontSize: '0.75rem' }}>
                          {getInitials(contact.name)}
                        </Avatar>
                        <Typography variant="body2" fontWeight="medium">
                          {contact.name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <EmailIcon fontSize="small" color="action" />
                        <Typography variant="body2">{contact.email || '-'}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <PhoneIcon fontSize="small" color="action" />
                        <Typography variant="body2">{contact.phone || '-'}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip label={contact.role || 'Not specified'} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {contact.notes || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => handleEditContact(contact)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => handleDeleteContact(contact.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      {/* Worksite Locations Section */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LocationIcon />
            <Typography variant="h6">Worksite Locations</Typography>
          </Box>
          <Button
            startIcon={<AddIcon />}
            onClick={() => {
              setEditingWorksite(null);
              setWorksiteForm({ nickname: '', street: '', city: '', state: '', zip: '', notes: '' });
              setWorksiteDialogOpen(true);
            }}
          >
            Add Location
          </Button>
        </Box>
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Location Name</TableCell>
                <TableCell>Address</TableCell>
                <TableCell>City, State ZIP</TableCell>
                <TableCell>Notes</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {worksiteLocations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                      No worksite locations added yet. Click "Add Location" to get started.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                worksiteLocations.map((worksite) => (
                  <TableRow key={worksite.id}>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        {worksite.nickname}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {worksite.street}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {worksite.city}, {worksite.state} {worksite.zip}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {worksite.notes || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => handleEditWorksite(worksite)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => handleDeleteWorksite(worksite.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

       {/* Industry Information Section */}
       <Card sx={{ mb: 3, mt: 3 }}>
         <CardHeader
           title={
             <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
               <BusinessIcon />
               <Typography variant="h6">Industry Information</Typography>
             </Box>
           }
         />
         <CardContent>
           <Grid container spacing={2}>
             <Grid item xs={12} md={6}>
               <Box sx={{ mb: 2 }}>
                 <Typography variant="body2" color="text.secondary" gutterBottom>
                   Industry Category
                 </Typography>
                 {editingIndustry ? (
                   <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                     <Box sx={{ flex: 1 }}>
                       <IndustrySelector
                         value={industryValue}
                         onChange={(value) => setIndustryValue(value)}
                         label="Industry"
                         variant="autocomplete"
                         showCategory={true}
                       />
                     </Box>
                     <IconButton size="small" onClick={handleSaveIndustry} color="primary">
                       <EditIcon fontSize="small" />
                     </IconButton>
                     <IconButton 
                       size="small" 
                       onClick={() => {
                         setEditingIndustry(false);
                         setIndustryValue(customer.industry || '');
                       }}
                     >
                       <ClearIcon fontSize="small" />
                     </IconButton>
                   </Box>
                 ) : (
                   <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                     {customer.industry ? (
                       <Chip 
                         label={customer.industry} 
                         variant="outlined" 
                         color="primary"
                         size="small"
                       />
                     ) : (
                       <Typography variant="body2" color="text.secondary" fontStyle="italic">
                         Not specified
                       </Typography>
                     )}
                     <IconButton size="small" onClick={() => setEditingIndustry(true)}>
                       <EditIcon fontSize="small" />
                     </IconButton>
                   </Box>
                 )}
               </Box>
             </Grid>


           </Grid>
         </CardContent>
       </Card>

       {/* Workforce Associations Section */}
       <Box sx={{ mb: 3, mt: 3 }}>
         <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
           <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
             <PersonIcon />
             <Typography variant="h6">{activeTenant?.name || 'Company'} Associations</Typography>
           </Box>
         </Box>
         
         {/* Company Location Association */}
         <Box sx={{ mb: 3 }}>
           <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
             <Typography variant="body2" color="text.secondary">
               Company Location Association
             </Typography>
             {editingLocation ? (
               <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                 <FormControl sx={{ minWidth: 300 }}>
                   <Select
                     value={locationValue}
                     onChange={(e) => setLocationValue(e.target.value)}
                     size="small"
                   >
                     <MenuItem value="">
                       <em>No location association</em>
                     </MenuItem>
                     {companyLocations.map((location) => (
                       <MenuItem key={location.id} value={location.id}>
                         {location.nickname} - {location.street}, {location.city}, {location.state}
                       </MenuItem>
                     ))}
                   </Select>
                 </FormControl>
                 <IconButton size="small" onClick={handleSaveLocation} color="primary">
                   <EditIcon fontSize="small" />
                 </IconButton>
                 <IconButton 
                   size="small" 
                   onClick={() => {
                     setEditingLocation(false);
                     setLocationValue(customer.companyLocationId || '');
                   }}
                 >
                   <ClearIcon fontSize="small" />
                 </IconButton>
               </Box>
             ) : (
               <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                 {customer.companyLocationId ? (
                   <Chip 
                     label="Associated with company location" 
                     variant="outlined" 
                     color="success"
                     size="small"
                   />
                 ) : (
                   <Typography variant="body2" color="text.secondary" fontStyle="italic">
                     No location association
                   </Typography>
                 )}
                 <IconButton size="small" onClick={() => setEditingLocation(true)}>
                   <EditIcon fontSize="small" />
                 </IconButton>
               </Box>
             )}
           </Box>
         </Box>

         {/* Associate Workforce User */}
         <Box sx={{ mb: 3 }}>
           <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
             <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
               <PersonIcon />
               <Typography variant="h6">Associate {activeTenant?.name || 'Company'} Users</Typography>
             </Box>
             <Button
               startIcon={<AddIcon />}
               onClick={() => {
                 setSelectedWorkforceUser(null);
                 setWorkforceRole('');
                 // Open a dialog for adding workforce association
                 // For now, we'll use a simple approach - you can enhance this later
                 if (workforceUsers.length > 0) {
                   setSelectedWorkforceUser(workforceUsers[0]);
                 }
               }}
             >
               Add User
             </Button>
           </Box>
           <TableContainer component={Paper}>
             <Table>
               <TableHead>
                 <TableRow>
                   <TableCell>Name</TableCell>
                   <TableCell>Role</TableCell>
                   <TableCell>Associated Date</TableCell>
                   <TableCell>Actions</TableCell>
                 </TableRow>
               </TableHead>
               <TableBody>
                 {workforceAssociations.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={4}>
                       <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                         No workforce members associated yet. Click "Add User" to get started.
                       </Typography>
                     </TableCell>
                   </TableRow>
                 ) : (
                   workforceAssociations.map((association) => (
                     <TableRow key={association.id}>
                       <TableCell>
                         <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                           <Avatar sx={{ width: 32, height: 32, fontSize: '0.75rem' }}>
                             {getInitials(association.userName)}
                           </Avatar>
                           <Typography variant="body2" fontWeight="medium">
                             {association.userName}
                           </Typography>
                         </Box>
                       </TableCell>
                       <TableCell>
                         <Chip label={association.role} size="small" variant="outlined" />
                       </TableCell>
                       <TableCell>
                         <Typography variant="body2" color="text.secondary">
                           {association.createdAt.toLocaleDateString()}
                         </Typography>
                       </TableCell>
                       <TableCell>
                         <Box sx={{ display: 'flex', gap: 0.5 }}>
                           <Tooltip title="Remove Association">
                             <IconButton 
                               size="small" 
                               color="error" 
                               onClick={() => handleRemoveWorkforceAssociation(association.id)}
                             >
                               <DeleteIcon fontSize="small" />
                             </IconButton>
                           </Tooltip>
                         </Box>
                       </TableCell>
                     </TableRow>
                   ))
                 )}
               </TableBody>
             </Table>
           </TableContainer>
         </Box>

         {/* Associate Tenant Locations */}
         <Box sx={{ mb: 3 }}>
           <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
             <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
               <LocationIcon />
               <Typography variant="h6">Associate {activeTenant?.name || 'Company'} Locations</Typography>
             </Box>
             <Button
               startIcon={<AddIcon />}
               onClick={() => {
                 // TODO: Implement dialog for adding location association
                 console.log('Add location association');
               }}
             >
               Add Location
             </Button>
           </Box>
           <TableContainer component={Paper}>
             <Table>
               <TableHead>
                 <TableRow>
                   <TableCell>Location Name</TableCell>
                   <TableCell>Address</TableCell>
                   <TableCell>City, State ZIP</TableCell>
                   <TableCell>Associated Date</TableCell>
                   <TableCell>Actions</TableCell>
                 </TableRow>
               </TableHead>
               <TableBody>
                 <TableRow>
                   <TableCell colSpan={5}>
                     <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                       No company locations associated yet. Click "Add Location" to get started.
                     </Typography>
                   </TableCell>
                 </TableRow>
               </TableBody>
             </Table>
           </TableContainer>
         </Box>
       </Box>

       {/* Remove Customer Section */}
       <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid #e0e0e0' }}>
         <Typography variant="h6" color="error" gutterBottom>
           Danger Zone
         </Typography>
         <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
           Removing this customer will permanently delete all associated data including contacts and worksite locations.
         </Typography>
         <Button
           variant="outlined"
           color="error"
           onClick={() => setRemoveCustomerDialogOpen(true)}
           sx={{ 
             borderColor: 'error.main',
             color: 'error.main',
             '&:hover': {
               borderColor: 'error.dark',
               backgroundColor: 'error.light',
               color: 'error.dark',
             }
           }}
         >
           Remove Customer
         </Button>
       </Box>

       {/* Contact Dialog */}
      <Dialog open={contactDialogOpen} onClose={() => setContactDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingContact ? 'Edit Contact' : 'Add New Contact'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                label="Name"
                fullWidth
                required
                value={contactForm.name}
                onChange={(e) => setContactForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Email"
                type="email"
                fullWidth
                value={contactForm.email}
                onChange={(e) => setContactForm(prev => ({ ...prev, email: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Phone"
                fullWidth
                value={contactForm.phone}
                onChange={(e) => setContactForm(prev => ({ ...prev, phone: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Role"
                fullWidth
                value={contactForm.role}
                onChange={(e) => setContactForm(prev => ({ ...prev, role: e.target.value }))}
                placeholder="e.g., Purchasing Manager, HR Director"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Notes"
                fullWidth
                multiline
                rows={3}
                value={contactForm.notes}
                onChange={(e) => setContactForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="e.g., Pete places all of the orders"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setContactDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleContactSubmit} variant="contained" disabled={loading}>
            {loading ? 'Saving...' : (editingContact ? 'Update' : 'Add')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Worksite Dialog */}
      <Dialog open={worksiteDialogOpen} onClose={() => setWorksiteDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingWorksite ? 'Edit Worksite Location' : 'Add New Worksite Location'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                label="Location Name/Nickname"
                fullWidth
                required
                value={worksiteForm.nickname}
                onChange={(e) => setWorksiteForm(prev => ({ ...prev, nickname: e.target.value }))}
                placeholder="e.g., Main Office, Warehouse, Branch Location"
              />
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                onLoad={(ref) => setAutocompleteRef(ref)}
                onPlaceChanged={handlePlaceChanged}
              >
                <TextField
                  label="Street Address"
                  fullWidth
                  required
                  value={worksiteForm.street}
                  onChange={(e) => setWorksiteForm(prev => ({ ...prev, street: e.target.value }))}
                />
              </Autocomplete>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="City"
                fullWidth
                value={worksiteForm.city}
                onChange={(e) => setWorksiteForm(prev => ({ ...prev, city: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField
                label="State"
                fullWidth
                value={worksiteForm.state}
                onChange={(e) => setWorksiteForm(prev => ({ ...prev, state: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField
                label="ZIP"
                fullWidth
                value={worksiteForm.zip}
                onChange={(e) => setWorksiteForm(prev => ({ ...prev, zip: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Notes"
                fullWidth
                multiline
                rows={3}
                value={worksiteForm.notes}
                onChange={(e) => setWorksiteForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="e.g., Main production facility, 24/7 operations"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWorksiteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleWorksiteSubmit} variant="contained" disabled={loading}>
            {loading ? 'Saving...' : (editingWorksite ? 'Update' : 'Add')}
          </Button>
        </DialogActions>
      </Dialog>

             {/* Remove Customer Warning Dialog */}
       <Dialog open={removeCustomerDialogOpen} onClose={() => setRemoveCustomerDialogOpen(false)} maxWidth="sm" fullWidth>
         <DialogTitle sx={{ color: 'error.main' }}>
           Remove Customer
         </DialogTitle>
         <DialogContent>
           <Alert severity="warning" sx={{ mb: 2 }}>
             <Typography variant="body1" fontWeight="bold">
               This action cannot be undone!
             </Typography>
           </Alert>
           <Typography variant="body1" sx={{ mb: 2 }}>
             Are you sure you want to remove <strong>{customer.name}</strong> from your customer list?
           </Typography>
           <Typography variant="body2" color="text.secondary">
             This will:
           </Typography>
           <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
             <li>Remove the customer from your associated customers list</li>
             <li>Delete all contacts associated with this customer</li>
             <li>Delete all worksite locations for this customer</li>
             <li>Remove all job orders and assignments linked to this customer</li>
           </ul>
           <Typography variant="body2" color="error.main" fontWeight="bold">
             This action is permanent and cannot be reversed.
           </Typography>
         </DialogContent>
         <DialogActions>
           <Button onClick={() => setRemoveCustomerDialogOpen(false)}>
             Cancel
           </Button>
           <Button 
             onClick={() => {
               setRemoveCustomerDialogOpen(false);
               onRemoveCustomer(customer.id);
             }} 
             variant="contained" 
             color="error"
             sx={{ 
               backgroundColor: 'error.main',
               '&:hover': {
                 backgroundColor: 'error.dark',
               }
             }}
           >
             Remove Customer
           </Button>
         </DialogActions>
       </Dialog>

       {/* Success/Error Messages */}
       <Snackbar open={!!successMessage} autoHideDuration={4000} onClose={() => setSuccessMessage('')}>
         <Alert severity="success" onClose={() => setSuccessMessage('')}>
           {successMessage}
         </Alert>
       </Snackbar>
       <Snackbar open={!!errorMessage} autoHideDuration={4000} onClose={() => setErrorMessage('')}>
         <Alert severity="error" onClose={() => setErrorMessage('')}>
           {errorMessage}
         </Alert>
       </Snackbar>
     </Box>
   );
 };

export default CustomerDetailsView; 