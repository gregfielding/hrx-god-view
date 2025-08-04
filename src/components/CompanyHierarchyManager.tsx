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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Switch,
  FormControlLabel,
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
  ExpandLess,
  ChevronRight,
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
  Group,
  Link,
  Timeline as TimelineIcon,
  Assessment,
  Insights,
  ContactSupport,
  PersonSearch,
  FilterList,
  Sort,
  Refresh,
  Download,
  Upload,
  Settings,
  Notifications,
  Chat,
  VideoCall,
  CalendarToday,
  AccessTime,
  Flag,
  PriorityHigh,
  LowPriority,
  Block,
  ThumbUp,
  ThumbDown,
  Favorite,
  FavoriteBorder,
  VisibilityOff,
  Lock,
  LockOpen,
  Security,
  VerifiedUser,
  GpsFixed,
  LocationSearching,
  Map as MapIcon,
  Public,
  Share,
  ContentCopy,
  QrCode,
  ContactPhone,
  ContactMail,
  ContactPage,
  ContactEmergency,
  ContactSupport as ContactSupportIcon,
  Contactless,
  Contacts,
  ContactPhoneOutlined,
  ContactMailOutlined,
  ContactPageOutlined,
  ContactEmergencyOutlined,
  ContactSupportOutlined,
  ContactlessOutlined,
  ContactsOutlined,
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
  ContactMailOutlined as ContactMailOutlinedIcon,
  ContactPhoneOutlined as ContactPhoneOutlinedIcon,
  ContactSupportOutlined as ContactSupportOutlinedIcon,
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
  VerifiedUserOutlined,
  Work,
  WorkOff,
  WorkOffOutlined,
  WorkOutline,
  WorkOutlined,
} from '@mui/icons-material';
import { collection, query, where, getDocs, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { CRMCompany, CRMContact } from '../types/CRM';
import { useAIFieldLogging } from '../utils/aiFieldLogging';

interface CompanyHierarchyManagerProps {
  tenantId: string;
}

interface CompanyNode {
  id: string;
  name: string;
  type: 'headquarters' | 'facility' | 'branch' | 'regional_office';
  parentId?: string;
  children: CompanyNode[];
  company: CRMCompany;
  region?: string;
  hasMSA: boolean;
  assignedRep?: string;
  facilityCode?: string;
  headcount?: number;
  isUnionized?: boolean;
  hasTempLaborExperience?: boolean;
  workforceModel?: 'full_time' | 'flex' | 'outsourced' | 'mixed';
}

interface RegionalAssignment {
  region: string;
  companies: CompanyNode[];
  totalHeadcount: number;
  assignedReps: string[];
  msaCount: number;
  unionizedCount: number;
  tempLaborCount: number;
}

const CompanyHierarchyManager: React.FC<CompanyHierarchyManagerProps> = ({ tenantId }) => {
  const [companies, setCompanies] = useState<CRMCompany[]>([]);
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [companyTree, setCompanyTree] = useState<CompanyNode[]>([]);
  const [regionalAssignments, setRegionalAssignments] = useState<RegionalAssignment[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanyNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [showCompanyDialog, setShowCompanyDialog] = useState(false);
  const [showFacilityDialog, setShowFacilityDialog] = useState(false);
  const [showRegionalDialog, setShowRegionalDialog] = useState(false);
  const [editingCompany, setEditingCompany] = useState<CRMCompany | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // AI Field Logging
  const logFieldInteraction = useAIFieldLogging('company_hierarchy_manager', tenantId, 'agency');

  useEffect(() => {
    logFieldInteraction(null, {
      action: 'component_loaded',
      tenantId,
      component: 'CompanyHierarchyManager'
    });
    loadData();
  }, [tenantId]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load companies
      const companiesQuery = query(collection(db, 'companies'), where('tenantId', '==', tenantId));
      const companiesSnapshot = await getDocs(companiesQuery);
      const companiesData = companiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMCompany));
      setCompanies(companiesData);

      // Load contacts
      const contactsQuery = query(collection(db, 'contacts'), where('tenantId', '==', tenantId));
      const contactsSnapshot = await getDocs(contactsQuery);
      const contactsData = contactsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMContact));
      setContacts(contactsData);

      // Build company tree
      const tree = buildCompanyTree(companiesData);
      setCompanyTree(tree);

      // Build regional assignments
      const regional = buildRegionalAssignments(tree);
      setRegionalAssignments(regional);

      logFieldInteraction(null, {
        action: 'data_loaded',
        companyCount: companiesData.length,
        contactCount: contactsData.length,
        treeDepth: getMaxTreeDepth(tree),
        regionalCount: regional.length,
        tenantId
      });

    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const buildCompanyTree = (companies: CRMCompany[]): CompanyNode[] => {
    const companyMap = new Map<string, CompanyNode>();
    const rootNodes: CompanyNode[] = [];

    // Create nodes for all companies
    companies.forEach(company => {
      const node: CompanyNode = {
        id: company.id,
        name: company.name,
        type: company.companyStructure?.locationType || 'facility',
        parentId: company.companyStructure?.parentId,
        children: [],
        company,
        region: company.companyStructure?.region,
        hasMSA: company.companyStructure?.msaSigned || false,
        assignedRep: company.companyStructure?.assignedRep,
        facilityCode: company.companyStructure?.facilityCode,
        headcount: company.companyStructure?.headcount,
        isUnionized: company.companyStructure?.isUnionized,
        hasTempLaborExperience: company.companyStructure?.hasTempLaborExperience,
        workforceModel: company.companyStructure?.workforceModel,
      };
      companyMap.set(company.id, node);
    });

    // Build parent-child relationships
    companies.forEach(company => {
      const node = companyMap.get(company.id);
      if (node) {
        if (node.parentId && companyMap.has(node.parentId)) {
          const parent = companyMap.get(node.parentId);
          if (parent) {
            parent.children.push(node);
          }
        } else {
          rootNodes.push(node);
        }
      }
    });

    return rootNodes;
  };

  const buildRegionalAssignments = (tree: CompanyNode[]): RegionalAssignment[] => {
    const regionalMap = new Map<string, RegionalAssignment>();

    const traverseNodes = (nodes: CompanyNode[]) => {
      nodes.forEach(node => {
        if (node.region) {
          const existing = regionalMap.get(node.region) || {
            region: node.region,
            companies: [],
            totalHeadcount: 0,
            assignedReps: [],
            msaCount: 0,
            unionizedCount: 0,
            tempLaborCount: 0,
          };

          existing.companies.push(node);
          existing.totalHeadcount += node.headcount || 0;
          if (node.assignedRep) {
            existing.assignedReps.push(node.assignedRep);
          }
          if (node.hasMSA) {
            existing.msaCount++;
          }
          if (node.isUnionized) {
            existing.unionizedCount++;
          }
          if (node.hasTempLaborExperience) {
            existing.tempLaborCount++;
          }

          regionalMap.set(node.region, existing);
        }

        if (node.children.length > 0) {
          traverseNodes(node.children);
        }
      });
    };

    traverseNodes(tree);
    return Array.from(regionalMap.values());
  };

  const getMaxTreeDepth = (nodes: CompanyNode[], currentDepth = 0): number => {
    if (nodes.length === 0) return currentDepth;
    
    let maxDepth = currentDepth;
    nodes.forEach(node => {
      const childDepth = getMaxTreeDepth(node.children, currentDepth + 1);
      maxDepth = Math.max(maxDepth, childDepth);
    });
    
    return maxDepth;
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

  const getLocationTypeColor = (locationType: string) => {
    switch (locationType) {
      case 'headquarters': return 'primary';
      case 'facility': return 'success';
      case 'branch': return 'warning';
      case 'regional_office': return 'info';
      default: return 'secondary';
    }
  };

  const getWorkforceModelIcon = (model?: string) => {
    switch (model) {
      case 'full_time': return <Work />;
      case 'flex': return <Schedule />;
      case 'outsourced': return <Group />;
      case 'mixed': return <Business />;
      default: return <Work />;
    }
  };

  const handleNodeToggle = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const handleCompanySelect = (company: CompanyNode) => {
    logFieldInteraction(null, {
      action: 'company_selected',
      companyId: company.id,
      companyName: company.name,
      companyType: company.type
    });
    setSelectedCompany(company);
    setShowCompanyDialog(true);
  };

  const handleEditCompany = (company: CRMCompany) => {
    setEditingCompany(company);
    setShowCompanyDialog(true);
  };

  const handleSaveCompany = async (companyData: Partial<CRMCompany>) => {
    try {
      logFieldInteraction(null, {
        action: 'company_updated',
        companyId: editingCompany?.id,
        companyName: companyData.name
      });

      if (editingCompany) {
        await updateDoc(doc(db, 'companies', editingCompany.id), {
          ...companyData,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'companies'), {
          ...companyData,
          tenantId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }

      setShowCompanyDialog(false);
      setEditingCompany(null);
      await loadData(); // Refresh data
    } catch (error) {
      console.error('Error saving company:', error);
    }
  };

  const renderCompanyTree = (nodes: CompanyNode[], level = 0) => {
    return nodes.map(node => {
      const isExpanded = expandedNodes.has(node.id);
      const hasChildren = node.children.length > 0;

      return (
        <Box key={node.id} sx={{ ml: level * 3 }}>
          <Card 
            variant="outlined" 
            sx={{ 
              mb: 1, 
              cursor: 'pointer',
              '&:hover': { bgcolor: 'action.hover' }
            }}
            onClick={() => handleCompanySelect(node)}
          >
            <CardContent sx={{ py: 1, px: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {hasChildren && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNodeToggle(node.id);
                      }}
                    >
                      {isExpanded ? <ExpandLess /> : <ChevronRight />}
                    </IconButton>
                  )}
                  
                  <Avatar sx={{ width: 32, height: 32, bgcolor: `${getLocationTypeColor(node.type)}.main` }}>
                    {getLocationTypeIcon(node.type)}
                  </Avatar>
                  
                  <Box>
                    <Typography variant="subtitle2" fontWeight="medium">
                      {node.name}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                      <Chip
                        label={node.type.replace('_', ' ')}
                        size="small"
                        color={getLocationTypeColor(node.type)}
                      />
                      {node.region && (
                        <Chip label={node.region} size="small" variant="outlined" />
                      )}
                      {node.hasMSA && (
                        <Chip label="MSA" size="small" color="success" />
                      )}
                    </Box>
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {node.headcount && (
                    <Chip label={`${node.headcount} employees`} size="small" variant="outlined" />
                  )}
                  {node.workforceModel && (
                    <Tooltip title={`Workforce: ${node.workforceModel.replace('_', ' ')}`}>
                      <IconButton size="small">
                        {getWorkforceModelIcon(node.workforceModel)}
                      </IconButton>
                    </Tooltip>
                  )}
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditCompany(node.company);
                    }}
                  >
                    <Edit />
                  </IconButton>
                </Box>
              </Box>
            </CardContent>
          </Card>

          {hasChildren && isExpanded && (
            <Collapse in={isExpanded}>
              {renderCompanyTree(node.children, level + 1)}
            </Collapse>
          )}
        </Box>
      );
    });
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          Company Hierarchy Manager
        </Typography>
        <LinearProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Company Hierarchy Manager
      </Typography>

      {/* Hierarchy Overview Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="h4" color="primary">
                    {companies.length}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Total Companies
                  </Typography>
                </Box>
                <Avatar sx={{ bgcolor: 'primary.main' }}>
                  <Business />
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
                    {companies.filter(c => c.companyStructure?.locationType === 'headquarters').length}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Headquarters
                  </Typography>
                </Box>
                <Avatar sx={{ bgcolor: 'success.main' }}>
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
                  <Typography variant="h4" color="warning.main">
                    {companies.filter(c => c.companyStructure?.locationType === 'facility').length}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Facilities
                  </Typography>
                </Box>
                <Avatar sx={{ bgcolor: 'warning.main' }}>
                  <Store />
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
                  <Typography variant="h4" color="info.main">
                    {regionalAssignments.length}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Regions
                  </Typography>
                </Box>
                <Avatar sx={{ bgcolor: 'info.main' }}>
                  <MapIcon />
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
            <Tab label="Company Tree" icon={<AccountTree />} />
            <Tab label="Facility Management" icon={<Store />} />
            <Tab label="Regional Assignments" icon={<MapIcon />} />
            <Tab label="Hierarchy Analytics" icon={<Assessment />} />
          </Tabs>

          {/* Company Tree Tab */}
          {activeTab === 0 && (
            <Box sx={{ mt: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">Company Hierarchy Tree</Typography>
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={() => setShowCompanyDialog(true)}
                >
                  Add Company
                </Button>
              </Box>
              
              <Box sx={{ maxHeight: 600, overflow: 'auto' }}>
                {companyTree.length > 0 ? (
                  renderCompanyTree(companyTree)
                ) : (
                  <Alert severity="info">
                    No companies found. Add your first company to start building the hierarchy.
                  </Alert>
                )}
              </Box>
            </Box>
          )}

          {/* Facility Management Tab */}
          {activeTab === 1 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>Facility Management</Typography>
              
              <TableContainer component={Paper} variant="outlined">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Facility</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Region</TableCell>
                      <TableCell>Headcount</TableCell>
                      <TableCell>Workforce Model</TableCell>
                      <TableCell>MSA Status</TableCell>
                      <TableCell>Assigned Rep</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {companies
                      .filter(company => company.companyStructure?.locationType !== 'headquarters')
                      .map((company) => (
                        <TableRow key={company.id}>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Avatar sx={{ width: 32, height: 32 }}>
                                {getLocationTypeIcon(company.companyStructure?.locationType || 'facility')}
                              </Avatar>
                              <Box>
                                <Typography variant="body2" fontWeight="medium">
                                  {company.name}
                                </Typography>
                                <Typography variant="caption" color="textSecondary">
                                  {company.companyStructure?.facilityCode || 'No Code'}
                                </Typography>
                              </Box>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={company.companyStructure?.locationType?.replace('_', ' ') || 'Unknown'}
                              size="small"
                              color={getLocationTypeColor(company.companyStructure?.locationType || 'facility')}
                            />
                          </TableCell>
                          <TableCell>{company.companyStructure?.region || 'N/A'}</TableCell>
                          <TableCell>{company.companyStructure?.headcount || 'N/A'}</TableCell>
                          <TableCell>
                            {company.companyStructure?.workforceModel && (
                              <Chip
                                icon={getWorkforceModelIcon(company.companyStructure.workforceModel)}
                                label={company.companyStructure.workforceModel.replace('_', ' ')}
                                size="small"
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={company.companyStructure?.msaSigned ? 'Active' : 'Inactive'}
                              size="small"
                              color={company.companyStructure?.msaSigned ? 'success' : 'default'}
                            />
                          </TableCell>
                          <TableCell>{company.companyStructure?.assignedRep || 'Unassigned'}</TableCell>
                          <TableCell>
                            <IconButton
                              size="small"
                              onClick={() => handleEditCompany(company)}
                            >
                              <Edit />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}

          {/* Regional Assignments Tab */}
          {activeTab === 2 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>Regional Assignment Tools</Typography>
              
              <Grid container spacing={2}>
                {regionalAssignments.map((region) => (
                  <Grid item xs={12} md={6} lg={4} key={region.region}>
                    <Card variant="outlined">
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                          <Avatar sx={{ bgcolor: 'info.main' }}>
                            <MapIcon />
                          </Avatar>
                          <Box>
                            <Typography variant="subtitle1" fontWeight="medium">
                              {region.region}
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                              {region.companies.length} companies
                            </Typography>
                          </Box>
                        </Box>
                        
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography variant="body2">Total Headcount:</Typography>
                            <Typography variant="body2" fontWeight="medium">
                              {region.totalHeadcount.toLocaleString()}
                            </Typography>
                          </Box>
                          
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography variant="body2">MSA Facilities:</Typography>
                            <Typography variant="body2" fontWeight="medium">
                              {region.msaCount}
                            </Typography>
                          </Box>
                          
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography variant="body2">Unionized:</Typography>
                            <Typography variant="body2" fontWeight="medium">
                              {region.unionizedCount}
                            </Typography>
                          </Box>
                          
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography variant="body2">Temp Labor Exp:</Typography>
                            <Typography variant="body2" fontWeight="medium">
                              {region.tempLaborCount}
                            </Typography>
                          </Box>
                          
                          <Divider sx={{ my: 1 }} />
                          
                          <Typography variant="caption" color="textSecondary">
                            Assigned Reps: {region.assignedReps.length > 0 ? region.assignedReps.join(', ') : 'None'}
                          </Typography>
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          {/* Hierarchy Analytics Tab */}
          {activeTab === 3 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" gutterBottom>Hierarchy Analytics</Typography>
              
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>Company Distribution</Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {['headquarters', 'facility', 'branch', 'regional_office'].map((type) => {
                          const count = companies.filter(c => c.companyStructure?.locationType === type).length;
                          const percentage = companies.length > 0 ? (count / companies.length) * 100 : 0;
                          
                          return (
                            <Box key={type}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                                  {type.replace('_', ' ')}s
                                </Typography>
                                <Typography variant="body2">
                                  {count} ({percentage.toFixed(1)}%)
                                </Typography>
                              </Box>
                              <LinearProgress 
                                variant="determinate" 
                                value={percentage} 
                                color={getLocationTypeColor(type)}
                                sx={{ height: 8, borderRadius: 4 }}
                              />
                            </Box>
                          );
                        })}
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
                
                <Grid item xs={12} md={6}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>Regional Distribution</Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {regionalAssignments.map((region) => {
                          const percentage = companies.length > 0 ? (region.companies.length / companies.length) * 100 : 0;
                          
                          return (
                            <Box key={region.region}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                <Typography variant="body2">
                                  {region.region}
                                </Typography>
                                <Typography variant="body2">
                                  {region.companies.length} ({percentage.toFixed(1)}%)
                                </Typography>
                              </Box>
                              <LinearProgress 
                                variant="determinate" 
                                value={percentage} 
                                color="info"
                                sx={{ height: 8, borderRadius: 4 }}
                              />
                            </Box>
                          );
                        })}
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Company Detail Dialog */}
      <Dialog
        open={showCompanyDialog}
        onClose={() => setShowCompanyDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {editingCompany ? 'Edit Company' : 'Company Details'}
        </DialogTitle>
        <DialogContent>
          {selectedCompany && !editingCompany && (
            <Box>
              <Typography variant="h6" gutterBottom>
                {selectedCompany.name}
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                {selectedCompany.type.replace('_', ' ')} • {selectedCompany.region || 'No Region'}
              </Typography>
              
              <Divider sx={{ my: 2 }} />
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" gutterBottom>Company Information</Typography>
                  <Typography variant="body2">Type: {selectedCompany.type.replace('_', ' ')}</Typography>
                  <Typography variant="body2">Region: {selectedCompany.region || 'N/A'}</Typography>
                  <Typography variant="body2">Facility Code: {selectedCompany.facilityCode || 'N/A'}</Typography>
                  <Typography variant="body2">Headcount: {selectedCompany.headcount || 'N/A'}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" gutterBottom>Workforce Information</Typography>
                  <Typography variant="body2">Model: {selectedCompany.workforceModel?.replace('_', ' ') || 'N/A'}</Typography>
                  <Typography variant="body2">Unionized: {selectedCompany.isUnionized ? 'Yes' : 'No'}</Typography>
                  <Typography variant="body2">Temp Labor Exp: {selectedCompany.hasTempLaborExperience ? 'Yes' : 'No'}</Typography>
                  <Typography variant="body2">MSA Status: {selectedCompany.hasMSA ? 'Active' : 'Inactive'}</Typography>
                </Grid>
              </Grid>
              
              {selectedCompany.children.length > 0 && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" gutterBottom>Child Facilities ({selectedCompany.children.length})</Typography>
                  <List dense>
                    {selectedCompany.children.map((child) => (
                      <ListItem key={child.id} sx={{ px: 0 }}>
                        <ListItemAvatar>
                          <Avatar sx={{ width: 32, height: 32 }}>
                            {getLocationTypeIcon(child.type)}
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={child.name}
                          secondary={`${child.type.replace('_', ' ')} • ${child.region || 'No Region'}`}
                        />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCompanyDialog(false)}>Close</Button>
          {selectedCompany && (
            <Button
              variant="contained"
              onClick={() => handleEditCompany(selectedCompany.company)}
            >
              Edit
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CompanyHierarchyManager; 