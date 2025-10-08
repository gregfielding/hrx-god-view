import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Stack,
  FormControlLabel,
  Checkbox,
  Chip,
  OutlinedInput,
  Divider,
  Autocomplete,
} from '@mui/material';
import {
  Save as SaveIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import { experienceOptions, educationOptions } from '../data/experienceOptions';
import { backgroundCheckOptions, drugScreeningOptions, additionalScreeningOptions } from '../data/screeningsOptions';
import { JobOrder } from '../types/recruiter/jobOrder';
import { getFieldDef } from '../fields/useFieldDef';
import { toNumberSafe, toISODate, coerceSelect } from '../utils/fieldCoercions';
import { getRegistryPath, setDeep, getRegistryIdForField } from '../utils/registryHelpers';
import { getOptionsForField } from '../utils/fieldOptions';

// ---- Local helpers to centralize date/number handling in this form ----
const formatDateForInput = (v: any): string => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
};

const parseDateFromInput = (v: string): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

// Helper function to remove undefined values from objects (Firestore doesn't allow undefined)
const removeUndefinedValues = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(removeUndefinedValues).filter(item => item !== undefined);
  }
  
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = removeUndefinedValues(value);
      }
    }
    return cleaned;
  }
  
  return obj;
};

interface Company {
  id: string;
  companyName: string;
  name: string;
}

interface Location {
  id: string;
  nickname: string;
  name: string;
  companyId?: string;
}

interface Contact {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  title?: string;
}

interface JobOrderFormProps {
  jobOrderId?: string; // If provided, we're editing; if not, we're creating
  dealId?: string; // If provided, we can load associated contacts from the deal
  onSave?: () => void; // Optional callback after successful save
  onCancel?: () => void; // Optional callback for cancel
}

const JobOrderForm: React.FC<JobOrderFormProps> = ({ 
  jobOrderId, 
  dealId,
  onSave, 
  onCancel 
}) => {
  const { tenantId, user } = useAuth();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(!!jobOrderId); // Loading if editing
  const [saving, setSaving] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [filteredLocations, setFilteredLocations] = useState<Location[]>([]);
  const [associatedContacts, setAssociatedContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Company Defaults State
  const [backgroundCheckPackages, setBackgroundCheckPackages] = useState<Array<{title: string, description: string}>>([]);
  const [drugScreeningPanels, setDrugScreeningPanels] = useState<Array<{title: string, description: string}>>([]);
  const [uniformRequirements, setUniformRequirements] = useState<Array<{title: string, description: string}>>([]);
  const [ppeOptions, setPpeOptions] = useState<Array<{title: string, description: string}>>([]);
  const [licensesCerts, setLicensesCerts] = useState<Array<{title: string, description: string}>>([]);
  const [experienceLevels, setExperienceLevels] = useState<Array<{title: string, description: string}>>([]);
  const [educationLevels, setEducationLevels] = useState<Array<{title: string, description: string}>>([]);
  const [physicalRequirements, setPhysicalRequirements] = useState<Array<{title: string, description: string}>>([]);
  const [languages, setLanguages] = useState<Array<{title: string, description: string}>>([]);
  const [skills, setSkills] = useState<Array<{title: string, description: string}>>([]);
  const companyDefaultsForOptions = {
    backgroundPackages: backgroundCheckPackages,
    screeningPanels: drugScreeningPanels,
    uniformRequirements,
    ppe: ppeOptions,
    licensesCerts: licensesCerts,
    experienceLevels,
    educationLevels,
    physicalRequirements,
    languages,
    skills,
  } as any;

  const [formData, setFormData] = useState({
    // Basic Information
    jobOrderName: '',
    jobTitle: '',
    description: '',
    companyId: '',
    worksiteId: '',
    status: 'draft',
    workersNeeded: 1,
    payRate: '',
    markup: '',
    billRate: '',
    calculatedBillRate: '',
    startDate: '',
    endDate: '',
    requirements: '',
    notes: '',
    
    // Discovery Stage Fields
    currentStaffCount: '',
    currentAgencyCount: '',
    currentSatisfactionLevel: '',
    currentStruggles: '',
    hasUsedAgenciesBefore: false,
    lastAgencyUsed: '',
    reasonStoppedUsingAgencies: '',
    openToUsingAgenciesAgain: false,
    additionalJobTitles: '',
    shiftTimes: '',
    employmentType: '',
    onsiteSupervisionRequired: false,
    experienceLevel: '',
    priority: '',
    shiftType: '',
    
    // Qualification Stage Fields
    mustHaveRequirements: '',
    mustAvoidRequirements: '',
    potentialObstacles: '',
    expectedStartDate: '',
    initialHeadcount: '',
    headcountAfter30Days: '',
    headcountAfter90Days: '',
    headcountAfter180Days: '',
    expectedPayRate: '',
    expectedMarkup: '',
    
    // Scoping Stage Fields
    replacingExistingAgency: false,
    rolloverExistingStaff: false,
    backgroundCheckPackages: [],
    drugScreeningPanels: [],
    additionalScreenings: [],
    eVerifyRequired: false,
    dressCode: [],
    timeclockSystem: '',
    disciplinePolicy: '',
    poRequired: false,
    paymentTerms: '',
    invoiceDeliveryMethod: '',
    invoiceFrequency: '',
    
    // Compliance Fields
    backgroundCheckRequired: false,
    drugScreenRequired: false,
    licensesCerts: [],
    experienceRequired: '',
    educationRequired: '',
    languagesRequired: [],
    skillsRequired: [],
    physicalRequirements: [],
    ppeRequirements: [],
    ppeProvidedBy: 'company',
    
    // Customer Rules
    attendancePolicy: '',
    noShowPolicy: '',
    overtimePolicy: '',
    callOffPolicy: '',
    injuryHandlingPolicy: '',
    
    // Agreement Fields
    verbalAgreementContact: '',
    verbalAgreementDate: '',
    verbalAgreementMethod: '',
    conditionsToFulfill: '',
    approvalsNeeded: '',
    insuranceSubmitted: false,
    
    // Contract Fields
    contractSignedDate: '',
    contractExpirationDate: '',
    rateSheetOnFile: false,
    msaSigned: false,
    
    // Financial
    estimatedRevenue: '',
    
    // HR Contact
    hrContactId: '',
    
    // Decision Maker
    decisionMaker: '',
    
    // Additional Contact Roles
    operationsContactId: '',
    procurementContactId: '',
    billingContactId: '',
    safetyContactId: '',
    invoiceContactId: '',
  });

  const isEditing = !!jobOrderId;

  // Load companies and company defaults
  useEffect(() => {
    if (tenantId) {
      loadCompanies();
      loadCompanyDefaults();
      if (isEditing && jobOrderId) {
        loadJobOrder();
      }
      if (dealId) {
        loadAssociatedContacts();
      }
    }
  }, [tenantId, jobOrderId, dealId]);

  // Load locations when company changes
  useEffect(() => {
    if (formData.companyId) {
      loadLocations(formData.companyId);
    } else {
      setLocations([]);
      setFilteredLocations([]);
    }
  }, [formData.companyId]);

  // Set filtered locations (now they're already company-specific)
  useEffect(() => {
    console.log('🔍 Setting filtered locations:', {
      locations: locations,
      currentWorksiteId: formData.worksiteId,
      companyId: formData.companyId
    });
    
    // If we have a worksiteId but it's not in the current locations, we need to include it
    const finalLocations = formData.worksiteId && !locations.find(loc => loc.id === formData.worksiteId)
      ? [
          ...locations,
          {
            id: formData.worksiteId,
            name: 'Current Location',
            nickname: 'Current Location',
            companyId: formData.companyId
          }
        ]
      : [...locations];
    
    if (formData.worksiteId && !locations.find(loc => loc.id === formData.worksiteId)) {
      console.log('🔍 Current worksiteId not found in locations, adding placeholder');
    }
    
    setFilteredLocations(finalLocations);
  }, [locations, formData.worksiteId, formData.companyId]);

  const loadCompanies = async () => {
    try {
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const companiesSnapshot = await getDocs(companiesRef);
      const companiesData = companiesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Company[];
      setCompanies(companiesData);
    } catch (error) {
      console.error('Error loading companies:', error);
    }
  };

  const loadLocations = async (companyId?: string) => {
    if (!companyId) {
      setLocations([]);
      return;
    }
    
    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations');
      const locationsSnapshot = await getDocs(locationsRef);
      const locationsData = locationsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Location[];
      setLocations(locationsData);
      console.log(`Loaded ${locationsData.length} locations for company ${companyId}:`, locationsData);
    } catch (error) {
      console.error('Error loading locations:', error);
      setLocations([]);
    }
  };

  const loadCompanyDefaults = async () => {
    try {
      const docRef = doc(db, 'tenants', tenantId, 'settings', 'company-defaults');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setBackgroundCheckPackages(data.backgroundPackages || []);
        setDrugScreeningPanels(data.screeningPanels || []);
        setUniformRequirements(data.uniformRequirements || []);
        setPpeOptions(data.ppe || []);
        setLicensesCerts(data.licensesCerts || []);
        setExperienceLevels(data.experienceLevels || []);
        setEducationLevels(data.educationLevels || []);
        setPhysicalRequirements(data.physicalRequirements || []);
        setLanguages(data.languages || []);
        setSkills(data.skills || []);
      }
    } catch (error) {
      console.error('Error loading company defaults:', error);
    }
  };

  const loadAssociatedContacts = async () => {
    if (!dealId || !tenantId) {
      console.log('🔍 JobOrderForm: Cannot load contacts - missing dealId or tenantId:', { dealId, tenantId });
      return;
    }
    
    console.log('🔍 JobOrderForm: Loading associated contacts for deal:', dealId);
    
    try {
      const dealRef = doc(db, 'tenants', tenantId, 'crm_deals', dealId);
      const dealSnap = await getDoc(dealRef);
      
      if (dealSnap.exists()) {
        const dealData = dealSnap.data();
        console.log('🔍 JobOrderForm: Deal data:', dealData);
        
        // Check for contacts in different possible locations
        let contactIds: string[] = [];
        
        // Try different possible structures
        if (dealData.associatedContacts && Array.isArray(dealData.associatedContacts)) {
          contactIds = dealData.associatedContacts;
        } else if (dealData.associations?.contacts && Array.isArray(dealData.associations.contacts)) {
          contactIds = dealData.associations.contacts.map((contact: any) => 
            typeof contact === 'string' ? contact : contact.id
          );
        } else if (dealData.contactRoles?.hr?.id) {
          // If there's an HR contact role, include it
          contactIds = [dealData.contactRoles.hr.id];
        }
        
        console.log('🔍 JobOrderForm: Found contact IDs in deal:', contactIds);
        
        if (contactIds.length > 0) {
          const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
          const contactsSnapshot = await getDocs(contactsRef);
          const contacts = contactsSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(contact => contactIds.includes(contact.id)) as Contact[];
          
          console.log('🔍 JobOrderForm: Loaded contacts:', contacts);
          setAssociatedContacts(contacts);
          
          // Auto-select Melissa Mellett as the default HR contact if no HR contact is currently set
          if (!formData.hrContactId && contacts.length > 0) {
            const melissaMellett = contacts.find(contact => 
              contact.fullName?.toLowerCase().includes('melissa') && 
              contact.fullName?.toLowerCase().includes('mellett')
            );
            
            if (melissaMellett) {
              console.log('🔍 JobOrderForm: Auto-selecting Melissa Mellett as default HR contact:', melissaMellett);
              setFormData(prev => ({
                ...prev,
                hrContactId: melissaMellett.id
              }));
            }
          }
        } else {
          console.log('🔍 JobOrderForm: No contact IDs found in deal data');
          setAssociatedContacts([]);
        }
        
        // Also check if there's an existing HR contact in the job order that we should include
        if (formData.hrContactId && !contactIds.includes(formData.hrContactId)) {
          console.log('🔍 JobOrderForm: Loading existing HR contact:', formData.hrContactId);
          try {
            const hrContactRef = doc(db, 'tenants', tenantId, 'crm_contacts', formData.hrContactId);
            const hrContactSnap = await getDoc(hrContactRef);
            if (hrContactSnap.exists()) {
              const hrContact = { id: hrContactSnap.id, ...hrContactSnap.data() } as Contact;
              setAssociatedContacts(prev => {
                const exists = prev.some(c => c.id === hrContact.id);
                return exists ? prev : [...prev, hrContact];
              });
              console.log('🔍 JobOrderForm: Added existing HR contact to list:', hrContact);
            }
          } catch (error) {
            console.error('Error loading existing HR contact:', error);
          }
        }
      } else {
        console.log('🔍 JobOrderForm: Deal not found:', dealId);
        setAssociatedContacts([]);
      }
    } catch (error) {
      console.error('Error loading associated contacts:', error);
    }
  };

  const loadJobOrder = async () => {
    if (!jobOrderId || !tenantId) return;
    
    setLoading(true);
    try {
      // Try tenant-scoped path first
      const jobOrderRef = doc(db, p.jobOrder(tenantId, jobOrderId));
      let jobOrderSnap = await getDoc(jobOrderRef);
      
      if (!jobOrderSnap.exists()) {
        // Fallback to top-level collection
        const topLevelJobOrderRef = doc(db, 'jobOrders', jobOrderId);
        jobOrderSnap = await getDoc(topLevelJobOrderRef);
      }
      
      if (jobOrderSnap.exists()) {
        const data = jobOrderSnap.data() as JobOrder;
        // Check for stageData in both top-level and embedded deal object
        const stageData = (data as any).stageData || (data as any).deal?.stageData || {};
        
        setFormData({
          // Basic Information
          jobOrderName: data.jobOrderName || '',
          jobTitle: (data as any).jobTitle || (stageData.discovery?.jobTitles?.[0] || ''),
          description: data.jobOrderDescription || '',
          companyId: (data as any).companyId || '',
          worksiteId: (data as any).worksiteId || '',
          status: data.status || 'draft',
          workersNeeded: data.workersNeeded || 1,
          payRate: (data as any).payRate || '',
          markup: (data as any).markup || '',
          billRate: (data as any).billRate || '',
          calculatedBillRate: (() => {
            const pay = parseFloat(String((data as any).payRate || '')) || 0;
            const m = parseFloat(String((data as any).markup || '')) || 0;
            const calc = (data as any).calculatedBillRate;
            if (typeof calc === 'number' && calc > 0) return String(calc);
            if (m > 0 && pay > 0) return String(Number((pay * (1 + m / 100)).toFixed(2)));
            return '';
          })(),
          priority: (data as any).priority || '',
          shiftType: (data as any).shiftType || '',
          startDate: formatDateForInput((data as any).startDate),
          endDate: formatDateForInput((data as any).endDate),
          requirements: (data as any).requirements || '',
          notes: (data as any).notes || '',
          
          // Discovery Stage Fields - from stageData.discovery
          currentStaffCount: stageData.discovery?.currentStaffCount?.toString() || '',
          currentAgencyCount: stageData.discovery?.currentAgencyCount?.toString() || '',
          currentSatisfactionLevel: stageData.discovery?.currentSatisfactionLevel || '',
          currentStruggles: stageData.discovery?.currentStruggles?.join(', ') || '',
          hasUsedAgenciesBefore: stageData.discovery?.hasUsedAgenciesBefore || false,
          lastAgencyUsed: stageData.discovery?.lastAgencyUsed || '',
          reasonStoppedUsingAgencies: stageData.discovery?.reasonStoppedUsingAgencies || '',
          openToUsingAgenciesAgain: stageData.discovery?.openToUsingAgenciesAgain || false,
          additionalJobTitles: stageData.discovery?.additionalJobTitles?.join(', ') || '',
          shiftTimes: stageData.discovery?.shiftTimes?.join(', ') || '',
          employmentType: stageData.discovery?.employmentType || '',
          onsiteSupervisionRequired: stageData.discovery?.onsiteSupervisionRequired || false,
          
          // Qualification Stage Fields - from stageData.qualification
          mustHaveRequirements: stageData.qualification?.mustHaveRequirements || '',
          mustAvoidRequirements: stageData.qualification?.mustAvoidRequirements || '',
          potentialObstacles: stageData.qualification?.potentialObstacles?.join(', ') || '',
          expectedStartDate: stageData.qualification?.expectedStartDate || '',
          initialHeadcount: stageData.qualification?.staffPlacementTimeline?.starting?.toString() || '',
          headcountAfter30Days: stageData.qualification?.staffPlacementTimeline?.after30Days?.toString() || '',
          headcountAfter90Days: stageData.qualification?.staffPlacementTimeline?.after90Days?.toString() || '',
          headcountAfter180Days: stageData.qualification?.staffPlacementTimeline?.after180Days?.toString() || '',
          expectedPayRate: stageData.qualification?.expectedAveragePayRate?.toString() || '',
          expectedMarkup: stageData.qualification?.expectedAverageMarkup?.toString() || '',
          experienceLevel: stageData.qualification?.experienceLevel || '',
          
          // Scoping Stage Fields - from stageData.scoping
          replacingExistingAgency: stageData.scoping?.replacingExistingAgency || false,
          rolloverExistingStaff: stageData.scoping?.rolloverExistingStaff || false,
          backgroundCheckPackages: stageData.scoping?.compliance?.backgroundCheckPackages || [],
          drugScreeningPanels: stageData.scoping?.compliance?.drugScreeningPanels || [],
          additionalScreenings: stageData.scoping?.compliance?.additionalScreenings || [],
          eVerifyRequired: stageData.scoping?.compliance?.eVerify || false,
          dressCode: stageData.scoping?.uniformRequirements || [],
          timeclockSystem: stageData.scoping?.timeclockSystem || '',
          disciplinePolicy: stageData.scoping?.disciplinePolicy || '',
          poRequired: stageData.scoping?.poRequired || false,
          paymentTerms: stageData.scoping?.paymentTerms || '',
          invoiceDeliveryMethod: stageData.scoping?.invoiceDeliveryMethod || '',
          invoiceFrequency: stageData.scoping?.invoiceFrequency || '',
          
          // Compliance Fields - from stageData.scoping.compliance
          backgroundCheckRequired: stageData.scoping?.compliance?.backgroundCheck || false,
          drugScreenRequired: stageData.scoping?.compliance?.drugScreen || false,
          licensesCerts: stageData.scoping?.compliance?.licensesCerts || [],
          experienceRequired: stageData.scoping?.compliance?.experience || '',
          educationRequired: stageData.scoping?.compliance?.education || '',
          languagesRequired: stageData.scoping?.compliance?.languages || [],
          skillsRequired: stageData.scoping?.compliance?.skills || [],
          physicalRequirements: stageData.scoping?.compliance?.physicalRequirements || [],
          ppeRequirements: stageData.scoping?.compliance?.ppe || [],
          ppeProvidedBy: stageData.scoping?.compliance?.ppeProvidedBy || 'company',
          
          // Customer Rules - from stageData.scoping.customerRules
          attendancePolicy: stageData.scoping?.customerRules?.attendance || '',
          noShowPolicy: stageData.scoping?.customerRules?.noShows || '',
          overtimePolicy: stageData.scoping?.customerRules?.overtime || '',
          callOffPolicy: stageData.scoping?.customerRules?.callOffs || '',
          injuryHandlingPolicy: stageData.scoping?.customerRules?.injuryHandling || '',
          
          // Agreement Fields - from stageData.verbalAgreement
          verbalAgreementContact: stageData.verbalAgreement?.contact || '',
          verbalAgreementDate: stageData.verbalAgreement?.date || '',
          verbalAgreementMethod: stageData.verbalAgreement?.method || '',
          conditionsToFulfill: stageData.verbalAgreement?.conditionsToFulfill?.join(', ') || '',
          approvalsNeeded: stageData.verbalAgreement?.approvalsNeeded?.join(', ') || '',
          insuranceSubmitted: stageData.verbalAgreement?.insuranceSubmitted || false,
          
          // Contract Fields - from stageData.closedWon
          contractSignedDate: stageData.closedWon?.contractSignedDate || '',
          contractExpirationDate: stageData.closedWon?.contractExpirationDate || '',
          rateSheetOnFile: stageData.closedWon?.rateSheetOnFile || false,
          msaSigned: stageData.closedWon?.msaSigned || false,
          
          // Financial
          estimatedRevenue: (data as any).estimatedRevenue?.toString() || '',
          
          // HR Contact
          hrContactId: (data as any).hrContactId || (data as any).deal?.hrContactId || '',
          
          // Decision Maker
          decisionMaker: (data as any).decisionMaker || stageData.qualification?.decisionMaker?.id || '',
          
          // Additional Contact Roles
          operationsContactId: (data as any).operationsContactId || (data as any).deal?.operationsContactId || '',
          procurementContactId: (data as any).procurementContactId || (data as any).deal?.procurementContactId || '',
          billingContactId: (data as any).billingContactId || (data as any).deal?.billingContactId || '',
          safetyContactId: (data as any).safetyContactId || (data as any).deal?.safetyContactId || '',
          invoiceContactId: (data as any).invoiceContactId || (data as any).deal?.invoiceContactId || '',
        });
        
        // Load locations for the company if companyId is set
        const companyForLocations = (data as any).companyId;
        if (companyForLocations) {
          await loadLocations(companyForLocations);
        }
      } else {
        setError('Job order not found');
      }
    } catch (error: any) {
      console.error('Error loading job order:', error);
      setError(error.message || 'Failed to load job order');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = async (field: string, value: any) => {
    let updatedFormData: any = {
      ...formData,
      [field]: value
    };

    // Auto-calculate calculatedBillRate when markup or payRate changes
    if (field === 'markup' || field === 'payRate') {
      const numericPay = parseFloat(
        field === 'payRate' ? String(value) : String(formData.payRate || 0)
      ) || 0;
      const numericMarkup = parseFloat(
        field === 'markup' ? String(value) : String(formData.markup || 0)
      ) || 0;
      const computed = numericMarkup > 0 && numericPay > 0 ? (numericPay * (1 + numericMarkup / 100)) : 0;
      updatedFormData = {
        ...updatedFormData,
        calculatedBillRate: computed ? String(Number(computed.toFixed(2))) : '',
        ...(numericMarkup > 0 ? { billRate: computed ? String(Number(computed.toFixed(2))) : '' } : {})
      };
    }
    
    setFormData(updatedFormData);
    
    // Auto-save on change
    if (isEditing && jobOrderId) {
      console.log('🔍 handleInputChange - Auto-saving field:', field, 'value:', value);
      await saveFieldToFirestore(field, value, updatedFormData);
    }
  };

  const handleFieldBlur = async (field: string, value: any) => {
    // Auto-save on blur for additional safety
    if (isEditing && jobOrderId) {
      console.log('🔍 handleFieldBlur - Auto-saving field:', field, 'value:', value);
      await saveFieldToFirestore(field, value, formData);
    }
  };

  const saveFieldToFirestore = async (field: string, value: any, currentFormData?: any) => {
    if (!tenantId || !user || !jobOrderId) return;

    // Use the passed form data or fall back to current state
    const dataToUse = currentFormData || formData;

    console.log('🔍 Auto-saving field:', field, 'value:', value, 'startDate in dataToUse:', dataToUse.startDate);

    try {
      // Get company and location names if needed
      let companyName = '';
      let worksiteName = '';
      
      if (field === 'companyId' && value) {
        const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', value);
        const companySnap = await getDoc(companyRef);
        if (companySnap.exists()) {
          const companyData = companySnap.data() as any;
          companyName = companyData.companyName || companyData.name || '';
        }
      }

      if (field === 'worksiteId' && value && dataToUse.companyId) {
        const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', dataToUse.companyId, 'locations', value);
        const locationSnap = await getDoc(locationRef);
        if (locationSnap.exists()) {
          const locationData = locationSnap.data() as any;
          worksiteName = locationData.nickname || locationData.name || '';
        }
      }

      // Build flattened updates using the latest dataToUse
      const stageDataUpdate: any = {
        discovery: {
          currentStaffCount: parseInt((dataToUse as any).currentStaffCount) || undefined,
          currentAgencyCount: parseInt((dataToUse as any).currentAgencyCount) || undefined,
          currentSatisfactionLevel: (dataToUse as any).currentSatisfactionLevel || undefined,
          hasUsedAgenciesBefore: (dataToUse as any).hasUsedAgenciesBefore || undefined,
          additionalJobTitles: (dataToUse as any).additionalJobTitles ? (dataToUse as any).additionalJobTitles.split(',').map((s: string) => s.trim()).filter((s: string) => s) : undefined,
          shiftTimes: (dataToUse as any).shiftTimes ? (dataToUse as any).shiftTimes.split(',').map((s: string) => s.trim()).filter((s: string) => s) : undefined,
          employmentType: (dataToUse as any).employmentType || undefined,
          onsiteSupervisionRequired: (dataToUse as any).onsiteSupervisionRequired || undefined,
          lastAgencyUsed: (dataToUse as any).lastAgencyUsed || undefined,
          reasonStoppedUsingAgencies: (dataToUse as any).reasonStoppedUsingAgencies || undefined,
          openToUsingAgenciesAgain: (dataToUse as any).openToUsingAgenciesAgain || undefined,
          currentStruggles: (dataToUse as any).currentStruggles ? (dataToUse as any).currentStruggles.split(',').map((s: string) => s.trim()).filter((s: string) => s) : undefined,
        },
        qualification: {
          mustHaveRequirements: (dataToUse as any).mustHaveRequirements || undefined,
          mustAvoidRequirements: (dataToUse as any).mustAvoidRequirements || undefined,
          potentialObstacles: (dataToUse as any).potentialObstacles ? (dataToUse as any).potentialObstacles.split(',').map((s: string) => s.trim()).filter((s: string) => s) : undefined,
          expectedStartDate: (dataToUse as any).expectedStartDate || undefined,
          staffPlacementTimeline: {
            starting: parseInt((dataToUse as any).initialHeadcount) || undefined,
            after30Days: parseInt((dataToUse as any).headcountAfter30Days) || undefined,
            after90Days: parseInt((dataToUse as any).headcountAfter90Days) || undefined,
            after180Days: parseInt((dataToUse as any).headcountAfter180Days) || undefined,
          },
          expectedAveragePayRate: parseFloat((dataToUse as any).expectedPayRate) || undefined,
          expectedAverageMarkup: parseFloat((dataToUse as any).expectedMarkup) || undefined,
        },
        scoping: {
          replacingExistingAgency: (dataToUse as any).replacingExistingAgency || undefined,
          rolloverExistingStaff: (dataToUse as any).rolloverExistingStaff || undefined,
          compliance: {
            backgroundCheck: (dataToUse as any).backgroundCheckRequired || undefined,
            backgroundCheckPackages: (dataToUse as any).backgroundCheckPackages || [],
            drugScreen: (dataToUse as any).drugScreenRequired || undefined,
            drugScreeningPanels: (dataToUse as any).drugScreeningPanels || [],
            additionalScreenings: (dataToUse as any).additionalScreenings || [],
            eVerify: (dataToUse as any).eVerifyRequired || undefined,
            licensesCerts: (dataToUse as any).licensesCerts || [],
            experience: (dataToUse as any).experienceRequired || undefined,
            education: (dataToUse as any).educationRequired || undefined,
            languages: (dataToUse as any).languagesRequired || [],
            skills: (dataToUse as any).skillsRequired || [],
            physicalRequirements: (dataToUse as any).physicalRequirements || undefined,
            ppe: (dataToUse as any).ppeRequirements || undefined,
            ppeProvidedBy: (dataToUse as any).ppeProvidedBy || undefined,
          },
          uniformRequirements: (dataToUse as any).dressCode || undefined,
          timeclockSystem: (dataToUse as any).timeclockSystem || undefined,
          disciplinePolicy: (dataToUse as any).disciplinePolicy || undefined,
          poRequired: (dataToUse as any).poRequired || undefined,
          paymentTerms: (dataToUse as any).paymentTerms || undefined,
          invoiceDeliveryMethod: (dataToUse as any).invoiceDeliveryMethod || undefined,
          invoiceFrequency: (dataToUse as any).invoiceFrequency || undefined,
          customerRules: {
            attendance: (dataToUse as any).attendancePolicy || undefined,
            noShows: (dataToUse as any).noShowPolicy || undefined,
            overtime: (dataToUse as any).overtimePolicy || undefined,
            callOffs: (dataToUse as any).callOffPolicy || undefined,
            injuryHandling: (dataToUse as any).injuryHandlingPolicy || undefined,
          },
        },
        verbalAgreement: {
          contact: (dataToUse as any).verbalAgreementContact || undefined,
          date: (dataToUse as any).verbalAgreementDate || undefined,
          method: (dataToUse as any).verbalAgreementMethod || undefined,
          conditionsToFulfill: (dataToUse as any).conditionsToFulfill ? (dataToUse as any).conditionsToFulfill.split(',').map((s: string) => s.trim()).filter((s: string) => s) : undefined,
          approvalsNeeded: (dataToUse as any).approvalsNeeded ? (dataToUse as any).approvalsNeeded.split(',').map((s: string) => s.trim()).filter((s: string) => s) : undefined,
          insuranceSubmitted: (dataToUse as any).insuranceSubmitted || undefined,
        },
        closedWon: {
          contractSignedDate: (dataToUse as any).contractSignedDate || undefined,
          contractExpirationDate: (dataToUse as any).contractExpirationDate || undefined,
          rateSheetOnFile: (dataToUse as any).rateSheetOnFile || undefined,
          msaSigned: (dataToUse as any).msaSigned || undefined,
        },
      };

      // Also set by registry path if the changed field has an explicit path
      const path = getRegistryPath(getRegistryIdForField(field));
      if (path) {
        setDeep(stageDataUpdate as any, path, value);
      }

      // Parse dates properly - convert string to Date object
      const startDateParsed = dataToUse.startDate ? parseDateFromInput(dataToUse.startDate) : null;
      const endDateParsed = dataToUse.endDate ? parseDateFromInput(dataToUse.endDate) : null;
      
      console.log('🔍 Date parsing:', {
        startDateInput: dataToUse.startDate,
        startDateParsed,
        endDateInput: dataToUse.endDate,
        endDateParsed
      });

      // Compute calculated bill rate if markup/payRate present
      const numericPay = toNumberSafe((dataToUse as any).payRate) ?? 0;
      const numericMarkup = toNumberSafe((dataToUse as any).markup) ?? 0;
      const computedBill = numericMarkup > 0 && numericPay > 0 ? Number((numericPay * (1 + numericMarkup / 100)).toFixed(2)) : 0;

      const updates = {
        tenantId,
        jobOrderName: dataToUse.jobOrderName,
        jobOrderDescription: dataToUse.description,
        status: dataToUse.status,
        workersNeeded: toNumberSafe(dataToUse.workersNeeded) ?? 1,
        payRate: toNumberSafe(dataToUse.payRate) ?? 0,
        markup: toNumberSafe(dataToUse.markup) ?? 0,
        // If markup present, persist computed bill; otherwise use manual billRate
        billRate: (numericMarkup > 0 ? computedBill : (toNumberSafe(dataToUse.billRate) ?? 0)) as number,
        calculatedBillRate: computedBill,
        startDate: startDateParsed,
        endDate: endDateParsed,
        companyId: dataToUse.companyId || '',
        companyName,
        worksiteId: dataToUse.worksiteId || '',
        worksiteName,
        estimatedRevenue: toNumberSafe(dataToUse.estimatedRevenue) ?? 0,
        notes: dataToUse.notes,
        hrContactId: dataToUse.hrContactId || '',
        decisionMaker: dataToUse.decisionMaker || '',
        operationsContactId: dataToUse.operationsContactId || '',
        procurementContactId: dataToUse.procurementContactId || '',
        billingContactId: dataToUse.billingContactId || '',
        safetyContactId: dataToUse.safetyContactId || '',
        invoiceContactId: dataToUse.invoiceContactId || '',
        stageData: stageDataUpdate,
        updatedAt: new Date(),
        updatedBy: user.uid,
      } as any;

      // Remove undefined values from the data before saving to Firestore
      const cleanJobOrderData = removeUndefinedValues(updates);
      
      console.log('🔍 About to save to Firestore:', {
        field,
        rawStartDate: updates.startDate,
        rawEndDate: updates.endDate,
        cleanStartDate: cleanJobOrderData.startDate,
        cleanEndDate: cleanJobOrderData.endDate
      });
      
      const jobOrderRef = doc(db, p.jobOrder(tenantId, jobOrderId));
      await updateDoc(jobOrderRef, cleanJobOrderData);
      
      console.log('✅ Auto-save successful for field:', field, 'saved data:', {
        startDate: cleanJobOrderData.startDate,
        endDate: cleanJobOrderData.endDate
      });
      
    } catch (error) {
      console.error('Error auto-saving field:', error);
      // Don't show error to user for auto-save failures
    }
  };

  const handleSave = async () => {
    if (!tenantId || !user) return;

    setSaving(true);
    setError(null);
    
    try {
      // Get company and location names
      let companyName = '';
      let worksiteName = '';
      
      if (formData.companyId) {
        const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', formData.companyId);
        const companySnap = await getDoc(companyRef);
        if (companySnap.exists()) {
          const companyData = companySnap.data() as any;
          companyName = companyData.companyName || companyData.name || '';
        }
      }

      if (formData.worksiteId) {
        const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', formData.companyId, 'locations', formData.worksiteId);
        const locationSnap = await getDoc(locationRef);
        if (locationSnap.exists()) {
          const locationData = locationSnap.data() as any;
          worksiteName = locationData.nickname || locationData.name || '';
        }
      }

      // Build the updated deal data structure
      const updatedDealData = {
        // Basic deal information
        name: formData.jobOrderName,
        companyId: formData.companyId,
        companyName,
        locationId: formData.worksiteId,
        locationName: worksiteName,
        estimatedRevenue: parseFloat(formData.estimatedRevenue) || 0,
        notes: formData.notes,
        
        // Stage data structure
        stageData: {
          discovery: {
            currentStaffCount: parseInt(formData.currentStaffCount) || undefined,
            currentAgencyCount: parseInt(formData.currentAgencyCount) || undefined,
            currentSatisfactionLevel: formData.currentSatisfactionLevel || undefined,
            currentStruggles: formData.currentStruggles ? formData.currentStruggles.split(',').map(s => s.trim()).filter(s => s) : undefined,
            hasUsedAgenciesBefore: formData.hasUsedAgenciesBefore,
            lastAgencyUsed: formData.lastAgencyUsed || undefined,
            reasonStoppedUsingAgencies: formData.reasonStoppedUsingAgencies || undefined,
            openToUsingAgenciesAgain: formData.openToUsingAgenciesAgain,
            additionalJobTitles: formData.additionalJobTitles ? formData.additionalJobTitles.split(',').map(s => s.trim()).filter(s => s) : undefined,
            shiftTimes: formData.shiftTimes ? formData.shiftTimes.split(',').map(s => s.trim()).filter(s => s) : undefined,
            employmentType: formData.employmentType || undefined,
            onsiteSupervisionRequired: formData.onsiteSupervisionRequired,
          },
          qualification: {
            mustHaveRequirements: formData.mustHaveRequirements || undefined,
            mustAvoidRequirements: formData.mustAvoidRequirements || undefined,
            potentialObstacles: formData.potentialObstacles ? formData.potentialObstacles.split(',').map(s => s.trim()).filter(s => s) : undefined,
            expectedStartDate: formData.expectedStartDate || undefined,
            staffPlacementTimeline: {
              starting: parseInt(formData.initialHeadcount) || undefined,
              after30Days: parseInt(formData.headcountAfter30Days) || undefined,
              after90Days: parseInt(formData.headcountAfter90Days) || undefined,
              after180Days: parseInt(formData.headcountAfter180Days) || undefined,
            },
            expectedAveragePayRate: parseFloat(formData.expectedPayRate) || undefined,
            expectedAverageMarkup: parseFloat(formData.expectedMarkup) || undefined,
          },
          scoping: {
            replacingExistingAgency: formData.replacingExistingAgency,
            rolloverExistingStaff: formData.rolloverExistingStaff,
            compliance: {
              backgroundCheck: formData.backgroundCheckRequired,
              backgroundCheckPackages: formData.backgroundCheckPackages,
              drugScreen: formData.drugScreenRequired,
              drugScreeningPanels: formData.drugScreeningPanels,
              additionalScreenings: formData.additionalScreenings,
              eVerify: formData.eVerifyRequired,
              licensesCerts: formData.licensesCerts,
              experience: formData.experienceRequired || undefined,
              education: formData.educationRequired || undefined,
              languages: formData.languagesRequired,
              skills: formData.skillsRequired,
              physicalRequirements: formData.physicalRequirements || undefined,
              ppe: formData.ppeRequirements || undefined,
              ppeProvidedBy: formData.ppeProvidedBy,
            },
            uniformRequirements: formData.dressCode || undefined,
            timeclockSystem: formData.timeclockSystem || undefined,
            disciplinePolicy: formData.disciplinePolicy || undefined,
            poRequired: formData.poRequired,
            paymentTerms: formData.paymentTerms || undefined,
            invoiceDeliveryMethod: formData.invoiceDeliveryMethod || undefined,
            invoiceFrequency: formData.invoiceFrequency || undefined,
            customerRules: {
              attendance: formData.attendancePolicy || undefined,
              noShows: formData.noShowPolicy || undefined,
              overtime: formData.overtimePolicy || undefined,
              callOffs: formData.callOffPolicy || undefined,
              injuryHandling: formData.injuryHandlingPolicy || undefined,
            },
          },
          verbalAgreement: {
            contact: formData.verbalAgreementContact || undefined,
            date: formData.verbalAgreementDate || undefined,
            method: formData.verbalAgreementMethod || undefined,
            conditionsToFulfill: formData.conditionsToFulfill ? formData.conditionsToFulfill.split(',').map(s => s.trim()).filter(s => s) : undefined,
            approvalsNeeded: formData.approvalsNeeded ? formData.approvalsNeeded.split(',').map(s => s.trim()).filter(s => s) : undefined,
            insuranceSubmitted: formData.insuranceSubmitted,
          },
          closedWon: {
            contractSignedDate: formData.contractSignedDate || undefined,
            contractExpirationDate: formData.contractExpirationDate || undefined,
            rateSheetOnFile: formData.rateSheetOnFile,
            msaSigned: formData.msaSigned,
          },
        },
        
        // Update timestamp
        updatedAt: new Date(),
      };

      // Compute bill rate consistency
      const numericPayForCreate = parseFloat(String(formData.payRate || '')) || 0;
      const numericMarkupForCreate = parseFloat(String(formData.markup || '')) || 0;
      const computedBillForCreate = numericMarkupForCreate > 0 && numericPayForCreate > 0
        ? Number((numericPayForCreate * (1 + numericMarkupForCreate / 100)).toFixed(2))
        : 0;

      const jobOrderData = {
        // Job Order specific fields
        tenantId,
        jobOrderName: formData.jobOrderName,
        jobOrderDescription: formData.description,
        status: formData.status,
        workersNeeded: parseInt(formData.workersNeeded.toString()) || 1,
        payRate: parseFloat(formData.payRate) || 0,
        markup: parseFloat(formData.markup) || 0,
        billRate: (numericMarkupForCreate > 0 ? computedBillForCreate : (parseFloat(formData.billRate) || 0)),
        calculatedBillRate: computedBillForCreate,
        startDate: formData.startDate ? (() => {
          try {
            const date = new Date(formData.startDate);
            return isNaN(date.getTime()) ? null : date;
          } catch (error) {
            console.warn('Invalid start date in form data:', formData.startDate);
            return null;
          }
        })() : null,
        endDate: formData.endDate ? (() => {
          try {
            const date = new Date(formData.endDate);
            return isNaN(date.getTime()) ? null : date;
          } catch (error) {
            console.warn('Invalid end date in form data:', formData.endDate);
            return null;
          }
        })() : null,
        
        // Update the deal data
        deal: updatedDealData,
        
        // HR Contact
        hrContactId: formData.hrContactId || '',
        
        // Additional Contact Roles
        operationsContactId: formData.operationsContactId || '',
        procurementContactId: formData.procurementContactId || '',
        billingContactId: formData.billingContactId || '',
        safetyContactId: formData.safetyContactId || '',
        invoiceContactId: formData.invoiceContactId || '',
        
        // Metadata
        updatedAt: new Date(),
        updatedBy: user.uid,
      };

      if (isEditing && jobOrderId) {
        // Update existing job order
        const jobOrderRef = doc(db, p.jobOrder(tenantId, jobOrderId));
        await updateDoc(jobOrderRef, jobOrderData);
        setSuccess('Job order updated successfully!');
      } else {
        // Create new job order
        const jobOrdersRef = collection(db, p.jobOrders(tenantId));
        const jobOrdersSnapshot = await getDocs(jobOrdersRef);
        const nextJobOrderNumber = jobOrdersSnapshot.size + 1;

        const newJobOrderData = {
          ...jobOrderData,
          jobOrderNumber: nextJobOrderNumber,
          createdBy: user.uid,
          createdAt: new Date(),
          headcountFilled: 0,
        };

        await addDoc(jobOrdersRef, newJobOrderData);
        setSuccess('Job order created successfully!');
      }
      
      // Call onSave callback if provided
      if (onSave) {
        onSave();
      } else {
        // Default behavior: redirect after delay
        setTimeout(() => {
          navigate('/recruiter/job-orders');
        }, 1500);
      }
      
    } catch (error: any) {
      console.error('Error saving job order:', error);
      setError(error.message || `Failed to ${isEditing ? 'update' : 'create'} job order`);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      navigate('/recruiter/job-orders');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Success/Error Messages */}
      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}
      
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Comprehensive Form with Section Headers */}
      <Card>
        <CardContent>
          <Grid container spacing={2}>
            {/* Basic Information Section */}
            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom sx={{ mt: 2, mb: 2, color: 'primary.main' }}>
                Basic Information
              </Typography>
            </Grid>

            <Grid container spacing={2} sx={{ mb: 3 }}>
            
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label={(getFieldDef('jobTitle')?.label || 'Job Title')}
                  value={formData.jobTitle}
                  onChange={(e) => handleInputChange('jobTitle', e.target.value)}
                  onBlur={(e) => handleFieldBlur('jobTitle', e.target.value)}
                  required
                />
              </Grid>
              
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={formData.status}
                    onChange={(e) => handleInputChange('status', e.target.value)}
                    onBlur={(e) => handleFieldBlur('status', e.target.value)}
                    label="Status"
                  >
                    <MenuItem value="draft">Draft</MenuItem>
                    <MenuItem value="open">Open</MenuItem>
                    <MenuItem value="on_hold">On Hold</MenuItem>
                    <MenuItem value="cancelled">Cancelled</MenuItem>
                    <MenuItem value="filled">Filled</MenuItem>
                    <MenuItem value="completed">Completed</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            <Grid container spacing={2} sx={{ mb: 3 }}>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={(getFieldDef('workersNeeded')?.label || 'Workers Needed')}
                type="number"
                value={formData.workersNeeded}
                onChange={(e) => handleInputChange('workersNeeded', parseInt(e.target.value) || 1)}
                onBlur={(e) => handleFieldBlur('workersNeeded', parseInt(e.target.value) || 1)}
                required
                inputProps={{ min: 1 }}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>{getFieldDef('shiftType')?.label || 'Shift Type'}</InputLabel>
                <Select
                  value={(formData as any).shiftType}
                  onChange={(e) => handleInputChange('shiftType', e.target.value)}
                  onBlur={(e) => handleFieldBlur('shiftType', e.target.value)}
                  label={getFieldDef('shiftType')?.label || 'Shift Type'}
                >
                  {(getFieldDef('shiftType')?.options || []).map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label={getFieldDef('payRate')?.label || 'Pay Rate'}
                value={formData.payRate}
                onChange={(e) => handleInputChange('payRate', e.target.value)}
                onBlur={(e) => handleFieldBlur('payRate', e.target.value)}
                placeholder="e.g., $15/hour, $500/week"
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label={getFieldDef('markup')?.label || 'Markup (%)'}
                value={formData.markup}
                onChange={(e) => handleInputChange('markup', e.target.value)}
                placeholder="e.g., 25"
              />
            </Grid>

            {(!formData.markup || String(formData.markup).trim() === '' || Number(formData.markup) === 0) ? (
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label={getFieldDef('billRate')?.label || 'Bill Rate'}
                  value={formData.billRate}
                  onChange={(e) => handleInputChange('billRate', e.target.value)}
                  onBlur={(e) => handleFieldBlur('billRate', e.target.value)}
                  placeholder="e.g., $22.50"
                />
              </Grid>
            ) : (
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label={getFieldDef('calculatedBillRate')?.label || 'Calculated Bill Rate'}
                  value={formData.calculatedBillRate}
                  InputProps={{ readOnly: true }}
                />
              </Grid>
            )}

            

            
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={getFieldDef('startDate')?.label || 'Start Date'}
                type="date"
                value={formData.startDate}
                onChange={(e) => handleInputChange('startDate', e.target.value)}
                onBlur={(e) => handleFieldBlur('startDate', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={getFieldDef('endDate')?.label || 'End Date'}
                type="date"
                value={formData.endDate}
                onChange={(e) => handleInputChange('endDate', e.target.value)}
                onBlur={(e) => handleFieldBlur('endDate', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            </Grid>


            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>{(getFieldDef('companyId')?.label || 'Company') + ' *'}</InputLabel>
                  <Select
                    value={formData.companyId}
                    onChange={(e) => handleInputChange('companyId', e.target.value)}
                    onBlur={(e) => handleFieldBlur('companyId', e.target.value)}
                    label={(getFieldDef('companyId')?.label || 'Company') + ' *'}
                    required
                  >
                    {companies.map((company) => (
                      <MenuItem key={company.id} value={company.id}>
                        {company.companyName || company.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>{getFieldDef('worksiteId')?.label || 'Location'}</InputLabel>
                  <Select
                    value={formData.worksiteId}
                    onChange={(e) => handleInputChange('worksiteId', e.target.value)}
                    onBlur={(e) => handleFieldBlur('worksiteId', e.target.value)}
                    label={getFieldDef('worksiteId')?.label || 'Location'}
                    disabled={!formData.companyId}
                  >
                    {filteredLocations.map((location) => (
                      <MenuItem key={location.id} value={location.id}>
                        {location.nickname || location.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>


            <Grid item xs={12} md={6}>
              <Typography variant="h6" gutterBottom sx={{ mt: 2, mb: 3, color: 'primary.main' }}>
                Company Contacts
              </Typography>
            </Grid>

            <Grid container spacing={2} sx={{ mb: 3 }}>

            <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                <InputLabel>{getFieldDef('decisionMaker')?.label || 'HR Contact'}</InputLabel>
                  <Select
                    value={formData.decisionMaker || ''}
                    onChange={(e) => handleInputChange('decisionMaker', e.target.value)}
                    onBlur={(e) => handleFieldBlur('decisionMaker', e.target.value)}
                    label="Decision Maker"
                    disabled={associatedContacts.length === 0}
                  >
                    <MenuItem value="">
                      <em>
                        {associatedContacts.length === 0 
                          ? 'No contacts available' 
                          : 'Select Decision Maker'
                        }
                      </em>
                    </MenuItem>
                    {associatedContacts.map((contact) => (
                      <MenuItem key={contact.id} value={contact.id}>
                        {contact.fullName} {contact.title && `(${contact.title})`}
                      </MenuItem>
                    ))}
                  </Select>
                  {associatedContacts.length === 0 && dealId && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                      No contacts are associated with this deal. Add contacts to the deal first.
                    </Typography>
                  )}
                  {!dealId && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                      HR Contact selection requires a deal to be associated with this job order.
                    </Typography>
                  )}
                </FormControl>
              </Grid>
            </Grid>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                <InputLabel>{getFieldDef('hrContactId')?.label || 'HR Contact'}</InputLabel>
                  <Select
                    value={formData.hrContactId || ''}
                    onChange={(e) => handleInputChange('hrContactId', e.target.value)}
                    onBlur={(e) => handleFieldBlur('hrContactId', e.target.value)}
                    label="HR Contact"
                    disabled={associatedContacts.length === 0}
                  >
                    <MenuItem value="">
                      <em>
                        {associatedContacts.length === 0 
                          ? 'No contacts available' 
                          : 'Select HR Contact'
                        }
                      </em>
                    </MenuItem>
                    {associatedContacts.map((contact) => (
                      <MenuItem key={contact.id} value={contact.id}>
                        {contact.fullName} {contact.title && `(${contact.title})`}
                      </MenuItem>
                    ))}
                  </Select>
                  {associatedContacts.length === 0 && dealId && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                      No contacts are associated with this deal. Add contacts to the deal first.
                    </Typography>
                  )}
                  {!dealId && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                      HR Contact selection requires a deal to be associated with this job order.
                    </Typography>
                  )}
                </FormControl>
              </Grid>

              {/* Additional Contact Roles */}
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                <InputLabel>{getFieldDef('operationsContactId')?.label || 'Operations Contact'}</InputLabel>
                  <Select
                    value={formData.operationsContactId || ''}
                    onChange={(e) => handleInputChange('operationsContactId', e.target.value)}
                    onBlur={(e) => handleFieldBlur('operationsContactId', e.target.value)}
                    label="Operations Contact"
                    disabled={associatedContacts.length === 0}
                  >
                    <MenuItem value="">
                      <em>
                        {associatedContacts.length === 0 
                          ? 'No contacts available' 
                          : 'Select Operations Contact'
                        }
                      </em>
                    </MenuItem>
                    {associatedContacts.map((contact) => (
                      <MenuItem key={contact.id} value={contact.id}>
                        {contact.fullName} {contact.title && `(${contact.title})`}
                      </MenuItem>
                    ))}
                  </Select>
                  {associatedContacts.length === 0 && dealId && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                      No contacts are associated with this deal. Add contacts to the deal first.
                    </Typography>
                  )}
                  {!dealId && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                      Operations Contact selection requires a deal to be associated with this job order.
                    </Typography>
                  )}
                </FormControl>
              </Grid>
            </Grid>

          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
              <InputLabel>{getFieldDef('procurementContactId')?.label || 'Procurement Contact'}</InputLabel>
                <Select
                  value={formData.procurementContactId || ''}
                  onChange={(e) => handleInputChange('procurementContactId', e.target.value)}
                  onBlur={(e) => handleFieldBlur('procurementContactId', e.target.value)}
                  label="Procurement Contact"
                  disabled={associatedContacts.length === 0}
                >
                  <MenuItem value="">
                    <em>
                      {associatedContacts.length === 0 
                        ? 'No contacts available' 
                        : 'Select Procurement Contact'
                      }
                    </em>
                  </MenuItem>
                  {associatedContacts.map((contact) => (
                    <MenuItem key={contact.id} value={contact.id}>
                      {contact.fullName} {contact.title && `(${contact.title})`}
                    </MenuItem>
                  ))}
                </Select>
                {associatedContacts.length === 0 && dealId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    No contacts are associated with this deal. Add contacts to the deal first.
                  </Typography>
                )}
                {!dealId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    Procurement Contact selection requires a deal to be associated with this job order.
                  </Typography>
                )}
              </FormControl>
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
              <InputLabel>{getFieldDef('billingContactId')?.label || 'Billing Contact'}</InputLabel>
                <Select
                  value={formData.billingContactId || ''}
                  onChange={(e) => handleInputChange('billingContactId', e.target.value)}
                  onBlur={(e) => handleFieldBlur('billingContactId', e.target.value)}
                  label="Billing Contact"
                  disabled={associatedContacts.length === 0}
                >
                  <MenuItem value="">
                    <em>
                      {associatedContacts.length === 0 
                        ? 'No contacts available' 
                        : 'Select Billing Contact'
                      }
                    </em>
                  </MenuItem>
                  {associatedContacts.map((contact) => (
                    <MenuItem key={contact.id} value={contact.id}>
                      {contact.fullName} {contact.title && `(${contact.title})`}
                    </MenuItem>
                  ))}
                </Select>
                {associatedContacts.length === 0 && dealId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    No contacts are associated with this deal. Add contacts to the deal first.
                  </Typography>
                )}
                {!dealId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    Billing Contact selection requires a deal to be associated with this job order.
                  </Typography>
                )}
              </FormControl>
            </Grid>
          </Grid>

          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
              <InputLabel>{getFieldDef('safetyContactId')?.label || 'Safety Contact'}</InputLabel>
                <Select
                  value={formData.safetyContactId || ''}
                  onChange={(e) => handleInputChange('safetyContactId', e.target.value)}
                  onBlur={(e) => handleFieldBlur('safetyContactId', e.target.value)}
                  label="Safety Contact"
                  disabled={associatedContacts.length === 0}
                >
                  <MenuItem value="">
                    <em>
                      {associatedContacts.length === 0 
                        ? 'No contacts available' 
                        : 'Select Safety Contact'
                      }
                    </em>
                  </MenuItem>
                  {associatedContacts.map((contact) => (
                    <MenuItem key={contact.id} value={contact.id}>
                      {contact.fullName} {contact.title && `(${contact.title})`}
                    </MenuItem>
                  ))}
                </Select>
                {associatedContacts.length === 0 && dealId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    No contacts are associated with this deal. Add contacts to the deal first.
                  </Typography>
                )}
                {!dealId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    Safety Contact selection requires a deal to be associated with this job order.
                  </Typography>
                )}
              </FormControl>
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>{getFieldDef('invoiceContactId')?.label || 'Invoice Contact'}</InputLabel>
                <Select
                  value={formData.invoiceContactId || ''}
                  onChange={(e) => handleInputChange('invoiceContactId', e.target.value)}
                  onBlur={(e) => handleFieldBlur('invoiceContactId', e.target.value)}
                  label="Invoice Contact"
                  disabled={associatedContacts.length === 0}
                >
                  <MenuItem value="">
                    <em>
                      {associatedContacts.length === 0 
                        ? 'No contacts available' 
                        : 'Select Invoice Contact'
                      }
                    </em>
                  </MenuItem>
                  {associatedContacts.map((contact) => (
                    <MenuItem key={contact.id} value={contact.id}>
                      {contact.fullName} {contact.title && `(${contact.title})`}
                    </MenuItem>
                  ))}
                </Select>
                {associatedContacts.length === 0 && dealId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    No contacts are associated with this deal. Add contacts to the deal first.
                  </Typography>
                )}
                {!dealId && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                    Invoice Contact selection requires a deal to be associated with this job order.
                  </Typography>
                )}
              </FormControl>
            </Grid>
          </Grid>


           <Grid item xs={12}>
               <Typography variant="h6" gutterBottom sx={{ mt: 2, mb: 3, color: 'primary.main' }}>
                 Company Background
               </Typography>
             </Grid>

             <Grid container spacing={2} sx={{ mb: 3 }}>

             <Grid item xs={12}>
               <FormControl component="fieldset" sx={{ mb: 3 }}>
                 <Typography variant="subtitle2" sx={{ mb: 2 }}>
                   Do they currently use staffing agencies?
                 </Typography>
                 <Box sx={{ display: 'flex', gap: 2 }}>
                   <Button
                     variant={formData.currentAgencyCount && parseInt(formData.currentAgencyCount) > 0 ? 'contained' : 'outlined'}
                     onClick={() => {
                       if (!formData.currentAgencyCount || parseInt(formData.currentAgencyCount) === 0) {
                         handleInputChange('currentAgencyCount', '1');
                       }
                     }}
                   >
                     Yes
                   </Button>
                   <Button
                     variant={!formData.currentAgencyCount || parseInt(formData.currentAgencyCount) === 0 ? 'contained' : 'outlined'}
                     onClick={() => handleInputChange('currentAgencyCount', '0')}
                   >
                     No
                   </Button>
                 </Box>
               </FormControl>
             </Grid>
             </Grid>
             <Grid container spacing={2} sx={{ mb: 3 }}>
      
                 <Grid item xs={12} md={6}>
                   <TextField
                     fullWidth
                     label={getFieldDef('currentStaffCount')?.label || 'Current Staff Count'}
                     type="number"
                     value={formData.currentStaffCount}
                     onChange={(e) => handleInputChange('currentStaffCount', e.target.value)}
                     onBlur={(e) => handleFieldBlur('currentStaffCount', e.target.value)}
                   />
                 </Grid>
                 <Grid item xs={12} md={6}>
                   <TextField
                     fullWidth
                     label={getFieldDef('currentAgencyCount')?.label || 'Current Agency Count'}
                     type="number"
                     value={formData.currentAgencyCount}
                     onChange={(e) => handleInputChange('currentAgencyCount', e.target.value)}
                     onBlur={(e) => handleFieldBlur('currentAgencyCount', e.target.value)}
                   />
                 </Grid>
                 <Grid item xs={12}>
                   <FormControl fullWidth>
                     <InputLabel>Satisfaction Level With Current Staffing Agencies</InputLabel>
                     <Select
                       value={formData.currentSatisfactionLevel || ''}
                       onChange={(e) => handleInputChange('currentSatisfactionLevel', e.target.value)}
                       onBlur={(e) => handleFieldBlur('currentSatisfactionLevel', e.target.value)}
                       label="Satisfaction Level With Current Staffing Agencies"
                     >
                       <MenuItem value="very_happy">Very Happy</MenuItem>
                       <MenuItem value="somewhat">Somewhat Satisfied</MenuItem>
                       <MenuItem value="frustrated">Frustrated</MenuItem>
                     </Select>
                   </FormControl>
                 </Grid>
                 </Grid>

                 <Grid container spacing={2} sx={{ mb: 3 }}>  
  
                 <Grid item xs={12}>
                   <FormControl component="fieldset" sx={{ mb: 2 }}>
                     <Typography variant="subtitle2" sx={{ mb: 2 }}>
                       Have they used staffing agencies before?
                     </Typography>
                     <Box sx={{ display: 'flex', gap: 2 }}>
                       <Button
                         variant={formData.hasUsedAgenciesBefore ? 'contained' : 'outlined'}
                         onClick={() => handleInputChange('hasUsedAgenciesBefore', true)}
                       >
                         Yes
                       </Button>
                       <Button
                         variant={!formData.hasUsedAgenciesBefore ? 'contained' : 'outlined'}
                         onClick={() => handleInputChange('hasUsedAgenciesBefore', false)}
                       >
                         No
                       </Button>
                     </Box>
                   </FormControl>
                 </Grid>
                 </Grid>


            {/* Job Details Section */}
            <Grid item xs={12}>
              <Divider sx={{ my: 3 }} />
              <Typography variant="h6" gutterBottom sx={{ mb: 2, color: 'primary.main' }}>
                Job Details
              </Typography>
            </Grid>
            
            

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={getFieldDef('estimatedRevenue')?.label || 'Estimated Revenue'}
                value={formData.estimatedRevenue}
                onChange={(e) => handleInputChange('estimatedRevenue', e.target.value)}
                placeholder="e.g., 50000"
              />
            </Grid>


            {/* Qualification Information Section */}
            <Grid item xs={12}>
              <Divider sx={{ my: 3 }} />
              <Typography variant="h6" gutterBottom sx={{ mb: 2, color: 'primary.main' }}>
                Qualification Information
              </Typography>
            </Grid>
            
            <Grid item xs={12}>
              <TextField
                fullWidth
                label={getFieldDef('mustHave')?.label || 'Must Have Requirements'}
                value={formData.mustHaveRequirements}
                onChange={(e) => handleInputChange('mustHaveRequirements', e.target.value)}
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label={getFieldDef('mustAvoid')?.label || 'Must Avoid Requirements'}
                value={formData.mustAvoidRequirements}
                onChange={(e) => handleInputChange('mustAvoidRequirements', e.target.value)}
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label={getFieldDef('potentialObstacles')?.label || 'Potential Obstacles'}
                value={formData.potentialObstacles}
                onChange={(e) => handleInputChange('potentialObstacles', e.target.value)}
                placeholder="Comma-separated list of potential obstacles"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={getFieldDef('expectedStartDate')?.label || 'Expected Start Date'}
                type="date"
                value={formData.expectedStartDate}
                onChange={(e) => handleInputChange('expectedStartDate', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={getFieldDef('expectedAveragePayRate')?.label || 'Expected Pay Rate'}
                value={formData.expectedPayRate}
                onChange={(e) => handleInputChange('expectedPayRate', e.target.value)}
                placeholder="e.g., 15.00"
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="Initial Headcount"
                type="number"
                value={formData.initialHeadcount}
                onChange={(e) => handleInputChange('initialHeadcount', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="After 30 Days"
                type="number"
                value={formData.headcountAfter30Days}
                onChange={(e) => handleInputChange('headcountAfter30Days', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="After 90 Days"
                type="number"
                value={formData.headcountAfter90Days}
                onChange={(e) => handleInputChange('headcountAfter90Days', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="After 180 Days"
                type="number"
                value={formData.headcountAfter180Days}
                onChange={(e) => handleInputChange('headcountAfter180Days', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label={getFieldDef('expectedAverageMarkup')?.label || 'Expected Markup (%)'}
                value={formData.expectedMarkup}
                onChange={(e) => handleInputChange('expectedMarkup', e.target.value)}
                placeholder="e.g., 25"
              />
            </Grid>

            {/* Compliance & Requirements Section */}
            <Grid item xs={12}>
              <Divider sx={{ my: 3 }} />
              <Typography variant="h6" gutterBottom sx={{ mb: 2, color: 'primary.main' }}>
                Compliance & Requirements
              </Typography>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.eVerifyRequired}
                    onChange={(e) => handleInputChange('eVerifyRequired', e.target.checked)}
                  />
                }
                label="E-Verify Required"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>{getFieldDef('ppeProvidedBy')?.label || 'PPE Provided By'}</InputLabel>
                <Select
                  value={formData.ppeProvidedBy}
                  onChange={(e) => handleInputChange('ppeProvidedBy', e.target.value)}
                  label={getFieldDef('ppeProvidedBy')?.label || 'PPE Provided By'}
                >
                  <MenuItem value="company">Company</MenuItem>
                  <MenuItem value="worker">Worker</MenuItem>
                  <MenuItem value="both">Both</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                multiple
                fullWidth
                options={backgroundCheckOptions.map(option => option.label)}
                value={formData.backgroundCheckPackages}
                onChange={(event, newValue) => {
                  handleInputChange('backgroundCheckPackages', newValue);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={getFieldDef('backgroundCheckPackages')?.label || 'Background Check Packages'}
                    helperText="Select required background check types"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                multiple
                fullWidth
                options={drugScreeningOptions.map(option => option.label)}
                value={formData.drugScreeningPanels}
                onChange={(event, newValue) => {
                  handleInputChange('drugScreeningPanels', newValue);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={getFieldDef('drugScreeningPanels')?.label || 'Drug Screening Panels'}
                    helperText="Select required drug screening panels"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                multiple
                fullWidth
                options={additionalScreeningOptions.map(option => option.label)}
                value={formData.additionalScreenings}
                onChange={(event, newValue) => {
                  handleInputChange('additionalScreenings', newValue);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Additional Screenings"
                    helperText="Select required additional screening types (healthcare, credentials, etc.)"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                multiple
                options={getOptionsForField('licensesCerts', companyDefaultsForOptions)}
                value={formData.licensesCerts.map(cred => ({ value: cred, label: cred }))}
                onChange={(_, newValue) => {
                  const credValues = newValue.map(option => option.value);
                  handleInputChange('licensesCerts', credValues);
                }}
                getOptionLabel={(option) => typeof option === 'string' ? option : option.label}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => {
                    const { key, ...chipProps } = getTagProps({ index });
                    return (
                      <Chip
                        key={key}
                        label={typeof option === 'string' ? option : option.label}
                        size="small"
                        {...chipProps}
                      />
                    );
                  })
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={getFieldDef('licensesCerts')?.label || 'Licenses & Certifications'}
                    placeholder="Type to search licenses and certifications..."
                    helperText="Start typing to search from 100+ standard credentials"
                  />
                )}
                filterSelectedOptions
                freeSolo={false}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Experience Required</InputLabel>
                <Select
                  value={formData.experienceRequired}
                  onChange={(e) => handleInputChange('experienceRequired', e.target.value)}
                  label="Experience Required"
                >
                  {experienceOptions.map((option, index) => (
                    <MenuItem key={index} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Education Required</InputLabel>
                <Select
                  value={formData.educationRequired}
                  onChange={(e) => handleInputChange('educationRequired', e.target.value)}
                  label="Education Required"
                >
                  {educationOptions.map((option, index) => (
                    <MenuItem key={index} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>{getFieldDef('languages')?.label || 'Languages Required'}</InputLabel>
                <Select
                  multiple
                  value={formData.languagesRequired}
                  onChange={(e) => handleInputChange('languagesRequired', e.target.value)}
                  input={<OutlinedInput label={getFieldDef('languages')?.label || 'Languages Required'} />}
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {selected.map((value) => (
                        <Chip key={value} label={value} size="small" />
                      ))}
                    </Box>
                  )}
                >
                  {getOptionsForField('languages', companyDefaultsForOptions).map((opt, index) => (
                    <MenuItem key={index} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                multiple
                options={getOptionsForField('skills', companyDefaultsForOptions)}
                value={formData.skillsRequired.map(skill => ({ value: skill, label: skill }))}
                onChange={(_, newValue) => {
                  const skillValues = newValue.map(option => option.value);
                  handleInputChange('skillsRequired', skillValues);
                }}
                getOptionLabel={(option) => typeof option === 'string' ? option : option.label}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => {
                    const { key, ...chipProps } = getTagProps({ index });
                    return (
                      <Chip
                        key={key}
                        label={typeof option === 'string' ? option : option.label}
                        size="small"
                        {...chipProps}
                      />
                    );
                  })
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={getFieldDef('skills')?.label || 'Skills Required'}
                    placeholder="Type to search skills..."
                    helperText="Start typing to search from 500+ O*NET skills"
                  />
                )}
                filterSelectedOptions
                freeSolo={false}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                multiple
                fullWidth
                options={[
                  'Standing',
                  'Walking',
                  'Sitting',
                  'Lifting 25 lbs',
                  'Lifting 50 lbs',
                  'Lifting 75 lbs',
                  'Lifting 100+ lbs',
                  'Carrying 25 lbs',
                  'Carrying 50 lbs',
                  'Carrying 75 lbs',
                  'Carrying 100+ lbs',
                  'Pushing',
                  'Pulling',
                  'Climbing',
                  'Balancing',
                  'Stooping',
                  'Kneeling',
                  'Crouching',
                  'Crawling',
                  'Reaching',
                  'Handling',
                  'Fingering',
                  'Feeling',
                  'Talking',
                  'Hearing',
                  'Seeing',
                  'Color Vision',
                  'Depth Perception',
                  'Field of Vision',
                  'Driving',
                  'Operating Machinery',
                  'Working at Heights',
                  'Confined Spaces',
                  'Outdoor Work',
                  'Indoor Work',
                  'Temperature Extremes',
                  'Noise',
                  'Vibration',
                  'Fumes/Odors',
                  'Dust',
                  'Chemicals',
                  'Radiation',
                  'Other'
                ]}
                value={formData.physicalRequirements}
                onChange={(event, newValue) => {
                  handleInputChange('physicalRequirements', newValue);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Physical Requirements"
                    helperText="Select physical requirements for this position"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                multiple
                fullWidth
                options={[
                  'Hard Hat',
                  'Safety Glasses',
                  'Safety Goggles',
                  'Face Shield',
                  'Respirator',
                  'Dust Mask',
                  'N95 Mask',
                  'Hearing Protection',
                  'Ear Plugs',
                  'Ear Muffs',
                  'High-Visibility Vest',
                  'Reflective Clothing',
                  'Safety Boots',
                  'Steel-Toe Boots',
                  'Non-Slip Shoes',
                  'Cut-Resistant Gloves',
                  'Chemical-Resistant Gloves',
                  'Heat-Resistant Gloves',
                  'Fall Protection Harness',
                  'Safety Lanyard',
                  'Lifeline',
                  'Confined Space Equipment',
                  'Gas Monitor',
                  'Air Purifying Respirator',
                  'Self-Contained Breathing Apparatus',
                  'First Aid Kit',
                  'Emergency Shower',
                  'Eye Wash Station',
                  'Fire Extinguisher',
                  'Safety Data Sheets',
                  'Lockout/Tagout Devices',
                  'Barricades',
                  'Warning Signs',
                  'Personal Alarm',
                  'Two-Way Radio',
                  'Flashlight',
                  'Headlamp',
                  'Protective Coveralls',
                  'Disposable Suits',
                  'Chemical Apron',
                  'Lab Coat',
                  'Hair Net',
                  'Beard Cover',
                  'Disposable Gloves',
                  'Nitrile Gloves',
                  'Latex Gloves',
                  'Vinyl Gloves',
                  'Insulated Gloves',
                  'Electrical Gloves',
                  'Welding Helmet',
                  'Welding Gloves',
                  'Welding Apron',
                  'Welding Boots',
                  'Welding Jacket',
                  'Chainsaw Chaps',
                  'Cutting Gloves',
                  'Abrasion-Resistant Clothing',
                  'Flame-Resistant Clothing',
                  'Arc Flash Protection',
                  'Voltage-Rated Gloves',
                  'Rubber Insulating Gloves',
                  'Leather Protectors',
                  'Insulating Blankets',
                  'Insulating Covers',
                  'Hot Sticks',
                  'Voltage Detectors',
                  'Ground Fault Circuit Interrupters',
                  'Other'
                ]}
                value={formData.ppeRequirements}
                onChange={(event, newValue) => {
                  handleInputChange('ppeRequirements', newValue);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={getFieldDef('ppe')?.label || 'PPE Requirements'}
                    helperText="Select required personal protective equipment"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <Autocomplete
                multiple
                fullWidth
                options={[
                  'Business Casual',
                  'Business Professional',
                  'Casual',
                  'Scrubs',
                  'Uniform Provided',
                  'Black Pants',
                  'White Shirt',
                  'Polo Shirt',
                  'Button-Down Shirt',
                  'Dress Shirt',
                  'Khaki Pants',
                  'Dress Pants',
                  'Jeans (Dark)',
                  'Jeans (No Holes)',
                  'Slacks',
                  'Skirt/Dress',
                  'Blouse',
                  'Sweater',
                  'Cardigan',
                  'Blazer',
                  'Suit',
                  'Tie Required',
                  'No Tie',
                  'Closed-Toe Shoes',
                  'Steel-Toe Boots',
                  'Non-Slip Shoes',
                  'Dress Shoes',
                  'Sneakers',
                  'Boots',
                  'Sandals Allowed',
                  'No Sandals',
                  'No Flip-Flops',
                  'No Shorts',
                  'No Tank Tops',
                  'No Graphic Tees',
                  'No Hoodies',
                  'No Sweatpants',
                  'No Leggings',
                  'No Yoga Pants',
                  'No Athletic Wear',
                  'No Ripped Clothing',
                  'No Visible Tattoos',
                  'No Facial Piercings',
                  'Minimal Jewelry',
                  'No Jewelry',
                  'Hair Tied Back',
                  'Clean Shaven',
                  'Facial Hair Allowed',
                  'Hair Color Restrictions',
                  'No Hair Color Restrictions',
                  'Coveralls',
                  'Safety Vest',
                  'Hard Hat',
                  'Reflective Clothing',
                  'Weather-Appropriate',
                  'Seasonal Attire',
                  'Formal Occasions',
                  'Customer-Facing',
                  'Back Office',
                  'Laboratory',
                  'Kitchen',
                  'Warehouse',
                  'Construction',
                  'Healthcare',
                  'Food Service',
                  'Retail',
                  'Office',
                  'Other'
                ]}
                value={formData.dressCode}
                onChange={(event, newValue) => {
                  handleInputChange('dressCode', newValue);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Uniform Requirements"
                    helperText="Select dress code and uniform requirements"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>

            {/* Customer Rules & Policies Section */}
            <Grid item xs={12}>
              <Divider sx={{ my: 3 }} />
              <Typography variant="h6" gutterBottom sx={{ mb: 2, color: 'primary.main' }}>
                Customer Rules & Policies
              </Typography>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.replacingExistingAgency}
                    onChange={(e) => handleInputChange('replacingExistingAgency', e.target.checked)}
                  />
                }
                label="Replacing Existing Agency"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.rolloverExistingStaff}
                    onChange={(e) => handleInputChange('rolloverExistingStaff', e.target.checked)}
                  />
                }
                label="Rollover Existing Staff"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Timeclock System"
                value={formData.timeclockSystem}
                onChange={(e) => handleInputChange('timeclockSystem', e.target.value)}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Attendance Policy"
                value={formData.attendancePolicy}
                onChange={(e) => handleInputChange('attendancePolicy', e.target.value)}
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="No-Show Policy"
                value={formData.noShowPolicy}
                onChange={(e) => handleInputChange('noShowPolicy', e.target.value)}
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Overtime Policy"
                value={formData.overtimePolicy}
                onChange={(e) => handleInputChange('overtimePolicy', e.target.value)}
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Call-Off Policy"
                value={formData.callOffPolicy}
                onChange={(e) => handleInputChange('callOffPolicy', e.target.value)}
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Injury Handling Policy"
                value={formData.injuryHandlingPolicy}
                onChange={(e) => handleInputChange('injuryHandlingPolicy', e.target.value)}
                multiline
                rows={2}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Discipline Policy"
                value={formData.disciplinePolicy}
                onChange={(e) => handleInputChange('disciplinePolicy', e.target.value)}
                multiline
                rows={2}
              />
            </Grid>

            {/* Billing & Invoicing Section */}
            <Grid item xs={12}>
              <Divider sx={{ my: 3 }} />
              <Typography variant="h6" gutterBottom sx={{ mb: 2, color: 'primary.main' }}>
                Billing & Invoicing
              </Typography>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.poRequired}
                    onChange={(e) => handleInputChange('poRequired', e.target.checked)}
                  />
                }
                label="PO Required"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Payment Terms"
                value={formData.paymentTerms}
                onChange={(e) => handleInputChange('paymentTerms', e.target.value)}
                placeholder="e.g., Net 30"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Invoice Delivery Method</InputLabel>
                <Select
                  value={formData.invoiceDeliveryMethod}
                  onChange={(e) => handleInputChange('invoiceDeliveryMethod', e.target.value)}
                  label="Invoice Delivery Method"
                >
                  <MenuItem value="email">Email</MenuItem>
                  <MenuItem value="portal">Portal</MenuItem>
                  <MenuItem value="mail">Mail</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Invoice Frequency</InputLabel>
                <Select
                  value={formData.invoiceFrequency}
                  onChange={(e) => handleInputChange('invoiceFrequency', e.target.value)}
                  label="Invoice Frequency"
                >
                  <MenuItem value="weekly">Weekly</MenuItem>
                  <MenuItem value="biweekly">Bi-weekly</MenuItem>
                  <MenuItem value="monthly">Monthly</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            {/* Agreement & Contract Information Section */}
            <Grid item xs={12}>
              <Divider sx={{ my: 3 }} />
              <Typography variant="h6" gutterBottom sx={{ mb: 2, color: 'primary.main' }}>
                Agreement & Contract Information
              </Typography>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Verbal Agreement Contact"
                value={formData.verbalAgreementContact}
                onChange={(e) => handleInputChange('verbalAgreementContact', e.target.value)}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Verbal Agreement Date"
                type="date"
                value={formData.verbalAgreementDate}
                onChange={(e) => handleInputChange('verbalAgreementDate', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Verbal Agreement Method</InputLabel>
                <Select
                  value={formData.verbalAgreementMethod}
                  onChange={(e) => handleInputChange('verbalAgreementMethod', e.target.value)}
                  label="Verbal Agreement Method"
                >
                  <MenuItem value="phone">Phone</MenuItem>
                  <MenuItem value="email">Email</MenuItem>
                  <MenuItem value="in_person">In Person</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.insuranceSubmitted}
                    onChange={(e) => handleInputChange('insuranceSubmitted', e.target.checked)}
                  />
                }
                label="Insurance Submitted"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Conditions to Fulfill"
                value={formData.conditionsToFulfill}
                onChange={(e) => handleInputChange('conditionsToFulfill', e.target.value)}
                placeholder="Comma-separated list of conditions"
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Approvals Needed"
                value={formData.approvalsNeeded}
                onChange={(e) => handleInputChange('approvalsNeeded', e.target.value)}
                placeholder="Comma-separated list of approvals needed"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Contract Signed Date"
                type="date"
                value={formData.contractSignedDate}
                onChange={(e) => handleInputChange('contractSignedDate', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Contract Expiration Date"
                type="date"
                value={formData.contractExpirationDate}
                onChange={(e) => handleInputChange('contractExpirationDate', e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.rateSheetOnFile}
                    onChange={(e) => handleInputChange('rateSheetOnFile', e.target.checked)}
                  />
                }
                label="Rate Sheet On File"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.msaSigned}
                    onChange={(e) => handleInputChange('msaSigned', e.target.checked)}
                  />
                }
                label="MSA Signed"
              />
            </Grid>

            {/* Notes Section */}
            <Grid item xs={12}>
              <Divider sx={{ my: 3 }} />
              <Typography variant="h6" gutterBottom sx={{ mb: 2, color: 'primary.main' }}>
                Notes
              </Typography>
            </Grid>
            
            <Grid item xs={12}>
              <TextField
                fullWidth
                label={getFieldDef('notes')?.label || 'Internal Notes'}
                value={formData.notes}
                onChange={(e) => handleInputChange('notes', e.target.value)}
                multiline
                rows={4}
                placeholder="Additional notes or special instructions..."
              />
            </Grid>

            {/* Action Buttons */}
            <Grid item xs={12}>
              <Divider sx={{ my: 3 }} />
              <Stack direction="row" spacing={2}>
                <Button
                  variant="outlined"
                  startIcon={<CancelIcon />}
                  onClick={handleCancel}
                >
                  Cancel
                </Button>
              </Stack>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    </Box>
  );
};

export default JobOrderForm;
