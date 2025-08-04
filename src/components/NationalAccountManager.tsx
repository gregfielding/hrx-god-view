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
  Tooltip,
  Divider,
  Alert,
  Badge,
  Avatar,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Collapse,
  Fade,
  Zoom,
  Grow,
  Slide,
  Fab,
  SpeedDial,
  SpeedDialAction,
  SpeedDialIcon,
  Breadcrumbs,
  Link as MuiLink,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  MobileStepper,
  useTheme,
  useMediaQuery,
  Tabs,
  Tab,
  CircularProgress,
  Autocomplete,
  Slider,
  FormGroup,
  Checkbox,
  Radio,
  RadioGroup,
  FormLabel,
  InputAdornment,
  OutlinedInput,
  InputLabel as MuiInputLabel,
  Select as MuiSelect,
  MenuItem as MuiMenuItem,
  FormHelperText,
  AlertTitle,
  Skeleton,
} from '@mui/material';
import {
  Business,
  LocationOn,
  AccountBalance,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  Warning,
  Error,
  ExpandMore,
  Add,
  Edit,
  Visibility,
  Assignment,
  People,
  AttachMoney,
  Schedule,
  Star,
  BusinessCenter,
  Store,
  Apartment,
  AccountTree,
  CorporateFare,
  Domain,
  HomeWork,
  Storefront,
  LocalShipping,
  Warehouse,
  Factory,
  BusinessOutlined,
  LocationCity,
  LocationOnOutlined,
  MapOutlined,
  Navigation,
  CompassCalibration,
  MyLocation,
  Place,
  Room,
  Streetview,
  Terrain,
  Traffic,
  Directions,
  DirectionsCar,
  DirectionsWalk,
  DirectionsBike,
  DirectionsBus,
  DirectionsRailway,
  DirectionsSubway,
  DirectionsTransit,
  DirectionsBoat,
  DirectionsRun,
  DirectionsWalkOutlined,
  DirectionsCarOutlined,
  DirectionsBikeOutlined,
  DirectionsBusOutlined,
  DirectionsRailwayOutlined,
  DirectionsSubwayOutlined,
  DirectionsTransitOutlined,
  DirectionsBoatOutlined,
  DirectionsRunOutlined,
  AccountBalanceOutlined,
  AccountBalanceWallet,
  AccountBalanceWalletOutlined,
  AccountBox,
  AccountBoxOutlined,
  AccountCircle,
  AccountCircleOutlined,
  AssignmentInd,
  AssignmentIndOutlined,
  Badge as BadgeIcon,
  BadgeOutlined,
  ContactMailOutlined,
  ContactPhoneOutlined,
  ContactSupportOutlined,
  Face,
  FaceOutlined,
  GroupOutlined,
  GroupWork,
  GroupWorkOutlined,
  HowToReg,
  HowToRegOutlined,
  Person,
  PersonAdd,
  PersonAddOutlined,
  PersonOff,
  PersonOffOutlined,
  PersonOutline,
  PersonPin,
  PersonPinCircle,
  PersonPinCircleOutlined,
  PersonPinOutlined,
  PersonRemove,
  PersonRemoveOutlined,
  RecordVoiceOver,
  RecordVoiceOverOutlined,
  SupervisorAccount,
  SupervisorAccountOutlined,
  VerifiedUser,
  VerifiedUserOutlined,
  Work,
  WorkOff,
  WorkOffOutlined,
  WorkOutline,
  WorkOutlined,
  ExpandLess,
  ChevronRight,
} from '@mui/icons-material';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { CRMCompany, CRMDeal } from '../types/CRM';
import { useAIFieldLogging } from '../utils/aiFieldLogging';

interface NationalAccountManagerProps {
  tenantId: string;
}

interface CompanyPerformance {
  totalDeals: number;
  totalValue: number;
  winRate: number;
  avgDealSize: number;
  recentActivity: number;
}

interface RegionalPerformance {
  region: string;
  companies: number;
  deals: number;
  value: number;
  growth: number;
}

const NationalAccountManager: React.FC<NationalAccountManagerProps> = ({ tenantId }) => {
  const [parentCompanies, setParentCompanies] = useState<CRMCompany[]>([]);
  const [childFacilities, setChildFacilities] = useState<CRMCompany[]>([]);
  const [selectedParent, setSelectedParent] = useState<CRMCompany | null>(null);
  const [performanceData, setPerformanceData] = useState<Map<string, CompanyPerformance>>(new Map());
  const [regionalData, setRegionalData] = useState<RegionalPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [showMSADialog, setShowMSADialog] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [showHierarchyDialog, setShowHierarchyDialog] = useState(false);
  const [selectedHierarchyCompany, setSelectedHierarchyCompany] = useState<CRMCompany | null>(null);

  // AI Field Logging
  const logFieldInteraction = useAIFieldLogging('national_account_manager', tenantId, 'agency');

  useEffect(() => {
    logFieldInteraction(null, {
      action: 'component_loaded',
      tenantId,
      component: 'NationalAccountManager'
    });
    loadNationalAccounts();
  }, [tenantId]);

  const loadNationalAccounts = async () => {
    try {
      setLoading(true);
      
      // Load parent companies (headquarters)
      const parentQuery = query(
        collection(db, 'companies'),
        where('tenantId', '==', tenantId),
        where('companyStructure.locationType', '==', 'headquarters')
      );
      const parentSnapshot = await getDocs(parentQuery);
      const parents = parentSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMCompany));
      setParentCompanies(parents);

      // Load child facilities
      const childQuery = query(
        collection(db, 'companies'),
        where('tenantId', '==', tenantId),
        where('companyStructure.locationType', 'in', ['facility', 'branch', 'regional_office'])
      );
      const childSnapshot = await getDocs(childQuery);
      const children = childSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMCompany));
      setChildFacilities(children);

      // Load performance data
      await loadPerformanceData(parents, children);
      
      // Load regional data
      await loadRegionalData(children);

      logFieldInteraction(null, {
        action: 'data_loaded',
        parentCount: parents.length,
        childCount: children.length,
        tenantId
      });

    } catch (error) {
      console.error('Error loading national accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPerformanceData = async (parents: CRMCompany[], children: CRMCompany[]) => {
    const performanceMap = new Map<string, CompanyPerformance>();
    
    // Load deals for all companies
    const dealsQuery = query(collection(db, 'deals'), where('tenantId', '==', tenantId));
    const dealsSnapshot = await getDocs(dealsQuery);
    const deals = dealsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMDeal));

          // Calculate performance for each parent company
      for (const parent of parents) {
        const parentDeals = deals.filter(deal => deal.companyId === parent.id);
        const childCompanies = children.filter(child => 
          child.companyStructure?.parentId === parent.externalId
        );
        
        const childDeals = childCompanies.flatMap(child =>
          deals.filter(deal => deal.companyId === child.id)
        );
        
        const allDeals = [...parentDeals, ...childDeals];
        const wonDeals = allDeals.filter(deal => deal.stage === 'won');
        
        performanceMap.set(parent.externalId, {
          totalDeals: allDeals.length,
          totalValue: allDeals.reduce((sum, deal) => sum + (deal.estimatedRevenue || 0), 0),
          winRate: allDeals.length > 0 ? (wonDeals.length / allDeals.length) * 100 : 0,
          avgDealSize: allDeals.length > 0 ? allDeals.reduce((sum, deal) => sum + (deal.estimatedRevenue || 0), 0) / allDeals.length : 0,
          recentActivity: allDeals.filter(deal => {
            const dealDate = new Date(deal.createdAt);
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            return dealDate > thirtyDaysAgo;
          }).length
        });
      }
    
    setPerformanceData(performanceMap);
  };

  const loadRegionalData = async (children: CRMCompany[]) => {
    const regionalMap = new Map<string, RegionalPerformance>();
    
    // Group children by region
    children.forEach(child => {
      const region = child.companyStructure?.region || 'Unknown';
      const existing = regionalMap.get(region) || {
        region,
        companies: 0,
        deals: 0,
        value: 0,
        growth: 0
      };
      
      existing.companies += 1;
      regionalMap.set(region, existing);
    });

    // Load deals for regional calculation
    const dealsQuery = query(collection(db, 'deals'), where('tenantId', '==', tenantId));
    const dealsSnapshot = await getDocs(dealsQuery);
    const deals = dealsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMDeal));

          // Calculate deal metrics for each region
      for (const [region, data] of regionalMap) {
        const regionalCompanies = children.filter(child => 
          child.companyStructure?.region === region
        );
        const regionalDeals = deals.filter(deal =>
          regionalCompanies.some(company => company.id === deal.companyId)
        );
        
        data.deals = regionalDeals.length;
        data.value = regionalDeals.reduce((sum, deal) => sum + (deal.estimatedRevenue || 0), 0);
        
        // Calculate growth (simplified - could be enhanced with historical data)
        const recentDeals = regionalDeals.filter(deal => {
          const dealDate = new Date(deal.createdAt);
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          return dealDate > thirtyDaysAgo;
        });
        data.growth = regionalDeals.length > 0 ? (recentDeals.length / regionalDeals.length) * 100 : 0;
      }

    setRegionalData(Array.from(regionalMap.values()));
  };

  const getLocationTypeIcon = (locationType: string) => {
    switch (locationType) {
      case 'headquarters': return <BusinessCenter />;
      case 'facility': return <Store />;
      case 'branch': return <Apartment />;
      case 'regional_office': return <LocationOn />;
      default: return <Business />;
    }
  };

  const getMSAStatusColor = (hasMSA: boolean) => {
    return hasMSA ? 'success' : 'warning';
  };

  const getMSAStatusIcon = (hasMSA: boolean) => {
    return hasMSA ? <CheckCircle /> : <Warning />;
  };

  const handleParentSelect = (parent: CRMCompany) => {
    logFieldInteraction(null, {
      action: 'parent_selected',
      parentId: parent.externalId,
      parentName: parent.name
    });
    setSelectedParent(parent);
    setShowDetailsDialog(true);
  };

  const handleMSAUpdate = async (companyId: string, hasMSA: boolean) => {
    try {
      logFieldInteraction(null, {
        action: 'msa_status_updated',
        companyId,
        hasMSA,
        previousValue: !hasMSA
      });

      await updateDoc(doc(db, 'companies', companyId), {
        'companyStructure.msaSigned': hasMSA
      });

      // Refresh data
      await loadNationalAccounts();
    } catch (error) {
      console.error('Error updating MSA status:', error);
    }
  };

  const getChildFacilities = (parentId: string) => {
    return childFacilities.filter(child => 
      child.companyStructure?.parentId === parentId
    );
  };

  const buildCompanyHierarchy = () => {
    const hierarchy: { parent: CRMCompany; children: CRMCompany[] }[] = [];
    
    parentCompanies.forEach(parent => {
      const children = getChildFacilities(parent.externalId);
      hierarchy.push({ parent, children });
    });
    
    return hierarchy;
  };

  const getParentCompany = (childId: string) => {
    const child = childFacilities.find(c => c.id === childId);
    if (child?.companyStructure?.parentId) {
      return parentCompanies.find(p => p.externalId === child.companyStructure.parentId);
    }
    return null;
  };

  const handleParentToggle = (parentId: string) => {
    const newExpanded = new Set(expandedParents);
    if (newExpanded.has(parentId)) {
      newExpanded.delete(parentId);
    } else {
      newExpanded.add(parentId);
    }
    setExpandedParents(newExpanded);
  };

  const handleHierarchySelect = (company: CRMCompany) => {
    logFieldInteraction(null, {
      action: 'hierarchy_company_selected',
      companyId: company.id,
      companyName: company.name,
      companyType: company.companyStructure?.locationType
    });
    setSelectedHierarchyCompany(company);
    setShowHierarchyDialog(true);
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          National Account Management
        </Typography>
        <LinearProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        National Account Management
      </Typography>

      {/* Main Content Tabs */}
      <Card>
        <CardContent>
          <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)}>
            <Tab label="Parent-Child Hierarchy" icon={<AccountTree />} />
            <Tab label="Parent Companies" icon={<BusinessCenter />} />
            <Tab label="Child Facilities" icon={<Store />} />
            <Tab label="Regional Performance" icon={<MapOutlined />} />
            <Tab label="MSA Status Tracking" icon={<CheckCircle />} />
          </Tabs>

          {/* Parent-Child Hierarchy Tab */}
          {activeTab === 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>
                Parent-Child Company Relationships
              </Typography>
              
              <Box sx={{ maxHeight: 600, overflow: 'auto' }}>
                {buildCompanyHierarchy().map(({ parent, children }) => {
                  const isExpanded = expandedParents.has(parent.id);
                  const performance = performanceData.get(parent.externalId);
                  
                  return (
                    <Card key={parent.id} variant="outlined" sx={{ mb: 2 }}>
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <IconButton
                              size="small"
                              onClick={() => handleParentToggle(parent.id)}
                              disabled={children.length === 0}
                            >
                              {isExpanded ? <ExpandLess /> : <ChevronRight />}
                            </IconButton>
                            
                            <Avatar sx={{ width: 40, height: 40, bgcolor: 'primary.main' }}>
                              <BusinessCenter />
                            </Avatar>
                            
                            <Box>
                              <Typography variant="subtitle1" fontWeight="medium">
                                {parent.name}
                              </Typography>
                              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                <Chip label={parent.companyStructure?.region || 'No Region'} size="small" />
                                <Chip label={`${children.length} facilities`} size="small" color="primary" />
                                {performance && (
                                  <Chip 
                                    label={`${performance.winRate.toFixed(1)}% win rate`} 
                                    size="small" 
                                    color={performance.winRate > 50 ? 'success' : 'default'}
                                  />
                                )}
                              </Box>
                            </Box>
                          </Box>
                          
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <IconButton
                              size="small"
                              onClick={() => handleHierarchySelect(parent)}
                            >
                              <Visibility />
                            </IconButton>
                          </Box>
                        </Box>
                        
                        <Collapse in={isExpanded}>
                          <Box sx={{ mt: 2, ml: 6 }}>
                            {children.length > 0 ? (
                              <Grid container spacing={2}>
                                {children.map((child) => (
                                  <Grid item xs={12} sm={6} md={4} key={child.id}>
                                    <Card variant="outlined" sx={{ cursor: 'pointer' }} onClick={() => handleHierarchySelect(child)}>
                                      <CardContent sx={{ py: 1, px: 2 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                          <Avatar sx={{ width: 32, height: 32, bgcolor: 'success.main' }}>
                                            {getLocationTypeIcon(child.companyStructure?.locationType || 'facility')}
                                          </Avatar>
                                          <Box>
                                            <Typography variant="body2" fontWeight="medium">
                                              {child.name}
                                            </Typography>
                                            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                                              <Chip 
                                                label={child.companyStructure?.locationType?.replace('_', ' ') || 'Facility'} 
                                                size="small" 
                                                color="success"
                                              />
                                              {child.companyStructure?.msaSigned && (
                                                <Chip label="MSA" size="small" color="success" />
                                              )}
                                            </Box>
                                          </Box>
                                        </Box>
                                      </CardContent>
                                    </Card>
                                  </Grid>
                                ))}
                              </Grid>
                            ) : (
                              <Alert severity="info">
                                No child facilities found for this parent company.
                              </Alert>
                            )}
                          </Box>
                        </Collapse>
                      </CardContent>
                    </Card>
                  );
                })}
              </Box>
            </Box>
          )}

          {/* Parent Companies Tab */}
          {activeTab === 1 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>
                Parent Companies Overview
              </Typography>
              <Grid container spacing={3}>
                {parentCompanies.map((parent) => {
                  const performance = performanceData.get(parent.externalId);
                  const childCount = getChildFacilities(parent.externalId).length;
                  const hasMSA = parent.companyStructure?.msaSigned || false;

                  return (
                    <Grid item xs={12} md={6} lg={4} key={parent.externalId}>
                      <Card>
                        <CardContent>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                            <Box>
                              <Typography variant="h6" gutterBottom>
                                {parent.name}
                              </Typography>
                              <Chip
                                icon={getLocationTypeIcon('headquarters')}
                                label="Headquarters"
                                size="small"
                                color="primary"
                              />
                            </Box>
                            <Tooltip title={hasMSA ? 'MSA Active' : 'No MSA'}>
                              <IconButton
                                size="small"
                                color={getMSAStatusColor(hasMSA)}
                                onClick={() => handleMSAUpdate(parent.id, !hasMSA)}
                              >
                                {getMSAStatusIcon(hasMSA)}
                              </IconButton>
                            </Tooltip>
                          </Box>

                          <Box sx={{ mb: 2 }}>
                            <Typography variant="body2" color="textSecondary">
                              Child Facilities: {childCount}
                            </Typography>
                            {performance && (
                              <>
                                <Typography variant="body2" color="textSecondary">
                                  Total Deals: {performance.totalDeals}
                                </Typography>
                                <Typography variant="body2" color="textSecondary">
                                  Total Value: ${performance.totalValue.toLocaleString()}
                                </Typography>
                                <Typography variant="body2" color="textSecondary">
                                  Win Rate: {performance.winRate.toFixed(1)}%
                                </Typography>
                              </>
                            )}
                          </Box>

                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<Visibility />}
                            onClick={() => handleParentSelect(parent)}
                            fullWidth
                          >
                            View Details
                          </Button>
                        </CardContent>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          )}

          {/* Child Facilities Tab */}
          {activeTab === 2 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>
                Child Facilities Management
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Facility Name</TableCell>
                      <TableCell>Parent Company</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Region</TableCell>
                      <TableCell>MSA Status</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {childFacilities.map((facility) => {
                      const parent = getParentCompany(facility.id);
                      return (
                        <TableRow key={facility.id}>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Avatar sx={{ width: 32, height: 32 }}>
                                {getLocationTypeIcon(facility.companyStructure?.locationType || 'facility')}
                              </Avatar>
                              <Typography variant="body2" fontWeight="medium">
                                {facility.name}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell>{parent?.name || 'Orphaned'}</TableCell>
                          <TableCell>
                            <Chip
                              label={facility.companyStructure?.locationType?.replace('_', ' ') || 'Facility'}
                              size="small"
                              color="success"
                            />
                          </TableCell>
                          <TableCell>{facility.companyStructure?.region || 'N/A'}</TableCell>
                          <TableCell>
                            <Chip
                              icon={getMSAStatusIcon(facility.companyStructure?.msaSigned || false)}
                              label={facility.companyStructure?.msaSigned ? 'Active' : 'Inactive'}
                              color={getMSAStatusColor(facility.companyStructure?.msaSigned || false)}
                              size="small"
                            />
                          </TableCell>
                          <TableCell>
                            <IconButton
                              size="small"
                              onClick={() => handleHierarchySelect(facility)}
                            >
                              <Visibility />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => handleMSAUpdate(facility.id, !facility.companyStructure?.msaSigned)}
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

          {/* Regional Performance Tab */}
          {activeTab === 3 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>
                Regional Performance Dashboard
              </Typography>
              <Grid container spacing={2}>
                {regionalData.map((region) => (
                  <Grid item xs={12} sm={6} md={3} key={region.region}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle2" color="textSecondary">
                          {region.region}
                        </Typography>
                        <Typography variant="h6">
                          {region.companies} Companies
                        </Typography>
                        <Typography variant="body2">
                          {region.deals} Deals • ${region.value.toLocaleString()}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                          {region.growth > 0 ? (
                            <TrendingUp color="success" fontSize="small" />
                          ) : (
                            <TrendingDown color="error" fontSize="small" />
                          )}
                          <Typography variant="caption" sx={{ ml: 0.5 }}>
                            {region.growth.toFixed(1)}% growth
                          </Typography>
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          {/* MSA Status Tracking Tab */}
          {activeTab === 4 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>
                MSA Status Tracking
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        MSA Overview
                      </Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="body2">Total Facilities:</Typography>
                        <Typography variant="body2" fontWeight="medium">
                          {childFacilities.length}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="body2">MSA Active:</Typography>
                        <Typography variant="body2" fontWeight="medium" color="success.main">
                          {childFacilities.filter(f => f.companyStructure?.msaSigned).length}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="body2">MSA Inactive:</Typography>
                        <Typography variant="body2" fontWeight="medium" color="warning.main">
                          {childFacilities.filter(f => !f.companyStructure?.msaSigned).length}
                        </Typography>
                      </Box>
                      <LinearProgress 
                        variant="determinate" 
                        value={(childFacilities.filter(f => f.companyStructure?.msaSigned).length / childFacilities.length) * 100}
                        color="success"
                        sx={{ height: 8, borderRadius: 4 }}
                      />
                    </CardContent>
                  </Card>
                </Grid>
                
                <Grid item xs={12} md={6}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        MSA by Region
                      </Typography>
                      {Array.from(new Set(childFacilities.map(f => f.companyStructure?.region).filter(Boolean))).map((region) => {
                        const regionalFacilities = childFacilities.filter(f => f.companyStructure?.region === region);
                        const msaCount = regionalFacilities.filter(f => f.companyStructure?.msaSigned).length;
                        const percentage = regionalFacilities.length > 0 ? (msaCount / regionalFacilities.length) * 100 : 0;
                        
                        return (
                          <Box key={region} sx={{ mb: 2 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                              <Typography variant="body2">{region}</Typography>
                              <Typography variant="body2">
                                {msaCount}/{regionalFacilities.length} ({percentage.toFixed(1)}%)
                              </Typography>
                            </Box>
                            <LinearProgress 
                              variant="determinate" 
                              value={percentage}
                              color="success"
                              sx={{ height: 6, borderRadius: 3 }}
                            />
                          </Box>
                        );
                      })}
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Hierarchy Company Details Dialog */}
      <Dialog
        open={showHierarchyDialog}
        onClose={() => setShowHierarchyDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {selectedHierarchyCompany?.name} - Company Details
        </DialogTitle>
        <DialogContent>
          {selectedHierarchyCompany && (
            <Box>
              <Typography variant="h6" gutterBottom>
                {selectedHierarchyCompany.name}
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                {selectedHierarchyCompany.companyStructure?.locationType?.replace('_', ' ')} • {selectedHierarchyCompany.companyStructure?.region || 'No Region'}
              </Typography>
              
              <Divider sx={{ my: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" gutterBottom>Company Information</Typography>
                  <Typography variant="body2">Type: {selectedHierarchyCompany.companyStructure?.locationType?.replace('_', ' ') || 'Unknown'}</Typography>
                  <Typography variant="body2">Region: {selectedHierarchyCompany.companyStructure?.region || 'N/A'}</Typography>
                  <Typography variant="body2">Industry: {selectedHierarchyCompany.industry || 'N/A'}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" gutterBottom>Contract Information</Typography>
                  <Typography variant="body2">MSA Status: {selectedHierarchyCompany.companyStructure?.msaSigned ? 'Active' : 'Inactive'}</Typography>
                  <Typography variant="body2">National Account ID: {selectedHierarchyCompany.companyStructure?.nationalAccountId || 'N/A'}</Typography>
                  <Typography variant="body2">Facility Code: {selectedHierarchyCompany.companyStructure?.facilityCode || 'N/A'}</Typography>
                </Grid>
              </Grid>
              
              {selectedHierarchyCompany.companyStructure?.locationType === 'headquarters' && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" gutterBottom>Child Facilities</Typography>
                  <List dense>
                    {getChildFacilities(selectedHierarchyCompany.externalId).map((child) => (
                      <ListItem key={child.id} sx={{ px: 0 }}>
                        <ListItemAvatar>
                          <Avatar sx={{ width: 32, height: 32 }}>
                            {getLocationTypeIcon(child.companyStructure?.locationType || 'facility')}
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={child.name}
                          secondary={`${child.companyStructure?.locationType?.replace('_', ' ')} • ${child.companyStructure?.region || 'No Region'}`}
                        />
                        <Chip
                          label={child.companyStructure?.msaSigned ? 'MSA Active' : 'No MSA'}
                          size="small"
                          color={child.companyStructure?.msaSigned ? 'success' : 'default'}
                        />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}
              
              {selectedHierarchyCompany.companyStructure?.locationType !== 'headquarters' && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" gutterBottom>Parent Company</Typography>
                  {(() => {
                    const parent = getParentCompany(selectedHierarchyCompany.id);
                    return parent ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Avatar sx={{ width: 32, height: 32 }}>
                          <BusinessCenter />
                        </Avatar>
                        <Typography variant="body2">{parent.name}</Typography>
                      </Box>
                    ) : (
                      <Typography variant="body2" color="textSecondary">No parent company assigned</Typography>
                    );
                  })()}
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowHierarchyDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Parent Company Details Dialog */}
      <Dialog
        open={showDetailsDialog}
        onClose={() => setShowDetailsDialog(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          {selectedParent?.name} - National Account Details
        </DialogTitle>
        <DialogContent>
          {selectedParent && (
            <Box>
              {/* Company Overview */}
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Company Overview
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="textSecondary">
                        Industry: {selectedParent.industry || 'N/A'}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        Region: {selectedParent.companyStructure?.region || 'N/A'}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="textSecondary">
                        MSA Status: {selectedParent.companyStructure?.msaSigned ? 'Active' : 'Inactive'}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        National Account ID: {selectedParent.companyStructure?.nationalAccountId || 'N/A'}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>

              {/* Child Facilities */}
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Child Facilities ({getChildFacilities(selectedParent.externalId).length})
                  </Typography>
                  <TableContainer component={Paper} variant="outlined">
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>Facility Name</TableCell>
                          <TableCell>Type</TableCell>
                          <TableCell>Region</TableCell>
                          <TableCell>MSA Status</TableCell>
                          <TableCell>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {getChildFacilities(selectedParent.externalId).map((facility) => (
                          <TableRow key={facility.externalId}>
                            <TableCell>{facility.name}</TableCell>
                            <TableCell>
                              <Chip
                                icon={getLocationTypeIcon(facility.companyStructure?.locationType || '')}
                                label={facility.companyStructure?.locationType?.replace('_', ' ') || 'Unknown'}
                                size="small"
                              />
                            </TableCell>
                            <TableCell>{facility.companyStructure?.region || 'N/A'}</TableCell>
                            <TableCell>
                                                           <Chip
                               icon={getMSAStatusIcon(facility.companyStructure?.msaSigned || false)}
                               label={facility.companyStructure?.msaSigned ? 'Active' : 'Inactive'}
                               color={getMSAStatusColor(facility.companyStructure?.msaSigned || false)}
                               size="small"
                             />
                           </TableCell>
                           <TableCell>
                             <IconButton
                               size="small"
                               onClick={() => handleMSAUpdate(facility.id, !facility.companyStructure?.msaSigned)}
                             >
                                <Edit fontSize="small" />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>

              {/* Performance Metrics */}
              {performanceData.get(selectedParent.externalId) && (
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Performance Metrics
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={12} sm={6} md={3}>
                        <Box textAlign="center">
                          <Typography variant="h4" color="primary">
                            {performanceData.get(selectedParent.externalId)?.totalDeals}
                          </Typography>
                          <Typography variant="body2" color="textSecondary">
                            Total Deals
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Box textAlign="center">
                          <Typography variant="h4" color="primary">
                            ${performanceData.get(selectedParent.externalId)?.totalValue.toLocaleString()}
                          </Typography>
                          <Typography variant="body2" color="textSecondary">
                            Total Value
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Box textAlign="center">
                          <Typography variant="h4" color="success.main">
                            {performanceData.get(selectedParent.externalId)?.winRate.toFixed(1)}%
                          </Typography>
                          <Typography variant="body2" color="textSecondary">
                            Win Rate
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} sm={6} md={3}>
                        <Box textAlign="center">
                          <Typography variant="h4" color="info.main">
                            ${performanceData.get(selectedParent.externalId)?.avgDealSize.toLocaleString()}
                          </Typography>
                          <Typography variant="body2" color="textSecondary">
                            Avg Deal Size
                          </Typography>
                        </Box>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDetailsDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default NationalAccountManager; 