import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Alert,
  IconButton,
  Stack,
  Autocomplete,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Paper
} from '@mui/material';
import {
  Business as BusinessIcon,
  Person as PersonIcon,
  LocationOn as LocationIcon,
  AttachMoney as DealIcon,
  Work as WorkIcon,
  Assignment as TaskIcon,
  Group as SalespeopleIcon,
  Close as CloseIcon,
  OpenInNew as OpenInNewIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { createDenormalizedAssociationService, DenormalizedAssociations } from '../utils/denormalizedAssociationService';

interface FastAssociationsCardProps {
  entityType: 'deal' | 'company' | 'contact' | 'salesperson' | 'location' | 'division' | 'task';
  entityId: string;
  tenantId: string;
  entityName: string;
  showAssociations?: {
    companies?: boolean;
    contacts?: boolean;
    salespeople?: boolean;
    locations?: boolean;
    deals?: boolean;
    divisions?: boolean;
    tasks?: boolean;
  };
  onAssociationChange?: () => void;
  maxHeight?: number;
}

const FastAssociationsCard: React.FC<FastAssociationsCardProps> = ({
  entityType,
  entityId,
  tenantId,
  entityName,
  showAssociations = {
    companies: true,
    contacts: true,
    salespeople: true,
    locations: true,
    deals: true,
    divisions: true,
    tasks: true
  },
  onAssociationChange,
  maxHeight = 400
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [associations, setAssociations] = useState<DenormalizedAssociations | null>(null);
  const [loading, setLoading] = useState(true);
  // const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [availableEntities, setAvailableEntities] = useState<{ [key: string]: any[] }>({});
  const [loadingEntities, setLoadingEntities] = useState<{ [key: string]: boolean }>({});

  const loadAssociations = async () => {
    if (!user || !tenantId || !entityId) return;

    try {
      setLoading(true);
      setError(null);

      console.log(`🔍 Loading associations for ${entityType}:${entityId} in tenant ${tenantId}`);
      console.log(`👤 Current user:`, {
        uid: user.uid,
        email: user.email,
        tenantId: user.tenantId,
        // Remove properties that don't exist on User type
      });
      
      const associationService = createDenormalizedAssociationService(tenantId);
      const result = await associationService.getAssociations(entityType, entityId);
      
      console.log(`⚡ Fast associations loaded for ${entityType}:${entityId}:`, result);
      console.log(`📊 Association breakdown:`, {
        companies: result.companies?.length || 0,
        contacts: result.contacts?.length || 0,
        salespeople: result.salespeople?.length || 0,
        locations: result.locations?.length || 0,
        deals: result.deals?.length || 0,
        divisions: result.divisions?.length || 0,
        tasks: result.tasks?.length || 0
      });
      
      // Debug each association type
      if (result.companies?.length > 0) {
        console.log(`🏢 Companies:`, result.companies);
      }
      if (result.contacts?.length > 0) {
        console.log(`👤 Contacts:`, result.contacts);
      }
      if (result.salespeople?.length > 0) {
        console.log(`👥 Salespeople:`, result.salespeople);
      }
      if (result.locations?.length > 0) {
        console.log(`📍 Locations:`, result.locations);
      }
      if (result.deals?.length > 0) {
        console.log(`💰 Deals:`, result.deals);
      }
      
      // 🚀 ENHANCED: Fetch full entity data for each association
      const enhancedResult = { ...result };
      
      // Fetch full company data
      if (result.companies?.length > 0) {
        console.log(`🔍 Fetching full data for ${result.companies.length} companies...`);
        const { doc, getDoc } = await import('firebase/firestore');
        const { db } = await import('../firebase');
        
        const companiesWithData = await Promise.all(
          result.companies.map(async (company: any) => {
            try {
              // Handle both string IDs and object IDs
              const companyId = typeof company === 'string' ? company : company.id;
              console.log(`🔍 Fetching company with ID: ${companyId}`);
              
              const companyRef = doc(db, `tenants/${tenantId}/crm_companies`, companyId);
              const companyDoc = await getDoc(companyRef);
              if (companyDoc.exists()) {
                const companyData = companyDoc.data();
                console.log(`✅ Found company data:`, companyData);
                return { 
                  id: companyId, 
                  ...(typeof company === 'object' ? company : {}), 
                  ...companyData 
                };
              }
              console.log(`❌ Company ${companyId} not found`);
              return { id: companyId, name: 'Unknown Company' };
            } catch (error) {
              console.error(`Error fetching company ${typeof company === 'string' ? company : company.id}:`, error);
              return { id: typeof company === 'string' ? company : company.id, name: 'Unknown Company' };
            }
          })
        );
        enhancedResult.companies = companiesWithData;
        console.log(`✅ Enhanced companies:`, companiesWithData);
      }
      
      // Fetch full contact data
      if (result.contacts?.length > 0) {
        console.log(`�� Fetching full data for ${result.contacts.length} contacts...`);
        const { doc, getDoc } = await import('firebase/firestore');
        const { db } = await import('../firebase');
        
        const contactsWithData = await Promise.all(
          result.contacts.map(async (contact: any) => {
            try {
              // Handle both string IDs and object IDs
              const contactId = typeof contact === 'string' ? contact : contact.id;
              console.log(`🔍 Fetching contact with ID: ${contactId}`);
              
              const contactRef = doc(db, `tenants/${tenantId}/crm_contacts`, contactId);
              const contactDoc = await getDoc(contactRef);
              if (contactDoc.exists()) {
                const contactData = contactDoc.data();
                console.log(`✅ Found contact data:`, contactData);
                return { 
                  id: contactId, 
                  ...(typeof contact === 'object' ? contact : {}), 
                  ...contactData 
                };
              }
              console.log(`❌ Contact ${contactId} not found`);
              return { id: contactId, name: 'Unknown Contact' };
            } catch (error) {
              console.error(`Error fetching contact ${typeof contact === 'string' ? contact : contact.id}:`, error);
              return { id: typeof contact === 'string' ? contact : contact.id, name: 'Unknown Contact' };
            }
          })
        );
        enhancedResult.contacts = contactsWithData;
        console.log(`✅ Enhanced contacts:`, contactsWithData);
      }
      
      // Fetch full salespeople data
      if (result.salespeople?.length > 0) {
        console.log(`🔍 Fetching full data for ${result.salespeople.length} salespeople...`);
        const { doc, getDoc } = await import('firebase/firestore');
        const { db } = await import('../firebase');
        
        const salespeopleWithData = await Promise.all(
          result.salespeople.map(async (salesperson: any) => {
            try {
              // Handle both string IDs and object IDs
              const salespersonId = typeof salesperson === 'string' ? salesperson : salesperson.id;
              console.log(`🔍 Fetching salesperson with ID: ${salespersonId}`);
              
              // Salespeople are stored in the top-level users collection
              const salespersonRef = doc(db, `users`, salespersonId);
              const salespersonDoc = await getDoc(salespersonRef);
              if (salespersonDoc.exists()) {
                const salespersonData = salespersonDoc.data();
                console.log(`✅ Found salesperson data:`, salespersonData);
                console.log(`🔍 Salesperson fields:`, {
                  firstName: salespersonData.firstName,
                  lastName: salespersonData.lastName,
                  name: salespersonData.name,
                  fullName: salespersonData.fullName,
                  email: salespersonData.email,
                  crm_sales: salespersonData.crm_sales
                });
                return { 
                  id: salespersonId, 
                  ...(typeof salesperson === 'object' ? salesperson : {}), 
                  ...salespersonData 
                };
              }
              console.log(`❌ Salesperson ${salespersonId} not found in users collection`);
              return { id: salespersonId, name: 'Unknown Salesperson' };
            } catch (error) {
              console.error(`Error fetching salesperson ${typeof salesperson === 'string' ? salesperson : salesperson.id}:`, error);
              return { id: typeof salesperson === 'string' ? salesperson : salesperson.id, name: 'Unknown Salesperson' };
            }
          })
        );
        enhancedResult.salespeople = salespeopleWithData;
        console.log(`✅ Enhanced salespeople:`, salespeopleWithData);
      }
      
      // Fetch full location data
      if (result.locations?.length > 0) {
        console.log(`🔍 Fetching full data for ${result.locations.length} locations...`);
        console.log(`📍 Location IDs from denormalized associations:`, result.locations);
        const { collection, getDocs, doc, getDoc } = await import('firebase/firestore');
        const { db } = await import('../firebase');
        
        // Get the company ID from the deal's associations to find the correct location subcollection
        const companyId = result.companies?.[0]?.id;
        console.log(`🔍 Using company ID for locations: ${companyId}`);
        
        const locationsWithData = await Promise.all(
          result.locations.map(async (location: any) => {
            try {
              // Handle both string IDs and object IDs
              const locationId = typeof location === 'string' ? location : location.id;
              console.log(`🔍 Processing location:`, location);
              
              // If the location object already has complete data from denormalized associations, use it
              if (typeof location === 'object' && location.name) {
                console.log(`✅ Using location data from denormalized associations:`, location);
                return {
                  id: locationId,
                  ...location
                };
              }
              
              // Otherwise, try to fetch the full data from Firestore
              console.log(`🔍 Fetching location with ID: ${locationId} from Firestore`);
              
              // Try multiple location paths to handle different data structures
              let locationData = null;
              let locationRef = null;
              
              // Debug: Test user permissions for this specific location
              console.log(`🔍 Testing permissions for location ${locationId} in tenant ${tenantId}`);
              console.log(`👤 User context:`, {
                uid: user?.uid,
                tenantId: user?.tenantId,
                // Remove properties that don't exist on User type
              });
              
              // First try: company subcollection (most common)
              if (companyId) {
                try {
                  locationRef = doc(db, `tenants/${tenantId}/crm_companies/${companyId}/locations`, locationId);
                  const locationDoc = await getDoc(locationRef);
                  if (locationDoc.exists()) {
                    locationData = locationDoc.data();
                    console.log(`✅ Found location in company subcollection:`, locationData);
                  } else {
                    console.log(`❌ Location ${locationId} not found in company ${companyId} subcollection`);
                  }
                } catch (companyError) {
                  const companyMsg = companyError instanceof Error ? companyError.message : String(companyError);
                  console.log(`⚠️ Could not fetch from company subcollection:`, companyMsg);
                  console.log(`🔍 Company error details:`, {
                    error: companyMsg,
                    code: (companyError as any)?.code,
                    locationId,
                    companyId,
                    tenantId
                  });
                }
              }
              
              // Second try: top-level locations collection (fallback)
              if (!locationData) {
                try {
                  locationRef = doc(db, `tenants/${tenantId}/crm_locations`, locationId);
                  const locationDoc = await getDoc(locationRef);
                  if (locationDoc.exists()) {
                    locationData = locationDoc.data();
                    console.log(`✅ Found location in top-level collection:`, locationData);
                  } else {
                    console.log(`❌ Location ${locationId} not found in top-level collection`);
                  }
                } catch (topLevelError) {
                  const topLevelMsg = topLevelError instanceof Error ? topLevelError.message : String(topLevelError);
                  console.log(`⚠️ Could not fetch from top-level collection:`, topLevelMsg);
                }
              }
              
              // Third try: search all companies for this location
              if (!locationData && companyId) {
                try {
                  console.log(`🔍 Searching all companies for location ${locationId}`);
                  const companiesRef = collection(db, `tenants/${tenantId}/crm_companies`);
                  const companiesSnapshot = await getDocs(companiesRef);
                  console.log(`🔍 Found ${companiesSnapshot.docs.length} companies to search`);
                  
                  for (const companyDoc of companiesSnapshot.docs) {
                    try {
                      const companyLocationRef = doc(db, `tenants/${tenantId}/crm_companies/${companyDoc.id}/locations`, locationId);
                      const companyLocationDoc = await getDoc(companyLocationRef);
                      if (companyLocationDoc.exists()) {
                        locationData = companyLocationDoc.data();
                        console.log(`✅ Found location in company ${companyDoc.id}:`, locationData);
                        break;
                      }
                    } catch (searchError) {
                      // Continue searching other companies
                      const searchMsg = searchError instanceof Error ? searchError.message : String(searchError);
                      console.log(`⚠️ Error searching company ${companyDoc.id}:`, searchMsg);
                    }
                  }
                  
                  if (!locationData) {
                    console.log(`❌ Location ${locationId} not found in any company subcollection`);
                  }
                } catch (searchAllError) {
                  const searchAllMsg = searchAllError instanceof Error ? searchAllError.message : String(searchAllError);
                  console.log(`⚠️ Could not search all companies:`, searchAllMsg);
                }
              }
              
              if (locationData) {
                console.log(`🔍 Location fields:`, {
                  name: locationData.name,
                  address: locationData.address,
                  title: locationData.title,
                  city: locationData.city,
                  state: locationData.state
                });
                
                // Update denormalized associations with the full location data
                await updateDenormalizedAssociationsWithLocationData(locationId, locationData);
                
                return { 
                  id: locationId, 
                  ...(typeof location === 'object' ? location : {}), 
                  ...locationData 
                };
              }
              
              // If we couldn't find the location data, but we have an ID, show the ID instead of "Unknown Location"
              console.log(`❌ Location ${locationId} not found in any collection`);
              return { 
                id: locationId, 
                name: `Location ${locationId}`,
                error: 'Location data not accessible'
              };
            } catch (error) {
              console.error(`Error fetching location ${typeof location === 'string' ? location : location.id}:`, error);
              console.log(`🔍 Location error details:`, {
                error: (error as any)?.message || String(error),
                code: (error as any)?.code,
                locationId: typeof location === 'string' ? location : location.id,
                companyId: companyId
              });
              // Return a fallback location object instead of throwing
              return { 
                id: typeof location === 'string' ? location : location.id, 
                name: 'Location (Access Restricted)',
                error: (error as any)?.message || String(error)
              };
            }
          })
        );
        enhancedResult.locations = locationsWithData;
        console.log(`✅ Enhanced locations:`, locationsWithData);
      }
      
      // Fetch full deal data
      if (result.deals?.length > 0) {
        console.log(`🔍 Fetching full data for ${result.deals.length} deals...`);
        const { collection, getDocs, query, where, doc, getDoc } = await import('firebase/firestore');
        const { db } = await import('../firebase');
        
        const dealsWithData = await Promise.all(
          result.deals.map(async (deal: any) => {
            try {
              // Handle both string IDs and object IDs
              const dealId = typeof deal === 'string' ? deal : deal.id;
              console.log(`🔍 Fetching deal with ID: ${dealId}`);
              
              const dealRef = doc(db, `tenants/${tenantId}/crm_deals`, dealId);
              const dealDoc = await getDoc(dealRef);
              if (dealDoc.exists()) {
                const dealData = dealDoc.data();
                console.log(`✅ Found deal data:`, dealData);
                return { 
                  id: dealId, 
                  ...(typeof deal === 'object' ? deal : {}), 
                  ...dealData 
                };
              }
              console.log(`❌ Deal ${dealId} not found`);
              return { id: dealId, name: 'Unknown Deal' };
            } catch (error) {
              console.error(`Error fetching deal ${typeof deal === 'string' ? deal : deal.id}:`, error);
              return { id: typeof deal === 'string' ? deal : deal.id, name: 'Unknown Deal' };
            }
          })
        );
        enhancedResult.deals = dealsWithData;
        console.log(`✅ Enhanced deals:`, dealsWithData);
      }
      
      setAssociations(enhancedResult);
    } catch (err) {
      console.error('Error loading fast associations:', err);
      setError('Failed to load associations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssociations();
  }, [entityType, entityId, tenantId, user]);

  const getEntityIcon = (type: string) => {
    switch (type) {
      case 'company': return <BusinessIcon />;
      case 'contact': return <PersonIcon />;
      case 'salesperson': return <SalespeopleIcon />;
      case 'location': return <LocationIcon />;
      case 'deal': return <DealIcon />;
      case 'division': return <WorkIcon />;
      case 'task': return <TaskIcon />;
      default: return <PersonIcon />;
    }
  };

  const getEntityLabel = (type: string) => {
    switch (type) {
      case 'companies': return 'Companies';
      case 'contacts': return 'Contacts';
      case 'salespeople': return 'Salespeople';
      case 'locations': return 'Locations';
      case 'deals': return 'Deals';
      case 'divisions': return 'Divisions';
      case 'tasks': return 'Tasks';
      default: return type.charAt(0).toUpperCase() + type.slice(1);
    }
  };

  const getEntityName = (entity: any, type: string) => {
    console.log(`🔍 Getting name for ${type} entity:`, entity);
    console.log(`🔍 Entity type: ${typeof entity}, keys:`, Object.keys(entity || {}));
    
    switch (type) {
      case 'companies': {
        const companyName = entity.name || entity.companyName || entity.title || 'Unknown Company';
        console.log(`🏢 Company name: ${companyName} (from fields: name=${entity.name}, companyName=${entity.companyName}, title=${entity.title})`);
        return companyName;
      }
      case 'contacts': {
        const contactName = entity.name || entity.fullName || entity.title || 'Unknown Contact';
        console.log(`👤 Contact name: ${contactName} (from fields: name=${entity.name}, fullName=${entity.fullName}, title=${entity.title})`);
        return contactName;
      }
      case 'salespeople': {
        // Handle salespeople with firstName/lastName fields
        if (entity.firstName && entity.lastName) {
          const salespersonName = `${entity.firstName} ${entity.lastName}`;
          console.log(`👥 Salesperson name: ${salespersonName} (from firstName=${entity.firstName}, lastName=${entity.lastName})`);
          return salespersonName;
        }
        const salespersonName = entity.name || entity.fullName || entity.title || 'Unknown Salesperson';
        console.log(`👥 Salesperson name: ${salespersonName} (from fields: name=${entity.name}, fullName=${entity.fullName}, title=${entity.title})`);
        return salespersonName;
      }
      case 'locations': {
        const locationName = entity.name || entity.address || entity.title || 'Unknown Location';
        console.log(`📍 Location name: ${locationName} (from fields: name=${entity.name}, address=${entity.address}, title=${entity.title})`);
        return locationName;
      }
      case 'deals': {
        const dealName = entity.name || entity.title || 'Unknown Deal';
        console.log(`💰 Deal name: ${dealName}`);
        return dealName;
      }
      case 'divisions': {
        const divisionName = entity.name || entity.title || 'Unknown Division';
        console.log(`🏢 Division name: ${divisionName}`);
        return divisionName;
      }
      case 'tasks': {
        const taskName = entity.title || entity.name || 'Unknown Task';
        console.log(`📋 Task name: ${taskName}`);
        return taskName;
      }
      default: {
        const defaultName = entity.name || entity.title || 'Unknown';
        console.log(`❓ Default name: ${defaultName}`);
        return defaultName;
      }
    }
  };

  const getEntitySubtitle = (entity: any, type: string) => {
    switch (type) {
      case 'companies': return entity.industry || entity.city;
      case 'contacts': return entity.email || entity.phone;
      case 'salespeople': 
        // For salespeople, show email as subtitle
        return entity.email || entity.phone || '';
      case 'locations': return entity.city || entity.address;
      case 'deals': return entity.stage || `$${entity.value?.toLocaleString()}`;
      case 'divisions': return entity.description;
      case 'tasks': return entity.status || entity.priority;
      default: return '';
    }
  };

  const handleEntityClick = (entity: any, type: string) => {
    const routeMap: { [key: string]: string } = {
      'companies': `/crm/companies/${entity.id}`,
      'deals': `/crm/deals/${entity.id}`,
      'contacts': `/crm/contacts/${entity.id}`,
      'salespeople': `/crm/salespeople/${entity.id}`,
      'tasks': `/crm/tasks/${entity.id}`,
      'locations': `/crm/locations/${entity.id}`
    };

    const route = routeMap[type];
    if (route) {
      navigate(route);
    }
  };

  const handleAddAssociation = async (targetType: string, targetEntity: any) => {
    try {
      const associationService = createDenormalizedAssociationService(tenantId);
      
      // Add the association
      await associationService.addAssociation(
        entityType,
        entityId,
        targetType as keyof DenormalizedAssociations,
        targetEntity
      );
      
      // Reload associations
      await loadAssociations();
      
      if (onAssociationChange) {
        onAssociationChange();
      }
    } catch (err) {
      console.error('Error adding association:', err);
      setError('Failed to add association');
    }
  };

  const handleRemoveAssociation = async (targetType: string, targetEntityId: string) => {
    try {
      const associationService = createDenormalizedAssociationService(tenantId);
      
      // Remove the association
      await associationService.removeAssociation(
        entityType,
        entityId,
        targetType as keyof DenormalizedAssociations,
        targetEntityId
      );
      
      // Reload associations
      await loadAssociations();
      
      if (onAssociationChange) {
        onAssociationChange();
      }
    } catch (err) {
      console.error('Error removing association:', err);
      setError('Failed to remove association');
    }
  };

  const loadAvailableEntities = async (targetType: string) => {
    if (loadingEntities[targetType]) return;
    
    try {
      setLoadingEntities(prev => ({ ...prev, [targetType]: true }));
      
      const entities = await loadEntitiesByType(targetType);
      setAvailableEntities(prev => ({ ...prev, [targetType]: entities }));
    } catch (err) {
      console.error(`Error loading available ${targetType}:`, err);
      setError(`Failed to load available ${targetType}`);
    } finally {
      setLoadingEntities(prev => ({ ...prev, [targetType]: false }));
    }
  };

  const loadEntitiesByType = async (entityType: string): Promise<any[]> => {
    try {
      // Import Firebase functions
      const { collection, getDocs, query, where } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      
      console.log(`🔍 Loading ${entityType} entities...`);
      
      let entities: any[] = [];

      if (entityType === 'salespeople' || entityType === 'salesperson') {
        // Use Firebase Function for salespeople (same as SimpleAssociationsCard)
        console.log(`🔍 Using Firebase Function to load salespeople`);
        const functions = getFunctions();
        const getSalespeople = httpsCallable(functions, 'getSalespeople');
        
        const result = await getSalespeople({
          tenantId: tenantId,
          activeTenantId: tenantId
        });
        
        entities = (result.data as any).salespeople || [];
        console.log(`✅ Loaded ${entities.length} salespeople via Firebase Function`);
      } else {
        // Use direct Firestore query for other entity types
        // When selecting for a deal, restrict by the associated company
        const associatedCompanies: any[] = (associations?.companies || []).filter(Boolean);
        const companyIds: string[] = associatedCompanies.map((c: any) => (typeof c === 'string' ? c : c.id)).filter(Boolean);

        if (entityType === 'locations' || entityType === 'location') {
          // Locations live under each company subcollection: crm_companies/{companyId}/locations
          if (companyIds.length === 0) {
            console.log('No associated companies found; returning no locations');
            return [];
          }

          const locationDocsArrays = await Promise.all(
            companyIds.map(async (companyId) => {
              const companyLocationsCol = collection(db, `tenants/${tenantId}/crm_companies/${companyId}/locations`);
              const snap = await getDocs(companyLocationsCol);
              return snap.docs.map((d) => ({ id: d.id, companyId, ...(d.data() as any) }));
            })
          );
          entities = locationDocsArrays.flat();
        } else if (entityType === 'contacts' || entityType === 'contact') {
          // Contacts collection at tenant level; filter by companyId in associated companyIds
          const contactsCol = collection(db, `tenants/${tenantId}/crm_contacts`);
          if (companyIds.length > 0 && companyIds.length <= 10) {
            // Firestore supports up to 10 values in 'in' clause
            const qContacts = query(contactsCol, where('companyId', 'in', companyIds));
            const snap = await getDocs(qContacts);
            entities = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          } else if (companyIds.length === 0) {
            console.log('No associated companies found; returning no contacts');
            entities = [];
          } else {
            // Fallback: load and client-filter if too many companies
            const snap = await getDocs(contactsCol);
            entities = snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as any) }))
              .filter((c: any) => companyIds.includes(c.companyId));
          }
        } else if (entityType === 'companies' || entityType === 'company') {
          const companiesCol = collection(db, `tenants/${tenantId}/crm_companies`);
          const snap = await getDocs(companiesCol);
          entities = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        } else if (entityType === 'deals' || entityType === 'deal') {
          const dealsCol = collection(db, `tenants/${tenantId}/crm_deals`);
          const snap = await getDocs(dealsCol);
          entities = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        } else {
          return [];
        }
      }
      
      console.log(`📋 Entities for ${entityType}:`, entities);
      
      // Filter out entities that are already associated
      const currentAssociations = associations?.[entityType + 's'] || [];
      const currentIds = currentAssociations.map((entity: any) => entity.id);
      
      const filteredEntities = entities.filter(entity => !currentIds.includes(entity.id));
      console.log(`✅ Available ${entityType} (after filtering):`, filteredEntities);
      
      return filteredEntities;
      
    } catch (error) {
      console.error(`Error loading ${entityType}:`, error);
      return [];
    }
  };

  const updateDenormalizedAssociationsWithLocationData = async (locationId: string, locationData: any) => {
    if (!tenantId || !entityId || !locationData) return;
    
    try {
      console.log(`🔄 Updating denormalized associations with location data for ${entityType}:${entityId}`);
      
      // Get current associations
      const associationService = createDenormalizedAssociationService(tenantId);
      const currentAssociations = await associationService.getAssociations(entityType, entityId);
      
      // Update the location in associations with full data
      const updatedLocations = currentAssociations.locations.map((loc: any) => {
        if (loc.id === locationId || (typeof loc === 'string' && loc === locationId)) {
          return {
            id: locationId,
            name: locationData.name || 'Unknown Location',
            address: locationData.address || locationData.title || '',
            ...locationData
          };
        }
        return loc;
      });
      
      // Update the associations
      await associationService.updateAssociations(entityType, entityId, {
        ...currentAssociations,
        locations: updatedLocations
      });
      
      console.log(`✅ Updated denormalized associations with location data`);
    } catch (error) {
      console.error('Error updating denormalized associations:', error);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent>
          <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" minHeight={200} gap={2}>
            <CircularProgress size={40} />
            <Typography variant="body2" color="text.secondary">
              Loading associations...
            </Typography>
            <Typography variant="caption" color="text.secondary">
              This may take a few seconds
            </Typography>
          </Box>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent>
          <Alert severity="error">{error}</Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          {Object.entries(showAssociations).map(([type, show], index) => {
            if (!show) return null;

            const entityList = associations?.[type as keyof DenormalizedAssociations] || [];
            const availableEntityList = availableEntities[type] || [];

            return (
              <Box key={`${type}-${index}`}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                  <Typography variant="subtitle2" fontWeight="medium" component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {getEntityIcon(type.replace('s', ''))}
                    {getEntityLabel(type)}
                    {entityList.length > 0 && (
                      <Chip 
                        size="small" 
                        label={entityList.length} 
                        sx={{ ml: 1 }}
                      />
                    )}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Autocomplete
                      size="small"
                      options={availableEntityList}
                      getOptionLabel={(option) => getEntityName(option, type)}
                      isOptionEqualToValue={(option, value) => option.id === value.id}
                      loading={loadingEntities[type] || false}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          placeholder={`Add ${getEntityLabel(type).toLowerCase()}`}
                          size="small"
                          sx={{ minWidth: 200 }}
                          InputProps={{
                            ...params.InputProps,
                            endAdornment: (
                              <>
                                {loadingEntities[type] ? <CircularProgress color="inherit" size={20} /> : null}
                                {params.InputProps.endAdornment}
                              </>
                            ),
                          }}
                        />
                      )}
                      onChange={(_, value) => {
                        if (value) {
                          handleAddAssociation(type, value);
                        }
                      }}
                      onOpen={async () => {
                        await loadAvailableEntities(type);
                      }}
                      noOptionsText={availableEntityList.length === 0 ? "No options" : "No matches"}
                    />
                  </Box>
                </Box>

                {entityList.length > 0 ? (
                  <TableContainer component={Paper} variant="outlined" sx={{ boxShadow: 'none' }}>
                    <Table size="small">
                      <TableBody>
                        {entityList.map((entity) => (
                          <TableRow key={entity.id}>
                            <TableCell>
                              <Box display="flex" alignItems="center" gap={1}>
                                {getEntityIcon(type.replace('s', ''))}
                                <Box>
                                  <Typography variant="body2" fontWeight="medium">
                                    {getEntityName(entity, type)}
                                  </Typography>
                                  {getEntitySubtitle(entity, type) && (
                                    <Typography variant="caption" color="text.secondary">
                                      {getEntitySubtitle(entity, type)}
                                    </Typography>
                                  )}
                                </Box>
                              </Box>
                            </TableCell>
                            <TableCell align="right" sx={{ width: '120px' }}>
                              <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ width: '100%' }}>
                                <IconButton
                                  size="small"
                                  onClick={() => handleEntityClick(entity, type)}
                                  sx={{ color: 'primary.main' }}
                                >
                                  <OpenInNewIcon fontSize="small" />
                                </IconButton>
                                <IconButton
                                  size="small"
                                  onClick={() => handleRemoveAssociation(type, entity.id)}
                                  sx={{ color: 'error.main' }}
                                >
                                  <CloseIcon fontSize="small" />
                                </IconButton>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No {getEntityLabel(type).toLowerCase()} associated
                  </Typography>
                )}
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default FastAssociationsCard;