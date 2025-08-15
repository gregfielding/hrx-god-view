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
// Legacy denormalized service removed; using unified service + direct fields
type DenormalizedAssociations = any;
import { isNewAssociationsReadEnabled } from '../utils/associationsAdapter';

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
  // NEW: Pre-loaded associations to prevent duplicate calls
  preloadedAssociations?: DenormalizedAssociations;
  preloadedContacts?: any[];
  preloadedSalespeople?: any[];
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
  maxHeight = 400,
  preloadedAssociations,
  preloadedContacts,
  preloadedSalespeople
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [associations, setAssociations] = useState<DenormalizedAssociations | null>(null);
  const [loading, setLoading] = useState(true);
  // const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [availableEntities, setAvailableEntities] = useState<{ [key: string]: any[] }>({});
  const [loadingEntities, setLoadingEntities] = useState<{ [key: string]: boolean }>({});

  // Use pre-loaded associations when available
  useEffect(() => {
    if (preloadedAssociations) {
      console.log(`🎯 FastAssociationsCard: Using pre-loaded associations for ${entityType}:${entityId}`);
      
      // If we have pre-loaded salespeople, use them instead of the denormalized data
      if (preloadedSalespeople && preloadedSalespeople.length > 0) {
        console.log(`🎯 FastAssociationsCard: Using pre-loaded salespeople:`, preloadedSalespeople);
        const enhancedAssociations = {
          ...preloadedAssociations,
          salespeople: preloadedSalespeople
        };
        setAssociations(enhancedAssociations);
      } else {
        setAssociations(preloadedAssociations);
      }
      
      setLoading(false);
      setError(null);

      // Enrich names/emails if missing (fetch once in background)
      (async () => {
        try {
          if (!tenantId) return;
          const { doc, getDoc } = await import('firebase/firestore');
          const { db } = await import('../firebase');
          const current = preloadedAssociations;
          const enriched = { ...current } as any;

          // Companies
          if (Array.isArray(current.companies)) {
            const updated = await Promise.all(
              current.companies.map(async (c: any) => {
                if (c?.name || c?.snapshot?.name || c?.companyName) return c;
                try {
                  const ref = doc(db, `tenants/${tenantId}/crm_companies`, c.id);
                  const snap = await getDoc(ref);
                  if (snap.exists()) {
                    const data: any = snap.data();
                    return { ...c, name: data.name || data.companyName, snapshot: { ...(c.snapshot || {}), name: data.name || data.companyName } };
                  }
                } catch {}
                return c;
              })
            );
            enriched.companies = updated;
          }

          // Contacts
          if (Array.isArray(current.contacts)) {
            const updated = await Promise.all(
              current.contacts.map(async (ct: any) => {
                if (ct?.name || ct?.fullName || ct?.snapshot?.fullName) return ct;
                try {
                  const ref = doc(db, `tenants/${tenantId}/crm_contacts`, ct.id);
                  const snap = await getDoc(ref);
                  if (snap.exists()) {
                    const data: any = snap.data();
                    const fullName = data.fullName || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : undefined);
                    return { ...ct, name: fullName || ct.name, snapshot: { ...(ct.snapshot || {}), fullName: fullName || ct.snapshot?.fullName, email: data.email || ct.snapshot?.email } };
                  }
                } catch {}
                return ct;
              })
            );
            enriched.contacts = updated;
          }

          // Salespeople (users)
          if (Array.isArray(current.salespeople)) {
            const updated = await Promise.all(
              current.salespeople.map(async (sp: any) => {
                if (sp?.displayName || sp?.firstName || sp?.snapshot?.displayName) return sp;
                try {
                  const ref = doc(db, `users`, sp.id);
                  const snap = await getDoc(ref);
                  if (snap.exists()) {
                    const data: any = snap.data();
                    const displayName = data.displayName || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : undefined);
                    return { ...sp, displayName: displayName, snapshot: { ...(sp.snapshot || {}), displayName: displayName, email: data.email || sp.snapshot?.email } };
                  }
                } catch {}
                return sp;
              })
            );
            enriched.salespeople = updated;
          }

          // Locations (try company subcollection first, then top-level)
          if (Array.isArray(current.locations)) {
            const associatedCompanyIds = (current.companies || []).map((c: any) => c?.id).filter(Boolean);
            const updated = await Promise.all(
              current.locations.map(async (l: any) => {
                if (l?.name || l?.snapshot?.nickname || l?.snapshot?.name) return l;
                try {
                  let data: any = null;
                  // Try company subcollections
                  for (const cid of associatedCompanyIds) {
                    try {
                      const refSub = doc(db, `tenants/${tenantId}/crm_companies/${cid}/locations`, l.id);
                      const snapSub = await getDoc(refSub);
                      if (snapSub.exists()) {
                        data = snapSub.data();
                        break;
                      }
                    } catch {}
                  }
                  // Fallback: top-level locations
                  if (!data) {
                    const refTop = doc(db, `tenants/${tenantId}/crm_locations`, l.id);
                    const snapTop = await getDoc(refTop);
                    if (snapTop.exists()) data = snapTop.data();
                  }
                  if (data) {
                    return { ...l, name: data.nickname || data.name, snapshot: { ...(l.snapshot || {}), nickname: data.nickname, name: data.name, city: data.city } };
                  }
                } catch {}
                return l;
              })
            );
            enriched.locations = updated;
          }

          setAssociations(enriched);
        } catch (e) {
          console.warn('Background enrichment skipped:', e);
        }
      })();
    }
  }, [preloadedAssociations, preloadedSalespeople, entityType, entityId]);

  const loadAssociations = async () => {
    if (!user || !tenantId || !entityId) return;

    try {
      setLoading(true);
      setError(null);

      // Prefer preloaded (from deal.associations) when flag is on
      if (preloadedAssociations && isNewAssociationsReadEnabled()) {
        console.log(`🎯 Using pre-loaded associations for ${entityType}:${entityId}`);
        setAssociations(preloadedAssociations);
        setLoading(false);
        return;
      }

      console.log(`🔍 Loading associations for ${entityType}:${entityId} in tenant ${tenantId}`);
      console.log(`👤 Current user:`, {
        uid: user.uid,
        email: user.email,
        tenantId: user.tenantId,
        // Remove properties that don't exist on User type
      });
      
      // Unified approach: read from entity doc associations directly or via lightweight fetches
      if (!tenantId) {
        throw new Error('Missing tenantId');
      }
      const { doc, getDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      const collectionPath = (() => {
        switch (entityType) {
          case 'company': return `tenants/${tenantId}/crm_companies`;
          case 'contact': return `tenants/${tenantId}/crm_contacts`;
          case 'deal': return `tenants/${tenantId}/crm_deals`;
          case 'location': return `tenants/${tenantId}/crm_locations`;
          case 'task': return `tenants/${tenantId}/crm_tasks`;
          case 'salesperson': return `users`;
          default: return `tenants/${tenantId}/crm_${entityType}s`;
        }
      })();
      const ref = doc(db, collectionPath, entityId);
      const ds = await getDoc(ref);
      const base = ds.exists() ? (ds.data() as any) : {};
      const result: any = base.associations || { companies: [], contacts: [], salespeople: [], locations: [], deals: [], divisions: [], tasks: [] };
      
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
              // Treat 'Unknown' as incomplete and fetch from Firestore
              if (typeof location === 'object' && location.name && location.name !== 'Unknown') {
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
        const fromSnap = entity.snapshot?.name || entity.snapshot?.companyName;
        let companyName = fromSnap || entity.companyName || entity.name || entity.title || 'Unknown Company';
        if ((companyName === 'Unknown' || companyName === 'Unknown Company') && entity.companyName) {
          companyName = entity.companyName;
        }
        console.log(`🏢 Company name: ${companyName} (from fields: name=${entity.name}, companyName=${entity.companyName}, title=${entity.title})`);
        return companyName;
      }
      case 'contacts': {
        const fromSnap = entity.snapshot?.fullName || entity.snapshot?.name;
        const fromFirstLast = entity.firstName && entity.lastName ? `${entity.firstName} ${entity.lastName}` : undefined;
        const contactName = fromSnap || fromFirstLast || entity.name || entity.fullName || entity.displayName || entity.title || 'Unknown Contact';
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
        // Handle salespeople with displayName field (from user collection)
        if (entity.displayName || entity.snapshot?.displayName) {
          const name = entity.displayName || entity.snapshot?.displayName;
          console.log(`👥 Salesperson name: ${name} (from displayName)`);
          return name as string;
        }
        if (entity.snapshot?.name) {
          const name = entity.snapshot.name;
          console.log(`👥 Salesperson name: ${name} (from snapshot.name)`);
          return name;
        }
        const name = entity.name || entity.fullName || entity.title || 'Unknown Salesperson';
        console.log(`👥 Salesperson name: ${name} (from fields: name=${entity.name}, fullName=${entity.fullName}, title=${entity.title})`);
        return name;
      }
      case 'locations': {
        const fromSnap = entity.snapshot?.nickname || entity.snapshot?.name || entity.snapshot?.city || entity.snapshot?.addressLine1;
        let locationName = fromSnap || entity.name || entity.address || entity.title || '';
        if (!locationName || locationName === 'Unknown' || locationName === 'Unknown Location') {
          locationName = entity.snapshot?.city || entity.id || 'Unknown Location';
        }
        console.log(`📍 Location name: ${locationName} (from fields: name=${entity.name}, snapshot=${JSON.stringify(entity.snapshot || {})})`);
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
      case 'companies': {
        const industry = entity.snapshot?.industry || entity.industry;
        const city = entity.snapshot?.city || entity.city;
        const state = entity.snapshot?.state || entity.state;
        const isValid = (v: any) => typeof v === 'string' && /[A-Za-z]/.test(v) && v.trim().length >= 3;
        if (isValid(industry)) return industry;
        if (isValid(city)) return state ? `${city}, ${state}` : city;
        return '';
      }
      case 'contacts': return entity.snapshot?.email || entity.email || entity.phone;
      case 'salespeople': 
        // For salespeople, show email as subtitle
        return entity.snapshot?.email || entity.email || entity.phone || '';
      case 'locations': {
        const city = entity.snapshot?.city || entity.city;
        const state = entity.snapshot?.state || entity.state;
        const addr = entity.snapshot?.addressLine1 || entity.addressLine1 || entity.address;
        const isValid = (v: any) => typeof v === 'string' && /[A-Za-z]/.test(v) && v.trim().length >= 3;
        if (isValid(city)) return state ? `${city}, ${state}` : city;
        if (isValid(addr)) return addr;
        return '';
      }
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
      if (!tenantId) {
        console.warn('manageAssociations blocked: missing tenantId', { entityType, entityId, targetType, targetId: targetEntity?.id || targetEntity });
        setError('Missing tenant context; cannot update associations.');
        return;
      }
      // Try dual-write callable first
      try {
        const { getFunctions, httpsCallable } = await import('firebase/functions');
        const functions = getFunctions(undefined as any, 'us-central1');
        const manageAssociations = httpsCallable(functions, 'manageAssociations');
        const payload = {
          action: 'add',
          sourceEntityType: entityType,
          sourceEntityId: entityId,
          targetEntityType: targetType,
          targetEntityId: targetEntity.id || targetEntity,
          tenantId
        } as any;
        console.log('manageAssociations.add payload', payload);
        await manageAssociations(payload);
      } catch (callableErr) {
        console.warn('Callable add failed:', callableErr);
      }

      await loadAssociations();
      if (onAssociationChange) onAssociationChange();
    } catch (err: any) {
      console.error('Error adding association:', err);
      const message = err?.message || err?.code || 'Failed to add association';
      setError(message);
    }
  };

  const handleRemoveAssociation = async (targetType: string, targetEntityId: string) => {
    try {
      if (!tenantId) {
        console.warn('manageAssociations blocked: missing tenantId (remove)', { entityType, entityId, targetType, targetId: targetEntityId });
        setError('Missing tenant context; cannot update associations.');
        return;
      }
      // Try dual-write callable first
      try {
        const { getFunctions, httpsCallable } = await import('firebase/functions');
        const functions = getFunctions(undefined as any, 'us-central1');
        const manageAssociations = httpsCallable(functions, 'manageAssociations');
        const payload = {
          action: 'remove',
          sourceEntityType: entityType,
          sourceEntityId: entityId,
          targetEntityType: targetType,
          targetEntityId,
          tenantId
        } as any;
        console.log('manageAssociations.remove payload', payload);
        await manageAssociations(payload);
      } catch (callableErr) {
        console.warn('Callable remove failed:', callableErr);
      }

      await loadAssociations();
      if (onAssociationChange) onAssociationChange();
    } catch (err: any) {
      console.error('Error removing association:', err);
      const message = err?.message || err?.code || 'Failed to remove association';
      setError(message);
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
        // Use Firebase Function for salespeople (same as UniversalAssociationsCard)
        console.log(`🔍 Using Firebase Function to load salespeople`);
        const functions = getFunctions();
        const getSalespeople = httpsCallable(functions, 'getSalespeopleForTenant');
        
        const result = await getSalespeople({
          tenantId: tenantId
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
          // Prefer explicit associations.contacts from the deal when available
          const assocContacts: any[] = (associations?.contacts || []).filter(Boolean);
          const contactIds: string[] = assocContacts.map((c: any) => (typeof c === 'string' ? c : c.id)).filter(Boolean);
          const contactsCol = collection(db, `tenants/${tenantId}/crm_contacts`);
          if (contactIds.length > 0) {
            const chunkSize = 10;
            const chunks: string[][] = [];
            for (let i = 0; i < contactIds.length; i += chunkSize) chunks.push(contactIds.slice(i, i + chunkSize));
            const resultsArrays = await Promise.all(
              chunks.map(async (ids) => {
                const qContacts = query(contactsCol, where('__name__', 'in', ids));
                const snap = await getDocs(qContacts);
                return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
              })
            );
            entities = resultsArrays.flat();
          } else {
            // Fallback: load all contacts or filter by associated companyIds if provided
            if (companyIds.length > 0 && companyIds.length <= 10) {
              const qContacts = query(contactsCol, where('companyId', 'in', companyIds));
              const snap = await getDocs(qContacts);
              entities = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
            } else if (companyIds.length === 0) {
              const snap = await getDocs(contactsCol);
              entities = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
            } else {
              const snap = await getDocs(contactsCol);
              entities = snap.docs
                .map((d) => ({ id: d.id, ...(d.data() as any) }))
                .filter((c: any) => companyIds.includes(c.companyId));
            }
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
      console.log(`🔄 Updating associations snapshot with location data for ${entityType}:${entityId}`);
      const { doc, updateDoc, getDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      const ref = doc(db, `tenants/${tenantId}/crm_${entityType}s`, entityId);
      const ds = await getDoc(ref);
      const current = ds.exists() ? (ds.data() as any).associations || {} : {};
      
      // Update the location in associations with full data
      const existingLocations = Array.isArray(current.locations) ? current.locations : [];
      const updatedLocations = existingLocations.map((loc: any) => {
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
      await updateDoc(ref, { associations: { ...current, locations: updatedLocations } });
      
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