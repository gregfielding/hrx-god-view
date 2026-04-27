import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Avatar,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert,
  Divider,
} from '@mui/material';
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  Person as PersonIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

interface Contact {
  id: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  title?: string;
}

interface ManageContactsDialogProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  currentContacts: Contact[];
  onContactsChange: (contacts: Contact[]) => void;
  dealCompanyId?: string;
}

const ManageContactsDialog: React.FC<ManageContactsDialogProps> = ({
  open,
  onClose,
  tenantId,
  currentContacts,
  onContactsChange,
  dealCompanyId,
}) => {
  const [availableContacts, setAvailableContacts] = useState<Contact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load available contacts from crm_contacts collection
  useEffect(() => {
    if (!open || !tenantId) return;

    const loadAvailableContacts = async () => {
      setLoading(true);
      setError('');

      try {
        console.log('Loading contacts for tenant:', tenantId, 'and company:', dealCompanyId);
        
        if (!dealCompanyId) {
          console.log('No company ID provided, showing all contacts');
          // If no company ID, show all contacts (fallback)
          const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
          const contactsQuery = query(contactsRef);
          const contactsSnapshot = await getDocs(contactsQuery);
          
          const allContacts: Contact[] = [];
          contactsSnapshot.docs.forEach(doc => {
            const contactData = doc.data();
            const displayName = contactData.firstName && contactData.lastName ? 
                               `${contactData.firstName} ${contactData.lastName}` :
                               contactData.fullName || 
                               contactData.name || 
                               contactData.email?.split('@')[0] || 
                               'Unknown Contact';
            
            allContacts.push({
              id: doc.id,
              fullName: displayName,
              firstName: contactData.firstName || '',
              lastName: contactData.lastName || '',
              email: contactData.email || '',
              phone: contactData.phone || '',
              title: contactData.title || ''
            });
          });
          
          setAvailableContacts(allContacts);
          return;
        }

        // Query contacts associated with the specific company
        const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
        const contactsQuery = query(contactsRef, where('companyId', '==', dealCompanyId));
        const contactsSnapshot = await getDocs(contactsQuery);
        console.log('Company contacts query results:', contactsSnapshot.size);
        
        const companyContacts: Contact[] = [];
        
        contactsSnapshot.docs.forEach(doc => {
          const contactData = doc.data();
          const displayName = contactData.firstName && contactData.lastName ? 
                             `${contactData.firstName} ${contactData.lastName}` :
                             contactData.fullName || 
                             contactData.name || 
                             contactData.email?.split('@')[0] || 
                             'Unknown Contact';
          
          companyContacts.push({
            id: doc.id,
            fullName: displayName,
            firstName: contactData.firstName || '',
            lastName: contactData.lastName || '',
            email: contactData.email || '',
            phone: contactData.phone || '',
            title: contactData.title || ''
          });
        });
        
        console.log('Company contacts found:', companyContacts.length);
        console.log('Company contacts:', companyContacts);
        setAvailableContacts(companyContacts);
        
      } catch (err: any) {
        console.error('Error loading available contacts:', err);
        setError('Failed to load available contacts');
      } finally {
        setLoading(false);
      }
    };

    loadAvailableContacts();
  }, [open, tenantId, dealCompanyId]);

  // Filter available contacts to exclude current ones
  const availableToAdd = availableContacts.filter(contact => {
    const isAlreadyAssigned = currentContacts.some(current => current.id === contact.id);
    console.log(`Contact ${contact.fullName} (${contact.id}) - Already assigned: ${isAlreadyAssigned}`);
    return !isAlreadyAssigned;
  });

  const handleAddContact = (contact: Contact) => {
    const updatedContacts = [...currentContacts, contact];
    onContactsChange(updatedContacts);
  };

  const handleRemoveContact = (contactId: string) => {
    const updatedContacts = currentContacts.filter(contact => contact.id !== contactId);
    onContactsChange(updatedContacts);
  };

  const handleAddSelectedContact = () => {
    if (selectedContactId) {
      const selectedContact = availableContacts.find(contact => contact.id === selectedContactId);
      if (selectedContact) {
        handleAddContact(selectedContact);
        setSelectedContactId('');
      }
    }
  };

  const handleClose = () => {
    setSelectedContactId('');
    setError('');
    onClose();
  };

  return (
    <Dialog 
      open={open} 
      onClose={handleClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Manage Contacts</Typography>
          <IconButton onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {/* Current Contacts */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
              Current Contacts ({currentContacts.length})
            </Typography>
            
            {currentContacts.length > 0 ? (
              <List sx={{ bgcolor: 'grey.50', borderRadius: 1 }}>
                {currentContacts.map((contact) => (
                  <ListItem key={contact.id} sx={{ py: 1 }}>
                    <ListItemAvatar>
                      <Avatar sx={{ width: 40, height: 40, fontSize: '1rem' }}>
                        {contact.fullName?.charAt(0) || contact.firstName?.charAt(0) || 'C'}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={contact.fullName}
                      secondary={contact.email}
                    />
                    <ListItemSecondaryAction>
                      <IconButton
                        edge="end"
                        onClick={() => handleRemoveContact(contact.id)}
                        color="error"
                      >
                        <DeleteIcon />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            ) : (
              <Box sx={{ textAlign: 'center', py: 3, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  No contacts assigned to this deal
                </Typography>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Add Contacts */}
          <Box>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
              Add Contacts
            </Typography>
            
            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress />
              </Box>
            )}
            
            {!loading && availableToAdd.length > 0 ? (
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                <FormControl fullWidth>
                  <InputLabel>Select Contact</InputLabel>
                  <Select
                    value={selectedContactId}
                    onChange={(e) => setSelectedContactId(e.target.value)}
                    label="Select Contact"
                  >
                    {availableToAdd.map((contact) => (
                      <MenuItem key={contact.id} value={contact.id}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem' }}>
                            {contact.fullName?.charAt(0) || contact.firstName?.charAt(0) || 'C'}
                          </Avatar>
                          <Box>
                            <Typography variant="body2">{contact.fullName}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {contact.email}
                            </Typography>
                          </Box>
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button
                  variant="contained"
                  onClick={handleAddSelectedContact}
                  disabled={!selectedContactId}
                  startIcon={<AddIcon />}
                >
                  Add
                </Button>
              </Box>
            ) : !loading ? (
              <Box sx={{ textAlign: 'center', py: 3, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {availableContacts.length > 0 
                    ? 'All available contacts are already assigned to this deal'
                    : 'No contacts available to add'
                  }
                </Typography>
              </Box>
            ) : null}
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 0 }}>
        <Button onClick={handleClose} variant="outlined">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ManageContactsDialog;
