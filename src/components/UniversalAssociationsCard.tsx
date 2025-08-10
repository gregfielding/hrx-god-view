import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Autocomplete,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
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
  AccountTree as DivisionIcon,
  Close as CloseIcon,
  OpenInNew as OpenInNewIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';

import { createAssociationService } from '../utils/associationService';
import { useAuth } from '../contexts/AuthContext';
import { useAssociationsCache, generateEntityKey } from '../contexts/AssociationsCacheContext';
import { functions , db } from '../firebase';
import { 
  AssociationQuery, 
  AssociationResult,
  CRMCompany,
  CRMLocation,
  CRMContact,
  CRMDeal
} from '../types/CRM';

// 🎯 UNIVERSAL ASSOCIATIONS CARD
// This component can be used for any CRM entity type and provides bulletproof association management

interface UniversalAssociationsCardProps {
  entityType: 'company' | 'location' | 'contact' | 'deal' | 'salesperson' | 'division';
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
    divisions?: boolean;
  };
  
  // Custom labels and icons
  customLabels?: {
    companies?: string;
    locations?: string;
    contacts?: string;
    deals?: string;
    salespeople?: string;
    divisions?: string;
  };
  
  // Callbacks
  onAssociationChange?: (type: string, action: 'add' | 'remove', entityId: string) => void;
  onError?: (error: string) => void;
  
  // UI Options
  maxHeight?: number;
  showCounts?: boolean;
  showActions?: boolean;
  compact?: boolean;
  
  // Filtering options
  filterByCompanyId?: string; // When set, locations will be filtered to only show locations from this company
}

const UniversalAssociationsCard: React.FC<UniversalAssociationsCardProps> = ({
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
    divisions: true
  },
  customLabels = {},
  onAssociationChange,
  onError,
  maxHeight = 400,
  showCounts = true,
  showActions = true,
  compact = false,
  filterByCompanyId
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { getCachedData, setCachedData, clearCache } = useAssociationsCache();
  
  // Generate cache key for this entity
  const entityKey = generateEntityKey(entityType, entityId, tenantId);
  
  // Check cache first
  const cachedData = getCachedData(entityKey);
  
  const [loading, setLoading] = useState(!cachedData);
  const [error, setError] = useState<string | null>(cachedData?.error || null);
  const [associations, setAssociations] = useState<AssociationResult | null>(cachedData?.associations || null);
  const [availableEntities, setAvailableEntities] = useState<{
    companies: CRMCompany[];
    locations: CRMLocation[];
    contacts: CRMContact[];
    deals: CRMDeal[];
    salespeople: any[];
    divisions: any[];
  }>(cachedData?.availableEntities || {
    companies: [],
    locations: [],
    contacts: [],
    deals: [],
    salespeople: [],
    divisions: []
  });

  // State for directly loaded entities when associations exist but entities are missing
  const [directlyLoadedEntities, setDirectlyLoadedEntities] = useState<{
    [key: string]: any[];
  }>({});



  // Association service
  const associationService = createAssociationService(tenantId, user?.uid || '');

  // Load associations and available entities
  useEffect(() => {
    // If we have cached data, don't reload
    if (cachedData) {
      console.log(`✅ Using cached associations for ${entityType}:${entityId}`);
      return;
    }

    const loadData = async () => {
      const startTime = performance.now();
      console.log(`🔍 Loading associations for ${entityType}:${entityId}`);
      
      try {
        setLoading(true);
        setError(null);

        // Load current associations
        const getSingularType = (pluralType: string) => {
          const singularMap: { [key: string]: string } = {
            'salespeople': 'salesperson',
            'people': 'person',
            'companies': 'company',
            'locations': 'location',
            'contacts': 'contact',
            'deals': 'deal',
            'divisions': 'division'
          };
          return singularMap[pluralType] || pluralType.slice(0, -1);
        };
        
        const targetTypes = Object.entries(showAssociations)
          .filter(([_, show]) => show)
          .map(([type, _]) => getSingularType(type)) as any[];

        console.log(`🔍 UniversalAssociationsCard: Target types for query:`, {
          showAssociations,
          targetTypes,
          entityType,
          entityId
        });

        const query: AssociationQuery = {
          entityType,
          entityId,
          targetTypes,
          includeMetadata: true
        };

        const result = await associationService.queryAssociations(query);
        setAssociations(result);

        console.log(`🔍 UniversalAssociationsCard: Associations result:`, {
          associations: result.associations?.length || 0,
          entities: {
            companies: result.entities?.companies?.length || 0,
            locations: result.entities?.locations?.length || 0,
            contacts: result.entities?.contacts?.length || 0,
            deals: result.entities?.deals?.length || 0,
            salespeople: result.entities?.salespeople?.length || 0,
            divisions: result.entities?.divisions?.length || 0
          },
          summary: result.summary
        });

        // For companies, also load salespeople associated with locations and deals (filter up)
        if (entityType === 'company' && showAssociations.salespeople) {
          try {
            // Query for salespeople associated with this company's locations
            const locationSalespeopleQuery: AssociationQuery = {
              entityType: 'location',
              entityId: '', // We'll need to get company locations first
              targetTypes: ['salesperson'],
              includeMetadata: true
            };

            // Query for salespeople associated with this company's deals
            const dealSalespeopleQuery: AssociationQuery = {
              entityType: 'deal',
              entityId: '', // We'll need to get company deals first
              targetTypes: ['salesperson'],
              includeMetadata: true
            };

            // For now, we'll use the AI context approach which should catch these
            const aiContext = await associationService.getAIContext(entityType, entityId, 'medium');
            
            // Extract salespeople from indirect associations
            const indirectSalespeople = aiContext.indirectAssociations.entities.salespeople || [];
            
            if (indirectSalespeople.length > 0) {
              console.log('✅ Found indirect salespeople:', indirectSalespeople.length);
              // These will appear in the associations table as they're part of the result
            }
          } catch (err) {
            console.error('Error loading indirect salespeople:', err);
          }
        }

        // Load available entities for dropdowns
        await loadAvailableEntities(targetTypes);

        const endTime = performance.now();
        const totalLoadTime = endTime - startTime;
        console.log(`🎯 Total associations panel load time: ${totalLoadTime.toFixed(2)}ms`);

        // Cache the successful result - use setTimeout to avoid setState during render
        setTimeout(() => {
          setCachedData(entityKey, {
            associations: result,
            availableEntities,
            loading: false,
            error: null,
            timestamp: Date.now()
          });
        }, 0);

      } catch (err: any) {
        const endTime = performance.now();
        const totalLoadTime = endTime - startTime;
        console.error(`❌ Error loading associations after ${totalLoadTime.toFixed(2)}ms:`, err);
        const errorMessage = err.message || 'Failed to load associations';
        setError(errorMessage);
        onError?.(errorMessage);
        
        // Cache the error state - use setTimeout to avoid setState during render
        setTimeout(() => {
          setCachedData(entityKey, {
            associations: null,
            availableEntities,
            loading: false,
            error: errorMessage,
            timestamp: Date.now()
          });
        }, 0);
      } finally {
        setLoading(false);
      }
    };

    if (entityId && tenantId) {
      console.log(`🔍 UniversalAssociationsCard: Loading data for ${entityType}:${entityId}`, {
        showAssociations,
        entityType,
        entityId,
        tenantId
      });
      loadData();
    }
  }, [entityId, tenantId, entityType, JSON.stringify(showAssociations)]);

  // Load missing entities when associations exist but entities are missing
  useEffect(() => {
    const loadMissingEntities = async () => {
      if (!associations) return;

      const missingEntities: { [key: string]: any[] } = {};

      for (const [type, show] of Object.entries(showAssociations)) {
        if (!show) continue;

        const getSingularType = (pluralType: string) => {
          const singularMap: { [key: string]: string } = {
            'salespeople': 'salesperson',
            'people': 'person',
            'companies': 'company',
            'locations': 'location',
            'contacts': 'contact',
            'deals': 'deal',
            'divisions': 'division'
          };
          return singularMap[pluralType] || pluralType.slice(0, -1);
        };

        const entityType = getSingularType(type);
        const currentAssociations = associations.associations.filter(
          a => a.targetEntityType === entityType
        );

        const getPluralType = (singularType: string) => {
          const pluralMap: { [key: string]: string } = {
            'salesperson': 'salespeople',
            'person': 'people',
            'company': 'companies',
            'location': 'locations',
            'contact': 'contacts',
            'deal': 'deals',
            'division': 'divisions'
          };
          return pluralMap[singularType] || `${singularType}s`;
        };

        const pluralType = getPluralType(entityType);
        const currentEntities = associations.entities[pluralType as keyof typeof associations.entities] || [];

        // If we have associations but no entities, load them
        if (currentAssociations.length > 0 && currentEntities.length === 0) {
          console.log(`🔄 Loading missing entities for ${type}...`);
          
          const entityIds = currentAssociations.map(a => a.targetEntityId);
          
          try {
            const { collection, getDocs, query, where } = await import('firebase/firestore');
            const { db } = await import('../firebase');
            
            let collectionPath;
            switch (entityType) {
              case 'company':
                collectionPath = `tenants/${tenantId}/crm_companies`;
                break;
              case 'contact':
                collectionPath = `tenants/${tenantId}/crm_contacts`;
                break;
              case 'deal':
                collectionPath = `tenants/${tenantId}/crm_deals`;
                break;
              default:
                continue;
            }
            
            if (collectionPath && entityIds.length > 0) {
              const batchSize = 10;
              const loadedEntities = [];
              
              for (let i = 0; i < entityIds.length; i += batchSize) {
                const batch = entityIds.slice(i, i + batchSize);
                const q = query(
                  collection(db, collectionPath),
                  where('__name__', 'in', batch)
                );
                
                const snapshot = await getDocs(q);
                const batchEntities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                loadedEntities.push(...batchEntities);
              }
              
              missingEntities[type] = loadedEntities;
              console.log(`✅ Loaded ${loadedEntities.length} missing entities for ${type}:`, loadedEntities);
            }
          } catch (error) {
            console.error(`❌ Error loading missing entities for ${type}:`, error);
          }
        }
      }

      if (Object.keys(missingEntities).length > 0) {
        setDirectlyLoadedEntities(missingEntities);
      }
    };

    loadMissingEntities();
  }, [associations, tenantId, showAssociations]);

  const loadAvailableEntities = async (targetTypes: string[]) => {
    const startTime = performance.now();
    console.log(`🚀 Starting to load available entities for types:`, targetTypes);
    
    try {
      const entities = {
        companies: [] as CRMCompany[],
        locations: [] as CRMLocation[],
        contacts: [] as CRMContact[],
        deals: [] as CRMDeal[],
        salespeople: [] as any[],
        divisions: [] as any[]
      };

      // Load all entity types in parallel for better performance
      const loadPromises = [];

      // Load salespeople using Firebase function
      if (targetTypes.includes('salesperson')) {
        loadPromises.push(
          (async () => {
            try {
              console.log('🔍 Calling getSalespeopleForTenant with tenantId:', tenantId);
              const getSalespeople = httpsCallable(functions, 'getSalespeopleForTenant');
              const result = await getSalespeople({ tenantId });
              const data = result.data as { salespeople: any[] };
              entities.salespeople = data.salespeople || [];
              console.log('✅ Loaded salespeople:', entities.salespeople.length);
            } catch (err) {
              console.error('❌ Error loading salespeople:', err);
              entities.salespeople = [];
            }
          })()
        );
      }

      // Load companies
      if (targetTypes.includes('company')) {
        loadPromises.push(
          (async () => {
            try {
              const companiesRef = collection(db, `tenants/${tenantId}/crm_companies`);
              const companiesSnapshot = await getDocs(companiesRef);
              entities.companies = companiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CRMCompany[];
              console.log('✅ Loaded companies:', entities.companies.length);
              console.log('🔍 Sample company data:', entities.companies.slice(0, 3).map(company => ({
                id: company.id,
                name: company.name,
                companyName: company.companyName,
                industry: company.industry
              })));
            } catch (err) {
              console.error('❌ Error loading companies:', err);
              entities.companies = [];
            }
          })()
        );
      }

      // Load contacts
      if (targetTypes.includes('contact')) {
        loadPromises.push(
          (async () => {
            try {
              const contactsRef = collection(db, `tenants/${tenantId}/crm_contacts`);
              const contactsSnapshot = await getDocs(contactsRef);
              entities.contacts = contactsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CRMContact[];
              console.log('✅ Loaded contacts:', entities.contacts.length);
            } catch (err) {
              console.error('❌ Error loading contacts:', err);
              entities.contacts = [];
            }
          })()
        );
      }

      // Load deals
      if (targetTypes.includes('deal')) {
        loadPromises.push(
          (async () => {
            try {
              const dealsRef = collection(db, `tenants/${tenantId}/crm_deals`);
              const dealsSnapshot = await getDocs(dealsRef);
              entities.deals = dealsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CRMDeal[];
              console.log('✅ Loaded deals:', entities.deals.length);
            } catch (err) {
              console.error('❌ Error loading deals:', err);
              entities.deals = [];
            }
          })()
        );
      }

      // Load locations (filtered by company if filterByCompanyId is provided)
      if (targetTypes.includes('location')) {
        loadPromises.push(
          (async () => {
            try {
              if (filterByCompanyId) {
                // Only load locations from the specified company
                console.log(`🔍 Loading locations filtered by company: ${filterByCompanyId}`);
                const locationsRef = collection(db, `tenants/${tenantId}/crm_companies/${filterByCompanyId}/locations`);
                const locationsSnapshot = await getDocs(locationsRef);
                
                entities.locations = locationsSnapshot.docs.map(doc => ({ 
                  id: doc.id, 
                  companyId: filterByCompanyId,
                  ...doc.data() 
                })) as CRMLocation[];
                
                console.log(`✅ Loaded ${entities.locations.length} locations for company ${filterByCompanyId}`);
              } else {
                // Load all locations from all companies (original behavior)
                console.log('🔍 Loading all locations from all companies');
                const companiesRef = collection(db, `tenants/${tenantId}/crm_companies`);
                const companiesSnapshot = await getDocs(companiesRef);
                
                // Load locations in parallel for better performance
                const locationPromises = companiesSnapshot.docs.map(async (companyDoc) => {
                  const companyId = companyDoc.id;
                  const locationsRef = collection(db, `tenants/${tenantId}/crm_companies/${companyId}/locations`);
                  const locationsSnapshot = await getDocs(locationsRef);
                  
                  return locationsSnapshot.docs.map(doc => ({ 
                    id: doc.id, 
                    companyId,
                    ...doc.data() 
                  })) as CRMLocation[];
                });
                
                const allCompanyLocations = await Promise.all(locationPromises);
                entities.locations = allCompanyLocations.flat();
                console.log('✅ Loaded all locations:', entities.locations.length);
              }
            } catch (err) {
              console.error('❌ Error loading locations:', err);
              entities.locations = [];
            }
          })()
        );
      }

      // Load divisions
      if (targetTypes.includes('division')) {
        loadPromises.push(
          (async () => {
            try {
              const divisionsRef = collection(db, `tenants/${tenantId}/divisions`);
              const divisionsSnapshot = await getDocs(divisionsRef);
              entities.divisions = divisionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
              console.log('✅ Loaded divisions:', entities.divisions.length);
            } catch (err) {
              console.error('❌ Error loading divisions:', err);
              entities.divisions = [];
            }
          })()
        );
      }

      // Execute all loading promises in parallel
      await Promise.all(loadPromises);
      const endTime = performance.now();
      const loadTime = endTime - startTime;
      
      console.log(`🚀 All entity types loaded in parallel in ${loadTime.toFixed(2)}ms`);
      console.log('✅ Available entities loaded:', {
        salespeople: entities.salespeople.length,
        companies: entities.companies.length,
        locations: entities.locations.length,
        contacts: entities.contacts.length,
        deals: entities.deals.length,
        divisions: entities.divisions.length
      });
      console.log('🔍 Available entities object keys:', Object.keys(entities));
      console.log('🔍 Target types that were requested:', targetTypes);

      setAvailableEntities(entities);
    } catch (err) {
      const endTime = performance.now();
      const loadTime = endTime - startTime;
      console.error(`❌ Error loading available entities after ${loadTime.toFixed(2)}ms:`, err);
    }
  };

  const handleAddAssociation = async (
    targetType: string,
    targetEntity: any
  ) => {
    console.log(`🔍 handleAddAssociation called:`, {
      targetType,
      targetEntity,
      entityType,
      entityId
    });
    
    try {
      console.log(`🔍 Creating association...`);
      await associationService.createAssociation(
        entityType,
        entityId,
        targetType as any,
        targetEntity.id,
        'primary',
        'medium'
      );
      console.log(`🔍 Association created successfully`);

      // Refresh associations
      console.log(`🔍 Refreshing associations...`);
      const result = await associationService.queryAssociations({
        entityType,
        entityId,
        includeMetadata: true
      });
      console.log(`🔍 Refreshed associations result:`, result);
      console.log(`🔍 Refreshed associations entities:`, result.entities);
      console.log(`🔍 Refreshed associations entities keys:`, Object.keys(result.entities));
      setAssociations(result);

      // Update cache with new associations - use setTimeout to avoid setState during render
      setTimeout(() => {
        setCachedData(entityKey, {
          associations: result,
          availableEntities,
          loading: false,
          error: null,
          timestamp: Date.now()
        });
      }, 0);

      onAssociationChange?.(targetType, 'add', targetEntity.id);

    } catch (err: any) {
      console.error('Error adding association:', err);
      setError(err.message || 'Failed to add association');
      onError?.(err.message || 'Failed to add association');
    }
  };

  const handleRemoveAssociation = async (associationId: string) => {
    try {
      console.log(`🗑️ handleRemoveAssociation called with ID: ${associationId}`);
      
      if (!associationId) {
        throw new Error('Association ID is required');
      }

      await associationService.deleteAssociation(associationId);

      // Refresh associations
      const result = await associationService.queryAssociations({
        entityType,
        entityId,
        includeMetadata: true
      });
      setAssociations(result);

      // Update cache with new associations - use setTimeout to avoid setState during render
      setTimeout(() => {
        setCachedData(entityKey, {
          associations: result,
          availableEntities,
          loading: false,
          error: null,
          timestamp: Date.now()
        });
      }, 0);

      onAssociationChange?.('', 'remove', '');

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
      case 'division': return <DivisionIcon fontSize="small" />;
      default: return <BusinessIcon fontSize="small" />;
    }
  };

  const getEntityLabel = (type: string) => {
    // Handle special cases for proper pluralization
    const pluralMap: { [key: string]: string } = {
      'salesperson': 'Salespeople',
      'salespeople': 'Salespeople',
      'person': 'People',
      'people': 'People'
    };
    
    // Check for custom label first
    const customLabel = customLabels[`${type}s` as keyof typeof customLabels];
    if (customLabel) return customLabel;
    
    // Check for special pluralization
    if (pluralMap[type]) return pluralMap[type];
    
    // Default pluralization
    return `${type.charAt(0).toUpperCase() + type.slice(1)}s`;
  };

  const getEntityName = (entity: any, type: string) => {
    switch (type) {
      case 'company':
        return entity.companyName || entity.name || 'Unknown Company';
      case 'location':
        return entity.name || 'Unknown Location';
      case 'contact':
        return entity.fullName || `${entity.firstName} ${entity.lastName}` || 'Unknown Contact';
      case 'deal':
        return entity.name || 'Unknown Deal';
      case 'salesperson':
        return `${entity.firstName} ${entity.lastName}` || entity.displayName || 'Unknown Salesperson';
      case 'division':
        return entity.name || 'Unknown Division';
      default:
        return entity.name || 'Unknown Entity';
    }
  };

  const getEntitySubtitle = (entity: any, type: string) => {
    switch (type) {
      case 'company':
        return entity.industry || entity.city || '';
      case 'location':
        return entity.city && entity.state ? `${entity.city}, ${entity.state}` : '';
      case 'contact':
        return entity.title || entity.jobTitle || '';
      case 'deal':
        return entity.estimatedRevenue ? `$${entity.estimatedRevenue.toLocaleString()}` : '';
      case 'salesperson':
        return entity.jobTitle || entity.email || '';
      case 'division':
        return entity.description || '';
      default:
        return '';
    }
  };

  const handleEntityClick = (entity: any, type: string) => {
    switch (type) {
      case 'company':
        navigate(`/crm/companies/${entity.id}`);
        break;
      case 'location':
        navigate(`/crm/companies/${entity.companyId}/locations/${entity.id}`);
        break;
      case 'contact':
        navigate(`/crm/contacts/${entity.id}`);
        break;
      case 'deal':
        navigate(`/crm/deals/${entity.id}`);
        break;
      case 'salesperson':
        navigate(`/users/${entity.id}`);
        break;
      case 'division':
        // Navigate to division details
        break;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader title="Associations" />
        <CardContent>
          <Box display="flex" justifyContent="center" p={2}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader title="Associations" />
        <CardContent>
          <Alert severity="error">{error}</Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader 
        title="Associations" 
        action={
          showCounts && associations && (
            <Chip 
              label={`${associations.summary.totalAssociations} total`}
              size="small"
              color="primary"
              variant="outlined"
            />
          )
        }
      />
      <CardContent>
        <Stack spacing={2}>
          {Object.entries(showAssociations).map(([type, show]) => {
            if (!show) return null;
            
            // Handle special cases for proper singularization
            const getSingularType = (pluralType: string) => {
              const singularMap: { [key: string]: string } = {
                'salespeople': 'salesperson',
                'people': 'person',
                'companies': 'company',
                'locations': 'location',
                'contacts': 'contact',
                'deals': 'deal',
                'divisions': 'division'
              };
              return singularMap[pluralType] || pluralType.slice(0, -1);
            };
            
            const entityType = getSingularType(type);
            console.log(`🔍 Filtering associations for ${type} (entityType: ${entityType}, entityId: ${entityId})`);
            console.log(`🔍 All associations:`, associations?.associations);
            
            const currentAssociations = associations?.associations.filter(
              a => (a.sourceEntityType === entityType && a.sourceEntityId === entityId) ||
                   (a.targetEntityType === entityType && a.targetEntityId === entityId)
            ) || [];
            
            console.log(`🔍 Filtered associations for ${type}:`, currentAssociations);
            
            // Get the correct plural type for accessing entities
            const getPluralType = (singularType: string) => {
              const pluralMap: { [key: string]: string } = {
                'salesperson': 'salespeople',
                'person': 'people',
                'company': 'companies',
                'location': 'locations',
                'contact': 'contacts',
                'deal': 'deals',
                'division': 'divisions'
              };
              return pluralMap[singularType] || `${singularType}s`;
            };
            
            // Use the type directly since it's already the correct plural form
            const pluralType = type; // type is already the plural form (e.g., "salespeople")
            let currentEntities = associations?.entities[pluralType as keyof typeof associations.entities] || [];
            
            // Debug: Log the entities object for salespeople
            if (type === 'salespeople') {
              console.log(`🔍 Salespeople entities debug:`, {
                associations: associations?.entities,
                salespeople: associations?.entities?.salespeople,
                currentEntities,
                pluralType,
                type
              });
            }
            
            // If we have associations but no entities, check if we have directly loaded entities
            if (currentAssociations.length > 0 && currentEntities.length === 0) {
              console.log(`⚠️ Found ${currentAssociations.length} associations but no entities for ${type}`);
              console.log(`⚠️ Associations:`, currentAssociations);
              console.log(`⚠️ All entities:`, associations?.entities);
              const directlyLoaded = directlyLoadedEntities[type] || [];
              if (directlyLoaded.length > 0) {
                currentEntities = directlyLoaded;
                console.log(`✅ Using directly loaded entities for ${type}:`, directlyLoaded);
              }
            }
            
            return (
              <Box key={`${type}-${entityType}`} sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  {getEntityIcon(entityType)}
                  <Typography variant="subtitle2" color="primary">
                    {getEntityLabel(entityType)}
                    {showCounts && currentAssociations.length > 0 && (
                      <Chip 
                        label={currentAssociations.length}
                        size="small"
                        sx={{ ml: 1 }}
                      />
                    )}
                  </Typography>
                </Box>

                {/* Add Association Dropdown */}
                {(() => {
                  const options = availableEntities[type as keyof typeof availableEntities] || [];
                  return (
                    <Autocomplete
                      options={options}
                      getOptionKey={(option) => option.id || option.name || `${option.email || option.phone || Math.random()}`}
                  getOptionLabel={(option) => {
                    const name = getEntityName(option, entityType);
                    const subtitle = getEntitySubtitle(option, entityType);
                    return subtitle ? `${name} - ${subtitle}` : name;
                  }}
                  filterOptions={(options, { inputValue }) => {
                    const searchTerm = inputValue.toLowerCase();
                    
                    const filtered = options.filter((option) => {
                      const optionLabel = getEntityName(option, entityType).toLowerCase();
                      const optionSubtitle = getEntitySubtitle(option, entityType).toLowerCase();
                      const matches = optionLabel.includes(searchTerm) || optionSubtitle.includes(searchTerm);
                      
                      return matches;
                    });
                    
                    return filtered;
                  }}
                  value={null}

                  onChange={(_, newValue) => {
                    if (newValue) {
                      handleAddAssociation(entityType, newValue);
                    }
                  }}
                  onOpen={() => {
                    console.log(`🔍 Opening dropdown for ${type}:`, {
                      options: availableEntities[type as keyof typeof availableEntities] || [],
                      entityType,
                      type,
                      availableEntitiesKeys: Object.keys(availableEntities),
                      availableEntities: availableEntities
                    });
                  }}
                  onInputChange={(event, value, reason) => {
                    console.log(`🔍 Input change for ${type}:`, {
                      value,
                      reason,
                      event: event?.type
                    });
                  }}
                  freeSolo={false}
                  selectOnFocus={false}
                  clearOnBlur={false}
                  autoComplete={false}
                  noOptionsText="No options available"
                  loading={false}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      size="small"
                      placeholder={`Add ${getEntityLabel(entityType).toLowerCase()}`}
                      sx={{ mb: 1 }}
                    />
                  )}
                  renderOption={(props, option) => {
                    const { key, ...otherProps } = props;
                    return (
                      <Box component="li" key={`${option.id || option.name || Math.random()}`} {...otherProps}>
                        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                          <Typography variant="body2">
                            {getEntityName(option, entityType)}
                          </Typography>
                          {getEntitySubtitle(option, entityType) && (
                            <Typography variant="caption" color="text.secondary">
                              {getEntitySubtitle(option, entityType)}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    );
                  }}
                    />
                  );
                })()}

                {/* Current Associations Table */}
                {(() => {
                  return currentEntities.length > 0 ? (
                    <TableContainer 
                      component={Paper} 
                      variant="outlined" 
                      sx={{ maxHeight: maxHeight }}
                    >
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Title</TableCell>
                            {showActions && <TableCell align="right">Actions</TableCell>}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {currentEntities.map((entity: any) => (
                            <TableRow key={entity.id}>
                              <TableCell>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Typography
                                    sx={{ 
                                      cursor: 'pointer',
                                      color: 'primary.main',
                                      textDecoration: 'underline',
                                      '&:hover': { color: 'primary.dark' }
                                    }}
                                    onClick={() => handleEntityClick(entity, entityType)}
                                  >
                                    {getEntityName(entity, entityType)}
                                  </Typography>
                                  <IconButton
                                    size="small"
                                    onClick={() => handleEntityClick(entity, entityType)}
                                    sx={{ p: 0.5 }}
                                  >
                                    <OpenInNewIcon fontSize="small" />
                                  </IconButton>
                                </Box>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" color="text.secondary">
                                  {getEntitySubtitle(entity, entityType)}
                                </Typography>
                              </TableCell>
                              {showActions && (
                                <TableCell align="right">
                                  <IconButton
                                    size="small"
                                    onClick={() => {
                                      console.log(`🔍 Looking for association between entityId: ${entityId} and entity.id: ${entity.id}`);
                                      console.log(`🔍 Current associations:`, currentAssociations);
                                      
                                      // Find the association that connects the current entity to the target entity
                                      const association = currentAssociations.find(
                                        a => (a.sourceEntityId === entityId && a.targetEntityId === entity.id) ||
                                             (a.sourceEntityId === entity.id && a.targetEntityId === entityId)
                                      );
                                      
                                      console.log(`🔍 Found association:`, association);
                                      
                                      if (association && association.id) {
                                        console.log('🗑️ Deleting association:', association);
                                        handleRemoveAssociation(association.id);
                                      } else {
                                        console.error('❌ Association not found for entity:', entity.id);
                                        console.error('❌ Available associations:', currentAssociations);
                                        console.error('❌ Looking for association between:', { entityId, entityId2: entity.id });
                                        setError('Association not found for this entity');
                                      }
                                    }}
                                    sx={{ color: 'error.main' }}
                                  >
                                    <CloseIcon fontSize="small" />
                                  </IconButton>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  ) : (
                    <Box sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        No {getEntityLabel(type).toLowerCase()} associated yet
                      </Typography>
                    </Box>
                  );
                })()}
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default UniversalAssociationsCard; 