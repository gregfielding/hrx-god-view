import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Grid,
  Chip,
  Button,
  IconButton,
  CircularProgress,
  Paper,
  Tabs,
  Tab,
  Badge,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  Avatar,
  Snackbar,
  Alert,
  FormHelperText,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  FormControlLabel,
  Switch,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Collapse,
  Skeleton,
  Checkbox,
  List,
  ListItem,
  ListItemText,
  Breadcrumbs,
  Link as MUILink,
} from '@mui/material';
import {
  Phone as PhoneIcon,
  Add as AddIcon,
  LocationOn as LocationIcon,
  Language as LanguageIcon,
  Work as WorkIcon,
  AttachMoney as DealIcon,
  Person as PersonIcon,
  Dashboard as DashboardIcon,
  Place as PlaceIcon,
  AttachMoney as OpportunitiesIcon,
  Note as NoteIcon,
  LinkedIn as LinkedInIcon,
  SmartToy as AIIcon,
  CloudUpload as UploadIcon,
  Delete as DeleteIcon,
  Facebook as FacebookIcon,
  Twitter as TwitterIcon,
  Refresh as RefreshIcon,
  OpenInNew as OpenInNewIcon,
  Newspaper as NewspaperIcon,
  LocationOn as LocationOnIcon,
  Visibility,
  Security as SecurityIcon,
  AccessTime as TimeClockIcon,
  Compare as CompareIcon,
  Receipt as BillingIcon,
  AttachFile as ContractsIcon,
  Edit as EditIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  Business as BusinessIcon,
  Event as EventIcon,
  Email as EmailIcon,
  Timeline as TimelineIcon,
  Close as CloseIcon,
  RocketLaunch as RocketLaunchIcon,
} from '@mui/icons-material';
import { Autocomplete as GoogleAutocomplete } from '@react-google-maps/api';
import SalesCoach from '../../components/SalesCoach';
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  updateDoc,
  onSnapshot,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';

import { db, storage , functions } from '../../firebase';
import FastAssociationsCard from '../../components/FastAssociationsCard';
import { useAuth } from '../../contexts/AuthContext';
import { useCRMCache } from '../../contexts/CRMCacheContext';
import IndustrySelector from '../../components/IndustrySelector';
import { geocodeAddress } from '../../utils/geocodeAddress';
import { INDUSTRIES, getIndustriesByCategory, getIndustryByCode } from '../../data/industries';
import NewsEnrichmentPanel from '../../components/NewsEnrichmentPanel';
import AIEnrichmentWidget from '../../components/AIEnrichmentWidget';
import DecisionMakersPanel from '../../components/DecisionMakersPanel';
import CRMNotesTab from '../../components/CRMNotesTab';
import { getStageHexColor, getTextContrastColor } from '../../utils/crmStageColors';
import AIAssistantChat from '../../components/AIAssistantChat';

// AngelList and Crunchbase Icon Components
const AngelListIcon = ({ hasUrl }: { hasUrl: boolean }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <img
      src={hasUrl ? "/img/angellist-icon-blue.svg" : "/img/angellist-icon-grey.svg"}
      alt="AngelList"
      style={{
        width: '16px',
        height: '16px'
      }}
    />
  </Box>
);

const CrunchbaseIcon = ({ hasUrl }: { hasUrl: boolean }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <img
      src={hasUrl ? "/img/crunchbase-icon-blue.svg" : "/img/crunchbase-icon-grey.svg"}
      alt="Crunchbase"
      style={{
        width: '18px',
        height: '18px'
      }}
    />
  </Box>
);

// Types for company activity items
type CompanyActivityItem = {
  id: string;
  type: 'task' | 'note' | 'deal_stage' | 'email';
  timestamp: Date;
  title: string;
  description?: string;
  metadata?: any;
};

// Normalizers
const normalizeSizeValue = (value?: string): string => {
  if (!value) return '';
  if (value === '50-100') return '51-100';
  return value;
};


  // Helper function to get sub-industries for a given main industry
  const getSubIndustries = (mainIndustryCode: string) => {
    if (!mainIndustryCode) return [];

    // Food Manufacturing (311) — prefer 3111-3119
    if (mainIndustryCode === '311') {
      return INDUSTRIES.filter(ind => ind.code.startsWith('311') && ind.code !== '311');
    }

    // Manufacturing sector (31x): return children where code starts with selected code and is longer
    if (/^\d{3}$/.test(mainIndustryCode) && mainIndustryCode.startsWith('31')) {
      return INDUSTRIES.filter(ind => ind.code.startsWith(mainIndustryCode) && ind.code !== mainIndustryCode);
    }

    // Generic: same category and longer codes, but bias to prefix matches if present
    const main = INDUSTRIES.find(ind => ind.code === mainIndustryCode);
    if (!main) return [];
    const inCategory = getIndustriesByCategory(main.category).filter(ind => ind.code !== mainIndustryCode);
    const prefixed = inCategory.filter(ind => ind.code.startsWith(mainIndustryCode));
    return prefixed.length > 0 ? prefixed : inCategory.filter(ind => ind.code.length > mainIndustryCode.length);
  };

// Helper function to find company website using multiple strategies
// Helper function to find company website using Google search
const findCompanyWebsite = async (companyName: string): Promise<string | null> => {
  try {
    // Simulate Google search for company website
    // In a real implementation, this would use:
    // 1. Google Custom Search API: https://developers.google.com/custom-search/v1/overview
    // 2. SerpAPI: https://serpapi.com/
    // 3. ScrapingBee: https://www.scrapingbee.com/
    // 4. Or a backend service with proper web scraping
    
    const searchQuery = encodeURIComponent(`${companyName} official website`);
    
    console.log(`Searching Google for: ${companyName} official website`);
    
    // Simulate a delay to mimic real search
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // TODO: Replace this with real Google Search API implementation
    // Example implementation:
    /*
    const response = await fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${searchQuery}`);
    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      for (const item of data.items) {
        const url = item.link;
        if (url && !url.includes('linkedin.com') && !url.includes('indeed.com') && !url.includes('facebook.com')) {
          return url;
        }
      }
    }
    */
    
    // For demonstration, we'll still use some intelligent guessing but with better logic
    const words = companyName.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    const cleanName = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // More realistic domain patterns based on common business practices
    const possibleDomains = [
      // Most common: company name + .com
      `${cleanName}.com`,
      
      // Multi-word companies often use first letters or key words
      ...(words.length > 1 ? [
        `${words.map(word => word.charAt(0)).join('')}.com`, // Acronym
        `${words[0]}${words[words.length - 1]}.com`, // First + Last word
        `${words[0]}${words[1]}.com`, // First two words
      ] : []),
      
      // Industry-specific patterns
      ...(words.some(word => ['steel', 'metal', 'supply', 'industrial'].includes(word)) ? [
        `${words[0]}steel.com`,
        `${words[0]}metal.com`,
        `${words[0]}supply.com`,
      ] : []),
      
      // Fallback to first word
      ...(words.length > 0 ? [`${words[0]}.com`] : [])
    ];

    // Test each domain (simulating what Google search would find)
    for (const domain of possibleDomains) {
      try {
        // Simulate checking if domain exists
        const response = await fetch(`https://${domain}`, { 
          method: 'HEAD', 
          mode: 'no-cors', 
          cache: 'no-cache' 
        });
        
        if (response.ok) {
          console.log(`Found website via search: https://${domain}`);
          return `https://${domain}`;
        }
      } catch (e) {
        continue;
      }
    }

    console.log('No website found via Google search for:', companyName);
    return null;
  } catch (e) {
    console.log('Google search failed:', e);
    return null;
  }
};

// Helper function to find LinkedIn URL using Google search
const generateLinkedInUrl = async (companyName: string): Promise<string> => {
  try {
    // Simulate Google search for LinkedIn profile
    // In a real implementation, this would use:
    // 1. Google Custom Search API: https://developers.google.com/custom-search/v1/overview
    // 2. SerpAPI: https://serpapi.com/
    // 3. ScrapingBee: https://www.scrapingbee.com/
    // 4. Or a backend service with proper web scraping
    
    const searchQuery = encodeURIComponent(`${companyName} LinkedIn company profile`);
    
    console.log(`Searching Google for: ${companyName} LinkedIn company profile`);
    
    // Simulate a delay to mimic real search
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // TODO: Replace this with real Google Search API implementation
    // Example implementation:
    /*
    const response = await fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${searchQuery}`);
    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      for (const item of data.items) {
        if (item.link && item.link.includes('linkedin.com/company/')) {
          return item.link;
        }
      }
    }
    */
    
    // For demonstration, we'll still use some intelligent guessing but with better logic
    const words = companyName.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    
    // More realistic LinkedIn URL patterns based on common practices
    const linkedinVariations = [
      // Acronym variations (highest priority - most common)
      ...(words.length > 1 ? [
        `https://linkedin.com/company/${words.map(word => word.charAt(0)).join('')}`,
        `https://linkedin.com/company/${words.map(word => word.charAt(0)).join('')}-company`,
        `https://linkedin.com/company/${words.map(word => word.charAt(0)).join('')}-inc`
      ] : []),
      
      // Key word combinations (second priority)
      ...(words.length > 1 ? [
        `https://linkedin.com/company/${words[0]}${words[words.length - 1]}`,
        `https://linkedin.com/company/${words[0]}${words[1]}`,
        `https://linkedin.com/company/${words[1]}${words[2]}`,
        `https://linkedin.com/company/${words[0]}${words[2]}`
      ] : []),
      
      // Shortened versions (remove common words)
      ...(words.length > 1 ? [
        `https://linkedin.com/company/${words.filter(word => !['company', 'corporation', 'corp', 'inc', 'llc', 'ltd', 'co', 'supply', 'services'].includes(word)).join('')}`,
        `https://linkedin.com/company/${words.filter(word => !['company', 'corporation', 'corp', 'inc', 'llc', 'ltd', 'co', 'supply', 'services'].includes(word)).join('-')}`
      ] : []),
      
      // Industry-specific abbreviations
      ...(words.some(word => ['steel', 'metal', 'supply', 'industrial', 'manufacturing'].includes(word)) ? [
        `https://linkedin.com/company/${words[0]}steel`,
        `https://linkedin.com/company/${words[0]}metal`,
        `https://linkedin.com/company/${words[0]}supply`,
        `https://linkedin.com/company/steel${words[0]}`,
        `https://linkedin.com/company/metal${words[0]}`,
        `https://linkedin.com/company/supply${words[0]}`
      ] : []),
      
      // First word only (fallback)
      ...(words.length > 0 ? [
        `https://linkedin.com/company/${words[0]}`,
        `https://linkedin.com/company/${words[0]}-company`
      ] : [])
    ];
    
    // Remove duplicates and get the most likely one
    const uniqueVariations = [...new Set(linkedinVariations)];
    const linkedinUrl = uniqueVariations[0];
    console.log(`Found LinkedIn URL via search: ${linkedinUrl}`);
    return linkedinUrl;
  } catch (e) {
    console.log('LinkedIn search failed:', e);
    return '';
  }
};

// Helper function to find Indeed URL using Google search
const findIndeedUrl = async (companyName: string): Promise<string> => {
  try {
    // Simulate Google search for Indeed company profile
    // In a real implementation, this would use:
    // 1. Google Custom Search API: https://developers.google.com/custom-search/v1/overview
    // 2. SerpAPI: https://serpapi.com/
    // 3. ScrapingBee: https://www.scrapingbee.com/
    // 4. Or a backend service with proper web scraping
    
    const searchQuery = encodeURIComponent(`${companyName} site:indeed.com/cmp`);
    
    console.log(`Searching Google for: ${companyName} site:indeed.com/cmp`);
    
    // Simulate a delay to mimic real search
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // TODO: Replace this with real Google Search API implementation
    // Example implementation:
    /*
    const response = await fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${searchQuery}`);
    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      for (const item of data.items) {
        if (item.link && item.link.includes('indeed.com/cmp/')) {
          return item.link;
        }
      }
    }
    */
    
    // For demonstration, we'll use some intelligent guessing but with better logic
    const words = companyName.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    
    // More realistic Indeed URL patterns based on common practices
    const indeedVariations = [
      // Full company name (highest priority - most common)
      `https://www.indeed.com/cmp/${companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`,
      
      // Acronym variations (second priority)
      ...(words.length > 1 ? [
        `https://www.indeed.com/cmp/${words.map(word => word.charAt(0)).join('')}`,
        `https://www.indeed.com/cmp/${words.map(word => word.charAt(0)).join('')}-company`,
        `https://www.indeed.com/cmp/${words.map(word => word.charAt(0)).join('')}-inc`
      ] : []),
      
      // Key word combinations (third priority)
      ...(words.length > 1 ? [
        `https://www.indeed.com/cmp/${words[0]}${words[words.length - 1]}`,
        `https://www.indeed.com/cmp/${words[0]}${words[1]}`,
        `https://www.indeed.com/cmp/${words[1]}${words[2]}`,
        `https://www.indeed.com/cmp/${words[0]}${words[2]}`
      ] : []),
      
      // Shortened versions (remove common words)
      ...(words.length > 1 ? [
        `https://www.indeed.com/cmp/${words.filter(word => !['company', 'corporation', 'corp', 'inc', 'llc', 'ltd', 'co', 'supply', 'services'].includes(word)).join('-')}`,
        `https://www.indeed.com/cmp/${words.filter(word => !['company', 'corporation', 'corp', 'inc', 'llc', 'ltd', 'co', 'supply', 'services'].includes(word)).join('')}`
      ] : []),
      
      // Industry-specific abbreviations
      ...(words.some(word => ['steel', 'metal', 'supply', 'industrial', 'manufacturing'].includes(word)) ? [
        `https://www.indeed.com/cmp/${words[0]}steel`,
        `https://www.indeed.com/cmp/${words[0]}metal`,
        `https://www.indeed.com/cmp/${words[0]}supply`,
        `https://www.indeed.com/cmp/steel${words[0]}`,
        `https://www.indeed.com/cmp/metal${words[0]}`,
        `https://www.indeed.com/cmp/supply${words[0]}`
      ] : []),
      
      // First word only (fallback)
      ...(words.length > 0 ? [
        `https://www.indeed.com/cmp/${words[0]}`,
        `https://www.indeed.com/cmp/${words[0]}-company`
      ] : [])
    ];
    
    // Remove duplicates and get the most likely one
    const uniqueVariations = [...new Set(indeedVariations)];
    const indeedUrl = uniqueVariations[0];
    console.log(`Found Indeed URL via search: ${indeedUrl}`);
    return indeedUrl;
  } catch (e) {
    console.log('Indeed search failed:', e);
    return '';
  }
};

// Helper function to find Facebook URL using Google search
const findFacebookUrl = async (companyName: string): Promise<string> => {
  try {
    // Simulate Google search for Facebook company page
    // In a real implementation, this would use:
    // 1. Google Custom Search API: https://developers.google.com/custom-search/v1/overview
    // 2. SerpAPI: https://serpapi.com/
    // 3. ScrapingBee: https://www.scrapingbee.com/
    // 4. Or a backend service with proper web scraping
    
    const searchQuery = encodeURIComponent(`${companyName} site:facebook.com`);
    
    console.log(`Searching Google for: ${companyName} site:facebook.com`);
    
    // Simulate a delay to mimic real search
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // TODO: Replace this with real Google Search API implementation
    // Example implementation:
    /*
    const response = await fetch(`https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${searchQuery}`);
    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      for (const item of data.items) {
        if (item.link && item.link.includes('facebook.com/')) {
          return item.link;
        }
      }
    }
    */
    
    // For demonstration, we'll use some intelligent guessing but with better logic
    const words = companyName.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    
    // More realistic Facebook URL patterns based on common practices
    const facebookVariations = [
      // Full company name (highest priority - most common)
      `https://www.facebook.com/${companyName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')}`,
      
      // Acronym variations (second priority)
      ...(words.length > 1 ? [
        `https://www.facebook.com/${words.map(word => word.charAt(0)).join('')}`,
        `https://www.facebook.com/${words.map(word => word.charAt(0)).join('')}company`,
        `https://www.facebook.com/${words.map(word => word.charAt(0)).join('')}inc`
      ] : []),
      
      // Key word combinations (third priority)
      ...(words.length > 1 ? [
        `https://www.facebook.com/${words[0]}${words[words.length - 1]}`,
        `https://www.facebook.com/${words[0]}${words[1]}`,
        `https://www.facebook.com/${words[1]}${words[2]}`,
        `https://www.facebook.com/${words[0]}${words[2]}`
      ] : []),
      
      // Shortened versions (remove common words)
      ...(words.length > 1 ? [
        `https://www.facebook.com/${words.filter(word => !['company', 'corporation', 'corp', 'inc', 'llc', 'ltd', 'co', 'supply', 'services'].includes(word)).join('')}`,
        `https://www.facebook.com/${words.filter(word => !['company', 'corporation', 'corp', 'inc', 'llc', 'ltd', 'co', 'supply', 'services'].includes(word)).join('-')}`
      ] : []),
      
      // Industry-specific abbreviations
      ...(words.some(word => ['steel', 'metal', 'supply', 'industrial', 'manufacturing'].includes(word)) ? [
        `https://www.facebook.com/${words[0]}steel`,
        `https://www.facebook.com/${words[0]}metal`,
        `https://www.facebook.com/${words[0]}supply`,
        `https://www.facebook.com/steel${words[0]}`,
        `https://www.facebook.com/metal${words[0]}`,
        `https://www.facebook.com/supply${words[0]}`
      ] : []),
      
      // First word only (fallback)
      ...(words.length > 0 ? [
        `https://www.facebook.com/${words[0]}`,
        `https://www.facebook.com/${words[0]}company`
      ] : [])
    ];
    
    // Remove duplicates and get the most likely one
    const uniqueVariations = [...new Set(facebookVariations)];
    const facebookUrl = uniqueVariations[0];
    console.log(`Found Facebook URL via search: ${facebookUrl}`);
    return facebookUrl;
  } catch (e) {
    console.log('Facebook search failed:', e);
    return '';
  }
};

const CompanyDetails: React.FC = () => {
  const { companyId } = useParams<{ companyId: string }>();
  const { tenantId, currentUser } = useAuth();
  const { updateCacheState } = useCRMCache();
  const navigate = useNavigate();


  
  const [company, setCompany] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [jobPostings, setJobPostings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  // Removed inline company name edit (managed in Core Identity widget)
  
  // Get active tab from URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const activeTab = urlParams.get('tab');
    if (activeTab !== null) {
      const tabIndex = parseInt(activeTab);
      if (tabIndex >= 0 && tabIndex <= 11) {
        setTabValue(tabIndex);
      }
    }
  }, []);

  // Inline edit logic removed
  const [salespeople, setSalespeople] = useState<any[]>([]);
  const [salespeopleLoading, setSalespeopleLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [logoLoading, setLogoLoading] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string>('');
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [companyContextOpen, setCompanyContextOpen] = useState(false);
  const [aiComponentsLoaded, setAiComponentsLoaded] = useState(false);
  const [patternAlerts, setPatternAlerts] = useState<Array<{id: string; type: 'warning' | 'info' | 'success'; message: string; action?: string}>>([]);

  // Apollo data processing function
  const processApolloData = useCallback(async (apolloData: any) => {
    if (!companyId || !tenantId) return;

    try {
      const updates: any = {};

      // Map Apollo fields to our company fields
      if (apolloData.name) updates.name = apolloData.name;
      if (apolloData.website_url) updates.website = apolloData.website_url;
      if (apolloData.angellist_url) updates.angellist = apolloData.angellist_url;
      if (apolloData.linkedin_url) updates.linkedin = apolloData.linkedin_url;
      if (apolloData.twitter_url) updates.twitter = apolloData.twitter_url;
      if (apolloData.facebook_url) updates.facebook = apolloData.facebook_url;
      if (apolloData.phone) updates.phone = apolloData.phone;
      if (apolloData.founded_year) updates.foundedYear = apolloData.founded_year;
      if (apolloData.logo_url) updates.logoUrl = apolloData.logo_url;
      if (apolloData.crunchbase_url) updates.crunchbase = apolloData.crunchbase_url;
      if (apolloData.short_description) updates.shortDescription = apolloData.short_description;
      if (apolloData.estimated_num_employees) updates.estimatedEmployees = apolloData.estimated_num_employees;
      if (apolloData.organization_revenue) updates.annualRevenue = apolloData.organization_revenue;

      // Process industry data
      if (apolloData.industry) {
        updates.industry = apolloData.industry;
      }
      if (apolloData.industries && apolloData.industries.length > 0) {
        updates.industry = apolloData.industries[0];
      }
      if (apolloData.secondary_industries && apolloData.secondary_industries.length > 0) {
        updates.subIndustry = apolloData.secondary_industries[0];
      }

      // Process address data for headquarters location
      if (apolloData.street_address || apolloData.city || apolloData.state || apolloData.postal_code || apolloData.country) {
        await createHeadquartersLocation(apolloData);
      }

      // Update company with Apollo data
      if (Object.keys(updates).length > 0) {
        await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId), {
          ...updates,
          updatedAt: serverTimestamp()
        });
      }

    } catch (error) {
      console.error('Error processing Apollo data:', error);
    }
  }, [companyId, tenantId]);

  // Create headquarters location from Apollo address data
  const createHeadquartersLocation = useCallback(async (apolloData: any) => {
    if (!companyId || !tenantId || !company) return;

    try {
      // Check if headquarters location already exists
      const locationsRef = collection(db, `tenants/${tenantId}/crm_companies/${companyId}/locations`);
      const headquartersQuery = query(locationsRef, where('type', '==', 'Headquarters'));
      const headquartersSnapshot = await getDocs(headquartersQuery);

      if (!headquartersSnapshot.empty) {
        console.log('Headquarters location already exists, skipping creation');
        return;
      }

      // Create address string
      const addressParts = [
        apolloData.street_address,
        apolloData.city,
        apolloData.state,
        apolloData.postal_code,
        apolloData.country
      ].filter(Boolean);

      if (addressParts.length === 0) return;

      const addressString = addressParts.join(', ');

      // Create new headquarters location
      const newLocation = {
        name: company.name || company.companyName || 'Headquarters',
        type: 'Headquarters',
        address: addressString,
        street: apolloData.street_address || '',
        city: apolloData.city || '',
        state: apolloData.state || '',
        zip: apolloData.postal_code || '',
        country: apolloData.country || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await addDoc(locationsRef, newLocation);
      console.log('Created headquarters location from Apollo data');

    } catch (error) {
      console.error('Error creating headquarters location:', error);
    }
  }, [companyId, tenantId, company]);
  
  // Feature Flags
  const featureFlags = {
    newDashboard: localStorage.getItem('feature.newDashboard') !== 'false',
    dealCoach: localStorage.getItem('feature.dealCoach') !== 'false',
    keyboardShortcuts: localStorage.getItem('feature.keyboardShortcuts') !== 'false',
    patternAlerts: localStorage.getItem('feature.patternAlerts') !== 'false',
    pinnedWidgets: localStorage.getItem('feature.pinnedWidgets') !== 'false',
    companyAI: localStorage.getItem('feature.companyAI') !== 'false'
  };

  useEffect(() => {
    if (!companyId || !tenantId) return;
    
    setLoading(true);
    // Clear job postings when switching companies
    setJobPostings([]);
    
    // Load tenant name
    const loadTenantName = async () => {
      try {
        const tenantDoc = await getDoc(doc(db, 'tenants', tenantId));
        if (tenantDoc.exists()) {
          const tenantData = tenantDoc.data();
          setTenantName(tenantData.name || '');
        }
      } catch (err) {
        console.error('Error loading tenant name:', err);
      }
    };
    loadTenantName();
    
    // Real-time listener for company details
    const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
    const unsubscribeCompany = onSnapshot(companyRef, (doc) => {
      if (doc.exists()) {
        const companyData = { id: doc.id, ...doc.data() };
        setCompany(companyData);
        setError(null);
      } else {
        setError('Company not found');
      }
      setLoading(false);
    }, (err) => {
      console.error('Error loading company details:', err);
      setError('Failed to load company details');
      setLoading(false);
    });
    
    // Real-time listener for associated contacts
    const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
    const contactsQuery = query(contactsRef, where('companyId', '==', companyId));
    const unsubscribeContacts = onSnapshot(contactsQuery, (snapshot) => {
      const contactsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setContacts(contactsData);
    }, (err) => {
      console.error('Error loading contacts:', err);
    });
    
    // Real-time listener for associated deals
    const dealsRef = collection(db, 'tenants', tenantId, 'crm_deals');
    const dealsQuery = query(dealsRef, where('companyId', '==', companyId));
    const unsubscribeDeals = onSnapshot(dealsQuery, (snapshot) => {
      const dealsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setDeals(dealsData);
    }, (err) => {
      console.error('Error loading deals:', err);
    });
    
    // Cleanup function to unsubscribe from listeners
    return () => {
      unsubscribeCompany();
      unsubscribeContacts();
      unsubscribeDeals();
    };
  }, [companyId, tenantId, updateCacheState]);

  // Pattern Detection and Alerts
  const detectPatterns = () => {
    const alerts: Array<{id: string; type: 'warning' | 'info' | 'success'; message: string; action?: string}> = [];
    
    if (company) {
      // Check for companies with no contacts
      if (contacts.length === 0) {
        alerts.push({
          id: 'no_contacts',
          type: 'warning',
          message: 'This company has no contacts. Consider adding key decision makers.',
          action: 'View Contacts'
        });
      }

      // Check for companies with no active deals
      const activeDeals = deals.filter(deal => deal.stage !== 'closed_won' && deal.stage !== 'closed_lost');
      if (activeDeals.length === 0 && deals.length > 0) {
        alerts.push({
          id: 'no_active_deals',
          type: 'warning',
          message: 'All deals for this company are closed. Consider creating new opportunities.',
          action: 'View Opportunities'
        });
      }

      // Check for companies with high potential but no deals
      if (deals.length === 0 && company.industry) {
        alerts.push({
          id: 'no_deals',
          type: 'info',
          message: 'This company has potential but no deals yet. Consider creating your first opportunity.',
          action: 'View Opportunities'
        });
      }

      // Check for companies missing key information
      const missingInfo = [];
      if (!company.website) missingInfo.push('website');
      if (!company.linkedin) missingInfo.push('LinkedIn');
      if (!company.industry) missingInfo.push('industry');
      
      if (missingInfo.length > 0) {
        alerts.push({
          id: 'missing_info',
          type: 'info',
          message: `Missing key information: ${missingInfo.join(', ')}. Consider enhancing company data.`,
          action: 'Enhance Data'
        });
      }
    }

    setPatternAlerts(alerts);
  };

  useEffect(() => {
    if (company && contacts && deals) {
      detectPatterns();
    }
  }, [company, contacts, deals]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    
    // Update URL with active tab
    const url = new URL(window.location.href);
    url.searchParams.set('tab', newValue.toString());
    window.history.replaceState({}, '', url.toString());
  };

  // Load salespeople for National Account Owner selection
  useEffect(() => {
    if (tenantId) {
      const loadSalespeople = async () => {
        setSalespeopleLoading(true);
        try {
          // Use Firebase Function to get salespeople (has admin privileges)
          const getSalespeople = httpsCallable(functions, 'getSalespeopleForTenant');
          const result = await getSalespeople({ tenantId });
          const data = result.data as { salespeople: any[] };
          setSalespeople(data.salespeople || []);
        } catch (err) {
          console.error('Error loading salespeople:', err);
          // If we can't load salespeople, just set an empty array
          // This prevents the error from breaking the entire component
          setSalespeople([]);
        } finally {
          setSalespeopleLoading(false);
        }
      };
      loadSalespeople();
    }
  }, [tenantId]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      if (file.size > 2 * 1024 * 1024) {
        setError('Logo file size must be less than 2MB');
        return;
      }

      const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
      if (!validTypes.includes(file.type)) {
        setError('Please upload a PNG, JPG, or SVG file');
        return;
      }

      setLogoLoading(true);
      try {
        const storageRef = ref(storage, `companies/${tenantId}/${company.id}/logo.${file.name.split('.').pop()}`);
        await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(storageRef);
        
        const updatedCompany = { ...company, logo: downloadURL };
        // setCompany(updatedCompany); // Not available in OverviewTab component
        
        await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id), { logo: downloadURL });
        setSuccess('Logo uploaded successfully!');
      } catch (err) {
        console.error('Error uploading logo:', err);
        setError('Failed to upload logo. Please try again.');
      }
      setLogoLoading(false);
    }
  };

  const handleDeleteLogo = async () => {
    setLogoLoading(true);
    try {
      if (company.logo) {
        const urlParts = company.logo.split('/');
        const fileName = urlParts[urlParts.length - 1];
        const fileExtension = fileName.split('.').pop() || 'png';
        const storageRef = ref(storage, `companies/${tenantId}/${company.id}/logo.${fileExtension}`);
        await deleteObject(storageRef);
      }
      
      const updatedCompany = { ...company, logo: '' };
      // setCompany(updatedCompany); // Not available in OverviewTab component
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id), { logo: '' });
      setSuccess('Logo deleted successfully!');
    } catch (err) {
      console.error('Error deleting logo:', err);
      setError('Failed to delete logo. Please try again.');
    }
    setLogoLoading(false);
  };

  // Helper function to ensure URLs have proper protocols
  const ensureUrlProtocol = (url: string): string => {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return 'https://' + url;
  };

  const handleCompanyUpdate = async (field: string, value: any) => {
    try {
      // Ensure URL fields have proper protocols
      let processedValue = value;
      if (['website', 'linkedin', 'indeed', 'facebook'].includes(field) && value) {
        processedValue = ensureUrlProtocol(value);
      }

      const updatedCompany = { ...company, [field]: processedValue };
      // setCompany(updatedCompany); // Not available in OverviewTab component
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId), { [field]: processedValue });
      setSuccess('Company updated successfully!');
    } catch (err) {
      console.error('Error updating company:', err);
      setError('Failed to update company. Please try again.');
    }
  };



  const handleAddressGeocode = async () => {
    if (!company.address) return;
    
    try {
      const coordinates = await geocodeAddress(company.address);
      await handleCompanyUpdate('coordinates', coordinates);
      setSuccess('Address geocoded successfully!');
    } catch (err) {
      console.error('Error geocoding address:', err);
      setError('Failed to geocode address. Please check the address format.');
    }
  };

  const handleDiscoverUrls = async () => {
    setAiLoading(true);
    try {
      const companyName = company.companyName || company.name;
      if (!companyName) {
        setError('Company name is required for URL discovery');
        setAiLoading(false);
        return;
      }

      // Use the enhanced SERP-powered URL discovery function
      const discoverUrls = httpsCallable(functions, 'discoverCompanyUrls');
      const urlResult = await discoverUrls({
        companyName,
        companyId: company.id,
        tenantId
      });
      
      const urlData = urlResult.data as any;
      console.log('SERP-enhanced URL discovery results:', urlData);
      
      // Update URLs if found and not already set
      const enhancedData: any = {};
      if (urlData.website && !company.website) {
        enhancedData.website = urlData.website;
      }
      if (urlData.linkedin && !company.linkedin) {
        enhancedData.linkedin = urlData.linkedin;
      }
      if (urlData.indeed && !company.indeed) {
        enhancedData.indeed = urlData.indeed;
      }
      if (urlData.facebook && !company.facebook) {
        enhancedData.facebook = urlData.facebook;
      }

      // Update the company data in Firestore
      if (Object.keys(enhancedData).length > 0) {
        await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id), enhancedData);
        setSuccess('URLs discovered and updated successfully with SERP data!');
      } else {
        setSuccess('No new URLs found to update.');
      }
      
    } catch (error) {
      console.error('URL discovery failed:', error);
      setError('Failed to discover URLs. Please try again.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleEnhanceWithAI = async () => {
    setAiLoading(true);
    try {
      const companyName = company.companyName || company.name;
      if (!companyName) {
        setError('Company name is required for AI enhancement');
        setAiLoading(false);
        return;
      }

      // Use the Apollo-powered company enrichment function
      try {
        const enrichCompany = httpsCallable(functions, 'enrichCompanyOnDemand');
        const result = await enrichCompany({
          tenantId,
          companyId: company.id,
          mode: 'full', // Use full enrichment mode for Apollo data
          force: false
        });
        
        const resultData = result.data as any;
        console.log('Apollo company enrichment results:', resultData);
        
        if (resultData.status === 'ok') {
          setSuccess('Company enhanced with Apollo data successfully!');
        } else if (resultData.status === 'error') {
          setError(resultData.message || 'Failed to enhance company with Apollo data');
        } else {
          // Handle other status types (like 'degraded')
          setSuccess(`Company enhanced: ${resultData.message || 'Success'}`);
        }
        
      } catch (enrichError: any) {
        console.error('Apollo enrichment failed:', enrichError);
        
        // Handle specific error types
        if (enrichError.code === 'functions/unavailable') {
          setError('Service temporarily unavailable. Please try again in a moment.');
        } else if (enrichError.code === 'functions/deadline-exceeded') {
          setError('Request timed out. The enhancement is still processing in the background.');
        } else if (enrichError.message?.includes('timeout')) {
          setError('Request timed out. The enhancement may still be processing.');
        } else {
          setError('Failed to enhance company with Apollo data. Please try again.');
        }
      }
      
    } catch (error) {
      console.error('Error enhancing with AI:', error);
      setError('Failed to enhance company with AI. Please try again.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleDeleteCompany = async () => {
    if (!companyId || !tenantId) return;
    
    setDeleting(true);
    try {
      // Delete the company document
      const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
      await deleteDoc(companyRef);
      
      // Navigate back to companies list
      navigate('/crm?tab=companies');
    } catch (err: any) {
      console.error('Error deleting company:', err);
      setError('Failed to delete company. Please try again.');
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error || !company) {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" minHeight="400px">
        <Typography variant="h6" color="error" gutterBottom>
          {error || 'Company not found'}
        </Typography>
        <Button variant="outlined" onClick={() => navigate('/crm?tab=companies')}>
          Back to Companies
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Breadcrumbs */}
      <Box sx={{ mb: 2 }}>
        <Breadcrumbs aria-label="breadcrumb">
          <MUILink underline="hover" color="inherit" href="/companies" onClick={(e) => { e.preventDefault(); navigate('/crm?tab=companies'); }}>
            Companies
          </MUILink>
          <Typography color="text.primary">{company?.companyName || company?.name || 'Company'}</Typography>
        </Breadcrumbs>
      </Box>
      {/* Enhanced Header - Persistent Company Information */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
            {/* Company Logo/Avatar */}
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={company.logo}
                alt={company.companyName || company.name}
                sx={{ 
                  width: 128, 
                  height: 128,
                  bgcolor: 'primary.main',
                  fontSize: '2rem',
                  fontWeight: 'bold'
                }}
              >
                {(company.companyName || company.name || 'C').charAt(0).toUpperCase()}
              </Avatar>
              <Box sx={{ 
                position: 'absolute', 
                bottom: -8, 
                right: -8, 
                display: 'flex', 
                gap: 0.5 
              }}>
                <IconButton
                  size="small"
                  sx={{
                    bgcolor: 'grey.300',
                    '&:hover': { bgcolor: 'grey.400' },
                    width: 24,
                    height: 24
                  }}
                  onClick={() => logoInputRef.current?.click()}
                >
                  <UploadIcon sx={{ fontSize: 16, color: 'grey.600' }} />
                </IconButton>
                {company.logo && (
                  <IconButton
                    size="small"
                    sx={{
                      bgcolor: 'grey.300',
                      '&:hover': { bgcolor: 'grey.400' },
                      width: 24,
                      height: 24
                    }}
                    onClick={handleDeleteLogo}
                  >
                    <DeleteIcon sx={{ fontSize: 16, color: 'grey.600' }} />
                  </IconButton>
                )}
              </Box>
            </Box>

            {/* Company Information */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                  {company.companyName || company.name}
                </Typography>
              </Box>
              {company?.pipelineValue && typeof company.pipelineValue.low === 'number' && typeof company.pipelineValue.high === 'number' && (
                <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <DealIcon sx={{ fontSize: 18, color: 'success.main' }} />
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    ${Number(company.pipelineValue.low || 0).toLocaleString()} – ${Number(company.pipelineValue.high || 0).toLocaleString()}
                  </Typography>
                </Box>
              )}

              {/* Company Stats */}
              {(company.foundedYear || company.estimatedEmployees || company.annualRevenue) && (
                <Box 
                  className="company-stats-box"
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 2, 
                    mt: 0, 
                    marginTop: 0,
                    '&.company-stats-box': {
                      marginTop: '0 !important'
                    }
                  }}
                >
                  {company.foundedYear && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Founded:</Typography>
                      <Typography variant="body2" color="text.primary">{company.foundedYear}</Typography>
                    </Box>
                  )}
                  {company.estimatedEmployees && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Employees:</Typography>
                      <Typography variant="body2" color="text.primary">{company.estimatedEmployees.toLocaleString()}</Typography>
                    </Box>
                  )}
                  {company.annualRevenue && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Revenue:</Typography>
                      <Typography variant="body2" color="text.primary">${company.annualRevenue.toLocaleString()}</Typography>
                    </Box>
                  )}
                </Box>
              )}

              {/* Industry Information */}
              {(company.industry || company.subIndustry) && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0 }}>
                  {company.industry && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Industry:</Typography>
                      <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                        {getIndustryByCode(company.industry)?.name || company.industry}
                      </Typography>
                    </Box>
                  )}
                  {company.subIndustry && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Sub-Industry:</Typography>
                      <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                        {getIndustryByCode(company.subIndustry)?.name || company.subIndustry}
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
              {/* Address */}
              {(company.address || company.city || company.state) && (
                <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <LocationIcon sx={{ fontSize: 16 }} />
                  {[
                    company.address,
                    company.city,
                    company.state,
                    company.zip
                  ].filter(Boolean).join(', ')}
                </Typography>
              )}
              
              {/* Social Media Icons */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0 }}>
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: company.website ? 'primary.main' : 'text.disabled',
                    bgcolor: company.website ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company.website ? 'primary.dark' : 'text.disabled',
                      bgcolor: company.website ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (company.website) {
                      let url = company.website;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={company.website ? 'Visit Website' : 'Add Website URL'}
                >
                  <LanguageIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: company.linkedin ? 'primary.main' : 'text.disabled',
                    bgcolor: company.linkedin ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company.linkedin ? 'primary.dark' : 'text.disabled',
                      bgcolor: company.linkedin ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (company.linkedin) {
                      let url = company.linkedin;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={company.linkedin ? 'Open LinkedIn' : 'Add LinkedIn URL'}
                >
                  <LinkedInIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: company.indeed ? 'primary.main' : 'text.disabled',
                    bgcolor: company.indeed ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company.indeed ? 'primary.dark' : 'text.disabled',
                      bgcolor: company.indeed ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (company.indeed) {
                      let url = company.indeed;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={company.indeed ? 'View Jobs on Indeed' : 'Add Indeed URL'}
                >
                  <WorkIcon sx={{ fontSize: 20 }} />
                </IconButton>
                
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: company.facebook ? 'primary.main' : 'text.disabled',
                    bgcolor: company.facebook ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company.facebook ? 'primary.dark' : 'text.disabled',
                      bgcolor: company.facebook ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (company.facebook) {
                      let url = company.facebook;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={company.facebook ? 'View Facebook Page' : 'Add Facebook URL'}
                >
                  <FacebookIcon sx={{ fontSize: 20 }} />
                </IconButton>

                {/* AngelList Icon */}
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: company.angellist ? 'primary.main' : 'text.disabled',
                    bgcolor: company.angellist ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company.angellist ? 'primary.dark' : 'text.disabled',
                      bgcolor: company.angellist ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (company.angellist) {
                      let url = company.angellist;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={company.angellist ? 'View AngelList Profile' : 'Add AngelList URL'}
                >
                  <AngelListIcon hasUrl={!!company.angellist} />
                </IconButton>

                {/* Crunchbase Icon */}
                <IconButton
                  size="small"
                  sx={{ 
                    p: 0.5,
                    color: company.crunchbase ? 'primary.main' : 'text.disabled',
                    bgcolor: company.crunchbase ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    '&:hover': {
                      color: company.crunchbase ? 'primary.dark' : 'text.disabled',
                      bgcolor: company.crunchbase ? 'primary.100' : 'transparent'
                    }
                  }}
                  onClick={() => {
                    if (company.crunchbase) {
                      let url = company.crunchbase;
                      if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                      }
                      window.open(url, '_blank');
                    }
                  }}
                  title={company.crunchbase ? 'View Crunchbase Profile' : 'Add Crunchbase URL'}
                >
                  <CrunchbaseIcon hasUrl={!!company.crunchbase} />
                </IconButton>
              </Box>

              {/* Relationship and Pipeline Status */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0, marginTop: 0 }}>
                {/* Relationship Strength */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Relationship:</Typography>
                  <Chip
                    label={contacts.length > 5 ? 'Strong' : contacts.length > 2 ? 'Medium' : 'Weak'}
                    size="small"
                    sx={{
                      bgcolor: contacts.length > 5 ? 'success.light' : contacts.length > 2 ? 'warning.light' : 'error.light',
                      color: contacts.length > 5 ? 'success.dark' : contacts.length > 2 ? 'warning.dark' : 'error.dark',
                      fontWeight: 500,
                      fontSize: '0.75rem'
                    }}
                  />
                </Box>
                
                {/* Pipeline Health */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Pipeline:</Typography>
                  <Chip
                    label={deals.length > 3 ? 'Excellent' : deals.length > 1 ? 'Good' : 'Needs Attention'}
                    size="small"
                    sx={{
                      bgcolor: deals.length > 3 ? 'success.light' : deals.length > 1 ? 'warning.light' : 'error.light',
                      color: deals.length > 3 ? 'success.dark' : deals.length > 1 ? 'warning.dark' : 'error.dark',
                      fontWeight: 500,
                      fontSize: '0.75rem'
                    }}
                  />
                </Box>
              </Box>


            </Box>
          </Box>

          {/* AI Enhance Button */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
            <Button
              variant="contained"
              startIcon={<RocketLaunchIcon />}
              onClick={handleEnhanceWithAI}
              disabled={aiLoading}
              sx={{
                bgcolor: 'primary.main',
                color: 'white',
                '&:hover': {
                  bgcolor: 'primary.dark'
                },
                '&:disabled': {
                  bgcolor: 'grey.400'
                }
              }}
            >
              {aiLoading ? 'Enhancing...' : 'AI Enhance'}
            </Button>
            {company.lastEnrichedAt && (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                Last updated: {new Date(company.lastEnrichedAt).toLocaleString()}
              </Typography>
            )}
          </Box>
        </Box>
        
        {/* Hidden file input for logo upload */}
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleLogoUpload}
        />
      </Box>

      {/* Pattern Alerts */}
      {featureFlags.patternAlerts && patternAlerts.length > 0 && (
        <Box sx={{ mb: 2 }}>
          {patternAlerts.map((alert) => (
            <Alert 
              key={alert.id}
              severity={alert.type}
              sx={{ mb: 1 }}
              action={
                alert.action && (
                  <Button 
                    color="inherit" 
                    size="small"
                    onClick={() => {
                      if (alert.action === 'View Contacts') {
                        setTabValue(2); // Switch to Contacts tab
                      } else if (alert.action === 'View Opportunities') {
                        setTabValue(3); // Switch to Opportunities tab
                      }
                    }}
                  >
                    {alert.action}
                  </Button>
                )
              }
            >
              {alert.message}
            </Alert>
          ))}
        </Box>
      )}

      {/* Collapsible Company Context Drawer */}
      <Collapse in={companyContextOpen} timeout="auto" unmountOnExit>
        <Card sx={{ mb: 3, border: '1px solid', borderColor: 'primary.main' }}>
          <CardHeader 
            title="Company Context" 
            action={
              <IconButton onClick={() => setCompanyContextOpen(false)}>
                <CloseIcon />
              </IconButton>
            }
            sx={{ p: 2, pb: 1 }}
            titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
          />
          <CardContent sx={{ p: 2, pt: 0 }}>
            <FastAssociationsCard
              entityType="company"
              entityId={company.id}
              tenantId={tenantId}
              entityName={company.companyName || company.name}
              showAssociations={{
                companies: false,
                locations: true,
                contacts: true,
                salespeople: true,
                deals: true,
                tasks: false
              }}
            />
          </CardContent>
        </Card>
      </Collapse>

      {/* Tabs Navigation */}
      <Paper elevation={1} sx={{ mb: 3, borderRadius: 0 }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
          aria-label="Company details tabs"
        >
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DashboardIcon fontSize="small" />
                Dashboard
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PlaceIcon fontSize="small" />
                Locations
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PersonIcon fontSize="small" />
                Contacts
                {/* <Badge badgeContent={contacts.length} color="primary" /> */}
              </Box>
            } 
          />
          {company.centralizedVendorProcess && (
            <Tab 
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <BusinessIcon fontSize="small" />
                  Vendor Process
                </Box>
              } 
            />
          )}
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <OpportunitiesIcon fontSize="small" />
                Opportunities
                {/* <Badge badgeContent={deals.length} color="primary" /> */}
              </Box>
            } 
          />
          {/* <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AIIcon fontSize="small" />
                Sales Coach
              </Box>
            } 
          /> */}
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <NoteIcon fontSize="small" />
                Notes
              </Box>
            } 
          />

          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CompareIcon fontSize="small" />
                Similar
              </Box>
            } 
          />

          {/* <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <SettingsIcon fontSize="small" />
                Order Defaults
              </Box>
            } 
          /> */}
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <WorkIcon fontSize="small" />
                Job Postings
                {/* <Badge badgeContent={jobPostings.length} color="primary" /> */}
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <NewspaperIcon fontSize="small" />
                News
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PersonIcon fontSize="small" />
                Decision Makers
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TimelineIcon fontSize="small" />
                Activity
              </Box>
            } 
          />
        </Tabs>
      </Paper>

      {/* Tab Panels */}
      {tabValue === 0 && (
        <CompanyDashboardTab company={company} tenantId={tenantId} contacts={contacts} deals={deals} />
      )}
      
      {tabValue === 1 && (
        <Box sx={{ mt: 0, mb: 0 }}>
          <LocationsTab company={company} currentTab={tabValue} />
        </Box>
      )}
      
      {tabValue === 2 && (
        <ContactsTab contacts={contacts} company={company} locations={[]} />
      )}
      
      {/* Conditional Vendor Process tab renders at index 3 when enabled */}
      {company.centralizedVendorProcess ? (
        <>
          {tabValue === 3 && (
            <VendorProcessTab company={company} tenantId={tenantId} />
          )}
          {tabValue === 4 && (
            <OpportunitiesTab deals={deals} company={company} locations={[]} />
          )}
        </>
      ) : (
        tabValue === 3 && (
          <OpportunitiesTab deals={deals} company={company} locations={[]} />
        )
      )}
      
      {/* Notes tab (index 5 when Vendor Process enabled, index 4 when disabled) */}
      {tabValue === (company.centralizedVendorProcess ? 5 : 4) && (
        <NotesTab company={company} tenantId={tenantId} />
      )}

      {/* Similar tab (index 6 when Vendor Process enabled, index 5 when disabled) */}
      {tabValue === (company.centralizedVendorProcess ? 6 : 5) && (
        <SimilarTab company={company} tenantId={tenantId} />
      )}

      {/* Job Postings tab (index 7 when Vendor Process enabled, index 6 when disabled) */}
      {tabValue === (company.centralizedVendorProcess ? 7 : 6) && (
        <IndeedJobsTab company={company} jobPostings={jobPostings} setJobPostings={setJobPostings} jobsLoading={jobsLoading} setJobsLoading={setJobsLoading} />
      )}

      {/* News tab (index 8 when Vendor Process enabled, index 7 when disabled) */}
      {tabValue === (company.centralizedVendorProcess ? 8 : 7) && (
        <NewsTab company={company} />
      )}

      {/* Decision Makers tab (index 9 when Vendor Process enabled, index 8 when disabled) */}
      {tabValue === (company.centralizedVendorProcess ? 9 : 8) && (
        <DecisionMakersPanel 
          companyName={company.companyName || company.name}
          companyId={company.id}
          tenantId={tenantId}
        />
      )}

      {/* Activity tab (index 10 when Vendor Process enabled, index 9 when disabled) */}
      {tabValue === (company.centralizedVendorProcess ? 10 : 9) && (
        <CompanyActivityTab company={company} tenantId={tenantId} />
      )}

      {/* Delete Company Button - Bottom of page */}
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'center', 
        mt: 9,
        pb: 3 
      }}>
        <Button 
          variant="outlined" 
          color="error"
          sx={{ 
            borderColor: 'error.main',
            '&:hover': {
              borderColor: 'error.dark',
              backgroundColor: 'error.light'
            }
          }}
          startIcon={<DeleteIcon />}
          onClick={() => setDeleteDialogOpen(true)}
        >
          Delete Company
        </Button>
      </Box>

      {/* Success/Error Snackbars */}
      <Snackbar open={!!success} autoHideDuration={4000} onClose={() => setSuccess(null)}>
        <Alert severity="success" onClose={() => setSuccess(null)} sx={{ width: '100%' }}>
          {success}
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <DialogTitle id="delete-dialog-title">Confirm Deletion</DialogTitle>
        <DialogContent>
          <Typography id="delete-dialog-description">
            Are you sure you want to delete this company? This action cannot be undone and will also delete all associated contacts, deals, and locations.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} color="primary">
            Cancel
          </Button>
          <Button onClick={handleDeleteCompany} color="error" variant="contained" disabled={deleting}>
            {deleting ? <CircularProgress size={24} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

// Recent Activity Widget for Dashboard
const RecentActivityWidget: React.FC<{ company: any; tenantId: string }> = ({ company, tenantId }) => {
  const [items, setItems] = useState<CompanyActivityItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const load = async () => {
      if (!company?.id || !tenantId) return;
      setLoading(true);
      try {
        const companyId: string = company.id;
        const contactIds: string[] = Array.isArray(company.associations?.contacts) ? company.associations.contacts : [];
        const dealIds: string[] = Array.isArray(company.associations?.deals) ? company.associations.deals : [];

        const aggregated: CompanyActivityItem[] = [];

        // Tasks: completed tasks associated to this company
        try {
          const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
          const tq = query(
            tasksRef,
            where('associations.companies', 'array-contains', companyId),
            where('status', '==', 'completed'),
            orderBy('updatedAt', 'desc'),
            limit(5)
          );
          const ts = await getDocs(tq);
          ts.forEach((docSnap) => {
            const d = docSnap.data() as any;
            aggregated.push({
              id: `task_${docSnap.id}`,
              type: 'task',
              timestamp: d.completedAt ? new Date(d.completedAt) : (d.updatedAt?.toDate?.() || new Date()),
              title: d.title || 'Task completed',
              description: d.description || '',
              metadata: { priority: d.priority, taskType: d.type }
            });
          });
        } catch {}

        // Notes: company + contact + deal notes
        const notesScopes = [
          { coll: 'company_notes', ids: [companyId] },
          { coll: 'contact_notes', ids: contactIds },
          { coll: 'deal_notes', ids: dealIds },
        ];
        for (const scope of notesScopes) {
          for (const id of scope.ids) {
            try {
              const notesRef = collection(db, 'tenants', tenantId, scope.coll);
              const nq = query(notesRef, where('entityId', '==', id), orderBy('timestamp', 'desc'), limit(5));
              const ns = await getDocs(nq);
              ns.forEach((docSnap) => {
                const d = docSnap.data() as any;
                aggregated.push({
                  id: `note_${scope.coll}_${docSnap.id}`,
                  type: 'note',
                  timestamp: d.timestamp?.toDate?.() || new Date(),
                  title: d.category ? `Note (${d.category})` : 'Note',
                  description: d.content,
                  metadata: { authorName: d.authorName, priority: d.priority, source: d.source }
                });
              });
            } catch {}
          }
        }

        // Deal stage progression
        for (const dealId of dealIds) {
          try {
            const stageRef = collection(db, 'tenants', tenantId, 'crm_deals', dealId, 'stage_history');
            const sq = query(stageRef, orderBy('timestamp', 'desc'), limit(5));
            const ss = await getDocs(sq);
            ss.forEach((docSnap) => {
              const d = docSnap.data() as any;
              aggregated.push({
                id: `dealstage_${dealId}_${docSnap.id}`,
                type: 'deal_stage',
                timestamp: d.timestamp?.toDate?.() || new Date(),
                title: `Deal stage: ${d.fromStage || '?'} → ${d.toStage || d.stage || '?'}`,
                description: d.reason || 'Stage updated',
                metadata: { dealId }
              });
            });
          } catch {}
        }

        // Sort by timestamp and take the most recent 5
        aggregated.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        setItems(aggregated.slice(0, 5));
      } catch (error) {
        console.error('Error loading recent activity:', error);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [company?.id, tenantId]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Skeleton variant="rectangular" height={32} />
        <Skeleton variant="rectangular" height={32} />
        <Skeleton variant="rectangular" height={32} />
      </Box>
    );
  }

  if (items.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 2 }}>
        <Typography variant="body2" color="text.secondary">
          No recent activity
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Activities will appear here as they occur
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map((item) => (
        <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1 }}>
          <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem' }}>
            {item.type === 'task' && <EventIcon sx={{ fontSize: 16 }} />}
            {item.type === 'note' && <NoteIcon sx={{ fontSize: 16 }} />}
            {item.type === 'deal_stage' && <DealIcon sx={{ fontSize: 16 }} />}
            {item.type === 'email' && <EmailIcon sx={{ fontSize: 16 }} />}
          </Avatar>
          <Typography variant="body2" fontSize="0.75rem">
            {item.title}
          </Typography>
        </Box>
      ))}
    </Box>
  );
};

// Aggregated activity across company, its contacts, and its deals
const CompanyActivityTab: React.FC<{ company: any; tenantId: string }> = ({ company, tenantId }) => {
  const [items, setItems] = useState<CompanyActivityItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  // Filters
  const [typeFilter, setTypeFilter] = useState<'all' | 'task' | 'note' | 'deal_stage' | 'email'>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  // Pagination
  const PAGE_SIZE = 25;
  const [page, setPage] = useState<number>(1);

  useEffect(() => {
    const load = async () => {
      if (!company?.id || !tenantId) return;
      setLoading(true);
      setError('');
      try {
        const companyId: string = company.id;
        const contactIds: string[] = Array.isArray(company.associations?.contacts) ? company.associations.contacts : [];
        const dealIds: string[] = Array.isArray(company.associations?.deals) ? company.associations.deals : [];

        const aggregated: CompanyActivityItem[] = [];

        // Tasks: completed tasks associated to this company
        try {
          const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
          const tq = query(
            tasksRef,
            where('associations.companies', 'array-contains', companyId),
            where('status', '==', 'completed'),
            orderBy('updatedAt', 'desc'),
            limit(200)
          );
          const ts = await getDocs(tq);
          ts.forEach((docSnap) => {
            const d = docSnap.data() as any;
            aggregated.push({
              id: `task_${docSnap.id}`,
              type: 'task',
              timestamp: d.completedAt ? new Date(d.completedAt) : (d.updatedAt?.toDate?.() || new Date()),
              title: d.title || 'Task completed',
              description: d.description || '',
              metadata: { priority: d.priority, taskType: d.type }
            });
          });
        } catch {}

        // Notes: company + contact + deal notes
        const notesScopes = [
          { coll: 'company_notes', ids: [companyId] },
          { coll: 'contact_notes', ids: contactIds },
          { coll: 'deal_notes', ids: dealIds },
        ];
        for (const scope of notesScopes) {
          for (const id of scope.ids) {
            try {
              const notesRef = collection(db, 'tenants', tenantId, scope.coll);
              const nq = query(notesRef, where('entityId', '==', id), orderBy('timestamp', 'desc'), limit(200));
              const ns = await getDocs(nq);
              ns.forEach((docSnap) => {
                const d = docSnap.data() as any;
                aggregated.push({
                  id: `note_${scope.coll}_${docSnap.id}`,
                  type: 'note',
                  timestamp: d.timestamp?.toDate?.() || new Date(),
                  title: d.category ? `Note (${d.category})` : 'Note',
                  description: d.content,
                  metadata: { authorName: d.authorName, priority: d.priority, source: d.source }
                });
              });
            } catch {}
          }
        }

        // Deal stage progression: subcollection stage_history under each deal
        for (const dealId of dealIds) {
          try {
            const stageRef = collection(db, 'tenants', tenantId, 'crm_deals', dealId, 'stage_history');
            const sq = query(stageRef, orderBy('timestamp', 'desc'), limit(100));
            const ss = await getDocs(sq);
            ss.forEach((docSnap) => {
              const d = docSnap.data() as any;
              aggregated.push({
                id: `dealstage_${dealId}_${docSnap.id}`,
                type: 'deal_stage',
                timestamp: d.timestamp?.toDate?.() || new Date(),
                title: `Deal stage: ${d.fromStage || '?'} → ${d.toStage || d.stage || '?'}`,
                description: d.reason || 'Stage updated',
                metadata: { dealId }
              });
            });
          } catch {}
        }

        // Emails: email_logs filtered by companyId and by each contactId
        try {
          const emailsRef = collection(db, 'tenants', tenantId, 'email_logs');
          const cq = query(emailsRef, where('companyId', '==', companyId), orderBy('timestamp', 'desc'), limit(200));
          const cs = await getDocs(cq);
          cs.forEach((docSnap) => {
            const d = docSnap.data() as any;
            aggregated.push({
              id: `email_company_${docSnap.id}`,
              type: 'email',
              timestamp: d.timestamp?.toDate?.() || new Date(),
              title: `Email: ${d.subject || '(no subject)'}`,
              description: d.bodySnippet,
              metadata: { from: d.from, to: d.to, direction: d.direction }
            });
          });
          for (const contactId of contactIds) {
            try {
              const cq2 = query(emailsRef, where('contactId', '==', contactId), orderBy('timestamp', 'desc'), limit(200));
              const cs2 = await getDocs(cq2);
              cs2.forEach((docSnap) => {
                const d = docSnap.data() as any;
                aggregated.push({
                  id: `email_contact_${contactId}_${docSnap.id}`,
                  type: 'email',
                  timestamp: d.timestamp?.toDate?.() || new Date(),
                  title: `Email: ${d.subject || '(no subject)'}`,
                  description: d.bodySnippet,
                  metadata: { from: d.from, to: d.to, direction: d.direction }
                });
              });
            } catch {}
          }
        } catch {}

        // Sort newest first
        aggregated.sort((a, b) => (b.timestamp?.getTime?.() || 0) - (a.timestamp?.getTime?.() || 0));
        setItems(aggregated);
        setPage(1);
      } catch (e: any) {
        setError(e?.message || 'Failed to load activity');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [company?.id, tenantId]);

  // Derived list after filters
  const filtered = items.filter((it) => {
    if (typeFilter !== 'all' && it.type !== typeFilter) return false;
    if (startDate) {
      const s = new Date(startDate + 'T00:00:00');
      if (it.timestamp < s) return false;
    }
    if (endDate) {
      const e = new Date(endDate + 'T23:59:59');
      if (it.timestamp > e) return false;
    }
    return true;
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Box>
      <Card>
        <CardHeader title={(<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><TimelineIcon /><Typography variant="h6">Company Activity</Typography></Box>)} />
        <CardContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {/* Filters */}
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Type</InputLabel>
              <Select value={typeFilter} label="Type" onChange={(e) => { setTypeFilter(e.target.value as any); setPage(1); }}>
                <MenuItem value="all">All</MenuItem>
                <MenuItem value="task">Tasks</MenuItem>
                <MenuItem value="note">Notes</MenuItem>
                <MenuItem value="deal_stage">Deal Stages</MenuItem>
                <MenuItem value="email">Emails</MenuItem>
              </Select>
            </FormControl>
            <TextField
              type="date"
              size="small"
              label="Start"
              InputLabelProps={{ shrink: true }}
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            />
            <TextField
              type="date"
              size="small"
              label="End"
              InputLabelProps={{ shrink: true }}
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            />
            <Box sx={{ flex: 1 }} />
            <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
              {total} results
            </Typography>
          </Box>
          {loading ? (
            <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
          ) : filtered.length === 0 ? (
            <Box textAlign="center" py={4}>
              <Typography color="text.secondary">No activity yet.</Typography>
              <Typography variant="caption" color="text.secondary">Completed tasks, notes, deal stage changes, and emails will appear here.</Typography>
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Type</TableCell>
                    <TableCell>Title</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell>When</TableCell>
                    <TableCell align="right">Link</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageItems.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell><Chip size="small" label={it.type.replace('_', ' ')} /></TableCell>
                      <TableCell><Typography variant="body2">{it.title}</Typography></TableCell>
                      <TableCell><Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>{it.description}</Typography></TableCell>
                      <TableCell><Typography variant="caption" color="text.secondary">{it.timestamp?.toLocaleString?.()}</Typography></TableCell>
                      <TableCell align="right">
                        <LinkForActivity it={it} tenantId={tenantId} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {/* Pagination */}
          {filtered.length > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
              <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
              <Typography variant="caption">Page {page} of {totalPages}</Typography>
              <Button size="small" variant="outlined" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

// Render link to originating record: deals or contacts; fallback to company
const LinkForActivity: React.FC<{ it: CompanyActivityItem; tenantId: string }> = ({ it, tenantId }) => {
  // Basic heuristics using metadata: for deal_stage use metadata.dealId; for email prefer metadata.dealId else first contact; for task/note no direct id unless captured – link to company as fallback
  let href: string | null = null;
  let label = 'Open';
  if (it.type === 'deal_stage' && it.metadata?.dealId) {
    href = `/crm/deals/${it.metadata.dealId}`;
    label = 'View Deal';
  } else if (it.type === 'email') {
    const dealId = it.metadata?.dealId;
    const contactId = Array.isArray(it.metadata?.contacts) ? it.metadata.contacts[0] : it.metadata?.contactId;
    if (dealId) {
      href = `/crm/deals/${dealId}`;
      label = 'View Deal';
    } else if (contactId) {
      href = `/crm/contacts/${contactId}`;
      label = 'View Contact';
    }
  }
  if (!href) {
    href = `/crm/companies/${(it as any).companyId || ''}`;
    label = 'View Company';
  }
  return (
    <Button size="small" href={href} target="_self" variant="text">{label}</Button>
  );
};

// Reusable SectionCard helper to standardize headings and spacing (no border/shadow changes)
const SectionCard: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({ title, action, children }) => (
  <Card sx={{ mb: 3 }}>
    <CardHeader title={title} action={action} titleTypographyProps={{ variant: 'h6' }} sx={{ pb: 0 }} />
    <CardContent sx={{ pt: 2 }}>{children}</CardContent>
  </Card>
);

// Tab Components
const CompanyDashboardTab: React.FC<{ company: any; tenantId: string; contacts: any[]; deals: any[] }> = ({ company, tenantId, contacts, deals }) => {
  const [aiComponentsLoaded, setAiComponentsLoaded] = useState(false);
  const [rebuildingActive, setRebuildingActive] = useState(false);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const navigate = useNavigate();
  // Local helper: URL protocol enforcement
  const ensureUrlProtocol = (url: string): string => {
    if (!url) return url as any;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return 'https://' + url;
  };
  // Local helper: update a single company field
  const updateCompanyField = async (field: string, value: any) => {
    try {
      let processed = value;
      if (['website', 'linkedin', 'indeed', 'facebook'].includes(field) && value) {
        processed = ensureUrlProtocol(value as string);
      }
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id), { [field]: processed });
    } catch (e) {
      console.error('Error updating company field', field, e);
    }
  };

  // Lazy load AI components
  useEffect(() => {
    const timer = setTimeout(() => {
      setAiComponentsLoaded(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const calculateCompanyMetrics = () => {
    const totalRevenue = deals.reduce((sum, deal) => {
      const revenue = deal.expectedRevenue || 0;
      return sum + revenue;
    }, 0);

    const activeDeals = deals.filter(deal => deal.stage !== 'closed_won' && deal.stage !== 'closed_lost').length;
    const wonDeals = deals.filter(deal => deal.stage === 'closed_won').length;

    return {
      totalRevenue: totalRevenue.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
      activeDeals,
      wonDeals,
      totalContacts: contacts.length
    };
  };

  // AI Company Insights
  const generateCompanyInsights = () => {
    const insights = [];
    
    // Revenue analysis
    const totalRevenue = deals.reduce((sum, deal) => sum + (deal.expectedRevenue || 0), 0);
    if (totalRevenue > 100000) {
      insights.push({ type: 'success', message: 'High-value client with significant revenue potential' });
    } else if (totalRevenue > 50000) {
      insights.push({ type: 'info', message: 'Medium-value client with good growth potential' });
    } else {
      insights.push({ type: 'warning', message: 'Low revenue - consider upselling opportunities' });
    }

    // Deal velocity analysis
    const recentDeals = deals.filter(deal => {
      const dealDate = deal.createdAt?.toDate?.() || new Date(deal.createdAt);
      return dealDate > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // Last 90 days
    });
    if (recentDeals.length > 3) {
      insights.push({ type: 'success', message: 'High deal velocity - active engagement' });
    } else if (recentDeals.length === 0) {
      insights.push({ type: 'warning', message: 'No recent deals - re-engagement needed' });
    }

    // Contact depth analysis
    if (contacts.length > 5) {
      insights.push({ type: 'success', message: 'Strong contact network established' });
    } else if (contacts.length === 0) {
      insights.push({ type: 'error', message: 'No contacts - critical gap to address' });
    }

    return insights;
  };

  // Relationship mapping data
  const generateRelationshipMap = () => {
    const relationships = [];
    
    // Company to contacts relationships
    contacts.forEach(contact => {
      relationships.push({
        source: company.companyName || company.name,
        target: `${contact.firstName} ${contact.lastName}`,
        type: 'contact',
        strength: contact.title?.toLowerCase().includes('ceo') || contact.title?.toLowerCase().includes('president') ? 'strong' : 'medium'
      });
    });

    // Company to deals relationships
    deals.forEach(deal => {
      relationships.push({
        source: company.companyName || company.name,
        target: deal.name,
        type: 'deal',
        strength: deal.expectedRevenue > 50000 ? 'strong' : 'medium'
      });
    });

    return relationships;
  };

  // Pipeline insights
  const generatePipelineInsights = () => {
    const pipelineData = {
      totalDeals: deals.length,
      activeDeals: deals.filter(deal => deal.stage !== 'closed_won' && deal.stage !== 'closed_lost').length,
      wonDeals: deals.filter(deal => deal.stage === 'closed_won').length,
      totalValue: deals.reduce((sum, deal) => sum + (deal.expectedRevenue || 0), 0),
      averageDealSize: deals.length > 0 ? deals.reduce((sum, deal) => sum + (deal.expectedRevenue || 0), 0) / deals.length : 0,
      winRate: deals.length > 0 ? (deals.filter(deal => deal.stage === 'closed_won').length / deals.length) * 100 : 0
    };

    return pipelineData;
  };

  const metrics = calculateCompanyMetrics();
  const insights = generateCompanyInsights();
  const relationships = generateRelationshipMap();
  const pipelineData = generatePipelineInsights();

  // Enrichment UI state
  const [enrichingFull, setEnrichingFull] = useState(false);
  const [enrichingMeta, setEnrichingMeta] = useState(false);
  const [enrichToastOpen, setEnrichToastOpen] = useState(false);
  const [enrichToastMsg, setEnrichToastMsg] = useState('');
  const [enrichToastError, setEnrichToastError] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState<string>('');

  return (
      <Grid container spacing={3}>
      {/* Left Column - Action Focused */}
      <Grid item xs={12} md={4}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>


          {/* Company Description Widget */}
          <Box sx={{ 
            '& .MuiPaper-root.MuiCard-root': {
              marginBottom: 0
            }
          }}>
            <SectionCard title="Company Description">
              {company.shortDescription || company.description ? (
                <Typography variant="body2" color="text.primary" sx={{ lineHeight: 1.6 }}>
                  {company.shortDescription || company.description}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  No company description available. Use AI Enhance to generate one.
                </Typography>
              )}
            </SectionCard>
          </Box>

          {/* Company Details (Widget) */}
          <Box sx={{ mb: 0 }}>
            <SectionCard title="Company Details">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  label="Company Name"
                  defaultValue={company.companyName || company.name || ''}
                  onBlur={(e) => updateCompanyField('companyName', e.target.value)}
                  size="small"
                  fullWidth
                />

                <FormControlLabel
                  control={
                    <Checkbox
                      checked={!!company.centralizedVendorProcess}
                      onChange={(e) => updateCompanyField('centralizedVendorProcess', e.target.checked)}
                      size="small"
                    />
                  }
                  label="Centralized Vendor Process"
                />
                <TextField
                  label="Website URL"
                  defaultValue={company.website || ''}
                  onBlur={(e) => updateCompanyField('website', e.target.value)}
                  size="small"
                  fullWidth
                  InputProps={{ startAdornment: <LanguageIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                />

                <TextField
                  label="Corporate Phone Number"
                  defaultValue={company.phone || ''}
                  onBlur={(e) => updateCompanyField('phone', e.target.value)}
                  size="small"
                  fullWidth
                  InputProps={{ startAdornment: <PhoneIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                />

                <TextField
                  label="LinkedIn URL"
                  defaultValue={company.linkedin || ''}
                  onBlur={(e) => updateCompanyField('linkedin', e.target.value)}
                  size="small"
                  fullWidth
                  InputProps={{ startAdornment: <LinkedInIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                />

                <TextField
                  label="Indeed Company URL"
                  defaultValue={company.indeed || ''}
                  onBlur={(e) => updateCompanyField('indeed', e.target.value)}
                  size="small"
                  fullWidth
                  InputProps={{ startAdornment: <WorkIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                />

                <TextField
                  label="Facebook Page URL"
                  defaultValue={company.facebook || ''}
                  onBlur={(e) => updateCompanyField('facebook', e.target.value)}
                  size="small"
                  fullWidth
                  InputProps={{ startAdornment: <FacebookIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                />

                <TextField
                  label="Twitter URL"
                  defaultValue={company.twitter || ''}
                  onBlur={(e) => updateCompanyField('twitter', e.target.value)}
                  size="small"
                  fullWidth
                  InputProps={{ startAdornment: <TwitterIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} /> }}
                />

                <TextField
                  label="AngelList URL"
                  defaultValue={company.angellist || ''}
                  onBlur={(e) => updateCompanyField('angellist', e.target.value)}
                  size="small"
                  fullWidth
                  InputProps={{ startAdornment: <AngelListIcon hasUrl={!!company.angellist} /> }}
                />

                <TextField
                  label="Crunchbase URL"
                  defaultValue={company.crunchbase || ''}
                  onBlur={(e) => updateCompanyField('crunchbase', e.target.value)}
                  size="small"
                  fullWidth
                  InputProps={{ startAdornment: <CrunchbaseIcon hasUrl={!!company.crunchbase} /> }}
                />

                <TextField
                  label="Founded Year"
                  defaultValue={company.foundedYear || ''}
                  onBlur={(e) => updateCompanyField('foundedYear', e.target.value)}
                  size="small"
                  fullWidth
                />

                <TextField
                  label="Estimated Employees"
                  defaultValue={company.estimatedEmployees || ''}
                  onBlur={(e) => updateCompanyField('estimatedEmployees', e.target.value)}
                  size="small"
                  fullWidth
                />

                <TextField
                  label="Annual Revenue ($)"
                  defaultValue={company.annualRevenue || ''}
                  onBlur={(e) => updateCompanyField('annualRevenue', e.target.value)}
                  size="small"
                  fullWidth
                />



                <IndustrySelector
                  value={company.industry || ''}
                  onChange={async (industryCode) => {
                    await updateCompanyField('industry', industryCode);
                    // Always clear subIndustry when primary changes
                    await updateCompanyField('subIndustry', '');
                  }}
                  label="Industry"
                  variant="select"
                  showCategory={false}
                />

                <FormControl fullWidth size="small" disabled={!company.industry}>
                  <InputLabel>Sub-Industry</InputLabel>
                  <Select
                    value={(company.subIndustry && getSubIndustries(company.industry).some(si => si.code === company.subIndustry)) ? company.subIndustry : ''}
                    label="Sub-Industry"
                    onChange={(e) => updateCompanyField('subIndustry', e.target.value)}
                  >
                    <MenuItem value="">
                      <em>Select a sub-industry</em>
                    </MenuItem>
                    {(() => {
                      const subIndustries = company.industry ? getSubIndustries(company.industry) : [];
                      return subIndustries.map((industry) => (
                        <MenuItem key={industry.code} value={industry.code}>
                          <Box>
                            <Typography variant="body2">{industry.name}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {industry.code}
                            </Typography>
                          </Box>
                        </MenuItem>
                      ));
                    })()}
                  </Select>
                  <FormHelperText>
                    {company.industry 
                      ? `Select a more specific industry classification (${getSubIndustries(company.industry).length} options available)`
                      : 'Select a more specific industry classification'}
                  </FormHelperText>
                </FormControl>

                {/* Tags field hidden per request */}
                {/* <Autocomplete
                  multiple
                  freeSolo
                  options={[]}
                  value={company.tags || []}
                  onChange={(event, newValue) => updateCompanyField('tags', newValue)}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => {
                      const tagProps = getTagProps({ index });
                      const { key, ...otherProps } = tagProps as any;
                      return (
                        <Chip
                          key={key}
                          variant="outlined"
                          label={option}
                          {...otherProps}
                          size="small"
                        />
                      );
                    })
                  }
                  renderInput={(params) => (
                    <TextField
                      {...(params as any)}
                      label="Tags"
                      size="small"
                      placeholder="Add tags..."
                    />
                  )}
                /> */}
               </Box>
            </SectionCard>
          </Box>
          {/* Recent Contacts moved to right column below Recent Activity */}


        </Box>
      </Grid>

      {/* Center Column - Company Intelligence */}
      <Grid item xs={12} md={5}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Company Intelligence - Hidden since metrics moved to header */}
          {/* <Card>
            <CardHeader 
              title="Company Intelligence" 
              action={
                <IconButton size="small">
                  <AIIcon sx={{ fontSize: 16 }} />
                </IconButton>
              }
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
            />
            <CardContent sx={{ p: 2 }}>
              {aiComponentsLoaded ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" fontWeight="bold" sx={{ mb: 1 }}>
                      AI Insights
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {insights.slice(0, 3).map((insight, index) => (
                        <Box key={index} sx={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 1, 
                          p: 1, 
                          borderRadius: 1, 
                          bgcolor: insight.type === 'success' ? 'success.50' : 
                                   insight.type === 'warning' ? 'warning.50' : 
                                   insight.type === 'error' ? 'error.50' : 'info.50',
                          border: '1px solid',
                          borderColor: insight.type === 'success' ? 'success.200' : 
                                      insight.type === 'warning' ? 'warning.200' : 
                                      insight.type === 'error' ? 'error.200' : 'info.200'
                        }}>
                          <Box sx={{ 
                            width: 8, 
                            height: 8, 
                            borderRadius: '50%', 
                            bgcolor: insight.type === 'success' ? 'success.main' : 
                                    insight.type === 'warning' ? 'warning.main' : 
                                    insight.type === 'error' ? 'error.main' : 'info.main' 
                          }} />
                          <Typography variant="caption" fontSize="0.75rem">
                            {insight.message}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">Relationship Strength</Typography>
                    <Chip 
                      label={relationships.length > 5 ? 'Strong' : relationships.length > 2 ? 'Medium' : 'Weak'} 
                      color={relationships.length > 5 ? 'success' : relationships.length > 2 ? 'warning' : 'error'} 
                      size="small" 
                    />
                  </Box>

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">Pipeline Health</Typography>
                    <Chip 
                      label={pipelineData.winRate > 60 ? 'Excellent' : pipelineData.winRate > 40 ? 'Good' : 'Needs Attention'} 
                      color={pipelineData.winRate > 60 ? 'success' : pipelineData.winRate > 40 ? 'warning' : 'error'} 
                      size="small" 
                    />
                  </Box>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Skeleton variant="rectangular" height={24} />
                  <Skeleton variant="rectangular" height={24} />
                  <Skeleton variant="rectangular" height={24} />
                </Box>
              )}
            </CardContent>
          </Card> */}



          {/* AI Enrichment – hidden per request */}
          {/* <AIEnrichmentWidget company={company} tenantId={tenantId} /> */}

          {/* Company Details (Widget) moved to left column */}

          {/* Sales Coach */}
          <Card>
            <CardHeader 
              title="Sales Coach" 
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
              action={
                <IconButton size="small" onClick={() => {
                  // This will trigger a new conversation in the SalesCoach component
                  const event = new CustomEvent('startNewSalesCoachConversation', {
                    detail: { entityId: company.id }
                  });
                  window.dispatchEvent(event);
                }}>
                  <AddIcon />
                </IconButton>
              }
            />
            <CardContent sx={{ p: 0, pt: 0 }}>
              <Box sx={{ height: 650 }}>
                <SalesCoach 
                  entityType="company"
                  entityId={company.id}
                  entityName={company.companyName || company.name}
                  tenantId={tenantId}
                  associations={{
                    companies: [],
                    contacts: contacts,
                    deals: deals,
                    salespeople: [],
                    locations: []
                  }}
                />
              </Box>
            </CardContent>
          </Card>

          {/* Relationship Map - Moved from right column */}
          <Card>
            <CardHeader 
              title="Relationship Map" 
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
              action={<IconButton size="small"><AIIcon sx={{ fontSize: 16 }} /></IconButton>}
            />
            <CardContent sx={{ p: 2 }}>
              {aiComponentsLoaded ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Company Node */}
                  <Box sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 1, 
                    p: 1, 
                    bgcolor: 'primary.50', 
                    borderRadius: 1, 
                    border: '2px solid',
                    borderColor: 'primary.main'
                  }}>
                    <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem', bgcolor: 'primary.main' }}>
                      {company.companyName?.charAt(0) || company.name?.charAt(0) || 'C'}
                    </Avatar>
                    <Typography variant="body2" fontWeight="bold" fontSize="0.75rem">
                      {company.companyName || company.name}
                    </Typography>
                  </Box>

                  {/* Connection Lines */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pl: 2 }}>
                    {relationships.slice(0, 4).map((rel, index) => (
                      <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ 
                          width: 1, 
                          height: 20, 
                          bgcolor: rel.strength === 'strong' ? 'success.main' : 'warning.main',
                          borderRadius: 0.5
                        }} />
                        <Box sx={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 0.5, 
                          p: 0.5, 
                          bgcolor: 'grey.50', 
                          borderRadius: 0.5,
                          flex: 1
                        }}>
                          <Avatar sx={{ width: 16, height: 16, fontSize: '0.625rem' }}>
                            {rel.type === 'contact' ? <PersonIcon sx={{ fontSize: 12 }} /> : <DealIcon sx={{ fontSize: 12 }} />}
                          </Avatar>
                          <Typography variant="caption" fontSize="0.625rem" sx={{ flex: 1 }}>
                            {rel.target.length > 15 ? rel.target.substring(0, 15) + '...' : rel.target}
                          </Typography>
                          <Chip 
                            label={rel.strength} 
                            size="small" 
                            color={rel.strength === 'strong' ? 'success' : 'warning'}
                            sx={{ height: 16, fontSize: '0.625rem' }}
                          />
                        </Box>
                      </Box>
                    ))}
                  </Box>

                  {relationships.length > 4 && (
                    <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
                      +{relationships.length - 4} more relationships
                    </Typography>
                  )}
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Skeleton variant="rectangular" height={32} />
                  <Skeleton variant="rectangular" height={24} />
                  <Skeleton variant="rectangular" height={24} />
                  <Skeleton variant="rectangular" height={24} />
                </Box>
              )}
            </CardContent>
          </Card>

          {/* Suggested by AI - Moved below Relationship Map */}
          <Card>
            <CardHeader 
              title="Suggested by AI" 
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
            />
            <CardContent sx={{ p: 2 }}>
              {aiComponentsLoaded ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Button variant="outlined" size="small" fullWidth sx={{ justifyContent: 'flex-start' }}>
                    Research company growth opportunities
                  </Button>
                  <Button variant="outlined" size="small" fullWidth sx={{ justifyContent: 'flex-start' }}>
                    Identify key decision makers
                  </Button>
                  <Button variant="outlined" size="small" fullWidth sx={{ justifyContent: 'flex-start' }}>
                    Analyze competitor landscape
                  </Button>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Skeleton variant="rectangular" height={32} />
                  <Skeleton variant="rectangular" height={32} />
                  <Skeleton variant="rectangular" height={32} />
                </Box>
              )}
            </CardContent>
          </Card>
        </Box>
      </Grid>

      {/* Right Column - Recent Activity + Active Salespeople + Opportunities */}
      <Grid item xs={12} md={3}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Recent Activity - Moved to top of right column */}
          <Card>
            <CardHeader 
              title="Recent Activity" 
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
            />
            <CardContent sx={{ p: 2 }}>
              <RecentActivityWidget company={company} tenantId={tenantId} />
            </CardContent>
          </Card>

          {/* Active Salespeople */}
          <Card>
            <CardHeader 
              title="Active Salespeople" 
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
              action={
                <Button size="small" disabled={rebuildingActive} onClick={async () => {
                  try {
                    setRebuildingActive(true);
                    // eslint-disable-next-line no-console
                    console.log('Rebuild active salespeople – calling', { tenantId, companyId: company.id });
                    const fn = httpsCallable(functions, 'rebuildCompanyActiveSalespeople');
                    const resp: any = await fn({ tenantId, companyId: company.id });
                    // eslint-disable-next-line no-console
                    console.log('Rebuild active salespeople – response', resp, resp?.data);
                    const data = resp?.data || {};
                    if (data.ok) {
                      setLocalSuccess(`Active salespeople updated (${data.count ?? data.updated ?? 0})`);
                    } else if (data.error) {
                      setLocalError(`Rebuild failed: ${data.error}`);
                    } else {
                      setLocalSuccess('Rebuild requested');
                    }
                    // Light refresh (no state wire-in here, but triggers firestore listener paths elsewhere)
                    try {
                      await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id));
                    } catch {}
                  } catch (e) {
                    // eslint-disable-next-line no-console
                    console.error('Rebuild active salespeople – error', e);
                    setLocalError('Failed to rebuild active salespeople');
                  } finally {
                    setRebuildingActive(false);
                  }
                }}>{rebuildingActive ? 'Rebuilding…' : 'Rebuild'}</Button>
              }
            />
            <CardContent sx={{ p: 2 }}>
              {company?.activeSalespeople && Object.keys(company.activeSalespeople).length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {Object.values(company.activeSalespeople as any)
                    .sort((a: any, b: any) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))
                    .slice(0, 5)
                    .map((sp: any) => (
                      <Box key={sp.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50' }}>
                        <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>
                          {(sp.displayName || sp.firstName || 'S').charAt(0)}
                        </Avatar>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" fontWeight="medium">
                            {sp.displayName || `${sp.firstName || ''} ${sp.lastName || ''}`.trim() || sp.email || 'Unknown'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {sp.jobTitle || sp.department || ''}
                          </Typography>
                        </Box>
                        {/* Date removed per request */}
                      </Box>
                    ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">No recent salesperson activity</Typography>
              )}
            </CardContent>
          </Card>

          {/* Opportunities - Moved from center column */}
          <Card>
            <CardHeader 
              title="Opportunities" 
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
            />
            <CardContent sx={{ p: 2 }}>
              {deals && deals.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {deals
                    .sort((a: any, b: any) => (b.expectedRevenue || 0) - (a.expectedRevenue || 0))
                    .slice(0, 5)
                    .map((deal: any) => {
                      const calculateExpectedRevenueRange = (deal: any) => {
                        // First check if we have qualification stage data for calculated ranges
                        if (deal.stageData?.qualification) {
                          const qualData = deal.stageData.qualification;
                          const payRate = qualData.expectedAveragePayRate || 16;
                          const markup = qualData.expectedAverageMarkup || 40;
                          const timeline = qualData.staffPlacementTimeline;

                          if (timeline) {
                            // Calculate bill rate: pay rate + markup
                            const billRate = payRate * (1 + markup / 100);
                            
                            // Annual hours per employee (2080 full-time hours)
                            const annualHoursPerEmployee = 2080;
                            
                            // Calculate annual revenue per employee
                            const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
                            
                            // Get starting and 180-day numbers
                            const startingCount = timeline.starting || 0;
                            const after180DaysCount = timeline.after180Days || timeline.after90Days || timeline.after30Days || startingCount;
                            
                            if (startingCount > 0 || after180DaysCount > 0) {
                              // Calculate revenue range
                              const minRevenue = annualRevenuePerEmployee * startingCount;
                              const maxRevenue = annualRevenuePerEmployee * after180DaysCount;
                              
                              return `$${minRevenue.toLocaleString()} - $${maxRevenue.toLocaleString()}`;
                            }
                          }
                        }
                        
                        // Fallback to estimatedRevenue if qualification data is not available
                        if (deal.expectedRevenue) {
                          const revenue = deal.expectedRevenue || 0;
                          if (revenue < 10000) return '$0 - $10K';
                          if (revenue < 50000) return '$10K - $50K';
                          if (revenue < 100000) return '$50K - $100K';
                          if (revenue < 500000) return '$100K - $500K';
                          if (revenue < 1000000) return '$500K - $1M';
                          return '$1M+';
                        }
                        
                        return '$0 - $0';
                      };

                      return (
                        <Box
                          key={deal.id}
                          sx={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 1, 
                            p: 1, 
                            borderRadius: 1, 
                            bgcolor: 'grey.50', 
                            cursor: 'pointer' 
                          }}
                          onClick={() => navigate(`/crm/deals/${deal.id}`)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { 
                            if (e.key === 'Enter' || e.key === ' ') { 
                              e.preventDefault(); 
                              navigate(`/crm/deals/${deal.id}`); 
                            } 
                          }}
                        >
                          <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem', bgcolor: getStageHexColor(deal.stage) }}>
                            <DealIcon sx={{ fontSize: 16 }} />
                          </Avatar>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" fontWeight="medium">
                              {deal.name || 'Unnamed Deal'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {calculateExpectedRevenueRange(deal)} • {deal.stage || 'Unknown Stage'}
                            </Typography>
                          </Box>
                        </Box>
                      );
                    })}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">No associated opportunities</Typography>
              )}
            </CardContent>
          </Card>

          {/* Local snackbars for rebuild feedback */}
          <Snackbar open={!!localSuccess} autoHideDuration={3000} onClose={() => setLocalSuccess(null)}>
            <Alert severity="success" onClose={() => setLocalSuccess(null)} sx={{ width: '100%' }}>
              {localSuccess}
            </Alert>
          </Snackbar>
          <Snackbar open={!!localError} autoHideDuration={4000} onClose={() => setLocalError(null)}>
            <Alert severity="error" onClose={() => setLocalError(null)} sx={{ width: '100%' }}>
              {localError}
            </Alert>
          </Snackbar>



          {/* Recent Contacts (moved here) */}
          <Box sx={{ mb: 0 }}>
            <SectionCard title="Recent Contacts" action={<Typography variant="body2" color="text.secondary">{contacts.length} total contacts</Typography>}>
              {contacts.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {contacts.slice(0, 5).map((contact) => (
                    <Box
                      key={contact.id}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                      onClick={() => navigate(`/crm/contacts/${contact.id}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/crm/contacts/${contact.id}`); } }}
                    >
                      <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>
                        {contact.firstName?.charAt(0) || contact.name?.charAt(0) || 'C'}
                      </Avatar>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight="medium">
                          {contact.firstName} {contact.lastName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {contact.title || 'No title'}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Box sx={{ textAlign: 'center', py: 3 }}>
                  <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
                    No contacts yet
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Add your first contact to get started
                  </Typography>
                  <Button variant="outlined" size="small">
                    Add Contact
                  </Button>
                </Box>
               )}
            </SectionCard>
          </Box>







        </Box>
      </Grid>
      </Grid>
  );
};

const OverviewTab: React.FC<{ company: any; tenantId: string }> = ({ company, tenantId }) => {
  const [aiLoading, setAiLoading] = useState(false);
  const [logoLoading, setLogoLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const addressAutocompleteRef = useRef<any>(null);
  
  // Local state for company name input
  const [companyNameInput, setCompanyNameInput] = useState(company.companyName || company.name || '');
  const [isEditingName, setIsEditingName] = useState(false);
  
  // Update local input when company data changes
  useEffect(() => {
    setCompanyNameInput(company.companyName || company.name || '');
  }, [company.companyName, company.name]);

  // Sync existing headquarters address to locations on component mount
  useEffect(() => {
    if (company && company.address && company.city && company.state && company.zip) {
      const syncExistingHeadquarters = async () => {
        try {
          const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations');
          const headquartersQuery = query(locationsRef, where('type', '==', 'Headquarters'));
          const headquartersSnap = await getDocs(headquartersQuery);
          
          // Only create if no headquarters location exists
          if (headquartersSnap.empty) {
            const addressData = {
              address: company.address,
              city: company.city,
              state: company.state,
              zip: company.zip,
              companyLat: company.companyLat,
              companyLng: company.companyLng,
            };
            await syncHeadquartersLocation(addressData);
            console.log('✅ Synced existing headquarters address to locations');
          }
        } catch (err) {
          console.error('Error syncing existing headquarters:', err);
        }
      };
      
      syncExistingHeadquarters();
    }
  }, [company, tenantId]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      if (file.size > 2 * 1024 * 1024) {
        setError('Logo file size must be less than 2MB');
        return;
      }

      const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
      if (!validTypes.includes(file.type)) {
        setError('Please upload a PNG, JPG, or SVG file');
        return;
      }

      setLogoLoading(true);
      try {
        const storageRef = ref(storage, `companies/${tenantId}/${company.id}/logo.${file.name.split('.').pop()}`);
        await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(storageRef);
        
        const updatedCompany = { ...company, logo: downloadURL };
        // setCompany(updatedCompany); // Not available in OverviewTab component
        
        await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id), { logo: downloadURL });
        setSuccess('Logo uploaded successfully!');
      } catch (err) {
        console.error('Error uploading logo:', err);
        setError('Failed to upload logo. Please try again.');
      }
      setLogoLoading(false);
    }
  };

  const handleDeleteLogo = async () => {
    setLogoLoading(true);
    try {
      if (company.logo) {
        const urlParts = company.logo.split('/');
        const fileName = urlParts[urlParts.length - 1];
        const fileExtension = fileName.split('.').pop() || 'png';
        const storageRef = ref(storage, `companies/${tenantId}/${company.id}/logo.${fileExtension}`);
        await deleteObject(storageRef);
      }
      
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id), { logo: '' });
      setSuccess('Logo deleted successfully!');
    } catch (err) {
      console.error('Error deleting logo:', err);
      setError('Failed to delete logo. Please try again.');
    }
    setLogoLoading(false);
  };

  // Helper function to ensure URLs have proper protocols
  const ensureUrlProtocol = (url: string): string => {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return 'https://' + url;
  };

  const handleCompanyUpdate = async (field: string, value: any) => {
    try {
      // Ensure URL fields have proper protocols
      let processedValue = value;
      if (['website', 'linkedin', 'indeed', 'facebook'].includes(field) && value) {
        processedValue = ensureUrlProtocol(value);
      }

      await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id), { [field]: processedValue });
      
      // Sync headquarters location if address fields are updated
      if (['address', 'city', 'state', 'zip'].includes(field)) {
        const addressData = {
          address: field === 'address' ? processedValue : company.address,
          city: field === 'city' ? processedValue : company.city,
          state: field === 'state' ? processedValue : company.state,
          zip: field === 'zip' ? processedValue : company.zip,
          companyLat: company.companyLat,
          companyLng: company.companyLng,
        };
        syncHeadquartersLocation(addressData);
      }
      
      setSuccess('Company updated successfully!');
    } catch (err) {
      console.error('Error updating company:', err);
      setError('Failed to update company. Please try again.');
    }
  };

  const commitCompanyName = async () => {
    const trimmed = (companyNameInput || '').trim();
    if ((company.companyName || company.name || '') !== trimmed) {
      await handleCompanyUpdate('companyName', trimmed);
    }
    setIsEditingName(false);
  };

  // Function to create or update headquarters location
  const syncHeadquartersLocation = async (addressData: any) => {
    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations');
      
      // Check if headquarters location already exists by type
      const headquartersQuery = query(locationsRef, where('type', '==', 'Headquarters'));
      const headquartersSnap = await getDocs(headquartersQuery);
      
      const locationData = {
        name: 'Headquarters',
        address: addressData.address,
        city: addressData.city,
        state: addressData.state,
        zipCode: addressData.zip,
        country: 'USA',
        type: 'Headquarters',
        coordinates: addressData.companyLat && addressData.companyLng ? {
          latitude: addressData.companyLat,
          longitude: addressData.companyLng
        } : null,
        discoveredBy: 'Manual',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contactCount: 0,
        dealCount: 0,
        salespersonCount: 0
      };

      const cleanLocationData = Object.fromEntries(
        Object.entries(locationData).filter(([, v]) => v !== undefined)
      );

      if (headquartersSnap.empty) {
        // Create new headquarters location
        await addDoc(locationsRef, cleanLocationData);
        console.log('✅ Created headquarters location');
      } else {
        // Check if any existing headquarters has the same address
        const existingHeadquarters = headquartersSnap.docs.find(doc => {
          const data = doc.data();
          return data.address === addressData.address && 
                 data.city === addressData.city && 
                 data.state === addressData.state && 
                 data.zipCode === addressData.zip;
        });

        if (existingHeadquarters) {
          // Update the existing headquarters with the same address
          await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations', existingHeadquarters.id), {
            ...cleanLocationData,
            id: existingHeadquarters.id // Preserve the existing ID
          });
          console.log('✅ Updated existing headquarters location with same address');
        } else {
          // Check if we have multiple headquarters and need to clean up duplicates
          if (headquartersSnap.docs.length > 1) {
            console.log('⚠️ Multiple headquarters found, cleaning up duplicates...');
            // Keep the first one and delete the rest
            const docsToDelete = headquartersSnap.docs.slice(1);
            for (const docToDelete of docsToDelete) {
              await deleteDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations', docToDelete.id));
            }
            console.log(`✅ Deleted ${docsToDelete.length} duplicate headquarters locations`);
          }
          
          // Update the first headquarters location
          const headquartersDoc = headquartersSnap.docs[0];
          await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations', headquartersDoc.id), {
            ...cleanLocationData,
            id: headquartersDoc.id // Preserve the existing ID
          });
          console.log('✅ Updated headquarters location');
        }
      }
    } catch (err) {
      console.error('Error syncing headquarters location:', err);
    }
  };

  const handlePlaceChanged = () => {
    const place = addressAutocompleteRef.current.getPlace();
    if (!place || !place.geometry) return;
    const components = place.address_components || [];
    const getComponent = (types: string[]) =>
      components.find((comp: any) => types.every((t) => comp.types.includes(t)))?.long_name || '';

    const addressData = {
      address: `${getComponent(['street_number'])} ${getComponent(['route'])}`.trim(),
      city: getComponent(['locality']),
      state: getComponent(['administrative_area_level_1']),
      zip: getComponent(['postal_code']),
      companyLat: place.geometry.location.lat(),
      companyLng: place.geometry.location.lng(),
    };

    // Update Firestore
    updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id), addressData);
    
    // Sync headquarters location
    syncHeadquartersLocation(addressData);
  };

  const handleAddressGeocode = async () => {
    if (!company.address) return;
    
    try {
      const coordinates = await geocodeAddress(company.address);
      await handleCompanyUpdate('coordinates', coordinates);
      setSuccess('Address geocoded successfully!');
    } catch (err) {
      console.error('Error geocoding address:', err);
      setError('Failed to geocode address. Please check the address format.');
    }
  };

  const handleDiscoverUrls = async () => {
    setAiLoading(true);
    try {
      const companyName = company.companyName || company.name;
      if (!companyName) {
        setError('Company name is required for URL discovery');
        setAiLoading(false);
        return;
      }

      // Use the enhanced SERP-powered URL discovery function
      const discoverUrls = httpsCallable(functions, 'discoverCompanyUrls');
      const urlResult = await discoverUrls({
        companyName,
        companyId: company.id,
        tenantId
      });
      
      const urlData = urlResult.data as any;
      console.log('SERP-enhanced URL discovery results:', urlData);
      
      // Update URLs if found and not already set
      const enhancedData: any = {};
      if (urlData.website && !company.website) {
        enhancedData.website = urlData.website;
      }
      if (urlData.linkedin && !company.linkedin) {
        enhancedData.linkedin = urlData.linkedin;
      }
      if (urlData.indeed && !company.indeed) {
        enhancedData.indeed = urlData.indeed;
      }
      if (urlData.facebook && !company.facebook) {
        enhancedData.facebook = urlData.facebook;
      }

      // Update the company data in Firestore
      if (Object.keys(enhancedData).length > 0) {
        await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id), enhancedData);
        setSuccess('URLs discovered and updated successfully with SERP data!');
      } else {
        setSuccess('No new URLs found to update.');
      }
      
    } catch (error) {
      console.error('URL discovery failed:', error);
      setError('Failed to discover URLs. Please try again.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleEnhanceWithAI = async () => {
    setAiLoading(true);
    try {
      const companyName = company.companyName || company.name;
      if (!companyName) {
        setError('Company name is required for AI enhancement');
        setAiLoading(false);
        return;
      }

      // Enhanced data object to collect real scraped data
      const enhancedData: any = {};
      
      // Use the new SERP-enhanced company enhancement function
      try {
        const enhanceWithSerp = httpsCallable(functions, 'enhanceCompanyWithSerp');
        const serpResult = await enhanceWithSerp({
          companyName,
          companyId: company.id,
          tenantId
        });
        
        const serpData = serpResult.data as any;
        console.log('SERP-enhanced company data:', serpData);
        
        if (serpData.success && serpData.data) {
          const data = serpData.data;
          
          // Update company information
          if (data.headquartersAddress && !company.address) {
            enhancedData.address = data.headquartersAddress;
          }
          if (data.headquartersCity && !company.city) {
            enhancedData.city = data.headquartersCity;
          }
          if (data.headquartersState && !company.state) {
            enhancedData.state = data.headquartersState;
          }
          if (data.headquartersZip && !company.zip) {
            enhancedData.zip = data.headquartersZip;
          }
          if (data.industry && !company.industry) {
            enhancedData.industry = data.industry;
          }
          if (data.companySize && !company.companySize) {
            enhancedData.companySize = data.companySize;
          }
          if (data.revenue && !company.revenue) {
            enhancedData.revenue = data.revenue;
          }
          if (data.description && !company.description) {
            enhancedData.description = data.description;
          }
          if (data.tags && data.tags.length > 0) {
            enhancedData.tags = data.tags;
          }
        }
        
      } catch (serpError) {
        console.error('SERP enhancement failed:', serpError);
        // Fallback to URL discovery only
        try {
          const discoverUrls = httpsCallable(functions, 'discoverCompanyUrls');
          const urlResult = await discoverUrls({
            companyName,
            companyId: company.id,
            tenantId
          });
          
          const urlData = urlResult.data as any;
          console.log('Fallback URL discovery results:', urlData);
          
          // Update URLs if found and not already set
          if (urlData.website && !company.website) {
            enhancedData.website = urlData.website;
          }
          if (urlData.linkedin && !company.linkedin) {
            enhancedData.linkedin = urlData.linkedin;
          }
          if (urlData.indeed && !company.indeed) {
            enhancedData.indeed = urlData.indeed;
          }
          if (urlData.facebook && !company.facebook) {
            enhancedData.facebook = urlData.facebook;
          }
          
        } catch (urlError) {
          console.error('URL discovery failed:', urlError);
          // Fallback to old methods if AI discovery fails
          if (!company.website) {
            const websiteUrl = await findCompanyWebsite(companyName);
            if (websiteUrl) {
              enhancedData.website = websiteUrl;
            }
          }
          if (!company.linkedin) {
            const linkedinUrl = generateLinkedInUrl(companyName);
            enhancedData.linkedin = linkedinUrl;
          }
        }
      }

      // 3. Generate AI summary based on company name and available data
      try {
        const summaryKeywords = companyName.toLowerCase().split(' ');
        let industryGuess = 'general business';
        let sizeGuess = '51-100';
        let revenueGuess = '$10M-$50M';
        
        // Enhanced keyword-based industry detection
        if (summaryKeywords.some(word => ['steel', 'metal', 'supply', 'manufacturing', 'industrial'].includes(word))) {
          industryGuess = 'manufacturing';
          enhancedData.industry = '31';
          // Set sub-industry for manufacturing
          if (summaryKeywords.some(word => ['steel', 'metal'].includes(word))) {
            enhancedData.subIndustry = '331'; // Primary Metal Manufacturing
          } else if (summaryKeywords.some(word => ['supply', 'distribution'].includes(word))) {
            enhancedData.subIndustry = '332'; // Fabricated Metal Product Manufacturing
          }
          sizeGuess = '101-250';
          revenueGuess = '$10M-$50M';
        } else if (summaryKeywords.some(word => ['construction', 'build', 'contractor', 'engineering'].includes(word))) {
          industryGuess = 'construction';
          enhancedData.industry = '23';
          // Set sub-industry for construction
          if (summaryKeywords.some(word => ['build', 'building'].includes(word))) {
            enhancedData.subIndustry = '236'; // Construction of Buildings
          } else if (summaryKeywords.some(word => ['engineering', 'civil'].includes(word))) {
            enhancedData.subIndustry = '237'; // Heavy and Civil Engineering Construction
          }
          sizeGuess = '51-100';
          revenueGuess = '$5M-$10M';
        } else if (summaryKeywords.some(word => ['tech', 'software', 'digital', 'app', 'platform'].includes(word))) {
          industryGuess = 'technology';
          enhancedData.industry = '54';
          // Set sub-industry for technology
          if (summaryKeywords.some(word => ['software', 'app', 'platform'].includes(word))) {
            enhancedData.subIndustry = '5415'; // Computer Systems Design and Related Services
          }
          sizeGuess = '11-50';
          revenueGuess = '$1M-$5M';
        } else if (summaryKeywords.some(word => ['health', 'medical', 'care', 'hospital', 'clinic'].includes(word))) {
          industryGuess = 'healthcare';
          enhancedData.industry = '62';
          sizeGuess = '251-500';
          revenueGuess = '$50M-$100M';
        } else if (summaryKeywords.some(word => ['finance', 'bank', 'credit', 'loan', 'investment'].includes(word))) {
          industryGuess = 'finance';
          enhancedData.industry = '52';
          sizeGuess = '101-250';
          revenueGuess = '$50M-$100M';
        } else if (summaryKeywords.some(word => ['retail', 'store', 'shop', 'market', 'commerce'].includes(word))) {
          industryGuess = 'retail';
          enhancedData.industry = '44';
          sizeGuess = '51-100';
          revenueGuess = '$10M-$50M';
        } else {
          // Default for general business
          enhancedData.industry = '55'; // Professional, Scientific, and Technical Services
          sizeGuess = '51-100';
          revenueGuess = '$10M-$50M';
        }

        // Generate contextual summary
        enhancedData.aiSummary = `${companyName} is a ${industryGuess} company that provides specialized services in their industry. Based on available information, they appear to be a well-established organization serving their market with professional expertise and quality solutions.`;

        // Set reasonable defaults for size and revenue based on industry
        enhancedData.size = sizeGuess;
        enhancedData.revenue = revenueGuess;
        
        // Generate relevant tags based on industry
        const tagMap: { [key: string]: string[] } = {
          'construction': ['Construction', 'Commercial', 'Professional Services'],
          'technology': ['Technology', 'Software', 'Digital Solutions'],
          'healthcare': ['Healthcare', 'Medical', 'Professional Services'],
          'finance': ['Finance', 'Banking', 'Professional Services'],
          'retail': ['Retail', 'Consumer Goods', 'Commerce'],
          'manufacturing': ['Manufacturing', 'Industrial', 'Production']
        };
        
        enhancedData.tags = tagMap[industryGuess] || ['Professional Services', 'Business Solutions'];
        
      } catch (e) {
        console.log('AI summary generation failed:', e);
        enhancedData.aiSummary = `${companyName} is a professional organization providing quality services to their clients.`;
      }

      // 4. Try to find and upload company logo
      let logoUrl = company.logo;
      if (!company.logo) {
        try {
          // Try multiple logo sources
          const logoSources = [
            // Clearbit logo sources
            `https://logo.clearbit.com/${companyName.toLowerCase().replace(/\s+/g, '')}.com`,
            `https://logo.clearbit.com/${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
            `https://logo.clearbit.com/${companyName.toLowerCase().replace(/\s+/g, '')}.org`,
            `https://logo.clearbit.com/${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.org`
          ];

          // Add LinkedIn logo sources if we have a LinkedIn URL
          if (enhancedData.linkedin || company.linkedin) {
            const linkedinUrl = enhancedData.linkedin || company.linkedin;
            // LinkedIn company logos are typically found at specific paths
            const linkedinLogoSources = [
              `${linkedinUrl}/logo.png`,
              `${linkedinUrl}/logo.jpg`,
              `${linkedinUrl}/logo.jpeg`,
              `${linkedinUrl}/company-logo.png`,
              `${linkedinUrl}/company-logo.jpg`,
              // Alternative LinkedIn logo paths
              `${linkedinUrl.replace('/company/', '/')}/logo.png`,
              `${linkedinUrl.replace('/company/', '/')}/logo.jpg`
            ];
            logoSources.push(...linkedinLogoSources);
          }

          // Try each logo source
          for (const logoSource of logoSources) {
            try {
              console.log(`Trying logo source: ${logoSource}`);
              const response = await fetch(logoSource, {
                method: 'GET',
                mode: 'no-cors',
                cache: 'no-cache'
              });
              
              if (response.ok) {
                const blob = await response.blob();
                
                // Check if the blob is actually an image
                if (blob.type.startsWith('image/')) {
                  const file = new File([blob], `${companyName.toLowerCase().replace(/\s+/g, '')}-logo.png`, { type: blob.type });

                  const storageRef = ref(storage, `companies/${tenantId}/${company.id}/ai-logo.png`);
                  await uploadBytes(storageRef, file);
                  logoUrl = await getDownloadURL(storageRef);
                  enhancedData.logo = logoUrl;
                  console.log(`Successfully uploaded logo from: ${logoSource}`);
                  break;
                }
              }
            } catch (logoErr) {
              console.log(`Logo source failed: ${logoSource}`, logoErr);
              // Continue to next logo source
            }
          }

          // If no logo found via direct URLs, try LinkedIn scraping approach
          if (!logoUrl && (enhancedData.linkedin || company.linkedin)) {
            try {
              const linkedinUrl = enhancedData.linkedin || company.linkedin;
              console.log(`Attempting LinkedIn logo extraction from: ${linkedinUrl}`);
              
              // Note: This would require a backend service to scrape LinkedIn
              // For now, we'll use a simulated approach
              const simulatedLinkedinLogo = `https://logo.clearbit.com/${companyName.toLowerCase().replace(/\s+/g, '')}.com`;
              
              const response = await fetch(simulatedLinkedinLogo);
              if (response.ok) {
                const blob = await response.blob();
                const file = new File([blob], `${companyName.toLowerCase().replace(/\s+/g, '')}-linkedin-logo.png`, { type: 'image/png' });

                const storageRef = ref(storage, `companies/${tenantId}/${company.id}/linkedin-logo.png`);
                await uploadBytes(storageRef, file);
                logoUrl = await getDownloadURL(storageRef);
                enhancedData.logo = logoUrl;
                console.log(`Successfully uploaded LinkedIn-style logo`);
              }
            } catch (linkedinLogoErr) {
              console.log('LinkedIn logo extraction failed:', linkedinLogoErr);
            }
          }
        } catch (logoErr) {
          console.log('AI logo detection failed, continuing without logo:', logoErr);
        }
      }

      // 5. Update the company with enhanced data
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id), enhancedData);
      const successMessage = `Company enhanced with real data!${logoUrl && logoUrl !== company.logo ? ' Logo found and uploaded.' : ''}`;
      setSuccess(successMessage);
      
    } catch (err) {
      console.error('Error enhancing with AI:', err);
      setError('Failed to enhance with AI. Please try again.');
    }
    setAiLoading(false);
  };

  return (
    <Grid container spacing={3}>
      {/* Core Identity */}
      <Grid item xs={12} md={6}>
        <Card>
          <CardHeader title="Core Identity" titleTypographyProps={{ variant: 'h6' }} />
          <CardContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Company Name"
                value={companyNameInput}
                onChange={(e) => setCompanyNameInput(e.target.value)}
                onBlur={(e) => handleCompanyUpdate('companyName', e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="Website URL"
                value={company.website || company.companyUrl || company.url || ''}
                onChange={(e) => handleCompanyUpdate('website', e.target.value)}
                fullWidth
                size="small"
                InputProps={{
                  startAdornment: <LanguageIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />
                }}
              />
              <TextField
                label="LinkedIn URL"
                value={company.linkedin || ''}
                onChange={(e) => handleCompanyUpdate('linkedin', e.target.value)}
                fullWidth
                size="small"
                InputProps={{
                  startAdornment: <LinkedInIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />
                }}
              />
              <TextField
                label="Indeed Company URL"
                value={company.indeed || ''}
                onChange={(e) => handleCompanyUpdate('indeed', e.target.value)}
                fullWidth
                size="small"
                placeholder="https://www.indeed.com/cmp/company-name"
                helperText="View job listings and company reviews"
                InputProps={{
                  startAdornment: <WorkIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />
                }}
              />
              <TextField
                label="Facebook Page URL"
                value={company.facebook || ''}
                onChange={(e) => handleCompanyUpdate('facebook', e.target.value)}
                fullWidth
                size="small"
                placeholder="https://www.facebook.com/company-name"
                helperText="Company's Facebook business page"
                InputProps={{
                  startAdornment: <FacebookIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />
                }}
              />
              <TextField
                label="Corporate Phone Number"
                value={company.phone || ''}
                onChange={(e) => handleCompanyUpdate('phone', e.target.value)}
                fullWidth
                size="small"
                InputProps={{
                  startAdornment: <PhoneIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />
                }}
              />
              <TextField
                label="AI Company Summary"
                value={company.aiSummary || ''}
                onChange={(e) => handleCompanyUpdate('aiSummary', e.target.value)}
                fullWidth
                multiline
                rows={3}
                size="small"
              />
            </Box>
          </CardContent>
        </Card>
      </Grid>

      {/* Company Details */}
      <Grid item xs={12} md={6}>
        <Card>
          <CardHeader title="Company Details" titleTypographyProps={{ variant: 'h6' }} />
          <CardContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Size (Employees)</InputLabel>
                <Select
                  value={normalizeSizeValue(company.size || '')}
                  label="Size (Employees)"
                  onChange={(e) => handleCompanyUpdate('size', e.target.value)}
                >
                  <MenuItem value="1-10">1-10</MenuItem>
                  <MenuItem value="11-50">11-50</MenuItem>
                  <MenuItem value="51-100">51-100</MenuItem>
                  <MenuItem value="101-250">101-250</MenuItem>
                  <MenuItem value="251-500">251-500</MenuItem>
                  <MenuItem value="501-1000">501-1000</MenuItem>
                  <MenuItem value="1001-5000">1001-5000</MenuItem>
                  <MenuItem value="5001-10000">5001-10000</MenuItem>
                  <MenuItem value="10000+">10000+</MenuItem>
                </Select>
              </FormControl>
              
              <FormControl fullWidth size="small">
                <InputLabel>Revenue</InputLabel>
                <Select
                  value={company.revenue || ''}
                  label="Revenue"
                  onChange={(e) => handleCompanyUpdate('revenue', e.target.value)}
                >
                  <MenuItem value="<$1M">&lt;$1M</MenuItem>
                  <MenuItem value="$1M-$5M">$1M-$5M</MenuItem>
                  <MenuItem value="$5M-$10M">$5M-$10M</MenuItem>
                  <MenuItem value="$10M-$50M">$10M-$50M</MenuItem>
                  <MenuItem value="$50M-$100M">$50M-$100M</MenuItem>
                  <MenuItem value="$100M-$500M">$100M-$500M</MenuItem>
                  <MenuItem value="$500M-$1B">$500M-$1B</MenuItem>
                  <MenuItem value="$1B+">$1B+</MenuItem>
                </Select>
              </FormControl>

              {/* Pipeline Totals */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="subtitle2" color="primary" fontWeight="medium">
                  Pipeline Value
                </Typography>
                {company.pipelineValue ? (
                  <Box>
                    <Typography variant="h6" color="success.main" fontWeight="bold">
                      ${company.pipelineValue.low?.toLocaleString()} - ${company.pipelineValue.high?.toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {company.pipelineValue.dealCount || 0} deal{(company.pipelineValue.dealCount || 0) !== 1 ? 's' : ''} in pipeline
                    </Typography>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No pipeline data available
                  </Typography>
                )}
              </Box>

              {/* Closed Deal Totals */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 2, bgcolor: 'success.50', borderRadius: 1 }}>
                <Typography variant="subtitle2" color="success.main" fontWeight="medium">
                  Closed Deal Value
                </Typography>
                {company.closedValue ? (
                  <Box>
                    <Typography variant="h6" color="success.main" fontWeight="bold">
                      ${company.closedValue.total?.toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {company.closedValue.dealCount || 0} closed deal{(company.closedValue.dealCount || 0) !== 1 ? 's' : ''}
                    </Typography>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No closed deals data available
                  </Typography>
                )}
              </Box>

              <IndustrySelector
                value={company.industry || ''}
                onChange={(industryCode) => {
                  handleCompanyUpdate('industry', industryCode);
                  // Clear sub-industry when main industry changes
                  if (company.subIndustry) {
                    handleCompanyUpdate('subIndustry', '');
                  }
                }}
                label="Industry"
                variant="select"
                showCategory={false}
              />

              <FormControl fullWidth size="small" disabled={!company.industry || !getSubIndustries(company.industry).some(si => si.code === (company.subIndustry || ''))}>
                <InputLabel>Sub-Industry</InputLabel>
                <Select
                  value={getSubIndustries(company.industry).some(si => si.code === (company.subIndustry || '')) ? company.subIndustry : ''}
                  label="Sub-Industry"
                  onChange={(e) => handleCompanyUpdate('subIndustry', e.target.value)}
                >
                  <MenuItem value="">
                    <em>Select a sub-industry</em>
                  </MenuItem>
                  {(() => {
                    const subIndustries = company.industry ? getSubIndustries(company.industry) : [];
                    console.log('Rendering sub-industry dropdown with:', {
                      companyIndustry: company.industry,
                      subIndustries: subIndustries,
                      subIndustriesLength: subIndustries.length
                    });
                    return subIndustries.map((industry) => (
                      <MenuItem key={industry.code} value={industry.code}>
                        <Box>
                          <Typography variant="body2">{industry.name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {industry.code}
                          </Typography>
                        </Box>
                      </MenuItem>
                    ));
                  })()}
                </Select>
                <FormHelperText>
                  {company.industry 
                    ? `Select a more specific industry classification (${getSubIndustries(company.industry).length} options available)`
                    : 'Select a more specific industry classification'
                  }
                </FormHelperText>
              </FormControl>

              <Autocomplete
                multiple
                freeSolo
                options={[]}
                value={company.tags || []}
                onChange={(event, newValue) => handleCompanyUpdate('tags', newValue)}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => {
                    const tagProps = getTagProps({ index });
                    const { key, ...otherProps } = tagProps;
                    return (
                      <Chip
                        key={key}
                        variant="outlined"
                        label={option}
                        {...otherProps}
                        size="small"
                      />
                    );
                  })
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Tags"
                    size="small"
                    placeholder="Add tags..."
                  />
                )}
              />

              <Autocomplete
                multiple
                freeSolo
                options={[]}
                value={company.divisions || []}
                onChange={(event, newValue) => handleCompanyUpdate('divisions', newValue)}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => {
                    const tagProps = getTagProps({ index });
                    const { key, ...otherProps } = tagProps;
                    return (
                      <Chip
                        key={key}
                        variant="outlined"
                        label={option}
                        {...otherProps}
                        size="small"
                      />
                    );
                  })
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Divisions"
                    size="small"
                    placeholder="Add divisions (e.g., Facilities Management, Hospitality)..."
                  />
                )}
              />
            </Box>
          </CardContent>
        </Card>
      </Grid>

      {/* Associations Card - Top Right */}
      <Grid item xs={12} md={6}>
        <FastAssociationsCard
          entityType="company"
          entityId={company.id}
          tenantId={tenantId}
          entityName={company.companyName || company.name}
          showAssociations={{
            locations: false,
            contacts: false,
            deals: false,
            salespeople: true,
            companies: false, // Don't show companies for companies
            tasks: false
          }}
        />
      </Grid>

      {/* Company Headquarters */}
      <Grid item xs={12} md={6}>
        <Card>
          <CardHeader 
            title="Company Headquarters" 
          />
          <CardContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <GoogleAutocomplete
                onLoad={(ref) => (addressAutocompleteRef.current = ref)}
                onPlaceChanged={handlePlaceChanged}
              >
                <TextField
                  label="Address"
                  value={company.address || ''}
                  onChange={(e) => handleCompanyUpdate('address', e.target.value)}
                  fullWidth
                  size="small"
                  InputProps={{
                    startAdornment: <LocationIcon sx={{ fontSize: 16, mr: 1, color: 'text.secondary' }} />
                  }}
                />
              </GoogleAutocomplete>
              <TextField
                label="City"
                value={company.city || ''}
                onChange={(e) => handleCompanyUpdate('city', e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="State"
                value={company.state || ''}
                onChange={(e) => handleCompanyUpdate('state', e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="ZIP Code"
                value={company.zip || ''}
                onChange={(e) => handleCompanyUpdate('zip', e.target.value)}
                fullWidth
                size="small"
              />
              {(company.companyLat && company.companyLng) && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
                  <LocationIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary">
                    Coordinates: {company.companyLat.toFixed(6)}, {company.companyLng.toFixed(6)}
                  </Typography>
                </Box>
              )}
              {company.address && company.city && company.state && company.zip && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<LocationIcon />}
                  onClick={async () => {
                    const addressData = {
                      address: company.address,
                      city: company.city,
                      state: company.state,
                      zip: company.zip,
                      companyLat: company.companyLat,
                      companyLng: company.companyLng,
                    };
                    await syncHeadquartersLocation(addressData);
                    setSuccess('Headquarters synced to locations successfully!');
                  }}
                >
                  Sync to Locations
                </Button>
              )}
            </Box>
          </CardContent>
        </Card>
      </Grid>



      {/* Success/Error Snackbars */}
      <Snackbar open={!!success} autoHideDuration={4000} onClose={() => setSuccess(null)}>
        <Alert severity="success" onClose={() => setSuccess(null)} sx={{ width: '100%' }}>
          {success}
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Grid>
  );
};

const LocationsTab: React.FC<{ company: any; currentTab: number }> = ({ company, currentTab }) => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [locations, setLocations] = useState<any[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [suggestedLocations, setSuggestedLocations] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  // Debug Google Maps API loading
  useEffect(() => {
    console.log('LocationsTab mounted');
    console.log('Google Maps API key available:', !!process.env.REACT_APP_GOOGLE_MAPS_API_KEY);
    console.log('window.google available:', !!(typeof window !== 'undefined' && window.google));
    if (typeof window !== 'undefined' && window.google) {
      console.log('Google Maps services:', Object.keys(window.google.maps || {}));
    }
  }, []);

  // Clean up duplicate headquarters locations
  const cleanupDuplicateHeadquarters = async () => {
    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations');
      const headquartersQuery = query(locationsRef, where('type', '==', 'Headquarters'));
      const headquartersSnap = await getDocs(headquartersQuery);
      
      if (headquartersSnap.docs.length > 1) {
        console.log(`⚠️ Found ${headquartersSnap.docs.length} headquarters locations, cleaning up duplicates...`);
        
        // Group by address to identify duplicates
        const addressGroups = new Map();
        headquartersSnap.docs.forEach(doc => {
          const data = doc.data();
          const addressKey = `${data.address}-${data.city}-${data.state}-${data.zipCode}`;
          if (!addressGroups.has(addressKey)) {
            addressGroups.set(addressKey, []);
          }
          addressGroups.get(addressKey).push({ id: doc.id, data });
        });
        
        // Delete duplicates within each address group
        for (const [addressKey, docs] of addressGroups) {
          if (docs.length > 1) {
            console.log(`Found ${docs.length} duplicate headquarters at address: ${addressKey}`);
            // Keep the first one, delete the rest
            const docsToDelete = docs.slice(1);
            for (const docToDelete of docsToDelete) {
              await deleteDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations', docToDelete.id));
            }
            console.log(`✅ Deleted ${docsToDelete.length} duplicate headquarters locations`);
          }
        }
      }
    } catch (err) {
      console.error('Error cleaning up duplicate headquarters:', err);
    }
  };

  // Load existing locations
  useEffect(() => {
    const loadLocations = async () => {
      if (!company?.id || !tenantId) return;
      
      try {
        setLoading(true);
        
        // Clean up any duplicate headquarters first
        await cleanupDuplicateHeadquarters();
        
        // Try Firebase Function first (more reliable)
        try {
          const getCompanyLocations = httpsCallable(functions, 'getCompanyLocations');
          const result = await getCompanyLocations({ tenantId, companyId: company.id });
          const data = result.data as { locations: any[] };
          setLocations(data.locations || []);
        } catch (functionError) {
          console.log('Firebase Function failed, falling back to direct Firestore access');
          
          // Fallback to direct Firestore access
          const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations');
          const locationsSnap = await getDocs(locationsRef);
          const locationsData = locationsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setLocations(locationsData);
        }
      } catch (err) {
        console.error('Error loading locations:', err);
        setError('Failed to load locations');
      } finally {
        setLoading(false);
      }
    };

    loadLocations();
  }, [company?.id, tenantId]);

  // AI-powered location discovery
  const discoverLocationsWithAI = async () => {
    if (!company?.companyName && !company?.name) return;
    
    setAiLoading(true);
    setError(null);
    
    try {
      const discoverLocations = httpsCallable(functions, 'discoverCompanyLocations');
      const result = await discoverLocations({
        companyName: company.companyName || company.name,
        companyId: company.id,
        tenantId,
        industry: company.industry,
        headquartersCity: company.headquartersCity || company.city,
        existingLocations: locations.map(loc => loc.address)
      });
      
      const data = result.data as { locations: any[] };
      setSuggestedLocations(data.locations || []);
      setShowSuggestions(true);
    } catch (err) {
      console.error('Error discovering locations:', err);
      setError('Failed to discover locations with AI');
    } finally {
      setAiLoading(false);
    }
  };

  // Add a suggested location
  const addSuggestedLocation = async (location: any) => {
    try {
      const locationData = {
        name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        zipCode: location.zipCode,
        country: location.country || 'USA',
        type: location.type || 'Office',
        coordinates: location.coordinates,
        discoveredBy: 'AI',
        discoveredAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        contactCount: 0,
        dealCount: 0,
        salespersonCount: 0
      };

      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations');
      const docRef = await addDoc(locationsRef, locationData);
      
      const newLocation = { id: docRef.id, ...locationData };
      setLocations(prev => [...prev, newLocation]);
      
      // Remove from suggestions
      setSuggestedLocations(prev => prev.filter(loc => loc.address !== location.address));
      
      if (suggestedLocations.length === 1) {
        setShowSuggestions(false);
      }
    } catch (err) {
      console.error('Error adding location:', err);
      setError('Failed to add location');
    }
  };

  // Add all suggested locations
  const addAllSuggestedLocations = async () => {
    try {
      for (const location of suggestedLocations) {
        await addSuggestedLocation(location);
      }
    } catch (err) {
      console.error('Error adding all locations:', err);
      setError('Failed to add some locations');
    }
  };

  // Delete a location
  const deleteLocation = async (locationId: string) => {
    try {
      const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations', locationId);
      await deleteDoc(locationRef);
      setLocations(prev => prev.filter(loc => loc.id !== locationId));
    } catch (err) {
      console.error('Error deleting location:', err);
      setError('Failed to delete location');
    }
  };

  // Update location
  const updateLocation = (updatedLocation: any) => {
    setLocations(prev => prev.map(loc => loc.id === updatedLocation.id ? updatedLocation : loc));
  };

  // Handle location details view
  const handleViewLocation = (location: any) => {
    navigate(`/crm/companies/${company.id}/locations/${location.id}?sourceTab=${currentTab}`);
  };



  // Manual location form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLocation, setNewLocation] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'USA',
    type: 'Office',
    division: '',
    coordinates: null
  });
  const autocompleteRef = useRef<any>(null);



  const handleAddLocation = async () => {
    try {
      const locationData = {
        ...newLocation,
        createdAt: new Date().toISOString(),
        discoveredBy: 'Manual',
        contactCount: 0,
        dealCount: 0,
        salespersonCount: 0
      };

      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', company.id, 'locations');
      const docRef = await addDoc(locationsRef, locationData);
      
      const addedLocation = { id: docRef.id, ...locationData };
      setLocations(prev => [...prev, addedLocation]);
      
      setNewLocation({
        name: '',
        address: '',
        city: '',
        state: '',
        zipCode: '',
        country: 'USA',
        type: 'Office',
        division: '',
        coordinates: null
      });
      setShowAddForm(false);
    } catch (err) {
      console.error('Error adding location:', err);
      setError('Failed to add location');
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading locations...</Typography>
      </Box>
    );
  }



  return (
    <Box sx={{ p: 0 }}>
      {/* Header with AI Discovery Button */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0, mb: 1, py: 0, px: 3 }}>
        <Typography variant="h6" fontWeight={700}>
          Company Locations ({locations.length})
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {/* <Button
            variant="outlined"
            startIcon={<AutoAwesomeIcon />}
            onClick={discoverLocationsWithAI}
            disabled={aiLoading}
          >
            {aiLoading ? 'Discovering...' : 'AI Discover Locations'}
          </Button> */}
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowAddForm(true)}
          >
            Add Location
          </Button>
        </Box>
      </Box>
      {/* divider intentionally removed to keep layout compact */}

      {/* Error Display */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* AI Suggestions */}
      {/* {showSuggestions && suggestedLocations.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardHeader 
            title={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AutoAwesomeIcon color="primary" />
                <Typography>AI Discovered Locations</Typography>
              </Box>
            }
            action={
              <Button
                size="small"
                variant="outlined"
                onClick={addAllSuggestedLocations}
              >
                Add All
              </Button>
            }
          />
          <CardContent>
            <Grid container spacing={2}>
              {suggestedLocations.map((location, index) => (
                <Grid item xs={12} md={6} key={index}>
                  <Card variant="outlined">
                    <CardContent>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="subtitle1" fontWeight="bold">
                            {location.name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {location.address}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {location.city}, {location.state} {location.zipCode}
                          </Typography>
                          <Chip 
                            label={location.type} 
                            size="small" 
                            color="primary" 
                            sx={{ mt: 1 }}
                          />
                        </Box>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => addSuggestedLocation(location)}
                        >
                          Add
                        </Button>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>
      )} */}

      {/* Manual Add Form */}
      {showAddForm && (
        <Card sx={{ mb: 3 }}>
          <CardHeader title="Add New Location" titleTypographyProps={{ variant: 'h6' }} />
          <CardContent>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Location Name"
                  value={newLocation.name}
                  onChange={(e) => setNewLocation(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Headquarters, Manufacturing Plant"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Type"
                  select
                  value={newLocation.type}
                  onChange={(e) => setNewLocation(prev => ({ ...prev, type: e.target.value }))}
                >
                  <MenuItem value="Office">Office</MenuItem>
                  <MenuItem value="Warehouse">Warehouse</MenuItem>
                  <MenuItem value="Plant">Plant</MenuItem>
                  <MenuItem value="Distribution Center">Distribution Center</MenuItem>
                  <MenuItem value="Manufacturing">Manufacturing</MenuItem>
                  <MenuItem value="Retail">Retail</MenuItem>
                  <MenuItem value="Branch">Branch</MenuItem>
                  <MenuItem value="Headquarters">Headquarters</MenuItem>
                  <MenuItem value="Data Center">Data Center</MenuItem>
                  <MenuItem value="Call Center">Call Center</MenuItem>
                  <MenuItem value="Research & Development">Research & Development</MenuItem>
                  <MenuItem value="Training Center">Training Center</MenuItem>
                  <MenuItem value="Service Center">Service Center</MenuItem>
                  <MenuItem value="Showroom">Showroom</MenuItem>
                  <MenuItem value="Storage Facility">Storage Facility</MenuItem>
                </TextField>
              </Grid>
              {company.divisions && company.divisions.length > 0 && (
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth>
                    <InputLabel>Division (Optional)</InputLabel>
                    <Select
                      value={newLocation.division}
                      label="Division (Optional)"
                      onChange={(e) => setNewLocation(prev => ({ ...prev, division: e.target.value }))}
                    >
                      <MenuItem value="">
                        <em>No division</em>
                      </MenuItem>
                      {company.divisions.map((division: string) => (
                        <MenuItem key={division} value={division}>
                          {division}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              )}
              <Grid item xs={12}>
                <GoogleAutocomplete
                  onLoad={(ref) => {
                    console.log('GoogleAutocomplete onLoad called, ref:', ref);
                    autocompleteRef.current = ref;
                  }}
                  onPlaceChanged={() => {
                    const place = autocompleteRef.current.getPlace();
                    if (place.geometry && place.geometry.location) {
                      const lat = place.geometry.location.lat();
                      const lng = place.geometry.location.lng();
                      
                      // Extract address components
                      const addressComponents = place.address_components || [];
                      let streetNumber = '';
                      let route = '';
                      let city = '';
                      let state = '';
                      let zipCode = '';
                      let country = 'USA';

                      addressComponents.forEach((component) => {
                        const types = component.types;
                        if (types.includes('street_number')) {
                          streetNumber = component.long_name;
                        } else if (types.includes('route')) {
                          route = component.long_name;
                        } else if (types.includes('locality')) {
                          city = component.long_name;
                        } else if (types.includes('administrative_area_level_1')) {
                          state = component.short_name;
                        } else if (types.includes('postal_code')) {
                          zipCode = component.long_name;
                        } else if (types.includes('country')) {
                          country = component.short_name;
                        }
                      });

                      const fullAddress = streetNumber && route ? `${streetNumber} ${route}` : place.formatted_address || '';

                      setNewLocation(prev => ({
                        ...prev,
                        address: fullAddress,
                        city,
                        state,
                        zipCode,
                        country,
                        coordinates: {
                          lat,
                          lng
                        }
                      }));
                    }
                  }}
                >
                  <TextField
                    fullWidth
                    label="Address"
                    value={newLocation.address}
                    onChange={(e) => setNewLocation(prev => ({ ...prev, address: e.target.value }))}
                    placeholder="Start typing an address..."
                    InputProps={{
                      endAdornment: newLocation.coordinates && (
                        <Box sx={{ display: 'flex', alignItems: 'center', mr: 1 }}>
                          <Chip 
                            size="small" 
                            label="📍 GPS" 
                            color="success" 
                            variant="outlined"
                          />
                        </Box>
                      )
                    }}
                  />
                </GoogleAutocomplete>
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="City"
                  value={newLocation.city}
                  onChange={(e) => setNewLocation(prev => ({ ...prev, city: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="State"
                  value={newLocation.state}
                  onChange={(e) => setNewLocation(prev => ({ ...prev, state: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="ZIP Code"
                  value={newLocation.zipCode}
                  onChange={(e) => setNewLocation(prev => ({ ...prev, zipCode: e.target.value }))}
                />
              </Grid>
              {newLocation.coordinates && (
                <Grid item xs={12}>
                  <Box sx={{ 
                    p: 2, 
                    bgcolor: 'success.light', 
                    borderRadius: 1, 
                    border: '1px solid',
                    borderColor: 'success.main'
                  }}>
                    <Typography variant="subtitle2" color="success.dark" gutterBottom>
                      📍 GPS Coordinates Captured
                    </Typography>
                    <Typography variant="body2" color="success.dark">
                      Latitude: {newLocation.coordinates.lat.toFixed(6)} | Longitude: {newLocation.coordinates.lng.toFixed(6)}
                    </Typography>
                  </Box>
                </Grid>
              )}
            </Grid>
            <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
              <Button
                variant="contained"
                onClick={handleAddLocation}
                disabled={!newLocation.name || !newLocation.address}
              >
                Add Location
              </Button>
              <Button
                variant="outlined"
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Locations Table */}
      {locations.length > 0 ? (
        <Card sx={{ mb: 0 }}>
          <CardContent 
            className="no-bottom-padding"
            sx={{ 
              p: 0, 
              pb: 0,
              '&:last-child': {
                paddingBottom: '0 !important'
              },
              '&.no-bottom-padding': {
                paddingBottom: '0 !important'
              }
            }}
          >
            <TableContainer sx={{ pb: 0 }}>
              <Table sx={{ mb: 0 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Location Name</TableCell>
                    <TableCell>Address</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Division</TableCell>
                    <TableCell>Contacts</TableCell>
                    <TableCell>Deals</TableCell>
                    <TableCell>Salespeople</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody sx={{ mb: 0 }}>
                  {locations.map((location) => (
                    <TableRow key={location.id}>
                      <TableCell>
                        <Typography variant="subtitle2" fontWeight="bold">
                          {location.name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {location.address}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {location.city}, {location.state} {location.zipCode}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip 
                          label={location.type} 
                          size="small" 
                          color="primary"
                        />
                      </TableCell>
                      <TableCell>
                        {location.division ? (
                          <Chip 
                            label={location.division} 
                            size="small" 
                            color="secondary"
                            variant="outlined"
                          />
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            -
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {location.contactCount || 0}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {location.dealCount || 0}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {location.salespersonCount || 0}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<Visibility />}
                          onClick={() => handleViewLocation(location)}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      ) : (
        <Card sx={{ mb: 0 }}>
          <CardContent sx={{ 
            textAlign: 'center', 
            py: 4, 
            pb: 4,
            '&:last-child': {
              paddingBottom: 16
            }
          }}>
            <LocationOnIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No Locations Found
            </Typography>
            {/* <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Use AI to automatically discover company locations or add them manually.
            </Typography>
            <Button
              variant="contained"
              startIcon={<AutoAwesomeIcon />}
              onClick={discoverLocationsWithAI}
              disabled={aiLoading}
            >
              {aiLoading ? 'Discovering...' : 'Discover with AI'}
            </Button> */}
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

const ContactsTab: React.FC<{ contacts: any[]; company: any; locations: any[] }> = ({ contacts, company, locations }) => {
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddContactDialog, setShowAddContactDialog] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  
  // Contact form state
  const [contactForm, setContactForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    jobTitle: '',
    contactType: 'Unknown',
    tags: [],
    isActive: true,
    notes: ''
  });
  
  // Load locations if not provided
  const [companyLocations, setCompanyLocations] = useState<any[]>(locations);
  
  useEffect(() => {
    if (locations.length === 0 && company?.id && tenantId) {
      loadLocations();
    } else {
      setCompanyLocations(locations);
    }
  }, [locations, company?.id, tenantId]);

  const loadLocations = async () => {
    try {
      setLoading(true);
      const getCompanyLocations = httpsCallable(functions, 'getCompanyLocations');
      const result = await getCompanyLocations({ tenantId, companyId: company.id });
      const data = result.data as { locations: any[] };
      setCompanyLocations(data.locations || []);
    } catch (err) {
      console.error('Error loading locations:', err);
      setError('Failed to load locations');
    } finally {
      setLoading(false);
    }
  };

  const handleContactFormChange = (field: string, value: string | boolean | string[]) => {
    setContactForm(prev => ({ ...prev, [field]: value }));
  };

  const handleTagsChange = (newTags: string[]) => {
    setContactForm(prev => ({ ...prev, tags: newTags }));
  };

  const handleSaveContact = async () => {
    if (!contactForm.firstName || !contactForm.lastName) {
      setError('First name and last name are required');
      return;
    }

    setSavingContact(true);
    try {
      const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
      const { db } = await import('../../firebase');
      
      const contactData = {
        ...contactForm,
        fullName: `${contactForm.firstName} ${contactForm.lastName}`,
        tenantId,
        companyId: company.id,
        companyName: company.companyName || company.name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        salesOwnerId: currentUser?.uid || null,
        accountOwnerId: currentUser?.uid || null
      };

      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      await addDoc(contactsRef, contactData);

      // Reset form and close dialog
      setContactForm({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        jobTitle: '',
        contactType: 'Unknown',
        tags: [],
        isActive: true,
        notes: ''
      });
      setShowAddContactDialog(false);
      setSuccess(true);
      setSuccessMessage('Contact added successfully!');
      
      // Reload the page to refresh contacts
      window.location.reload();
    } catch (err: any) {
      console.error('Error adding contact:', err);
      setError(err.message || 'Failed to add contact');
    } finally {
      setSavingContact(false);
    }
  };

  const handleLocationChange = async (contactId: string, locationId: string | null) => {
    try {
      console.log('Updating location association:', {
        contactId,
        locationId,
        companyId: company.id,
        tenantId
      });
      
      const location = companyLocations.find(loc => loc.id === locationId);
      const updateLocationAssociation = httpsCallable(functions, 'updateLocationAssociation');
      
      try {
        const result = await updateLocationAssociation({
          tenantId,
          entityType: 'contact',
          entityId: contactId,
          locationId: locationId,
          companyId: company.id,
          locationName: location?.name || null
        });
        console.log('Location association update result:', result);
      } catch (callableErr) {
        console.warn('Callable failed, falling back to HTTP:', callableErr);
        const resp = await fetch('https://us-central1-hrx1-d3beb.cloudfunctions.net/updateLocationAssociationHttp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            entityType: 'contact',
            entityId: contactId,
            locationId: locationId,
            companyId: company.id,
            locationName: location?.name || null
          })
        });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`HTTP fallback failed: ${resp.status} ${errText}`);
        }
        console.log('HTTP fallback succeeded');
      }
      
      
      // Update the contact in the list
      // Note: In a real implementation, you'd want to refresh the contacts list
      // or update the specific contact in the state
    } catch (err: any) {
      console.error('Error updating location association via function:', err);
      
      // Fallback: Try direct Firestore update
      try {
        console.log('Attempting fallback direct update...');
        const { updateDoc, doc } = await import('firebase/firestore');
        const { db } = await import('../../firebase');
        
        const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
        const location = companyLocations.find(loc => loc.id === locationId);
        
        await updateDoc(contactRef, {
          locationId: locationId,
          locationName: location?.name || null,
          updatedAt: new Date()
        });
        
        console.log('Fallback update successful');
        // Clear any previous errors
        setError(null);
        
      } catch (fallbackErr: any) {
        console.error('Fallback update also failed:', fallbackErr);
        
        // Provide more specific error messages
        let errorMessage = 'Failed to update location association';
        if (err.message) {
          errorMessage = err.message;
        } else if (err.details?.message) {
          errorMessage = err.details.message;
        }
        
        setError(errorMessage);
      }
    }
  };
  
  return (
    <Grid container spacing={0}>
      <Grid item xs={12}>
        <Box sx={{ py: 0, px: 3}}>
          <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mt: 0, mb: 1 }}>
            <Typography variant="h6" fontWeight={700}>Contacts</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowAddContactDialog(true)}>Add Contact</Button>
          </Box>
        </Box>
      </Grid>
      <Grid item xs={12}>
        <Card>
          {/* <CardHeader 
            title={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PersonIcon />
                <Typography>Contacts ({contacts.length})</Typography>
              </Box>
            }
            action={
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={() => setShowAddContactDialog(true)}
              >
                Add Contact
              </Button>
            }
          /> */}
          <CardContent>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            
            {contacts.length > 0 ? (
              <TableContainer component={Paper} variant="outlined">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Title</TableCell>
                      <TableCell>Email</TableCell>
                      <TableCell>Phone</TableCell>
                      <TableCell>Location</TableCell>
                      <TableCell>LinkedIn</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {contacts.slice(0, 10).map((contact: any) => (
                      <TableRow key={contact.id}>
                        <TableCell>
                          <Typography>
                            {contact.fullName || contact.name}
                          </Typography>
                        </TableCell>
                        <TableCell>{contact.title || contact.jobTitle}</TableCell>
                        <TableCell>{contact.email}</TableCell>
                        <TableCell>{contact.phone}</TableCell>
                        <TableCell>
                          <FormControl size="small" sx={{ minWidth: 150 }}>
                            <Select
                              value={contact.locationId || ''}
                              onChange={(e) => handleLocationChange(contact.id, e.target.value || null)}
                              displayEmpty
                            >
                              <MenuItem value="">
                                <em>No location</em>
                              </MenuItem>
                              {companyLocations.map((location) => (
                                <MenuItem key={location.id} value={location.id}>
                                  {location.name}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell>
                          {contact.linkedinUrl ? (
                            <IconButton
                              size="small"
                              onClick={() => window.open(contact.linkedinUrl, '_blank')}
                              color="primary"
                              title="Open LinkedIn Profile"
                            >
                              <LinkedInIcon />
                            </IconButton>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              No LinkedIn
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<Visibility />}
                            onClick={() => navigate(`/crm/contacts/${contact.id}`)}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No contacts associated with this company
              </Typography>
            )}
            
            {contacts.length > 10 && (
              <Box sx={{ mt: 2, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  +{contacts.length - 10} more contacts
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>

      {/* Add Contact Dialog */}
      <Dialog open={showAddContactDialog} onClose={() => setShowAddContactDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Add New Contact</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="First Name"
                value={contactForm.firstName}
                onChange={(e) => handleContactFormChange('firstName', e.target.value)}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Last Name"
                value={contactForm.lastName}
                onChange={(e) => handleContactFormChange('lastName', e.target.value)}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={contactForm.email}
                onChange={(e) => handleContactFormChange('email', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Phone"
                value={contactForm.phone}
                onChange={(e) => handleContactFormChange('phone', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Job Title"
                value={contactForm.jobTitle}
                onChange={(e) => handleContactFormChange('jobTitle', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Contact Type</InputLabel>
                <Select
                  value={contactForm.contactType}
                  label="Contact Type"
                  onChange={(e) => handleContactFormChange('contactType', e.target.value)}
                >
                  <MenuItem value="Decision Maker">Decision Maker</MenuItem>
                  <MenuItem value="Influencer">Influencer</MenuItem>
                  <MenuItem value="Gatekeeper">Gatekeeper</MenuItem>
                  <MenuItem value="Referrer">Referrer</MenuItem>
                  <MenuItem value="Evaluator">Evaluator</MenuItem>
                  <MenuItem value="Unknown">Unknown</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={contactForm.isActive}
                    onChange={(e) => handleContactFormChange('isActive', e.target.checked)}
                    color="primary"
                  />
                }
                label="Active Contact"
              />
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                multiple
                freeSolo
                options={[]}
                value={contactForm.tags}
                onChange={(event, newValue) => handleTagsChange(newValue)}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      color="primary"
                    />
                  ))
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Tags"
                    placeholder="Add tags..."
                  />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Notes"
                multiline
                rows={3}
                value={contactForm.notes}
                onChange={(e) => handleContactFormChange('notes', e.target.value)}
              />
            </Grid>
            <Grid item xs={12}>
              <Alert severity="info">
                <Typography variant="body2">
                  This contact will be automatically associated with <strong>{company.companyName || company.name}</strong>.
                </Typography>
              </Alert>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddContactDialog(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveContact}
            variant="contained"
            disabled={savingContact || !contactForm.firstName || !contactForm.lastName}
            startIcon={savingContact ? <CircularProgress size={16} /> : null}
          >
            {savingContact ? 'Saving...' : 'Save Contact'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success Snackbar */}
      <Snackbar
        open={success}
        autoHideDuration={6000}
        onClose={() => setSuccess(false)}
      >
        <Alert onClose={() => setSuccess(false)} severity="success">
          {successMessage}
        </Alert>
      </Snackbar>
    </Grid>
  );
};

const OpportunitiesTab: React.FC<{ deals: any[]; company: any; locations: any[] }> = ({ deals, company, locations }) => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // New opportunity dialog state
  const [showNewOpportunityDialog, setShowNewOpportunityDialog] = useState(false);
  const [newOpportunityForm, setNewOpportunityForm] = useState({
    name: '',
    divisionId: '',
    locationId: '',
  });
  const [companyDivisions, setCompanyDivisions] = useState<any[]>([]);
  const [companyLocations, setCompanyLocations] = useState<any[]>(locations);
  const [loadingDivisions, setLoadingDivisions] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  
  // Calculate expected revenue range from qualification data
  const calculateExpectedRevenueRange = (deal: any) => {
    if (!deal.stageData?.qualification) {
      return { min: 0, max: 0, hasData: false };
    }

    const qualData = deal.stageData.qualification;
    const payRate = qualData.expectedAveragePayRate || 16; // Default to $16
    const markup = qualData.expectedAverageMarkup || 40; // Default to 40%
    const timeline = qualData.staffPlacementTimeline;

    if (!timeline) {
      return { min: 0, max: 0, hasData: false };
    }

    // Calculate bill rate: pay rate + markup
    const billRate = payRate * (1 + markup / 100);
    
    // Annual hours per employee (2080 full-time hours)
    const annualHoursPerEmployee = 2080;
    
    // Calculate annual revenue per employee
    const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
    
    // Get starting and 180-day numbers
    const startingCount = timeline.starting || 0;
    const after180DaysCount = timeline.after180Days || timeline.after90Days || timeline.after30Days || startingCount;
    
    // Calculate revenue range
    const minRevenue = annualRevenuePerEmployee * startingCount;
    const maxRevenue = annualRevenuePerEmployee * after180DaysCount;
    
    return {
      min: minRevenue,
      max: maxRevenue,
      hasData: startingCount > 0 || after180DaysCount > 0
    };
  };
  
  // Get expected close date from qualification stage
  const getExpectedCloseDate = (deal: any) => {
    if (!deal.stageData?.qualification?.expectedCloseDate) {
      return null;
    }
    
    // Debug logging to see what date we're getting
    console.log('Deal close date debug:', {
      dealId: deal.id,
      dealName: deal.name,
      expectedCloseDate: deal.stageData.qualification.expectedCloseDate,
      closeDate: deal.closeDate,
      stageData: deal.stageData?.qualification
    });
    
    const date = new Date(deal.stageData.qualification.expectedCloseDate);
    return date;
  };
  
  // Load locations if not provided
  useEffect(() => {
    if (locations.length === 0 && company?.id && tenantId) {
      loadLocations();
    } else {
      setCompanyLocations(locations);
    }
  }, [locations, company?.id, tenantId]);

  const loadLocations = async () => {
    try {
      setLoading(true);
      const getCompanyLocations = httpsCallable(functions, 'getCompanyLocations');
      const result = await getCompanyLocations({ tenantId, companyId: company.id });
      const data = result.data as { locations: any[] };
      setCompanyLocations(data.locations || []);
    } catch (err) {
      console.error('Error loading locations:', err);
      setError('Failed to load locations');
    } finally {
      setLoading(false);
    }
  };

  // Load company divisions
  const loadCompanyDivisions = async (companyId: string) => {
    try {
      setLoadingDivisions(true);
      const getCompanyDivisions = httpsCallable(functions, 'getCompanyDivisions');
      const result = await getCompanyDivisions({ tenantId, companyId });
      const data = result.data as { divisions: any[] };
      setCompanyDivisions(data.divisions || []);
    } catch (err) {
      console.error('Error loading company divisions:', err);
      setCompanyDivisions([]);
    } finally {
      setLoadingDivisions(false);
    }
  };

  // Load company locations for the dialog
  const loadCompanyLocationsForDialog = async (companyId: string) => {
    try {
      setLoadingLocations(true);
      const getCompanyLocations = httpsCallable(functions, 'getCompanyLocations');
      const result = await getCompanyLocations({ tenantId, companyId });
      const data = result.data as { locations: any[] };
      setCompanyLocations(data.locations || []);
    } catch (err) {
      console.error('Error loading company locations:', err);
      setCompanyLocations([]);
    } finally {
      setLoadingLocations(false);
    }
  };

  // Handle company selection (for divisions and locations)
  const handleCompanySelection = async (selectedCompany: any) => {
    if (selectedCompany?.id) {
      setNewOpportunityForm(prev => ({ ...prev, companyId: selectedCompany.id }));
      
      // Load divisions and locations for the selected company
      await Promise.all([
        loadCompanyDivisions(selectedCompany.id),
        loadCompanyLocationsForDialog(selectedCompany.id)
      ]);
    } else {
      setNewOpportunityForm(prev => ({ ...prev, companyId: '' }));
      setCompanyDivisions([]);
      setCompanyLocations([]);
    }
  };

  // Handle creating new opportunity
  const handleCreateNewOpportunity = async () => {
    if (!newOpportunityForm.name) {
      return; // Basic validation
    }

    try {
      setLoading(true);
      
      // Create the new opportunity
      const opportunityData = {
        name: newOpportunityForm.name,
        companyId: company.id, // Use the current company
        stage: 'qualification', // Default stage
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        associations: {
          companies: [company.id],
          salespeople: [], // Will be set by the system or user
          divisions: newOpportunityForm.divisionId ? [newOpportunityForm.divisionId] : [],
          locations: newOpportunityForm.locationId ? [newOpportunityForm.locationId] : [],
        },
        // Add division and location data if selected
        ...(newOpportunityForm.divisionId && { divisionId: newOpportunityForm.divisionId }),
        ...(newOpportunityForm.locationId && { locationId: newOpportunityForm.locationId }),
      };

      const opportunitiesRef = collection(db, `tenants/${tenantId}/crm_deals`);
      const docRef = await addDoc(opportunitiesRef, opportunityData);

      // Close dialog and reset form
      setShowNewOpportunityDialog(false);
      setNewOpportunityForm({
        name: '',
        divisionId: '',
        locationId: '',
      });
      setCompanyDivisions([]);
      setCompanyLocations([]);

      // Navigate to the new opportunity details
      navigate(`/crm/deals/${docRef.id}`);
    } catch (error) {
      console.error('Error creating new opportunity:', error);
      setError('Failed to create new opportunity');
    } finally {
      setLoading(false);
    }
  };

  const handleLocationChange = async (dealId: string, locationId: string | null) => {
    try {
      const location = companyLocations.find(loc => loc.id === locationId);
      const updateLocationAssociation = httpsCallable(functions, 'updateLocationAssociation');
      try {
        await updateLocationAssociation({
          tenantId,
          entityType: 'deal',
          entityId: dealId,
          locationId: locationId,
          companyId: company.id,
          locationName: location?.name || null
        });
      } catch (callableErr) {
        console.warn('Callable failed, falling back to HTTP:', callableErr);
        const resp = await fetch('https://us-central1-hrx1-d3beb.cloudfunctions.net/updateLocationAssociationHttp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            entityType: 'deal',
            entityId: dealId,
            locationId: locationId,
            companyId: company.id,
            locationName: location?.name || null
          })
        });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`HTTP fallback failed: ${resp.status} ${errText}`);
        }
      }
      
      // Update the deal in the list
      // Note: In a real implementation, you'd want to refresh the deals list
      // or update the specific deal in the state
    } catch (err) {
      console.error('Error updating location association:', err);
      setError('Failed to update location association');
    }
  };
  
  return (
    <Grid container spacing={0}>
      <Grid item xs={12}>
        <Box sx={{ p:0, pl:3, pr:3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mt: 0, mb: 1 }}>
            <Typography variant="h6" fontWeight={700}>Opportunities ({deals.length})</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowNewOpportunityDialog(true)}>Add Opportunity</Button>
          </Box>
        </Box>
      </Grid>
      <Grid item xs={12}>
        <Card>
          {/* <Box sx={{ py: 0, px: 3}}>
          <CardHeader 
            title={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 3 }}>
                <OpportunitiesIcon />
                <Typography variant="h6">Opportunities ({deals.length})</Typography>
              </Box>
            }
            action={
              <Button
    
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={() => setShowNewOpportunityDialog(true)}
              >
                Add New Opportunit
              </Button>
            }
          />
          </Box> */}
          <CardContent>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            
            {deals.length > 0 ? (
              <TableContainer component={Paper} variant="outlined">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Deal Name</TableCell>
                      <TableCell>Stage</TableCell>
                      <TableCell>Value</TableCell>
                      <TableCell>Probability</TableCell>
                      <TableCell>Close Date</TableCell>
                      <TableCell>Location</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {deals.slice(0, 10).map((deal: any) => (
                      <TableRow key={deal.id}>
                        <TableCell>
                          <Typography
                            sx={{ 
                              cursor: 'pointer',
                              color: 'primary.main',
                              textDecoration: 'underline',
                              '&:hover': {
                                color: 'primary.dark'
                              }
                            }}
                            onClick={() => navigate(`/crm/deals/${deal.id}`)}
                          >
                            {deal.name}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip 
                            label={deal.stage || 'Unknown Stage'} 
                            size="small" 
                            style={{
                              backgroundColor: getStageHexColor(deal.stage || ''),
                              color: getTextContrastColor(getStageHexColor(deal.stage || '')),
                              fontWeight: 600
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const revenueRange = calculateExpectedRevenueRange(deal);
                            if (revenueRange.hasData) {
                              return `$${revenueRange.min.toLocaleString()} - $${revenueRange.max.toLocaleString()}`;
                            }
                            return deal.estimatedRevenue ? `$${deal.estimatedRevenue.toLocaleString()}` : '-';
                          })()}
                        </TableCell>
                        <TableCell>
                          <Chip 
                            label={`${deal.probability || 0}%`} 
                            size="small" 
                            color={deal.probability > 50 ? 'success' : 'default'}
                          />
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const expectedCloseDate = getExpectedCloseDate(deal);
                            if (expectedCloseDate) {
                              return expectedCloseDate.toLocaleDateString();
                            }
                            // Fallback to regular closeDate if no qualification date
                            if (deal.closeDate) {
                              console.log('Using fallback closeDate:', deal.closeDate);
                              return new Date(deal.closeDate).toLocaleDateString();
                            }
                            return 'Not set';
                          })()}
                        </TableCell>
                        <TableCell>
                          <FormControl size="small" sx={{ minWidth: 150 }}>
                            <Select
                              value={(() => {
                                const locs = (deal.associations?.locations || []) as any[];
                                const first = locs.find(l => typeof l === 'object') || locs[0];
                                return typeof first === 'string' ? first : (first?.id || '');
                              })()}
                              onChange={(e) => handleLocationChange(deal.id, e.target.value || null)}
                              displayEmpty
                            >
                              <MenuItem value="">
                                <em>No location</em>
                              </MenuItem>
                              {companyLocations.map((location) => (
                                <MenuItem key={location.id} value={location.id}>
                                  {location.name}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => navigate(`/crm/deals/${deal.id}`)}
                              sx={{ minWidth: 'auto', px: 1 }}
                            >
                              View
                            </Button>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No opportunities associated with this company
              </Typography>
            )}
            
            {deals.length > 10 && (
              <Box sx={{ mt: 2, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  +{deals.length - 10} more opportunities
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>

      {/* New Opportunity Dialog */}
      <Dialog open={showNewOpportunityDialog} onClose={() => setShowNewOpportunityDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create New Opportunity</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Opportunity Name"
                value={newOpportunityForm.name}
                onChange={(e) => setNewOpportunityForm(prev => ({ ...prev, name: e.target.value }))}
                required
                placeholder="e.g., New Staffing Contract"
              />
            </Grid>
            <Grid item xs={12}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Company: {company.companyName || company.name}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Division (Optional)</InputLabel>
                <Select
                  value={newOpportunityForm.divisionId}
                  onChange={(e) => setNewOpportunityForm(prev => ({ ...prev, divisionId: e.target.value }))}
                  label="Division (Optional)"
                  disabled={loadingDivisions}
                >
                  <MenuItem value="">
                    <em>No division</em>
                  </MenuItem>
                  {companyDivisions.map((division) => (
                    <MenuItem key={division.id} value={division.id}>
                      {division.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Location (Optional)</InputLabel>
                <Select
                  value={newOpportunityForm.locationId}
                  onChange={(e) => setNewOpportunityForm(prev => ({ ...prev, locationId: e.target.value }))}
                  label="Location (Optional)"
                  disabled={loadingLocations}
                >
                  <MenuItem value="">
                    <em>No location</em>
                  </MenuItem>
                  {companyLocations.map((location) => (
                    <MenuItem key={location.id} value={location.id}>
                      {location.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowNewOpportunityDialog(false)} disabled={loading}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreateNewOpportunity} 
            variant="contained"
            disabled={!newOpportunityForm.name || loading}
          >
            {loading ? <CircularProgress size={20} /> : 'Create Opportunity'}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
};

const NotesTab: React.FC<{ company: any; tenantId: string }> = ({ company, tenantId }) => {
  return (
    <CRMNotesTab
      entityId={company.id}
      entityType="company"
      entityName={company.companyName || company.name || 'Company'}
      tenantId={tenantId}
    />
  );
};

// Helper function to scrape job postings from Google Jobs
const scrapeJobPostings = async (companyName: string): Promise<any[]> => {
  try {
    console.log(`Scraping job postings for: ${companyName}`);
    
    // Simulate Google Jobs search
    // In a real implementation, this would use:
    // 1. Google Jobs API
    // 2. SerpAPI for Google Jobs
    // 3. Diffbot Jobs API
    // 4. Or a custom scraper with proper rate limiting
    
    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Mock job data based on company name
    const companyLower = companyName.toLowerCase();
    let mockJobs = [];
    
    // Generate different jobs based on company name
    if (companyLower.includes('health') || companyLower.includes('care') || companyLower.includes('medical') || companyLower.includes('nursing') || companyLower.includes('bria')) {
      mockJobs = [
        {
          id: '1',
          title: 'Certified Nursing Assistant (CNA)',
          location: 'Palos Hills, IL',
          company: companyName,
          description: 'Provide direct patient care and support to residents in a healthcare setting. Experience in long-term care preferred.',
          postedDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          salary: '$20-25/hour',
          jobType: 'Full-time',
          url: 'https://indeed.com/viewjob?jk=bria1',
          keywords: ['healthcare', 'nursing', 'patient care', 'cna'],
          urgency: 'high'
        },
        {
          id: '2',
          title: 'Registered Nurse (RN)',
          location: 'Palos Hills, IL',
          company: companyName,
          description: 'Provide professional nursing care to residents. Must have valid RN license and experience in healthcare.',
          postedDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          salary: '$25-35/hour',
          jobType: 'Full-time',
          url: 'https://indeed.com/viewjob?jk=bria2',
          keywords: ['nursing', 'healthcare', 'rn', 'registered nurse'],
          urgency: 'medium'
        },
        {
          id: '3',
          title: 'Activities Coordinator',
          location: 'Palos Hills, IL',
          company: companyName,
          description: 'Plan and coordinate recreational activities for residents. Creative and energetic individual needed.',
          postedDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          salary: '$16-20/hour',
          jobType: 'Full-time',
          url: 'https://indeed.com/viewjob?jk=bria3',
          keywords: ['activities', 'recreation', 'coordination', 'healthcare'],
          urgency: 'high'
        }
      ];
    } else if (companyLower.includes('microsoft')) {
      mockJobs = [
        {
          id: '1',
          title: 'Software Engineer',
          location: 'Redmond, WA',
          company: companyName,
          description: 'Join our engineering team to build next-generation software solutions.',
          postedDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          salary: '$120,000-180,000/year',
          jobType: 'Full-time',
          url: 'https://indeed.com/viewjob?jk=ms1',
          keywords: ['software', 'engineering', 'development', 'programming'],
          urgency: 'high'
        },
        {
          id: '2',
          title: 'Product Manager',
          location: 'Redmond, WA',
          company: companyName,
          description: 'Lead product strategy and development for our cloud services platform.',
          postedDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          salary: '$140,000-200,000/year',
          url: 'https://indeed.com/viewjob?jk=ms2',
          keywords: ['product', 'management', 'strategy', 'cloud'],
          urgency: 'medium'
        }
      ];
    } else {
      // Default jobs for other companies
      mockJobs = [
        {
          id: '1',
          title: 'Warehouse Associate',
          location: 'Various Locations',
          company: companyName,
          description: 'We are seeking a reliable warehouse associate to join our team. Responsibilities include picking, packing, and shipping orders.',
          postedDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          salary: '$18-22/hour',
          jobType: 'Full-time',
          url: 'https://indeed.com/viewjob?jk=123456',
          keywords: ['warehouse', 'picking', 'shipping', 'forklift'],
          urgency: 'high'
        },
        {
          id: '2',
          title: 'Sales Representative',
          location: 'Remote',
          company: companyName,
          description: 'Join our sales team to help grow our business. Experience in sales preferred.',
          postedDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          salary: '$50,000-70,000/year',
          jobType: 'Full-time',
          url: 'https://indeed.com/viewjob?jk=123458',
          keywords: ['sales', 'business development', 'customer service'],
          urgency: 'low'
        }
      ];
    }
    
    console.log(`Found ${mockJobs.length} job postings for ${companyName}`);
    return mockJobs;
  } catch (error) {
    console.error('Error scraping job postings:', error);
    return [];
  }
};

const NewsTab: React.FC<{ company: any }> = ({ company }) => {
  const { tenantId } = useAuth();
  
  if (!company) {
    return (
      <Box sx={{ p: 0 }}>
        <Typography>Loading company information...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      <NewsEnrichmentPanel
        companyName={company.companyName || company.name || ''}
        companyId={company.id}
        tenantId={tenantId!}
        headquartersCity={company.headquartersCity || company.city}
        industry={company.industry}
      />
    </Box>
  );
};

const IndeedJobsTab: React.FC<{ 
  company: any; 
  jobPostings: any[]; 
  setJobPostings: (jobs: any[]) => void;
  jobsLoading: boolean;
  setJobsLoading: (loading: boolean) => void;
}> = ({ company, jobPostings, setJobPostings, jobsLoading, setJobsLoading }) => {
  
  const loadJobPostings = async () => {
    if (!company?.companyName && !company?.name) return;
    
    setJobsLoading(true);
    try {
      const scrapeIndeedJobs = httpsCallable(functions, 'scrapeIndeedJobs');
      const result = await scrapeIndeedJobs({ 
        companyName: company.companyName || company.name,
        indeedUrl: company.indeed || null
      });
      
      const data = result.data as { jobs: any[], source: string, message: string };
      console.log(`Job scraping result: ${data.message} (source: ${data.source})`);
      setJobPostings(data.jobs || []);
    } catch (error) {
      console.error('Error loading job postings:', error);
      // Fallback to mock data if Firebase Function fails
      try {
        const jobs = await scrapeJobPostings(company.companyName || company.name);
        setJobPostings(jobs);
      } catch (fallbackError) {
        console.error('Fallback job loading also failed:', fallbackError);
        setJobPostings([]);
      }
    }
    setJobsLoading(false);
  };

  useEffect(() => {
    if (company?.id) {
      // Clear existing jobs and load new ones for the current company
      setJobPostings([]);
      loadJobPostings();
    }
  }, [company?.id]); // Use company.id as dependency to trigger when company changes

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'high': return 'error';
      case 'medium': return 'warning';
      case 'low': return 'success';
      default: return 'default';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  const extractTopKeywords = (jobs: any[]) => {
    const keywordCount: { [key: string]: number } = {};
    
    jobs.forEach(job => {
      job.keywords?.forEach((keyword: string) => {
        keywordCount[keyword] = (keywordCount[keyword] || 0) + 1;
      });
    });
    
    return Object.entries(keywordCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([keyword]) => keyword);
  };

  const topKeywords = extractTopKeywords(jobPostings);

  return (
    <Box>
      <Box sx={{ p:0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0, mb: 1, px: 3 }}>
          <Typography variant="h6" fontWeight={700}>Job Postings</Typography>
          <Button
            variant="contained"
            startIcon={<RefreshIcon />}
            onClick={loadJobPostings}
            disabled={jobsLoading}
          >
            {jobsLoading ? 'Loading...' : 'Refresh Jobs'}
          </Button>
        </Box>
      </Box>

      {/* Job Insights */}
      {jobPostings.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardHeader title="Hiring Insights" titleTypographyProps={{ variant: 'h6' }} />
          <CardContent>
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="h4" color="primary">
                    {jobPostings.length}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Active Job Postings
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={12} md={4}>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="h4" color="warning.main">
                    {jobPostings.filter(job => job.urgency === 'high').length}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Urgent Positions
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={12} md={4}>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="h4" color="success.main">
                    {jobPostings.filter(job => job.jobType === 'Full-time').length}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Full-time Roles
                  </Typography>
                </Box>
              </Grid>
            </Grid>
            
            {topKeywords.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Top Keywords:
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {topKeywords.map((keyword, index) => (
                    <Chip
                      key={index}
                      label={keyword}
                      size="small"
                      variant="outlined"
                      color="primary"
                    />
                  ))}
                </Box>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {/* Job Listings */}
      {jobsLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : jobPostings.length > 0 ? (
        <Grid container spacing={2}>
          {jobPostings.map((job) => (
            <Grid item xs={12} key={job.id}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Box>
                      <Typography variant="h6" gutterBottom>
                        {job.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        📍 {job.location} • 💼 {job.jobType}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Chip
                        label={job.urgency}
                        size="small"
                        color={getUrgencyColor(job.urgency)}
                        variant="outlined"
                      />
                      <IconButton
                        size="small"
                        onClick={() => window.open(job.url, '_blank')}
                        title="View on Indeed"
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>
                  
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    {job.description}
                  </Typography>
                  
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      💰 {job.salary}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Posted {formatDate(job.postedDate)}
                    </Typography>
                  </Box>
                  
                  {job.keywords && job.keywords.length > 0 && (
                    <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {job.keywords.slice(0, 3).map((keyword: string, index: number) => (
                        <Chip
                          key={index}
                          label={keyword}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: '0.7rem' }}
                        />
                      ))}
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : (
        <Card>
          <CardContent>
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <WorkIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No Job Postings Found
              </Typography>
              <Typography variant="body2" color="text.secondary">
                No active job postings were found for this company.
              </Typography>
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

// Order Defaults Tab Component
const VendorProcessTab: React.FC<{ company: any; tenantId: string }> = ({ company, tenantId }) => {
  const [steps, setSteps] = useState<any[]>([]);
  const [salespeople, setSalespeople] = useState<any[]>([]);
  const [companyContacts, setCompanyContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [addStepDialogOpen, setAddStepDialogOpen] = useState(false);
  const [addSalespersonDialogOpen, setAddSalespersonDialogOpen] = useState(false);
  const [addContactDialogOpen, setAddContactDialogOpen] = useState(false);

  // Form states
  const [newStep, setNewStep] = useState({ title: '', description: '', status: 'Not Started' });
  const [selectedSalesperson, setSelectedSalesperson] = useState('');
  const [selectedContact, setSelectedContact] = useState('');

  // Load vendor process data
  useEffect(() => {
    const loadVendorProcessData = async () => {
      try {
        setLoading(true);
        
        // Load company contacts
        const contactsQuery = query(
          collection(db, 'tenants', tenantId, 'crm_contacts'),
          where('companyId', '==', company.id)
        );
        const contactsSnapshot = await getDocs(contactsQuery);
        const contactsData = contactsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setCompanyContacts(contactsData);

        // Load salespeople (users with crm_sales: true)
        const salespeopleQuery = query(
          collection(db, 'users'),
          where('crm_sales', '==', true)
        );
        const salespeopleSnapshot = await getDocs(salespeopleQuery);
        const salespeopleData = salespeopleSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setSalespeople(salespeopleData);

        // Load existing vendor process data
        const companyDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id));
        const companyData = companyDoc.data();
        if (companyData?.vendorProcess) {
          setSteps(companyData.vendorProcess.steps || []);
        }
      } catch (err) {
        console.error('Error loading vendor process data:', err);
        setError('Failed to load vendor process data');
      } finally {
        setLoading(false);
      }
    };

    if (company?.id) {
      loadVendorProcessData();
    }
  }, [company?.id, tenantId]);

  const handleSaveVendorProcess = async () => {
    try {
      setSaving(true);
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id), {
        vendorProcess: {
          steps: steps,
          salespeople: salespeople.filter(s => s.selected),
          companyContacts: companyContacts.filter(c => c.selected)
        },
        updatedAt: serverTimestamp()
      });
      setSuccess('Vendor process saved successfully');
    } catch (err) {
      console.error('Error saving vendor process:', err);
      setError('Failed to save vendor process');
    } finally {
      setSaving(false);
    }
  };

  const handleAddStep = () => {
    if (newStep.title.trim()) {
      setSteps(prev => [...prev, { ...newStep, id: Date.now().toString() }]);
      setNewStep({ title: '', description: '', status: 'Not Started' });
      setAddStepDialogOpen(false);
    }
  };

  const handleAddSalesperson = () => {
    if (selectedSalesperson) {
      setSalespeople(prev => prev.map(s => 
        s.id === selectedSalesperson ? { ...s, selected: true } : s
      ));
      setSelectedSalesperson('');
      setAddSalespersonDialogOpen(false);
    }
  };

  const handleAddContact = () => {
    if (selectedContact) {
      setCompanyContacts(prev => prev.map(c => 
        c.id === selectedContact ? { ...c, selected: true } : c
      ));
      setSelectedContact('');
      setAddContactDialogOpen(false);
    }
  };

  const handleRemoveSalesperson = (salespersonId: string) => {
    setSalespeople(prev => prev.map(s => 
      s.id === salespersonId ? { ...s, selected: false } : s
    ));
  };

  const handleRemoveContact = (contactId: string) => {
    setCompanyContacts(prev => prev.map(c => 
      c.id === contactId ? { ...c, selected: false } : c
    ));
  };

  const handleUpdateStepStatus = (stepId: string, newStatus: string) => {
    setSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, status: newStatus } : step
    ));
  };

  const handleDeleteStep = (stepId: string) => {
    setSteps(prev => prev.filter(step => step.id !== stepId));
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 0, mb: 0 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, pl: 3 }}>
        <Typography variant="h6" sx={{ fontWeight:700 }}>
          Vendor Process
        </Typography>
        {/* <Button
          variant="contained"
          onClick={handleSaveVendorProcess}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : null}
        >
          {saving ? 'Saving...' : 'Save Process'}
        </Button> */}
      </Box>

      <Grid container spacing={3}>
        {/* Steps Card */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardHeader
              title="Steps"
              titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
              action={
                <IconButton onClick={() => setAddStepDialogOpen(true)}>
                  <AddIcon />
                </IconButton>
              }
            />
            <CardContent>
              {steps.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {steps.map((step) => (
                    <Box key={step.id} sx={{ 
                      p: 2, 
                      border: '1px solid', 
                      borderColor: 'grey.300', 
                      borderRadius: 1,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body1" fontWeight="medium">
                          {step.title}
                        </Typography>
                        {step.description && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {step.description}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <FormControl size="small" sx={{ minWidth: 120 }}>
                          <Select
                            value={step.status}
                            onChange={(e) => handleUpdateStepStatus(step.id, e.target.value)}
                            displayEmpty
                          >
                            <MenuItem value="Not Started">Not Started</MenuItem>
                            <MenuItem value="In Process">In Process</MenuItem>
                            <MenuItem value="Completed">Completed</MenuItem>
                            <MenuItem value="Cancelled">Cancelled</MenuItem>
                          </Select>
                        </FormControl>
                        <IconButton 
                          size="small" 
                          color="error"
                          onClick={() => handleDeleteStep(step.id)}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    No steps defined yet
                  </Typography>
                  <Button 
                    variant="outlined" 
                    startIcon={<AddIcon />}
                    onClick={() => setAddStepDialogOpen(true)}
                    sx={{ mt: 1 }}
                  >
                    Add First Step
                  </Button>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Right Column */}
        <Grid item xs={12} md={4}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Salespeople Card */}
            <Card>
              <CardHeader
                title="Salespeople"
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                action={
                  <IconButton onClick={() => setAddSalespersonDialogOpen(true)}>
                    <AddIcon />
                  </IconButton>
                }
              />
              <CardContent>
                {salespeople.filter(s => s.selected).length > 0 ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {salespeople.filter(s => s.selected).map((salesperson) => (
                      <Box key={salesperson.id} sx={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        p: 1,
                        bgcolor: 'grey.50',
                        borderRadius: 1
                      }}>
                        <Typography variant="body2">
                          {salesperson.displayName || salesperson.name || salesperson.email}
                        </Typography>
                        <IconButton 
                          size="small" 
                          onClick={() => handleRemoveSalesperson(salesperson.id)}
                        >
                          <DeleteIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No salespeople selected
                  </Typography>
                )}
              </CardContent>
            </Card>

            {/* Company Contacts Card */}
            <Card>
              <CardHeader
                title="Company Contacts"
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                action={
                  <IconButton onClick={() => setAddContactDialogOpen(true)}>
                    <AddIcon />
                  </IconButton>
                }
              />
              <CardContent>
                {companyContacts.filter(c => c.selected).length > 0 ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {companyContacts.filter(c => c.selected).map((contact) => (
                      <Box key={contact.id} sx={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        p: 1,
                        bgcolor: 'grey.50',
                        borderRadius: 1
                      }}>
                        <Typography variant="body2">
                          {contact.firstName} {contact.lastName}
                        </Typography>
                        <IconButton 
                          size="small" 
                          onClick={() => handleRemoveContact(contact.id)}
                        >
                          <DeleteIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No company contacts selected
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Box>
        </Grid>
      </Grid>

      {/* Add Step Dialog */}
      <Dialog open={addStepDialogOpen} onClose={() => setAddStepDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Step</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Title"
              value={newStep.title}
              onChange={(e) => setNewStep(prev => ({ ...prev, title: e.target.value }))}
              fullWidth
              size="small"
            />
            <TextField
              label="Description"
              value={newStep.description}
              onChange={(e) => setNewStep(prev => ({ ...prev, description: e.target.value }))}
              fullWidth
              multiline
              rows={3}
              size="small"
            />
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select
                value={newStep.status}
                onChange={(e) => setNewStep(prev => ({ ...prev, status: e.target.value }))}
                label="Status"
              >
                <MenuItem value="Not Started">Not Started</MenuItem>
                <MenuItem value="In Process">In Process</MenuItem>
                <MenuItem value="Completed">Completed</MenuItem>
                <MenuItem value="Cancelled">Cancelled</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddStepDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleAddStep} variant="contained">Add Step</Button>
        </DialogActions>
      </Dialog>

      {/* Add Salesperson Dialog */}
      <Dialog open={addSalespersonDialogOpen} onClose={() => setAddSalespersonDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Salesperson</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {salespeople.filter(s => !s.selected).length > 0 
                ? 'Select a salesperson to add to this vendor process:'
                : 'No available salespeople to add'
              }
            </Typography>
            {salespeople.filter(s => !s.selected).length > 0 && (
              <FormControl fullWidth size="small">
                <InputLabel>Select salesperson</InputLabel>
                <Select
                  value={selectedSalesperson}
                  onChange={(e) => setSelectedSalesperson(e.target.value)}
                  label="Select salesperson"
                >
                  {salespeople.filter(s => !s.selected).map((salesperson) => (
                    <MenuItem key={salesperson.id} value={salesperson.id}>
                      {salesperson.displayName || salesperson.name || salesperson.email}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddSalespersonDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleAddSalesperson} 
            variant="contained"
            disabled={!selectedSalesperson}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Contact Dialog */}
      <Dialog open={addContactDialogOpen} onClose={() => setAddContactDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Company Contact</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {companyContacts.filter(c => !c.selected).length > 0 
                ? 'Select a contact to add to this vendor process:'
                : 'No available contacts to add'
              }
            </Typography>
            {companyContacts.filter(c => !c.selected).length > 0 && (
              <FormControl fullWidth size="small">
                <InputLabel>Select contact</InputLabel>
                <Select
                  value={selectedContact}
                  onChange={(e) => setSelectedContact(e.target.value)}
                  label="Select contact"
                >
                  {companyContacts.filter(c => !c.selected).map((contact) => (
                    <MenuItem key={contact.id} value={contact.id}>
                      {contact.firstName} {contact.lastName}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddContactDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleAddContact} 
            variant="contained"
            disabled={!selectedContact}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success/Error Snackbars */}
      <Snackbar open={!!success} autoHideDuration={4000} onClose={() => setSuccess(null)}>
        <Alert severity="success" onClose={() => setSuccess(null)} sx={{ width: '100%' }}>
          {success}
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

const OrderDefaultsTab: React.FC<{ company: any; tenantId: string; tenantName: string }> = ({ company, tenantId, tenantName }) => {
  const [orderDefaults, setOrderDefaults] = useState<any>({
    backgroundCheckRequired: false,
    backgroundCheckTypes: [],
    drugScreenRequired: false,
    drugScreenTypes: [],
    steelToeRequired: false,
    uniformRequirements: '',
    eVerifyRequired: false,
    badgePPEProvidedBy: '',
    otherSafetyComplianceNotes: '',
    timeClockSystem: '',
    timecardApprovalProcess: '',
    overtimePolicy: '',
    attendanceExpectations: '',
    callOffProcedure: '',
    noCallNoShowPolicy: '',
    injuryReportingContact: '',
    injuryReportingNotes: '',
    performanceMetricsShared: false,
    disciplinaryProcess: '',
    otherTimeAttendanceNotes: '',
    clientBillingTerms: '',
    rateSheet: null,
    rateSheetTitle: '',
    rateSheetDealId: '',
    msaSigned: false,
    msaExpirationDate: null,
    poRequired: false,
    invoiceContact: '',
    invoiceDeliveryMethod: '',
    invoiceFrequency: '',
    contracts: []
  });

  const [contacts, setContacts] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load order defaults and related data
  useEffect(() => {
    const loadOrderDefaults = async () => {
      try {
        setLoading(true);
        
        // Load company contacts
        const contactsQuery = query(
          collection(db, 'tenants', tenantId, 'crm_contacts'),
          where('companyId', '==', company.id)
        );
        const contactsSnapshot = await getDocs(contactsQuery);
        const contactsData = contactsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setContacts(contactsData);

        // Load company deals
        const dealsQuery = query(
          collection(db, 'tenants', tenantId, 'crm_deals'),
          where('companyId', '==', company.id)
        );
        const dealsSnapshot = await getDocs(dealsQuery);
        const dealsData = dealsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setDeals(dealsData);

        // Load existing order defaults
        const orderDefaultsDoc = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id));
        const companyData = orderDefaultsDoc.data();
        if (companyData?.orderDefaults) {
          setOrderDefaults(prev => ({ ...prev, ...companyData.orderDefaults }));
        }
      } catch (err) {
        console.error('Error loading order defaults:', err);
        setError('Failed to load order defaults');
      } finally {
        setLoading(false);
      }
    };

    if (company?.id) {
      loadOrderDefaults();
    }
  }, [company?.id]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', company.id), {
        orderDefaults: orderDefaults,
        updatedAt: serverTimestamp()
      });
      setSuccess('Order defaults saved successfully');
    } catch (err) {
      console.error('Error saving order defaults:', err);
      setError('Failed to save order defaults');
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange = (field: string, value: any) => {
    setOrderDefaults(prev => ({ ...prev, [field]: value }));
  };

  const handleBackgroundCheckTypeAdd = () => {
    setOrderDefaults(prev => ({
      ...prev,
      backgroundCheckTypes: [...prev.backgroundCheckTypes, '']
    }));
  };

  const handleBackgroundCheckTypeChange = (index: number, value: string) => {
    setOrderDefaults(prev => ({
      ...prev,
      backgroundCheckTypes: prev.backgroundCheckTypes.map((type: string, i: number) => 
        i === index ? value : type
      )
    }));
  };

  const handleBackgroundCheckTypeRemove = (index: number) => {
    setOrderDefaults(prev => ({
      ...prev,
      backgroundCheckTypes: prev.backgroundCheckTypes.filter((_: string, i: number) => i !== index)
    }));
  };

  const handleDrugScreenTypeAdd = () => {
    setOrderDefaults(prev => ({
      ...prev,
      drugScreenTypes: [...prev.drugScreenTypes, '']
    }));
  };

  const handleDrugScreenTypeChange = (index: number, value: string) => {
    setOrderDefaults(prev => ({
      ...prev,
      drugScreenTypes: prev.drugScreenTypes.map((type: string, i: number) => 
        i === index ? value : type
      )
    }));
  };

  const handleDrugScreenTypeRemove = (index: number) => {
    setOrderDefaults(prev => ({
      ...prev,
      drugScreenTypes: prev.drugScreenTypes.filter((_: string, i: number) => i !== index)
    }));
  };

  const handleContractAdd = () => {
    setOrderDefaults(prev => ({
      ...prev,
      contracts: [...prev.contracts, { name: '', description: '', dealId: '' }]
    }));
  };

  const handleContractChange = (index: number, field: string, value: string) => {
    setOrderDefaults(prev => ({
      ...prev,
      contracts: prev.contracts.map((contract: any, i: number) => 
        i === index ? { ...contract, [field]: value } : contract
      )
    }));
  };

  const handleContractRemove = (index: number) => {
    setOrderDefaults(prev => ({
      ...prev,
      contracts: prev.contracts.filter((_: any, i: number) => i !== index)
    }));
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 0, mb: 0 }}>
      <Grid container spacing={3}>
        {/* Safety & Compliance Section */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader
              title="Safety & Compliance"
              titleTypographyProps={{ variant: 'h6' }}
              avatar={<SecurityIcon color="primary" />}
            />
            <CardContent>
              <Grid container spacing={2}>
                                 {/* Background Check */}
                 <Grid item xs={12}>
                   <FormControl component="fieldset">
                     <FormControlLabel
                       control={
                         <Switch
                           checked={orderDefaults.backgroundCheckRequired}
                           onChange={(e) => handleFieldChange('backgroundCheckRequired', e.target.checked)}
                         />
                       }
                       label="Background Check Required?"
                     />
                   </FormControl>
                   {orderDefaults.backgroundCheckRequired && (
                     <Box sx={{ mt: 2, ml: 3 }}>
                       <Typography variant="body2" color="text.secondary" gutterBottom>
                         What check(s):
                       </Typography>
                       {orderDefaults.backgroundCheckTypes.map((type: string, index: number) => (
                         <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                           <TextField
                             size="small"
                             value={type}
                             onChange={(e) => handleBackgroundCheckTypeChange(index, e.target.value)}
                             placeholder="e.g., Criminal background, etc."
                             fullWidth
                           />
                           <IconButton
                             size="small"
                             onClick={() => handleBackgroundCheckTypeRemove(index)}
                             color="error"
                           >
                             <DeleteIcon />
                           </IconButton>
                         </Box>
                       ))}
                       <Button
                         size="small"
                         startIcon={<AddIcon />}
                         onClick={handleBackgroundCheckTypeAdd}
                         sx={{ mt: 1 }}
                       >
                         Add Check Type
                       </Button>
                     </Box>
                   )}
                 </Grid>

                 {/* Drug Screen */}
                 <Grid item xs={12}>
                   <FormControl component="fieldset">
                     <FormControlLabel
                       control={
                         <Switch
                           checked={orderDefaults.drugScreenRequired}
                           onChange={(e) => handleFieldChange('drugScreenRequired', e.target.checked)}
                         />
                       }
                       label="Drug Screen Required?"
                     />
                   </FormControl>
                   {orderDefaults.drugScreenRequired && (
                     <Box sx={{ mt: 2, ml: 3 }}>
                       <Typography variant="body2" color="text.secondary" gutterBottom>
                         Drug Screen Type(s):
                       </Typography>
                       {orderDefaults.drugScreenTypes.map((type: string, index: number) => (
                         <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                           <TextField
                             size="small"
                             value={type}
                             onChange={(e) => handleDrugScreenTypeChange(index, e.target.value)}
                             placeholder="e.g., 5-panel, 10-panel, etc."
                             fullWidth
                           />
                           <IconButton
                             size="small"
                             onClick={() => handleDrugScreenTypeRemove(index)}
                             color="error"
                           >
                             <DeleteIcon />
                           </IconButton>
                         </Box>
                       ))}
                       <Button
                         size="small"
                         startIcon={<AddIcon />}
                         onClick={handleDrugScreenTypeAdd}
                         sx={{ mt: 1 }}
                       >
                         Add Drug Screen Type
                       </Button>
                     </Box>
                   )}
                 </Grid>

                {/* Steel Toe */}
                <Grid item xs={12}>
                  <FormControl component="fieldset">
                    <FormControlLabel
                      control={
                        <Switch
                          checked={orderDefaults.steelToeRequired}
                          onChange={(e) => handleFieldChange('steelToeRequired', e.target.checked)}
                        />
                      }
                      label="Steel Toe Required?"
                    />
                  </FormControl>
                </Grid>

                {/* Uniform Requirements */}
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Uniform Requirements"
                    value={orderDefaults.uniformRequirements}
                    onChange={(e) => handleFieldChange('uniformRequirements', e.target.value)}
                    multiline
                    rows={2}
                  />
                </Grid>

                {/* E-Verify */}
                <Grid item xs={12}>
                  <FormControl component="fieldset">
                    <FormControlLabel
                      control={
                        <Switch
                          checked={orderDefaults.eVerifyRequired}
                          onChange={(e) => handleFieldChange('eVerifyRequired', e.target.checked)}
                        />
                      }
                      label="E-Verify Required?"
                    />
                  </FormControl>
                </Grid>

                                 {/* Badge/PPE Provided By */}
                 <Grid item xs={12}>
                   <FormControl fullWidth>
                     <InputLabel>Badge/PPE Provided By</InputLabel>
                     <Select
                       value={orderDefaults.badgePPEProvidedBy}
                       onChange={(e) => handleFieldChange('badgePPEProvidedBy', e.target.value)}
                       label="Badge/PPE Provided By"
                     >
                       <MenuItem value="">Select provider</MenuItem>
                       <MenuItem value={company?.companyName || company?.name || 'Company'}>
                         {company?.companyName || company?.name || 'Company'}
                       </MenuItem>
                       <MenuItem value={tenantName}>
                         {tenantName}
                       </MenuItem>
                     </Select>
                   </FormControl>
                 </Grid>

                 {/* Other Safety & Compliance Notes */}
                 <Grid item xs={12}>
                   <TextField
                     fullWidth
                     label="Other Safety & Compliance Notes"
                     value={orderDefaults.otherSafetyComplianceNotes}
                     onChange={(e) => handleFieldChange('otherSafetyComplianceNotes', e.target.value)}
                     multiline
                     rows={3}
                     placeholder="Additional safety requirements, compliance notes, or special instructions..."
                   />
                 </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Time & Attendance Section */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader
              title="Time & Attendance"
              titleTypographyProps={{ variant: 'h6' }}
              avatar={<TimeClockIcon color="primary" />}
            />
            <CardContent>
              <Grid container spacing={2}>
                {/* Time Clock System */}
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Time Clock System Used"
                    value={orderDefaults.timeClockSystem}
                    onChange={(e) => handleFieldChange('timeClockSystem', e.target.value)}
                  />
                </Grid>

                {/* Timecard Approval Process */}
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Timecard Approval Process"
                    value={orderDefaults.timecardApprovalProcess}
                    onChange={(e) => handleFieldChange('timecardApprovalProcess', e.target.value)}
                    multiline
                    rows={2}
                  />
                </Grid>

                {/* Overtime Policy */}
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Overtime Policy"
                    value={orderDefaults.overtimePolicy}
                    onChange={(e) => handleFieldChange('overtimePolicy', e.target.value)}
                    multiline
                    rows={2}
                  />
                </Grid>

                {/* Attendance Expectations */}
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Attendance Expectations"
                    value={orderDefaults.attendanceExpectations}
                    onChange={(e) => handleFieldChange('attendanceExpectations', e.target.value)}
                    multiline
                    rows={2}
                  />
                </Grid>

                {/* Call-Off Procedure */}
                <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel>Call-Off Procedure</InputLabel>
                    <Select
                      value={orderDefaults.callOffProcedure}
                      onChange={(e) => handleFieldChange('callOffProcedure', e.target.value)}
                      label="Call-Off Procedure"
                    >
                      <MenuItem value="Phone, text, direct supervisor">Phone, text, direct supervisor</MenuItem>
                      <MenuItem value="custom">Custom (specify below)</MenuItem>
                    </Select>
                  </FormControl>
                  {orderDefaults.callOffProcedure === 'custom' && (
                    <TextField
                      fullWidth
                      label="Custom Call-Off Procedure"
                      value={orderDefaults.customCallOffProcedure || ''}
                      onChange={(e) => handleFieldChange('customCallOffProcedure', e.target.value)}
                      multiline
                      rows={2}
                      sx={{ mt: 1 }}
                    />
                  )}
                </Grid>

                {/* No Call/No Show Policy */}
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="No Call/No Show Policy"
                    value={orderDefaults.noCallNoShowPolicy}
                    onChange={(e) => handleFieldChange('noCallNoShowPolicy', e.target.value)}
                    multiline
                    rows={2}
                  />
                </Grid>

                                 {/* Injury Reporting Contact */}
                 <Grid item xs={12}>
                   <FormControl fullWidth>
                     <InputLabel>Injury Reporting Contact</InputLabel>
                     <Select
                       value={orderDefaults.injuryReportingContact}
                       onChange={(e) => handleFieldChange('injuryReportingContact', e.target.value)}
                       label="Injury Reporting Contact"
                     >
                       <MenuItem value="">Select a contact</MenuItem>
                       {contacts.map((contact) => (
                         <MenuItem key={contact.id} value={contact.id}>
                           {contact.firstName} {contact.lastName} - {contact.title || 'No title'}
                         </MenuItem>
                       ))}
                     </Select>
                   </FormControl>
                 </Grid>

                 {/* Injury Reporting Notes */}
                 <Grid item xs={12}>
                   <TextField
                     fullWidth
                     label="Injury Reporting Notes"
                     value={orderDefaults.injuryReportingNotes}
                     onChange={(e) => handleFieldChange('injuryReportingNotes', e.target.value)}
                     multiline
                     rows={2}
                     placeholder="Additional notes about injury reporting procedures..."
                   />
                 </Grid>

                 {/* Performance Metrics Shared */}
                 <Grid item xs={12}>
                   <FormControl component="fieldset">
                     <FormControlLabel
                       control={
                         <Switch
                           checked={orderDefaults.performanceMetricsShared}
                           onChange={(e) => handleFieldChange('performanceMetricsShared', e.target.checked)}
                         />
                       }
                       label="Performance Metrics Shared?"
                     />
                   </FormControl>
                 </Grid>

                 {/* Disciplinary Process */}
                 <Grid item xs={12}>
                   <TextField
                     fullWidth
                     label="Disciplinary Process"
                     value={orderDefaults.disciplinaryProcess}
                     onChange={(e) => handleFieldChange('disciplinaryProcess', e.target.value)}
                     multiline
                     rows={2}
                     placeholder="Describe the disciplinary process and procedures..."
                   />
                 </Grid>

                 {/* Other Time & Attendance Notes */}
                 <Grid item xs={12}>
                   <TextField
                     fullWidth
                     label="Other Time & Attendance Notes"
                     value={orderDefaults.otherTimeAttendanceNotes}
                     onChange={(e) => handleFieldChange('otherTimeAttendanceNotes', e.target.value)}
                     multiline
                     rows={3}
                     placeholder="Additional time and attendance policies, procedures, or special instructions..."
                   />
                 </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

                {/* Billing & Invoicing Section */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader
              title="Billing & Invoicing"
              titleTypographyProps={{ variant: 'h6' }}
              avatar={<BillingIcon color="primary" />}
            />
            <CardContent>
              <Grid container spacing={2}>
                {/* Client Billing Terms */}
                <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel>Client Billing Terms</InputLabel>
                    <Select
                      value={orderDefaults.clientBillingTerms}
                      onChange={(e) => handleFieldChange('clientBillingTerms', e.target.value)}
                      label="Client Billing Terms"
                    >
                      <MenuItem value="Net 7">Net 7</MenuItem>
                      <MenuItem value="Net 15">Net 15</MenuItem>
                      <MenuItem value="Net 30">Net 30</MenuItem>
                      <MenuItem value="Net 45">Net 45</MenuItem>
                      <MenuItem value="Net 60">Net 60</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                {/* PO Required */}
                <Grid item xs={12}>
                  <FormControl component="fieldset">
                    <FormControlLabel
                      control={
                        <Switch
                          checked={orderDefaults.poRequired}
                          onChange={(e) => handleFieldChange('poRequired', e.target.checked)}
                        />
                      }
                      label="PO Required?"
                    />
                  </FormControl>
                </Grid>

                {/* Invoice Contact */}
                <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel>Invoice Contact</InputLabel>
                    <Select
                      value={orderDefaults.invoiceContact}
                      onChange={(e) => handleFieldChange('invoiceContact', e.target.value)}
                      label="Invoice Contact"
                    >
                      <MenuItem value="">Select a contact</MenuItem>
                      {contacts.map((contact) => (
                        <MenuItem key={contact.id} value={contact.id}>
                          {contact.firstName} {contact.lastName} - {contact.title || 'No title'}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                {/* Invoice Delivery Method */}
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Invoice Delivery Method"
                    value={orderDefaults.invoiceDeliveryMethod}
                    onChange={(e) => handleFieldChange('invoiceDeliveryMethod', e.target.value)}
                    placeholder="e.g., Email, Mail, Portal"
                  />
                </Grid>

                {/* Invoice Frequency */}
                <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel>Invoice Frequency</InputLabel>
                    <Select
                      value={orderDefaults.invoiceFrequency}
                      onChange={(e) => handleFieldChange('invoiceFrequency', e.target.value)}
                      label="Invoice Frequency"
                    >
                      <MenuItem value="Weekly">Weekly</MenuItem>
                      <MenuItem value="Biweekly">Biweekly</MenuItem>
                      <MenuItem value="Monthly">Monthly</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Contracts and Rate Sheets Section */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader
              title="Contracts and Rate Sheets"
              titleTypographyProps={{ variant: 'h6' }}
              avatar={<ContractsIcon color="primary" />}
            />
            <CardContent>
              <Grid container spacing={2}>
                {/* Rate Sheet Title */}
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Rate Sheet Title"
                    value={orderDefaults.rateSheetTitle}
                    onChange={(e) => handleFieldChange('rateSheetTitle', e.target.value)}
                    placeholder="e.g., 2024 Rate Sheet"
                  />
                </Grid>

                {/* Rate Sheet Deal */}
                <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel>Rate Sheet Deal</InputLabel>
                    <Select
                      value={orderDefaults.rateSheetDealId}
                      onChange={(e) => handleFieldChange('rateSheetDealId', e.target.value)}
                      label="Rate Sheet Deal"
                    >
                      <MenuItem value="">Select a deal</MenuItem>
                      {deals.map((deal) => (
                        <MenuItem key={deal.id} value={deal.id}>
                          {deal.name || deal.title || 'Untitled Deal'}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                {/* Upload Rate Sheet */}
                <Grid item xs={12}>
                  <Button
                    variant="outlined"
                    component="label"
                    startIcon={<UploadIcon />}
                    fullWidth
                    sx={{ height: 56 }}
                  >
                    Upload Rate Sheet
                    <input
                      type="file"
                      hidden
                      accept=".pdf,.doc,.docx,.xls,.xlsx"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleFieldChange('rateSheet', file.name);
                        }
                      }}
                    />
                  </Button>
                </Grid>

                {/* MSA Section */}
                <Grid item xs={12}>
                  <FormControl component="fieldset">
                    <FormControlLabel
                      control={
                        <Switch
                          checked={orderDefaults.msaSigned}
                          onChange={(e) => handleFieldChange('msaSigned', e.target.checked)}
                        />
                      }
                      label="MSA Signed?"
                    />
                  </FormControl>
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="MSA Expiration Date"
                    type="date"
                    value={orderDefaults.msaExpirationDate || ''}
                    onChange={(e) => handleFieldChange('msaExpirationDate', e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    disabled={!orderDefaults.msaSigned}
                  />
                </Grid>

                {/* Contracts Upload */}
                <Grid item xs={12}>
                  <Typography variant="h6" gutterBottom>
                    Contracts
                  </Typography>
                  {orderDefaults.contracts.map((contract: any, index: number) => (
                    <Card key={index} sx={{ mb: 2, p: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                        <IconButton
                          onClick={() => handleContractRemove(index)}
                          color="error"
                          size="small"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Box>
                      
                      <Grid container spacing={2}>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            label="Contract Name"
                            value={contract.name}
                            onChange={(e) => handleContractChange(index, 'name', e.target.value)}
                            placeholder="e.g., Service Agreement"
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            label="Description"
                            value={contract.description}
                            onChange={(e) => handleContractChange(index, 'description', e.target.value)}
                            placeholder="Brief description"
                            multiline
                            rows={2}
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <FormControl fullWidth>
                            <InputLabel>Associated Deal</InputLabel>
                            <Select
                              value={contract.dealId}
                              onChange={(e) => handleContractChange(index, 'dealId', e.target.value)}
                              label="Associated Deal"
                            >
                              <MenuItem value="">Select a deal</MenuItem>
                              {deals.map((deal) => (
                                <MenuItem key={deal.id} value={deal.id}>
                                  {deal.name || deal.title || 'Untitled Deal'}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>
                        <Grid item xs={12}>
                          <Button
                            variant="outlined"
                            component="label"
                            startIcon={<UploadIcon />}
                            size="small"
                          >
                            Upload Contract
                            <input
                              type="file"
                              hidden
                              accept=".pdf,.doc,.docx"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  handleContractChange(index, 'file', file.name);
                                }
                              }}
                            />
                          </Button>
                        </Grid>
                      </Grid>
                    </Card>
                  ))}
                  <Button
                    startIcon={<AddIcon />}
                    onClick={handleContractAdd}
                    variant="outlined"
                  >
                    Add Contract
                  </Button>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Save Button */}
        <Grid item xs={12}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving}
              startIcon={saving ? <CircularProgress size={20} /> : null}
            >
              {saving ? 'Saving...' : 'Save Order Defaults'}
            </Button>
          </Box>
        </Grid>
      </Grid>

      {/* Success/Error Snackbars */}
      <Snackbar open={!!success} autoHideDuration={4000} onClose={() => setSuccess(null)}>
        <Alert severity="success" onClose={() => setSuccess(null)} sx={{ width: '100%' }}>
          {success}
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

// Similar Companies Tab Component
const SimilarTab: React.FC<{ company: any; tenantId: string }> = ({ company, tenantId }) => {
  const { currentUser } = useAuth();
  const [similarCompanies, setSimilarCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [addingCompany, setAddingCompany] = useState<string | null>(null);

  // Load similar companies using AI
  const loadSimilarCompanies = async () => {
    if (!company) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const findSimilarCompanies = httpsCallable(functions, 'findSimilarCompanies');
      const result = await findSimilarCompanies({
        companyName: company.companyName || company.name,
        industry: company.industry,
        location: company.city && company.state ? `${company.city}, ${company.state}` : null,
        tenantId
      });
      
      const data = result.data as { success: boolean; companies: any[]; error?: string };
      
      if (data.success) {
        setSimilarCompanies(data.companies || []);
      } else {
        setError(data.error || 'Failed to load similar companies');
        setSimilarCompanies([]);
      }
    } catch (err: any) {
      console.error('Error loading similar companies:', err);
      
      // Extract error message from Firebase error
      let errorMessage = 'Failed to load similar companies';
      if (err?.details?.message) {
        errorMessage = err.details.message;
      } else if (err?.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Add company to CRM
  const handleAddCompany = async (similarCompany: any) => {
    if (!currentUser?.uid) {
      setError('User not authenticated');
      return;
    }

    setAddingCompany(similarCompany.name);
    
    try {
      const addCompanyToCRM = httpsCallable(functions, 'addCompanyToCRM');
      await addCompanyToCRM({
        companyData: {
          companyName: similarCompany.name,
          industry: similarCompany.industry,
          address: similarCompany.address,
          city: similarCompany.city,
          state: similarCompany.state,
          zip: similarCompany.zip,
          website: similarCompany.website,
          linkedinUrl: similarCompany.linkedinUrl,
          phone: similarCompany.phone,
          email: similarCompany.email,
          description: similarCompany.description,
          employeeCount: similarCompany.employeeCount,
          revenue: similarCompany.revenue,
          founded: similarCompany.founded,
          headquarters: similarCompany.headquarters,
          subsidiaries: similarCompany.subsidiaries,
          competitors: similarCompany.competitors,
          technologies: similarCompany.technologies,
          socialMedia: similarCompany.socialMedia,
          news: similarCompany.news,
          logo: similarCompany.logo
        },
        tenantId,
        salespersonId: currentUser.uid
      });
      
      setSuccess(`Successfully added ${similarCompany.name} to CRM`);
      
      // Remove the added company from the list
      setSimilarCompanies(prev => prev.filter(c => c.name !== similarCompany.name));
    } catch (err) {
      console.error('Error adding company to CRM:', err);
      setError(`Failed to add ${similarCompany.name} to CRM`);
    } finally {
      setAddingCompany(null);
    }
  };

  // Load similar companies on component mount
  useEffect(() => {
    loadSimilarCompanies();
  }, [company]);

  return (
    <Box sx={{ p:0}}>
      <Box sx={{ px: 3, mb: 1 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mt: 0, mb: 0 }}>
          <Typography variant="h6" fontWeight={700}>Similar Companies</Typography>
          <Button variant="contained" startIcon={<RefreshIcon />} onClick={loadSimilarCompanies} disabled={loading}>
            Refresh
          </Button>
        </Box>
      </Box>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Card>
          
            <CardContent>
              {error && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                  {error}
                </Alert>
              )}
              
              {success && (
                <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
                  {success}
                </Alert>
              )}

              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress />
                </Box>
              ) : similarCompanies.length > 0 ? (
                <Grid container spacing={2}>
                  {similarCompanies.map((similarCompany, index) => (
                    <Grid item xs={12} md={6} lg={4} key={index}>
                      <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}>
                            <Avatar
                              src={similarCompany.logo}
                              alt={similarCompany.name}
                              sx={{ width: 48, height: 48, bgcolor: 'primary.main' }}
                            >
                              {similarCompany.name?.charAt(0)?.toUpperCase()}
                            </Avatar>
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="h6" component="h3" gutterBottom>
                                {similarCompany.name}
                              </Typography>
                              {similarCompany.industry && (
                                <Chip 
                                  label={similarCompany.industry} 
                                  size="small" 
                                  color="primary" 
                                  sx={{ mb: 1 }}
                                />
                              )}
                            </Box>
                          </Box>

                          <Box sx={{ mb: 2 }}>
                            {similarCompany.description && (
                              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                {similarCompany.description}
                              </Typography>
                            )}
                            
                            {similarCompany.headquarters && (
                              <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                                <LocationIcon fontSize="small" />
                                {similarCompany.headquarters}
                              </Typography>
                            )}
                            
                            {similarCompany.employeeCount && (
                              <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                                <PersonIcon fontSize="small" />
                                {similarCompany.employeeCount} employees
                              </Typography>
                            )}
                            
                            {similarCompany.revenue && (
                              <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                                <DealIcon fontSize="small" />
                                {similarCompany.revenue}
                              </Typography>
                            )}
                          </Box>

                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {similarCompany.website && (
                              <IconButton
                                size="small"
                                onClick={() => window.open(similarCompany.website, '_blank')}
                                title="Visit Website"
                              >
                                <LanguageIcon fontSize="small" />
                              </IconButton>
                            )}
                            
                            {similarCompany.linkedinUrl && (
                              <IconButton
                                size="small"
                                onClick={() => window.open(similarCompany.linkedinUrl, '_blank')}
                                title="View LinkedIn"
                              >
                                <LinkedInIcon fontSize="small" />
                              </IconButton>
                            )}
                          </Box>

                          <Box sx={{ mt: 2 }}>
                            <Button
                              variant="contained"
                              size="small"
                              fullWidth
                              onClick={() => handleAddCompany(similarCompany)}
                              disabled={addingCompany === similarCompany.name}
                              startIcon={addingCompany === similarCompany.name ? <CircularProgress size={16} /> : <AddIcon />}
                            >
                              {addingCompany === similarCompany.name ? 'Adding...' : 'Add to CRM'}
                            </Button>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              ) : (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">No similar companies found</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

export default CompanyDetails;
