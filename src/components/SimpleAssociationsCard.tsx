import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Autocomplete,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Paper,
  IconButton,
  Chip,
  CircularProgress,
  Alert,
  Stack
} from '@mui/material';
import {
  Business as BusinessIcon,
  LocationOn as LocationIcon,
  Person as PersonIcon,
  AttachMoney as DealIcon,
  Group as SalespeopleIcon,
  Assignment as TaskIcon,
  Close as CloseIcon,
  OpenInNew as OpenInNewIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where, limit, doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { createSimpleAssociationService, SimpleAssociations } from '../utils/simpleAssociationService';
import { createUnifiedAssociationService } from '../utils/unifiedAssociationService';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';


// 🎯 SIMPLE ASSOCIATIONS CARD
// Uses the simple association system with maps in entity documents

interface SimpleAssociationsCardProps {
  entityType: 'company' | 'location' | 'contact' | 'deal' | 'salesperson' | 'task';
  entityId: string;
  entityName: string;
  tenantId: string;
  
  // Configuration for what associations to show
  showAssociations?: {
    companies?: boolean;
    locations?: boolean;
    contacts?: boolean;
    deals?: boolean;
    salespeople?: boolean;
    tasks?: boolean;
  };
  
  // Custom labels
  customLabels?: {
    companies?: string;
    locations?: string;
    contacts?: string;
    deals?: string;
    salespeople?: string;
    tasks?: string;
  };
  
  // Callbacks
  onAssociationChange?: (type: string, action: 'add' | 'remove', entityId: string) => void;
  onError?: (error: string) => void;
  
  // UI Options
  maxHeight?: number;
  showCounts?: boolean;
  showActions?: boolean;
  compact?: boolean;
  
  // Cached data props to prevent reloading
  cachedAssociations?: SimpleAssociations;
  cachedEntities?: {
    companies: any[];
    deals: any[];
    contacts: any[];
    salespeople: any[];
    tasks: any[];
    locations: any[];
  };
  isLoading?: boolean;
  error?: string | null;
}

const SimpleAssociationsCard: React.FC<SimpleAssociationsCardProps> = ({
  entityType,
  entityId,
  entityName,
  tenantId,
  showAssociations = {
    companies: true,
    locations: true,
    contacts: true,
    deals: true,
    salespeople: true,
    tasks: true
  },
  customLabels = {},
  onAssociationChange,
  onError,
  maxHeight = 400,
  showCounts = true,
  showActions = true,
  compact = false,
  cachedAssociations,
  cachedEntities,
  isLoading: externalLoading,
  error: externalError
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [loadingEntities, setLoadingEntities] = useState<{[key: string]: boolean}>({});
  const [dataReady, setDataReady] = useState<{[key: string]: boolean}>({});
  const [error, setError] = useState<string | null>(null);
  
  // Use external loading and error states if provided
  const isCurrentlyLoading = externalLoading !== undefined ? externalLoading : loading;
  const currentError = externalError !== undefined ? externalError : error;

  // Debug: Log loading state changes
  useEffect(() => {
    console.log(`🔄 Loading state changed to: ${loading}`);
  }, [loading]);
  const [associations, setAssociations] = useState<SimpleAssociations>({});
  const [entities, setEntities] = useState<{
    companies: any[];
    deals: any[];
    contacts: any[];
    salespeople: any[];
    tasks: any[];
    locations: any[];
  }>({
    companies: [],
    deals: [],
    contacts: [],
    salespeople: [],
    tasks: [],
    locations: []
  });

  // Available entities for adding new associations
  const [availableEntities, setAvailableEntities] = useState<{
    companies: any[];
    deals: any[];
    contacts: any[];
    salespeople: any[];
    tasks: any[];
    locations: any[];
  }>({
    companies: [],
    deals: [],
    contacts: [],
    salespeople: [],
    tasks: [],
    locations: []
  });

  // Association service
  const associationService = createSimpleAssociationService(tenantId, user?.uid || '');
  
  // Simple cache to avoid redundant queries
  const [entityCache, setEntityCache] = useState<{[key: string]: any[]}>({});
  const [cacheTimestamp, setCacheTimestamp] = useState<{[key: string]: number}>({});
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  
  // Persistent cache for unified service results (lifetime of component)
  const [unifiedServiceCache, setUnifiedServiceCache] = useState<{[key: string]: any}>({});

  // Helper function to get collection path
  const getCollectionPath = (entityType: string): string => {
    const collectionMap: { [key: string]: string } = {
      'company': `tenants/${tenantId}/crm_companies`,
      'companies': `tenants/${tenantId}/crm_companies`,
      'deal': `tenants/${tenantId}/crm_deals`,
      'deals': `tenants/${tenantId}/crm_deals`,
      'contact': `tenants/${tenantId}/crm_contacts`,
      'contacts': `tenants/${tenantId}/crm_contacts`,
      'salesperson': 'users',
      'salespeople': 'users',
      'task': `tenants/${tenantId}/crm_tasks`,
      'tasks': `tenants/${tenantId}/crm_tasks`,
      // Note: Locations are stored as subcollections under companies, not as a top-level collection
      'location': `tenants/${tenantId}/crm_companies`, // This will need special handling
      'locations': `tenants/${tenantId}/crm_companies`  // This will need special handling
    };

    return collectionMap[entityType] || `tenants/${tenantId}/crm_${entityType}s`;
  };

  // Load associations and entities
  useEffect(() => {
    // If cached data is provided, use it instead of loading
    if (cachedAssociations && cachedEntities) {
      console.log(`✅ Using cached data for ${entityType}:${entityId}`);
      setAssociations(cachedAssociations);
      setEntities(cachedEntities);
      setLoading(false);
      setError(null);
      return;
    }

    const loadData = async () => {
      try {
        console.log(`🔄 Starting loadData for ${entityType}:${entityId}`);
        setLoading(true);
        setError(null);
        
        // Add timeout to prevent infinite loading
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Loading timeout after 15 seconds')), 15000);
        });

        console.log(`🔍 Loading associations for ${entityType}:${entityId}`);

        // Try unified association service first, fallback to simple service
        let finalResult: any;
        
        // Check persistent cache first
        const cacheKey = `unified_${entityType}_${entityId}`;
        if (unifiedServiceCache[cacheKey]) {
          console.log(`✅ Using cached unified service result for ${entityType}:${entityId}`);
          finalResult = unifiedServiceCache[cacheKey];
        } else {
          try {
            console.log(`🔍 Trying unified association service for ${entityType}:${entityId}`);
            const unifiedService = createUnifiedAssociationService(tenantId, user?.uid || '');
            
            // Add timeout for unified service
            const unifiedPromise = unifiedService.getEntityAssociations(entityType, entityId);
            const unifiedResult = await Promise.race([unifiedPromise, timeoutPromise]) as any;
            
            console.log(`✅ Unified association service returned:`, unifiedResult);
            
            // Convert unified result to simple format
            finalResult = {
              associations: unifiedResult.associations,
              entities: unifiedResult.entities
            };
            
            // Cache the result for the lifetime of the component
            setUnifiedServiceCache(prev => ({
              ...prev,
              [cacheKey]: finalResult
            }));
            
          } catch (unifiedError) {
            console.log(`❌ Unified service failed, falling back to simple service:`, unifiedError);
            
            // Fallback to simple association service
            finalResult = await associationService.getAssociations(entityType, entityId);
            console.log(`✅ Simple association service returned:`, finalResult);
          }
        }
        
        console.log(`🔍 Setting associations and entities:`, finalResult);
        setAssociations(finalResult.associations);
        setEntities(finalResult.entities);

        console.log(`✅ Loaded associations:`, finalResult.associations);
        console.log(`✅ Loaded entities:`, finalResult.entities);
        console.log(`🔄 Setting loading to false`);

        // Note: Removed pre-loading to improve initial load performance
        // Entities will be loaded on-demand when dropdowns are opened

      } catch (err: any) {
        console.error('❌ Error loading associations:', err);
        setError(err.message || 'Failed to load associations');
        onError?.(err.message || 'Failed to load associations');
      } finally {
        console.log(`🔄 Finally block - setting loading to false`);
        setLoading(false);
      }
    };

    loadData();
  }, [entityType, entityId, tenantId, cachedAssociations, cachedEntities]);

  // Debug: Log when available entities change
  useEffect(() => {
    console.log('🔄 Available entities updated:', availableEntities);
  }, [availableEntities]);

  // Load available entities for adding new associations
  const loadAvailableEntities = async (targetType: string) => {
    try {
      console.log(`🔍 Loading available ${targetType} for association...`);
      setLoadingEntities(prev => ({ ...prev, [targetType]: true }));

      // Check cache first
      const cacheKey = `${targetType}_${entityType}_${entityId}`;
      const now = Date.now();
      const cachedData = entityCache[cacheKey];
      const cacheTime = cacheTimestamp[cacheKey];
      
      if (cachedData && cacheTime && (now - cacheTime) < CACHE_DURATION) {
        console.log(`✅ Using cached data for ${targetType}`);
        setAvailableEntities(prev => ({ ...prev, [targetType]: cachedData }));
        setDataReady(prev => ({ ...prev, [targetType]: true }));
        setLoadingEntities(prev => ({ ...prev, [targetType]: false }));
        return;
      }
      
      // Check persistent cache for available entities
      const checkCacheKey = `available_${targetType}_${entityType}_${entityId}`;
      if (unifiedServiceCache[checkCacheKey]) {
        console.log(`✅ Using persistent cached data for ${targetType}`);
        setAvailableEntities(prev => ({ ...prev, [targetType]: unifiedServiceCache[checkCacheKey] }));
        setDataReady(prev => ({ ...prev, [targetType]: true }));
        setLoadingEntities(prev => ({ ...prev, [targetType]: false }));
        return;
      }

      let entities: any[] = [];

      if (targetType === 'salespeople') {
        // Use Firebase Function for salespeople
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
        let collectionPath: string;
        let queryFilter: any = null;

        switch (targetType) {
          case 'companies': {
            collectionPath = `tenants/${tenantId}/crm_companies`;
            break;
          }
          case 'deals': {
            collectionPath = `tenants/${tenantId}/crm_deals`;
            // If we're on a deal page, filter deals by the same company
            if (entityType === 'deal') {
              try {
                // Get the deal document to find its companyId
                const dealRef = doc(db, `tenants/${tenantId}/crm_deals`, entityId);
                const dealDoc = await getDoc(dealRef);
                if (dealDoc.exists()) {
                  const dealData = dealDoc.data();
                  if (dealData.companyId) {
                    console.log(`🔍 Filtering deals by company: ${dealData.companyId}`);
                    queryFilter = where('companyId', '==', dealData.companyId);
                  }
                }
              } catch (err) {
                console.error('Error getting deal company for deal filtering:', err);
              }
            }
            break;
          }
          case 'contacts': {
            // For contacts, always load all contacts from the company
            if (entityType === 'deal') {
              try {
                console.log(`🔍 Loading all contacts for deal's company`);
                
                // Get the deal document to find its companyId
                const dealRef = doc(db, `tenants/${tenantId}/crm_deals`, entityId);
                const dealDoc = await getDoc(dealRef);
                if (dealDoc.exists()) {
                  const dealData = dealDoc.data();
                  if (dealData.companyId) {
                    console.log(`🔍 Loading all contacts for company: ${dealData.companyId}`);
                    
                    // Load all contacts from the company directly
                    const contactsRef = collection(db, `tenants/${tenantId}/crm_contacts`);
                    const contactsQuery = query(contactsRef, where('companyId', '==', dealData.companyId));
                    const contactsSnapshot = await getDocs(contactsQuery);
                    
                    entities = contactsSnapshot.docs.map(doc => ({
                      id: doc.id,
                      ...doc.data()
                    }));
                    
                    console.log(`✅ Loaded ${entities.length} contacts from company ${dealData.companyId}`);
                    break;
                  }
                }
              } catch (err) {
                console.error('Error loading contacts for company:', err);
              }
            }
            
            // Fallback to direct Firestore query for other entity types
            collectionPath = `tenants/${tenantId}/crm_contacts`;
            break;
          }
          case 'tasks': {
            collectionPath = `tenants/${tenantId}/crm_tasks`;
            break;
          }
          case 'locations': {
            // Locations are stored as subcollections under companies, not as a top-level collection
            if (entityType === 'deal') {
              try {
                // Get the deal document to find its companyId
                const dealRef = doc(db, `tenants/${tenantId}/crm_deals`, entityId);
                const dealDoc = await getDoc(dealRef);
                if (dealDoc.exists()) {
                  const dealData = dealDoc.data();
                  if (dealData.companyId) {
                    console.log(`🔍 Loading locations for company: ${dealData.companyId}`);
                    // Load locations from the company's subcollection
                    const companyLocationsRef = collection(db, `tenants/${tenantId}/crm_companies`, dealData.companyId, 'locations');
                    const locationsSnapshot = await getDocs(companyLocationsRef);
                    entities = locationsSnapshot.docs.map(doc => ({
                      id: doc.id,
                      companyId: dealData.companyId, // Add companyId for reference
                      ...doc.data()
                    }));
                    console.log(`✅ Loaded ${entities.length} locations for company ${dealData.companyId}`);
                    console.log(`🔍 Locations entities before filtering:`, entities);
                    // Continue to the filtering and state setting below
                  } else {
                    console.log('⚠️ Deal has no companyId, cannot load locations');
                  }
                }
              } catch (err) {
                console.error('Error loading locations for deal:', err);
                setError(`Failed to load locations: ${err.message}`);
              }
            } else if (entityType === 'contact') {
              // For contacts, load locations from the contact's associated company
              try {
                // Get the contact document to find its companyId
                const contactRef = doc(db, `tenants/${tenantId}/crm_contacts`, entityId);
                const contactDoc = await getDoc(contactRef);
                if (contactDoc.exists()) {
                  const contactData = contactDoc.data();
                  if (contactData.companyId) {
                    console.log(`🔍 Loading locations for contact's company: ${contactData.companyId}`);
                    // Load locations from the company's subcollection
                    const companyLocationsRef = collection(db, `tenants/${tenantId}/crm_companies`, contactData.companyId, 'locations');
                    const locationsSnapshot = await getDocs(companyLocationsRef);
                    entities = locationsSnapshot.docs.map(doc => ({
                      id: doc.id,
                      companyId: contactData.companyId, // Add companyId for reference
                      ...doc.data()
                    }));
                    console.log(`✅ Loaded ${entities.length} locations for contact's company ${contactData.companyId}`);
                    console.log(`🔍 Locations entities before filtering:`, entities);
                    // Continue to the filtering and state setting below
                  } else {
                    console.log('⚠️ Contact has no companyId, cannot load locations');
                  }
                }
              } catch (err) {
                console.error('Error loading locations for contact:', err);
                setError(`Failed to load locations: ${err.message}`);
              }
            } else {
              // For other entity types, load all locations from all companies in parallel
              console.log('🔍 Loading all locations from all companies');
              try {
                const companiesRef = collection(db, `tenants/${tenantId}/crm_companies`);
                const companiesSnapshot = await getDocs(companiesRef);
                
                // Load all company locations in parallel instead of sequentially
                const locationPromises = companiesSnapshot.docs.map(async (companyDoc) => {
                  const companyId = companyDoc.id;
                  const companyData = companyDoc.data();
                  const locationsRef = collection(db, `tenants/${tenantId}/crm_companies/${companyId}/locations`);
                  const locationsSnapshot = await getDocs(locationsRef);
                  
                  return locationsSnapshot.docs.map(doc => ({
                    id: doc.id,
                    companyId: companyId,
                    companyName: companyData.companyName || companyData.name,
                    ...doc.data()
                  }));
                });
                
                const allLocationArrays = await Promise.all(locationPromises);
                entities = allLocationArrays.flat();
                console.log(`✅ Loaded ${entities.length} total locations from all companies`);
              } catch (err) {
                console.error('Error loading all locations:', err);
                setError(`Failed to load locations: ${err.message}`);
              }
            }
            break;
          }
          default:
            // For locations, we should never reach here since they're handled in the switch case
            if (targetType === 'locations') {
              console.log('⚠️ Locations should be handled in switch case, not default');
              break;
            }
            
            // For other entity types, use the regular query logic
            {
              const defaultCollectionPath = getCollectionPath(targetType);
              if (!defaultCollectionPath) {
                console.error(`❌ No collection path found for ${targetType}`);
                break;
              }

              const q = queryFilter 
                ? query(collection(db, defaultCollectionPath), queryFilter, limit(50))
                : query(collection(db, defaultCollectionPath), limit(50));

              const snapshot = await getDocs(q);
              entities = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
              }));
            }
            break;
        }
      }

      // Filter out entities that are already associated
      const currentAssociatedIds = associations[`${targetType}` as keyof SimpleAssociations] || [];
      console.log(`🔍 Current associated IDs for ${targetType}:`, currentAssociatedIds);
      const availableEntities = entities.filter(entity => !currentAssociatedIds.includes(entity.id));
      console.log(`🔍 Available entities after filtering:`, availableEntities);

      // Deduplicate entities by ID to prevent React key warnings
      const uniqueEntities = availableEntities.filter((entity, index, self) => 
        index === self.findIndex(e => e.id === entity.id)
      );

      console.log(`🔍 Setting available entities for ${targetType}:`, uniqueEntities);
      setAvailableEntities(prev => ({
        ...prev,
        [targetType]: uniqueEntities
      }));

      console.log(`✅ Loaded ${uniqueEntities.length} available ${targetType}:`, uniqueEntities);
      
      // Cache the results
      const cacheKeyForStorage = `${targetType}_${entityType}_${entityId}`;
      setEntityCache(prev => ({ ...prev, [cacheKeyForStorage]: uniqueEntities }));
      setCacheTimestamp(prev => ({ ...prev, [cacheKeyForStorage]: Date.now() }));
      
      // Cache persistently for the lifetime of the component
      const storeCacheKey = `available_${targetType}_${entityType}_${entityId}`;
      setUnifiedServiceCache(prev => ({
        ...prev,
        [storeCacheKey]: uniqueEntities
      }));
      
      // Mark data as ready for this type
      setDataReady(prev => ({ ...prev, [targetType]: true }));

    } catch (err: any) {
      console.error(`❌ Error loading available ${targetType}:`, err);
      setError(err.message || `Failed to load available ${targetType}`);
    } finally {
      setLoadingEntities(prev => ({ ...prev, [targetType]: false }));
    }
  };

  // Helper function to convert plural to singular
  const getSingularType = (pluralType: string): string => {
    const singularMap: { [key: string]: string } = {
      'companies': 'company',
      'deals': 'deal',
      'contacts': 'contact',
      'salespeople': 'salesperson',
      'tasks': 'task',
      'locations': 'location'
    };
    return singularMap[pluralType] || pluralType.replace('s', '');
  };

  const handleAddAssociation = async (targetType: string, targetEntity: any) => {
    try {
      console.log(`🔗 Adding association: ${entityType} → ${targetType}`);
      
      await associationService.addAssociation(
        entityType,
        entityId,
        getSingularType(targetType), // Convert plural to singular properly
        targetEntity.id
      );

      // Refresh associations
      const result = await associationService.getAssociations(entityType, entityId);
      setAssociations(result.associations);
      setEntities(result.entities);

      onAssociationChange?.(targetType, 'add', targetEntity.id);

    } catch (err: any) {
      console.error('❌ Error adding association:', err);
      setError(err.message || 'Failed to add association');
      onError?.(err.message || 'Failed to add association');
    }
  };

  const handleRemoveAssociation = async (targetType: string, targetEntityId: string) => {
    try {
      console.log(`🗑️ Removing association: ${entityType} → ${targetType}`);
      
      await associationService.removeAssociation(
        entityType,
        entityId,
        getSingularType(targetType), // Convert plural to singular properly
        targetEntityId
      );

      // Refresh associations
      const result = await associationService.getAssociations(entityType, entityId);
      setAssociations(result.associations);
      setEntities(result.entities);

      onAssociationChange?.(targetType, 'remove', targetEntityId);

    } catch (err: any) {
      console.error('❌ Error removing association:', err);
      setError(err.message || 'Failed to remove association');
      onError?.(err.message || 'Failed to remove association');
    }
  };

  const getEntityIcon = (type: string) => {
    switch (type) {
      case 'company': return <BusinessIcon fontSize="small" />;
      case 'location': return <LocationIcon fontSize="small" />;
      case 'contact': return <PersonIcon fontSize="small" />;
      case 'deal': return <DealIcon fontSize="small" />;
      case 'salesperson': return <SalespeopleIcon fontSize="small" />;
      case 'task': return <TaskIcon fontSize="small" />;
      default: return <BusinessIcon fontSize="small" />;
    }
  };

  const getEntityLabel = (type: string) => {
    const customLabel = customLabels[`${type}s` as keyof typeof customLabels];
    if (customLabel) return customLabel;

    const labelMap: { [key: string]: string } = {
      'companies': 'Companies',
      'deals': 'Deals',
      'contacts': 'Contacts',
      'salespeople': 'Salespeople',
      'tasks': 'Tasks',
      'locations': 'Locations'
    };

    return labelMap[type] || type;
  };

  const getEntityName = (entity: any, type: string) => {
    switch (type) {
      case 'companies':
        return entity.companyName || entity.name || 'Unknown Company';
      case 'deals':
        return entity.name || entity.title || 'Unknown Deal';
      case 'contacts':
        return `${entity.firstName || ''} ${entity.lastName || ''}`.trim() || 'Unknown Contact';
      case 'salespeople':
        return `${entity.firstName || ''} ${entity.lastName || ''}`.trim() || 'Unknown Salesperson';
      case 'tasks':
        return entity.title || entity.name || 'Unknown Task';
      case 'locations':
        return entity.name || entity.address || 'Unknown Location';
      default:
        return entity.name || entity.title || 'Unknown';
    }
  };

  const getEntitySubtitle = (entity: any, type: string) => {
    switch (type) {
      case 'companies':
        return entity.industry || entity.city || '';
      case 'deals':
        return entity.stage || entity.value || '';
      case 'contacts':
        return entity.email || entity.company || '';
      case 'salespeople':
        return entity.email || '';
      case 'tasks':
        return entity.status || entity.dueDate || '';
      case 'locations':
        return entity.city || entity.address || '';
      default:
        return '';
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

  if (isCurrentlyLoading) {
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

  if (currentError) {
    return (
      <Card>
        <CardContent>
          <Alert severity="error">{currentError}</Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          {Object.entries(showAssociations).map(([type, show]) => {
            if (!show) return null;

            // For locations, only show if there's a company association
            if (type === 'locations' && entityType === 'contact') {
              const companyAssociatedIds = associations.companies || [];
              if (companyAssociatedIds.length === 0) {
                return null; // Don't show locations section if no company is associated
              }
            }

            const entityList = entities[type as keyof typeof entities] || [];
            const associatedIds = associations[`${type}` as keyof SimpleAssociations] || [];
            const availableEntityList = availableEntities[type as keyof typeof availableEntities] || [];

            return (
              <Box key={type}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                  <Typography variant="subtitle2" fontWeight="medium">
                    {getEntityLabel(type)}
                    {showCounts && associatedIds.length > 0 && (
                      <Chip 
                        size="small" 
                        label={associatedIds.length} 
                        sx={{ ml: 1 }}
                      />
                    )}
                  </Typography>
                  {showActions && (
                    <Autocomplete
                      key={`${type}-${availableEntityList.length}-${dataReady[type] ? 'ready' : 'loading'}`} // Force re-render when data changes
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
                        console.log(`🔍 Opening dropdown for ${type}, current available entities:`, availableEntityList);
                        console.log(`🔍 Data ready for ${type}:`, dataReady[type]);
                        await loadAvailableEntities(type);
                      }}
                      noOptionsText={availableEntityList.length === 0 ? "No options" : "No matches"}
                    />
                  )}
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
                                {showActions && (
                                  <IconButton
                                    size="small"
                                    onClick={() => handleRemoveAssociation(type, entity.id)}
                                    sx={{ color: 'error.main' }}
                                  >
                                    <CloseIcon fontSize="small" />
                                  </IconButton>
                                )}
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

export default SimpleAssociationsCard;