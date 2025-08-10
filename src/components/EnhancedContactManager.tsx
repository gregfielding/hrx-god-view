import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  LinearProgress,
  IconButton,
  Divider,
  Avatar,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Tabs,
  Tab,
  Rating,

} from '@mui/material';
import {
  Person,
  Email,
  Phone,
  Star,
  Add,
  Edit,
  Visibility,
  Assignment,
  People,
  BusinessCenter,
  Link,
  Timeline as TimelineIcon,
  ContactSupport,
  VideoCall,
  Block,
  ThumbUp,
  Map,
} from '@mui/icons-material';
import { collection, query, getDocs, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';

import { db } from '../firebase';
import { CRMContact, CRMCompany, CRMDeal } from '../types/CRM';
import { useAIFieldLogging } from '../utils/aiFieldLogging';

interface EnhancedContactManagerProps {
  tenantId: string;
}

interface ContactRelationship {
  contactId: string;
  relatedContactId: string;
  relationshipType: 'supervisor' | 'subordinate' | 'peer' | 'mentor' | 'mentee';
  strength: number; // 1-10
  lastInteraction: Date;
  notes: string;
}

interface StakeholderMap {
  contactId: string;
  dealId: string;
  role: 'decision_maker' | 'recommender' | 'observer' | 'blocker' | 'champion';
  influence: 'low' | 'medium' | 'high';
  personality: 'dominant' | 'analytical' | 'amiable' | 'expressive';
  relationshipStage: 'cold' | 'warm' | 'hot' | 'advocate';
  isContractSigner: boolean;
  isDecisionInfluencer: boolean;
  isImplementationResponsible: boolean;
}

interface ContactActivity {
  id: string;
  contactId: string;
  type: 'email' | 'call' | 'meeting' | 'note' | 'task';
  title: string;
  description: string;
  date: Date;
  outcome: 'positive' | 'neutral' | 'negative';
  relatedDealId?: string;
  relatedCompanyId?: string;
}

const EnhancedContactManager: React.FC<EnhancedContactManagerProps> = ({ tenantId }) => {
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [companies, setCompanies] = useState<CRMCompany[]>([]);
  const [deals, setDeals] = useState<CRMDeal[]>([]);
  const [selectedContact, setSelectedContact] = useState<CRMContact | null>(null);
  const [stakeholderMaps, setStakeholderMaps] = useState<StakeholderMap[]>([]);
  const [contactRelationships, setContactRelationships] = useState<ContactRelationship[]>([]);
  const [contactActivities, setContactActivities] = useState<ContactActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [showContactDialog, setShowContactDialog] = useState(false);
  // const [showStakeholderDialog, setShowStakeholderDialog] = useState(false);
  // const [showRelationshipDialog, setShowRelationshipDialog] = useState(false);
  const [editingContact, setEditingContact] = useState<CRMContact | null>(null);

  // AI Field Logging
  const logFieldInteraction = useAIFieldLogging('enhanced_contact_manager', tenantId, 'agency');

  useEffect(() => {
    logFieldInteraction(null, {
      action: 'component_loaded',
      tenantId,
      component: 'EnhancedContactManager'
    });
    loadData();
  }, [tenantId]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load contacts
      const contactsQuery = query(collection(db, 'tenants', tenantId, 'crm_contacts'));
      const contactsSnapshot = await getDocs(contactsQuery);
      const contactsData = contactsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMContact));
      setContacts(contactsData);

      // Load companies
      const companiesQuery = query(collection(db, 'tenants', tenantId, 'crm_companies'));
      const companiesSnapshot = await getDocs(companiesQuery);
      const companiesData = companiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMCompany));
      setCompanies(companiesData);

      // Load deals
      const dealsQuery = query(collection(db, 'tenants', tenantId, 'crm_deals'));
      const dealsSnapshot = await getDocs(dealsQuery);
      const dealsData = dealsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMDeal));
      setDeals(dealsData);

      // Load stakeholder maps (mock data for now)
      const mockStakeholderMaps: StakeholderMap[] = contactsData.slice(0, 10).map((contact, index) => ({
        contactId: contact.id,
        dealId: dealsData[index % dealsData.length]?.id || '',
        role: ['decision_maker', 'recommender', 'observer', 'blocker', 'champion'][index % 5] as any,
        influence: ['low', 'medium', 'high'][index % 3] as any,
        personality: ['dominant', 'analytical', 'amiable', 'expressive'][index % 4] as any,
        relationshipStage: ['cold', 'warm', 'hot', 'advocate'][index % 4] as any,
        isContractSigner: index % 3 === 0,
        isDecisionInfluencer: index % 2 === 0,
        isImplementationResponsible: index % 4 === 0,
      }));
      setStakeholderMaps(mockStakeholderMaps);

      // Load contact relationships (mock data for now)
      const mockRelationships: ContactRelationship[] = contactsData.slice(0, 5).map((contact, index) => ({
        contactId: contact.id,
        relatedContactId: contactsData[(index + 1) % contactsData.length]?.id || '',
        relationshipType: ['supervisor', 'subordinate', 'peer', 'mentor', 'mentee'][index % 5] as any,
        strength: Math.floor(Math.random() * 10) + 1,
        lastInteraction: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
        notes: `Relationship note for ${contact.fullName}`,
      }));
      setContactRelationships(mockRelationships);

      // Load contact activities (mock data for now)
      const mockActivities: ContactActivity[] = contactsData.slice(0, 15).map((contact, index) => ({
        id: `activity_${index}`,
        contactId: contact.id,
        type: ['email', 'call', 'meeting', 'note', 'task'][index % 5] as any,
        title: `Activity ${index + 1} with ${contact.fullName}`,
        description: `Description for activity ${index + 1}`,
        date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
        outcome: ['positive', 'neutral', 'negative'][index % 3] as any,
        relatedDealId: dealsData[index % dealsData.length]?.id,
        relatedCompanyId: contact.companyId,
      }));
      setContactActivities(mockActivities);

      logFieldInteraction(null, {
        action: 'data_loaded',
        contactCount: contactsData.length,
        companyCount: companiesData.length,
        dealCount: dealsData.length,
        tenantId
      });

    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getContactCompany = (contact: CRMContact) => {
    return companies.find(company => company.id === contact.companyId);
  };

  // const getContactDeals = (contact: CRMContact) => {
  //   return deals.filter(deal => deal.contactIds?.includes(contact.id));
  // };

  const getContactStakeholderMaps = (contactId: string) => {
    return stakeholderMaps.filter(map => map.contactId === contactId);
  };

  const getContactRelationships = (contactId: string) => {
    return contactRelationships.filter(rel => 
      rel.contactId === contactId || rel.relatedContactId === contactId
    );
  };

  // const getContactActivities = (contactId: string) => {
  //   return contactActivities.filter(activity => activity.contactId === contactId);
  // };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'decision_maker': return <BusinessCenter />;
      case 'recommender': return <Star />;
      case 'observer': return <Visibility />;
      case 'blocker': return <Block />;
      case 'champion': return <ThumbUp />;
      default: return <Person />;
    }
  };

  const getInfluenceColor = (influence: string) => {
    switch (influence) {
      case 'high': return 'error';
      case 'medium': return 'warning';
      case 'low': return 'success';
      default: return 'default';
    }
  };

  const getPersonalityColor = (personality: string) => {
    switch (personality) {
      case 'dominant': return 'error';
      case 'analytical': return 'info';
      case 'amiable': return 'success';
      case 'expressive': return 'warning';
      default: return 'default';
    }
  };

  const getRelationshipStageColor = (stage: string) => {
    switch (stage) {
      case 'advocate': return 'success';
      case 'hot': return 'error';
      case 'warm': return 'warning';
      case 'cold': return 'default';
      default: return 'default';
    }
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'email': return <Email />;
      case 'call': return <Phone />;
      case 'meeting': return <VideoCall />;
      case 'note': return <Edit />;
      case 'task': return <Assignment />;
      default: return <ContactSupport />;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'email': return 'primary';
      case 'call': return 'success';
      case 'meeting': return 'warning';
      case 'note': return 'info';
      case 'task': return 'secondary';
      default: return 'default';
    }
  };

  const getOutcomeColor = (outcome: string) => {
    switch (outcome) {
      case 'positive': return 'success';
      case 'neutral': return 'default';
      case 'negative': return 'error';
      default: return 'default';
    }
  };

  const handleContactSelect = (contact: CRMContact) => {
    logFieldInteraction(null, {
      action: 'contact_selected',
      contactId: contact.id,
      contactName: contact.fullName
    });
    setSelectedContact(contact);
    setShowContactDialog(true);
  };

  const handleEditContact = (contact: CRMContact) => {
    setEditingContact(contact);
    setShowContactDialog(true);
  };

  const handleSaveContact = async (contactData: Partial<CRMContact>) => {
    try {
      logFieldInteraction(null, {
        action: 'contact_updated',
        contactId: editingContact?.id,
        contactName: contactData.fullName
      });

      if (editingContact) {
        await updateDoc(doc(db, 'contacts', editingContact.id), {
          ...contactData,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'contacts'), {
          ...contactData,
          tenantId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }

      setShowContactDialog(false);
      setEditingContact(null);
      await loadData(); // Refresh data
    } catch (error) {
      console.error('Error saving contact:', error);
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          Enhanced Contact Management
        </Typography>
        <LinearProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Enhanced Contact Management
      </Typography>

      {/* Contact Overview Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="h4" color="primary">
                    {contacts.length}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Total Contacts
                  </Typography>
                </Box>
                <Avatar sx={{ bgcolor: 'primary.main' }}>
                  <People />
                </Avatar>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="h4" color="success.main">
                    {stakeholderMaps.filter(m => m.role === 'champion').length}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Champions
                  </Typography>
                </Box>
                <Avatar sx={{ bgcolor: 'success.main' }}>
                  <ThumbUp />
                </Avatar>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="h4" color="warning.main">
                    {stakeholderMaps.filter(m => m.role === 'decision_maker').length}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Decision Makers
                  </Typography>
                </Box>
                <Avatar sx={{ bgcolor: 'warning.main' }}>
                  <BusinessCenter />
                </Avatar>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="h4" color="error.main">
                    {stakeholderMaps.filter(m => m.role === 'blocker').length}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Blockers
                  </Typography>
                </Box>
                <Avatar sx={{ bgcolor: 'error.main' }}>
                  <Block />
                </Avatar>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Main Content Tabs */}
      <Card>
        <CardContent>
          <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)}>
            <Tab label="Contact Roles" icon={<Assignment />} />
            <Tab label="Stakeholder Maps" icon={<Map />} />
            <Tab label="Relationships" icon={<Link />} />
            <Tab label="Activity Timeline" icon={<TimelineIcon />} />
          </Tabs>

          {/* Contact Roles Tab */}
          {activeTab === 0 && (
            <Box sx={{ mt: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">Contact Role Assignment</Typography>
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={() => setShowContactDialog(true)}
                >
                  Add Contact
                </Button>
              </Box>
              
              <TableContainer component={Paper} variant="outlined">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Contact</TableCell>
                      <TableCell>Company</TableCell>
                      <TableCell>Role</TableCell>
                      <TableCell>Influence</TableCell>
                      <TableCell>Personality</TableCell>
                      <TableCell>Relationship Stage</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {contacts.map((contact) => {
                      const stakeholderMap = getContactStakeholderMaps(contact.id)[0];
                      const company = getContactCompany(contact);
                      
                      return (
                        <TableRow key={contact.id}>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Avatar sx={{ width: 32, height: 32 }}>
                                {contact.firstName?.[0]}{contact.lastName?.[0]}
                              </Avatar>
                              <Box>
                                <Typography variant="body2" fontWeight="medium">
                                  {contact.fullName}
                                </Typography>
                                <Typography variant="caption" color="textSecondary">
                                  {contact.title}
                                </Typography>
                              </Box>
                            </Box>
                          </TableCell>
                          <TableCell>{company?.name || 'N/A'}</TableCell>
                          <TableCell>
                            {stakeholderMap && (
                              <Chip
                                icon={getRoleIcon(stakeholderMap.role)}
                                label={stakeholderMap.role.replace('_', ' ')}
                                size="small"
                                color={stakeholderMap.role === 'champion' ? 'success' : 'default'}
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            {stakeholderMap && (
                              <Chip
                                label={stakeholderMap.influence}
                                size="small"
                                color={getInfluenceColor(stakeholderMap.influence)}
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            {stakeholderMap && (
                              <Chip
                                label={stakeholderMap.personality}
                                size="small"
                                color={getPersonalityColor(stakeholderMap.personality)}
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            {stakeholderMap && (
                              <Chip
                                label={stakeholderMap.relationshipStage}
                                size="small"
                                color={getRelationshipStageColor(stakeholderMap.relationshipStage)}
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <IconButton
                              size="small"
                              onClick={() => handleContactSelect(contact)}
                            >
                              <Visibility />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => handleEditContact(contact)}
                            >
                              <Edit />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}

          {/* Stakeholder Maps Tab */}
          {activeTab === 1 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>Stakeholder Mapping Visualization</Typography>
              
              <Grid container spacing={2}>
                {stakeholderMaps.map((stakeholder, index) => {
                  const contact = contacts.find(c => c.id === stakeholder.contactId);
                  const deal = deals.find(d => d.id === stakeholder.dealId);
                  
                  return (
                    <Grid item xs={12} sm={6} md={4} key={index}>
                      <Card variant="outlined">
                        <CardContent>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                            <Avatar sx={{ width: 40, height: 40 }}>
                              {contact?.firstName?.[0]}{contact?.lastName?.[0]}
                            </Avatar>
                            <Box>
                              <Typography variant="subtitle1" fontWeight="medium">
                                {contact?.fullName}
                              </Typography>
                              <Typography variant="caption" color="textSecondary">
                                {deal?.name || 'No Deal'}
                              </Typography>
                            </Box>
                          </Box>
                          
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <Chip
                              icon={getRoleIcon(stakeholder.role)}
                              label={stakeholder.role.replace('_', ' ')}
                              size="small"
                              color={stakeholder.role === 'champion' ? 'success' : 'default'}
                            />
                            
                            <Box sx={{ display: 'flex', gap: 1 }}>
                              <Chip
                                label={stakeholder.influence}
                                size="small"
                                color={getInfluenceColor(stakeholder.influence)}
                              />
                              <Chip
                                label={stakeholder.personality}
                                size="small"
                                color={getPersonalityColor(stakeholder.personality)}
                              />
                            </Box>
                            
                            <Chip
                              label={stakeholder.relationshipStage}
                              size="small"
                              color={getRelationshipStageColor(stakeholder.relationshipStage)}
                            />
                            
                            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                              {stakeholder.isContractSigner && (
                                <Chip label="Contract Signer" size="small" color="primary" />
                              )}
                              {stakeholder.isDecisionInfluencer && (
                                <Chip label="Decision Influencer" size="small" color="secondary" />
                              )}
                              {stakeholder.isImplementationResponsible && (
                                <Chip label="Implementation" size="small" color="info" />
                              )}
                            </Box>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          )}

          {/* Relationships Tab */}
          {activeTab === 2 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>Contact Relationship Tracking</Typography>
              
              <Grid container spacing={2}>
                {contacts.slice(0, 6).map((contact) => {
                  const relationships = getContactRelationships(contact.id);
                  
                  return (
                    <Grid item xs={12} md={6} key={contact.id}>
                      <Card variant="outlined">
                        <CardContent>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                            <Avatar sx={{ width: 40, height: 40 }}>
                              {contact.firstName?.[0]}{contact.lastName?.[0]}
                            </Avatar>
                            <Box>
                              <Typography variant="subtitle1" fontWeight="medium">
                                {contact.fullName}
                              </Typography>
                              <Typography variant="caption" color="textSecondary">
                                {relationships.length} relationships
                              </Typography>
                            </Box>
                          </Box>
                          
                          <List dense>
                            {relationships.map((relationship, index) => {
                              const relatedContact = contacts.find(c => 
                                c.id === (relationship.contactId === contact.id ? relationship.relatedContactId : relationship.contactId)
                              );
                              
                              return (
                                <ListItem key={index} sx={{ px: 0 }}>
                                  <ListItemAvatar>
                                    <Avatar sx={{ width: 32, height: 32 }}>
                                      {relatedContact?.firstName?.[0]}{relatedContact?.lastName?.[0]}
                                    </Avatar>
                                  </ListItemAvatar>
                                  <ListItemText
                                    primary={relatedContact?.fullName}
                                    secondary={
                                      <Box>
                                        <Chip
                                          label={relationship.relationshipType}
                                          size="small"
                                          sx={{ mr: 1 }}
                                        />
                                        <Rating value={relationship.strength} max={10} size="small" readOnly />
                                      </Box>
                                    }
                                  />
                                </ListItem>
                              );
                            })}
                          </List>
                        </CardContent>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          )}

          {/* Activity Timeline Tab */}
          {activeTab === 3 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>Contact Activity Timeline</Typography>
              
              <List>
                {contactActivities.slice(0, 10).map((activity) => {
                  const contact = contacts.find(c => c.id === activity.contactId);
                  const deal = deals.find(d => d.id === activity.relatedDealId);
                  
                  return (
                    <ListItem key={activity.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mb: 1 }}>
                      <ListItemAvatar>
                        <Avatar sx={{ bgcolor: `${getActivityColor(activity.type)}.main` }}>
                          {getActivityIcon(activity.type)}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="subtitle2" component="span">
                              {contact?.fullName}
                            </Typography>
                            <Chip
                              label={activity.type}
                              size="small"
                              color={getActivityColor(activity.type)}
                            />
                            <Chip
                              label={activity.outcome}
                              size="small"
                              color={getOutcomeColor(activity.outcome)}
                            />
                          </Box>
                        }
                        secondary={
                          <Box>
                            <Typography variant="body2">
                              {activity.title}
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                              {activity.date.toLocaleDateString()}
                              {deal && ` • Related to: ${deal.name}`}
                            </Typography>
                          </Box>
                        }
                      />
                    </ListItem>
                  );
                })}
              </List>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Contact Detail Dialog */}
      <Dialog
        open={showContactDialog}
        onClose={() => setShowContactDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {editingContact ? 'Edit Contact' : 'Contact Details'}
        </DialogTitle>
        <DialogContent>
          {selectedContact && !editingContact && (
            <Box>
              <Typography variant="h6" gutterBottom>
                {selectedContact.fullName}
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                {selectedContact.title} at {getContactCompany(selectedContact)?.name}
              </Typography>
              
              <Divider sx={{ my: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" gutterBottom>Contact Information</Typography>
                  <Typography variant="body2">Email: {selectedContact.email}</Typography>
                  <Typography variant="body2">Phone: {selectedContact.phone}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" gutterBottom>Role Information</Typography>
                  <Typography variant="body2">Role: {selectedContact.role}</Typography>
                  <Typography variant="body2">Status: {selectedContact.status}</Typography>
                </Grid>
              </Grid>
              
              {selectedContact.contactProfile && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" gutterBottom>Enhanced Profile</Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2">Deal Role: {selectedContact.contactProfile.dealRole}</Typography>
                      <Typography variant="body2">Influence: {selectedContact.contactProfile.influence}</Typography>
                      <Typography variant="body2">Personality: {selectedContact.contactProfile.personality}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2">Relationship Stage: {selectedContact.contactProfile.relationshipStage}</Typography>
                      <Typography variant="body2">Department: {selectedContact.contactProfile.department}</Typography>
                      <Typography variant="body2">Location: {selectedContact.contactProfile.location}</Typography>
                    </Grid>
                  </Grid>
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowContactDialog(false)}>Close</Button>
          {selectedContact && (
            <Button
              variant="contained"
              onClick={() => handleEditContact(selectedContact)}
            >
              Edit
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default EnhancedContactManager; 