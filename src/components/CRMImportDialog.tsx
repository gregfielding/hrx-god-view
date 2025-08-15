import React, { useState, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Stepper,
  Step,
  StepLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  CircularProgress,
  Grid,
  Card,
  CardContent,
  CardHeader,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Business as CompanyIcon,
  Person as ContactIcon,
  Group as SalespersonIcon,
  TrendingUp as DealIcon,
} from '@mui/icons-material';
import { collection, addDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { enhanceCompanyData } from '../utils/companyNameExtractor';
import { cleanCompanyData, cleanContactData } from '../utils/phoneNumberCleaner';
import { processCompanyAddress, parseAddress } from '../utils/addressParser';

interface CRMImportData {
  companies: any[];
  contacts: any[];
  salespeople: any[];
  deals: any[];
}

interface ImportStep {
  label: string;
  description: string;
  completed: boolean;
  error?: string;
}

interface ImportMapping {
  [key: string]: string;
}

const CRMImportDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ open, onClose, onSuccess }) => {
  const { tenantId } = useAuth();
  const [activeStep, setActiveStep] = useState(0);
  const [importData, setImportData] = useState<CRMImportData>({
    companies: [],
    contacts: [],
    salespeople: [],
    deals: [],
  });
  const [importSteps, setImportSteps] = useState<ImportStep[]>([
    { label: 'Upload Files', description: 'Upload CSV files', completed: false },
    { label: 'Map Fields', description: 'Map CSV columns to CRM fields', completed: false },
    { label: 'Review Data', description: 'Review and validate imported data', completed: false },
    { label: 'Import Data', description: 'Import data to CRM', completed: false },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, message: '' });
  const [aiEnhancementProgress, setAiEnhancementProgress] = useState({ current: 0, total: 0, message: '' });
  
  // Field mappings (currently using direct field access, but keeping for future flexibility)
  const [companyMapping] = useState<ImportMapping>({
    'companyId': 'externalId',
    'Name': 'companyName',
    'Website': 'companyUrl',
    'Phone': 'companyPhone',
    'Address': 'streetAddress',
    'City': 'city',
    'State': 'state',
    'Zip': 'zip',
    'Country': 'country',
    'LinkedIn': 'linkedInUrl',
    'Sales owner id': 'externalSalesId',
    'Sales owner': 'externalSalesOwner',
  });
  
  const [contactMapping] = useState<ImportMapping>({
    'contactId': 'externalId',
    'First name': 'firstName',
    'Last name': 'lastName',
    'Job title': 'jobTitle',
    'Work phone': 'workPhone',
    'Phone': 'phone',
    'Time zone': 'timeZone',
    'Address': 'streetAddress',
    'City': 'city',
    'State': 'state',
    'Zipcode': 'zip',
    'Country': 'country',
    'LinkedIn': 'linkedInUrl',
    'Last contacted time': 'lastContactedTime',
    'Last contacted mode': 'lastContactedMode',
    'Last activity type': 'lastActivityType',
    'Last activity date': 'lastActivityDate',
    'Recent note': 'recentNote',
    'Created at': 'createdAt',
    'Company id': 'externalCompanyId',
    'Company': 'companyName',
    'Sales owner id': 'salesOwnerId',
    'Sales owner': 'salesOwner',
    'Email': 'email',
  });

  const [dealMapping] = useState<ImportMapping>({
    'dealId': 'externalId',
    'Offer name': 'name',
    'Expected Offer value': 'value',
    'Currency': 'currency',
    'Expected close date': 'expectedCloseDate',
    'Created at': 'createdAt',
    'Offer stage': 'offerStage',
    'Related Company id': 'externalCompanyId',
    'Related Company': 'externalCompanyName',
    'Sales owner id': 'salesOwnerId',
    'Sales owner': 'salesOwner',
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper function to process company address (parse units and geocode) with timeout and error handling
  const processCompanyAddressData = async (company: any): Promise<{
    streetAddress: string;
    unit?: string;
    coordinates?: { lat: number; lng: number };
  }> => {
    try {
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Address processing timeout')), 10000) // 10 second timeout
      );
      
      const addressPromise = processCompanyAddress(company);
      const result = await Promise.race([addressPromise, timeoutPromise]);
      
      return result;
    } catch (error) {
      console.warn(`Address processing failed for company ${company['Name']}:`, error);
      // Return fallback data without coordinates
      const address = company['Address'] || '';
      const { streetAddress, unit } = parseAddress(address);
      
      return {
        streetAddress,
        ...(unit ? { unit } : {}),
        ...(undefined as any),
      } as { streetAddress: string; unit?: string; coordinates?: { lat: number; lng: number } };
    }
  };

  const steps = [
    'Upload Files',
    'Map Fields', 
    'Review Data',
    'Import Data'
  ];

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    setLoading(true);
    setError('');

    try {
      const csvData: CRMImportData = {
        companies: [],
        contacts: [],
        salespeople: [],
        deals: [],
      };

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const text = await file.text();
        console.log(`Raw file content (first 500 chars):`, text.substring(0, 500));
        console.log(`Raw file content (first 1000 chars):`, text.substring(0, 1000));
        
        // First, let's try to reconstruct proper CSV lines by handling multi-line fields
        const reconstructedLines: string[] = [];
        let currentLine = '';
        let inQuotes = false;
        // let quoteCount = 0;
        
        for (let i = 0; i < text.length; i++) {
          const char = text[i];
          
          if (char === '"') {
            // quoteCount++;
            inQuotes = !inQuotes;
            currentLine += char;
          } else if (char === '\n' && !inQuotes) {
            // End of line, but not inside quotes
            if (currentLine.trim()) {
              reconstructedLines.push(currentLine.trim());
            }
            currentLine = '';
            // quoteCount = 0;
          } else {
            currentLine += char;
          }
        }
        
        // Add the last line if it exists
        if (currentLine.trim()) {
          reconstructedLines.push(currentLine.trim());
        }
        
        console.log(`Original lines: ${text.split('\n').length}`);
        console.log(`Reconstructed lines: ${reconstructedLines.length}`);
        
        const lines = reconstructedLines.filter(line => line.trim());
        console.log(`Total lines after filtering: ${lines.length}`);
        
        if (lines.length < 2) {
          console.error(`File ${file.name} has insufficient data (need at least header + 1 row)`);
          continue;
        }
        
        // Enhanced CSV parsing function with better debugging
        const parseCSVLine = (line: string, lineNumber: number): string[] => {
          console.log(`Parsing line ${lineNumber}: "${line}"`);
          
          // First try the standard CSV parser
          const result: string[] = [];
          let current = '';
          let inQuotes = false;
          let i = 0;
          
          while (i < line.length) {
            const char = line[i];
            
            if (char === '"') {
              if (inQuotes && line[i + 1] === '"') {
                // Escaped quote
                current += '"';
                i += 2;
              } else {
                // Toggle quote state
                inQuotes = !inQuotes;
                i++;
              }
            } else if (char === ',' && !inQuotes) {
              // End of field
              result.push(current.trim());
              current = '';
              i++;
            } else {
              current += char;
              i++;
            }
          }
          
          // Add the last field
          result.push(current.trim());
          
          // If we ended up with mismatched quotes, try a fallback approach
          if (inQuotes || result.length < 3) {
            console.log(`Line ${lineNumber} had parsing issues, trying fallback parser`);
            
            // Fallback: split by comma but be more careful about quotes
            const fallbackResult: string[] = [];
            const matches = line.match(/(".*?"|[^,]+)/g) || [];
            
            for (const match of matches) {
              let field = match.trim();
              // Remove surrounding quotes
              if (field.startsWith('"') && field.endsWith('"')) {
                field = field.slice(1, -1);
              }
              // Handle escaped quotes
              field = field.replace(/""/g, '"');
              fallbackResult.push(field);
            }
            
            console.log(`Fallback parser result for line ${lineNumber}:`, fallbackResult);
            return fallbackResult;
          }
          
          console.log(`Line ${lineNumber} parsed into ${result.length} fields:`, result);
          return result;
        };

        const headers = parseCSVLine(lines[0], 1).map(h => h.replace(/"/g, ''));
        console.log(`Headers:`, headers);
        console.log(`Headers include 'Sales owner id':`, headers.includes('Sales owner id'));
        console.log(`Headers include 'Sales owner':`, headers.includes('Sales owner'));
        
        const rows = lines.slice(1).filter(line => line.trim());
        console.log(`Data rows:`, rows.length);

        const data = rows.map((row, index) => {
          const values = parseCSVLine(row, index + 2).map(v => v.replace(/"/g, ''));
          const obj: any = {};
          headers.forEach((header, headerIndex) => {
            obj[header] = values[headerIndex] || '';
          });
          
          // Debug first few rows
          if (index < 3) {
            console.log(`Row ${index + 1}:`, obj);
            console.log(`Row ${index + 1} sales owner data:`, {
              'Sales owner id': obj['Sales owner id'],
              'Sales owner': obj['Sales owner']
            });
          }
          
          return obj;
        });



        console.log(`Processing file: ${file.name}`);
        console.log(`Headers found:`, headers);
        console.log(`Data rows before filtering:`, rows.length);
        console.log(`Data rows after filtering:`, data.length);
        console.log(`Filtered out ${rows.length - data.length} invalid rows`);
        
        // Apply file-type specific filtering
        const fileName = file.name.toLowerCase();
        let filteredData = data;
        
        if (fileName.includes('contact') || fileName.includes('contacts')) {
          // Apply contact-specific filtering
          filteredData = data.filter(row => {
            const hasName = (row['First name'] && row['First name'].trim()) || 
                           (row['Last name'] && row['Last name'].trim()) ||
                           (row['Name'] && row['Name'].trim());
            const hasEmail = row['Email'] && row['Email'].trim();
            const hasCompany = row['Company'] && row['Company'].trim();
            
            // Additional validation: check for problematic patterns
            const nameField = row['First name'] || row['Last name'] || row['Name'] || '';
            const emailField = row['Email'] || '';
            const recentNoteField = row['Recent note'] || '';
            
            // Filter out rows where name field contains very long text (likely notes)
            const isNameTooLong = nameField.length > 100;
            
            // Filter out rows where email field contains non-email content
            const isEmailInvalid = emailField && !emailField.includes('@') && emailField.length > 20;
            
            // Filter out rows that look like notes or comments
            const looksLikeNote = nameField.includes('I\'ll reach out') || 
                                 nameField.includes('thank you') ||
                                 nameField.includes('UTC') ||
                                 nameField.includes('2024-') ||
                                 nameField.includes('Have a good weekend') ||
                                 nameField.includes('staffing at our AZ locations');
            
            // Check if this row is actually just a note field that got parsed as a contact
            const isJustNote = (recentNoteField && recentNoteField.length > 50) && 
                              (!nameField || nameField.length < 5) &&
                              (!emailField || !emailField.includes('@'));
            
            // Check if email field contains timestamp patterns (common in notes)
            const hasTimestampInEmail = emailField.includes('UTC') || 
                                       emailField.includes('2024-') ||
                                       emailField.includes('17:43:26') ||
                                       emailField.includes('2024-10-24');
            
            // Check if this looks like a note continuation (common when notes contain commas)
            const looksLikeNoteContinuation = (nameField.includes('Have a good weekend') && emailField.includes('UTC')) ||
                                             (nameField.includes('staffing at our AZ locations') && emailField.includes('2024-'));
            
            console.log(`Contact row validation:`, {
              name: nameField,
              email: emailField,
              recentNote: recentNoteField,
              hasName: !!hasName,
              hasEmail: !!hasEmail,
              hasCompany: !!hasCompany,
              isNameTooLong,
              isEmailInvalid,
              looksLikeNote,
              isJustNote,
              hasTimestampInEmail,
              looksLikeNoteContinuation,
              shouldKeep: (hasName || hasEmail || hasCompany) && 
                         !isNameTooLong && 
                         !isEmailInvalid && 
                         !looksLikeNote && 
                         !isJustNote && 
                         !hasTimestampInEmail &&
                         !looksLikeNoteContinuation
            });
            
            // Keep row if it has valid contact info and doesn't look like a note
            return (hasName || hasEmail || hasCompany) && 
                   !isNameTooLong && 
                   !isEmailInvalid && 
                   !looksLikeNote && 
                   !isJustNote && 
                   !hasTimestampInEmail &&
                   !looksLikeNoteContinuation;
          });
          console.log(`Detected as contacts file`);
          csvData.contacts = filteredData;
        } else if (fileName.includes('deal') || fileName.includes('deals') || fileName.includes('opportunity') || fileName.includes('opportunities')) {
          // Apply deal-specific filtering
          filteredData = data.filter(row => {
            const hasDealName = row['Offer name'] && row['Offer name'].trim();
            const hasDealId = row['dealId'] && row['dealId'].trim();
            const hasCompany = row['Related Company'] && row['Related Company'].trim();
            
            console.log(`Deal row validation:`, {
              dealName: row['Offer name'],
              dealId: row['dealId'],
              company: row['Related Company'],
              hasDealName: !!hasDealName,
              hasDealId: !!hasDealId,
              hasCompany: !!hasCompany,
              shouldKeep: hasDealName || hasDealId || hasCompany
            });
            
            // Keep row if it has valid deal info
            return hasDealName || hasDealId || hasCompany;
          });
          console.log(`Detected as deals file`);
          csvData.deals = filteredData;
        } else if (fileName.includes('company') || fileName.includes('companies') || fileName.includes('customer') || fileName.includes('customers')) {
          // Apply company-specific filtering
          filteredData = data.filter(row => {
            const hasCompanyName = row['Name'] && row['Name'].trim();
            const hasCompanyId = row['companyId'] && row['companyId'].trim();
            
            console.log(`Company row validation:`, {
              companyName: row['Name'],
              companyId: row['companyId'],
              hasCompanyName: !!hasCompanyName,
              hasCompanyId: !!hasCompanyId,
              shouldKeep: hasCompanyName || hasCompanyId
            });
            
            // Keep row if it has valid company info
            return hasCompanyName || hasCompanyId;
          });
          console.log(`Detected as companies file`);
          csvData.companies = filteredData;
        } else {
          // For unknown file types, keep all rows
          console.log(`Unknown file type: ${file.name}, keeping all rows`);
          filteredData = data;
        }
      }

      // Step: Clean phone numbers
      console.log('Cleaning phone numbers...');
      csvData.companies = cleanCompanyData(csvData.companies);
      csvData.contacts = cleanContactData(csvData.contacts);
      console.log('Phone numbers cleaned');

      // Extract unique salespeople from companies and contacts
      const salespeopleMap = new Map();
      const salespeopleCounts = new Map(); // Track how many times each salesperson appears
      
      console.log('Extracting salespeople from companies...');
      // From companies
      csvData.companies.forEach((company, index) => {
        const salesOwnerId = company['Sales owner id'];
        const salesOwnerName = company['Sales owner'];
        
        console.log(`Company ${index + 1}:`, {
          'Sales owner id': salesOwnerId,
          'Sales owner': salesOwnerName,
          hasSalesOwnerId: !!salesOwnerId,
          hasSalesOwner: !!salesOwnerName
        });
        
        if (salesOwnerId && salesOwnerName) {
          console.log(`Adding salesperson from company: ${salesOwnerName} (ID: ${salesOwnerId})`);
          salespeopleMap.set(salesOwnerId, {
            freshsalesId: salesOwnerId,
            name: salesOwnerName,
            email: '', // Will need to be provided separately
            phone: '',
          });
          
          // Track count
          salespeopleCounts.set(salesOwnerId, (salespeopleCounts.get(salesOwnerId) || 0) + 1);
        } else {
          console.log(`Company ${company['Name']} has no sales owner data`);
        }
      });

      console.log('Extracting salespeople from contacts...');
      // From contacts
      csvData.contacts.forEach((contact, index) => {
        const salesOwnerId = contact['Sales owner id'];
        const salesOwnerName = contact['Sales owner'];
        
        console.log(`Contact ${index + 1}:`, {
          'Sales owner id': salesOwnerId,
          'Sales owner': salesOwnerName,
          hasSalesOwnerId: !!salesOwnerId,
          hasSalesOwner: !!salesOwnerName
        });
        
        if (salesOwnerId && salesOwnerName) {
          console.log(`Adding salesperson from contact: ${salesOwnerName} (ID: ${salesOwnerId})`);
          salespeopleMap.set(salesOwnerId, {
            freshsalesId: salesOwnerId,
            name: salesOwnerName,
            email: '', // Will need to be provided separately
            phone: '',
          });
          
          // Track count
          salespeopleCounts.set(salesOwnerId, (salespeopleCounts.get(salesOwnerId) || 0) + 1);
        } else {
          console.log(`Contact ${contact[contactMapping['First name']]} ${contact[contactMapping['Last name']]} has no sales owner data`);
        }
      });

      console.log('Extracting salespeople from deals...');
      // From deals
      csvData.deals.forEach((deal, index) => {
        const salesOwnerId = deal['Sales owner id'];
        const salesOwnerName = deal['Sales owner'];
        
        console.log(`Deal ${index + 1}:`, {
          'Sales owner id': salesOwnerId,
          'Sales owner': salesOwnerName,
          hasSalesOwnerId: !!salesOwnerId,
          hasSalesOwner: !!salesOwnerName
        });
        
        if (salesOwnerId && salesOwnerName) {
          console.log(`Adding salesperson from deal: ${salesOwnerName} (ID: ${salesOwnerId})`);
          salespeopleMap.set(salesOwnerId, {
            freshsalesId: salesOwnerId,
            name: salesOwnerName,
            email: '', // Will need to be provided separately
            phone: '',
          });
          
          // Track count
          salespeopleCounts.set(salesOwnerId, (salespeopleCounts.get(salesOwnerId) || 0) + 1);
        } else {
          console.log(`Deal ${deal[dealMapping['Offer name']]} has no sales owner data`);
        }
      });

      csvData.salespeople = Array.from(salespeopleMap.values());
      
      console.log('Salespeople extraction summary:');
      console.log('- Unique salespeople found:', csvData.salespeople.length);
      console.log('- Salespeople with counts:', Array.from(salespeopleCounts.entries()).map(([id, count]) => {
        const salesperson = salespeopleMap.get(id);
        return `${salesperson?.name} (ID: ${id}): ${count} occurrences`;
      }));
      console.log('Final salespeople extracted:', csvData.salespeople);

      // Step: Enhance company data with AI-extracted names
      console.log('Enhancing company data with AI-extracted names...');
      const companiesNeedingNames = csvData.companies.filter(company => 
        !company['Name'] || !company['Name'].trim()
      );
      
      if (companiesNeedingNames.length > 0) {
        console.log(`Found ${companiesNeedingNames.length} companies without names, attempting AI enhancement...`);
        setAiEnhancementProgress({ current: 0, total: companiesNeedingNames.length, message: 'Starting AI enhancement...' });
        
        csvData.companies = await enhanceCompanyData(
          csvData.companies,
          (current, total, message) => {
            setAiEnhancementProgress({ current, total, message });
          }
        );
        
        setAiEnhancementProgress({ current: 0, total: 0, message: '' });
      } else {
        console.log('All companies have names, skipping AI enhancement');
      }

      // Count companies without salespeople
      const companiesWithoutSalespeople = csvData.companies.filter(company => 
        !company['Sales owner id'] || !company['Sales owner']
      );
      
      console.log(`Import summary:`);
      console.log(`- Companies: ${csvData.companies.length}`);
      console.log(`- Companies with salespeople: ${csvData.companies.length - companiesWithoutSalespeople.length}`);
      console.log(`- Companies without salespeople: ${companiesWithoutSalespeople.length}`);
      console.log(`- Contacts: ${csvData.contacts.length}`);
      console.log(`- Unique salespeople: ${csvData.salespeople.length}`);
      console.log(`- Deals: ${csvData.deals.length}`);
      
      if (companiesWithoutSalespeople.length > 0) {
        console.log('Companies without salespeople:', companiesWithoutSalespeople.map(c => c[companyMapping['Name']] || c['Name']));
      }

      // Show success message with file detection results
      if (csvData.companies.length === 0 && csvData.contacts.length === 0) {
        setError('No companies or contacts found in uploaded files. Please check file names and format.');
      } else {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }

      setImportData(csvData);
      setImportSteps(prev => prev.map((step, index) => 
        index === 0 ? { ...step, completed: true } : step
      ));
      setActiveStep(1);

    } catch (err: any) {
      setError(`Error processing files: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    if (activeStep === steps.length - 1) {
      handleImport();
    } else {
      setActiveStep(prev => prev + 1);
      if (activeStep === 1) {
        setImportSteps(prev => prev.map((step, index) => 
          index === 1 ? { ...step, completed: true } : step
        ));
      }
    }
  };

  const handleBack = () => {
    setActiveStep(prev => prev - 1);
  };

  const handleImport = async () => {
    if (!tenantId) {
      setError('No tenant ID found. Please log in as a tenant user.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Step 1: Create placeholder salesperson records (not actual user accounts)
      const salespeopleMap = new Map();
      for (const salesperson of importData.salespeople) {
        try {
          // Create a placeholder record in a separate collection for salespeople
          console.log(`Attempting to save salesperson to Firestore:`, salesperson);
          const salespersonDoc = await addDoc(collection(db, 'tenants', tenantId, 'crm_salespeople'), {
            name: salesperson.name,
            freshsalesId: salesperson.freshsalesId,
            email: '', // Will be filled when actual salesperson is added
            phone: '',
            status: 'placeholder', // Indicates this is a placeholder
            linkedUserId: null, // Will be linked to actual user account later
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          salespeopleMap.set(salesperson.freshsalesId, salespersonDoc.id);
          console.log(`Successfully saved salesperson: ${salesperson.name} with ID: ${salespersonDoc.id}`);
        } catch (err) {
          console.error(`Error creating salesperson placeholder ${salesperson.name}:`, err);
        }
      }

      // Step 2: Import companies with robust error handling
      const companiesMap = new Map();
      let successfulCompanies = 0;
      let failedCompanies = 0;
      
      setImportProgress({ current: 0, total: importData.companies.length, message: 'Importing companies...' });
      
      for (let i = 0; i < importData.companies.length; i++) {
        const company = importData.companies[i];
        const companyName = company['Name'] || 'Unknown Company';
        
        try {
          setImportProgress({ 
            current: i + 1, 
            total: importData.companies.length, 
            message: `Importing ${companyName}...` 
          });
          
          // Process address (parse units and geocode) with timeout protection
          let addressData;
          try {
            addressData = await processCompanyAddressData(company);
          } catch (addressError) {
            console.warn(`Address processing failed for ${companyName}, using fallback:`, addressError);
            // Use fallback address data
            const address = company['Address'] || '';
            const { streetAddress, unit } = parseAddress(address);
            addressData = { streetAddress, unit, coordinates: undefined };
          }
          
          // Debug: Log the raw company data and mapping
          console.log(`Processing company: ${companyName}`);
          console.log(`Raw company data:`, company);
          console.log(`Company mapping:`, companyMapping);
          console.log(`Direct field access test:`, {
            'companyId': company['companyId'],
            'Name': company['Name'],
            'Website': company['Website'],
            'Phone': company['Phone'],
            'Address': company['Address'],
            'City': company['City'],
            'State': company['State'],
            'Zip': company['Zip'],
            'Country': company['Country'],
            'LinkedIn': company['LinkedIn'],
            'Sales owner id': company['Sales owner id'],
            'Sales owner': company['Sales owner'],
          });
          console.log(`Mapped values (CORRECTED):`, {
            companyName: company['Name'],
            companyUrl: company['Website'],
            companyPhone: company['Phone'],
            city: company['City'],
            state: company['State'],
            zip: company['Zip'],
            country: company['Country'],
            linkedInUrl: company['LinkedIn'],
            externalSalesId: company['Sales owner id'],
            externalSalesOwner: company['Sales owner'],
            externalId: company['companyId'],
          });
          
          // Create company document with timeout protection
          const companyData = {
            companyName: company['Name'] || '',
            companyUrl: company['Website'] || '',
            companyPhone: company['Phone'] || '',
            streetAddress: addressData.streetAddress,
            ...(addressData.unit && { unit: addressData.unit }), // Only include unit if it exists
            city: company['City'] || '',
            state: company['State'] || '',
            zip: company['Zip'] || '',
            country: company['Country'] || '',
            linkedInUrl: company['LinkedIn'] || '',
            // Add geocoded coordinates if available
            ...(addressData.coordinates && {
              latitude: addressData.coordinates.lat,
              longitude: addressData.coordinates.lng,
            }),
            status: 'lead',
            tier: 'C',
            externalSalesId: company['Sales owner id'] || '', // Store Freshsales ID
            externalSalesOwner: company['Sales owner'] || '', // Store name for display
            salesOwnerRef: salespeopleMap.get(company['Sales owner id']) || null, // Reference to placeholder
            source: 'freshsales_import',
            externalId: company['companyId'] || '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          
          console.log(`Attempting to save company to Firestore:`, companyData);
          const companyDoc = await addDoc(collection(db, 'tenants', tenantId, 'crm_companies'), companyData);
          companiesMap.set(company['companyId'], companyDoc.id);
          successfulCompanies++;
          
          console.log(`Successfully imported company: ${companyName} with ID: ${companyDoc.id}`);
          
        } catch (err) {
          failedCompanies++;
          console.error(`Error importing company ${companyName}:`, err);
          // Continue with next company instead of stopping
        }
      }
      
      console.log(`Company import summary: ${successfulCompanies} successful, ${failedCompanies} failed`);

      // Step 3: Import contacts with robust error handling
      let successfulContacts = 0;
      let failedContacts = 0;
      
      for (const contact of importData.contacts) {
        const contactName = `${contact['First name'] || ''} ${contact['Last name'] || ''}`.trim() || 'Unknown Contact';
        
        try {
          const companyId = companiesMap.get(contact['Company id']);
          
          const contactData = {
            fullName: contactName,
            firstName: contact['First name'] || '',
            lastName: contact['Last name'] || '',
            email: contact['Email'] || '',
            phone: contact['Phone'] || '',
            workPhone: contact['Work phone'] || '',
            jobTitle: contact['Job title'] || '',
            timeZone: contact['Time zone'] || '',
            streetAddress: contact['Address'] || '',
            city: contact['City'] || '',
            state: contact['State'] || '',
            zip: contact['Zipcode'] || '',
            country: contact['Country'] || '',
            linkedInUrl: contact['LinkedIn'] || '',
            lastContactedTime: contact['Last contacted time'] || null,
            lastContactedMode: contact['Last contacted mode'] || '',
            lastActivityType: contact['Last activity type'] || '',
            lastActivityDate: contact['Last activity date'] || null,
            recentNote: contact['Recent note'] || '',
            associations: companyId ? { companies: [companyId] } : {},
            externalCompanyId: contact['Company id'] || '',
            companyName: contact['Company'] || '',
            salesOwnerId: contact['Sales owner id'] || '', // Store external ID
            salesOwnerName: contact['Sales owner'] || '', // Store name for display
            salesOwnerRef: salespeopleMap.get(contact['Sales owner id']) || null, // Reference to placeholder
            role: 'other',
            status: 'active',
            externalId: contact['contactId'] || '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          
          await addDoc(collection(db, 'tenants', tenantId, 'crm_contacts'), contactData);
          successfulContacts++;
          
          console.log(`Successfully imported contact: ${contactName}`);
          
        } catch (err) {
          failedContacts++;
          console.error(`Error importing contact ${contactName}:`, err);
          // Continue with next contact instead of stopping
        }
      }
      
      console.log(`Contact import summary: ${successfulContacts} successful, ${failedContacts} failed`);

      // Step 4: Import deals
      let successfulDeals = 0;
      let failedDeals = 0;
      
      setImportProgress({ current: 0, total: importData.deals.length, message: 'Importing deals...' });
      
      for (let i = 0; i < importData.deals.length; i++) {
        const deal = importData.deals[i];
        const dealName = deal[dealMapping['Offer name']] || deal['Offer name'] || 'Unknown Deal';
        
        try {
          setImportProgress({ 
            current: i + 1, 
            total: importData.deals.length, 
            message: `Importing ${dealName}...` 
          });
          
          // Find the company ID for this deal
          let companyId = '';
          if (deal['Related Company id']) {
            // Try to find company by external ID
            const companyQuery = query(
              collection(db, 'tenants', tenantId, 'crm_companies'),
              where('externalId', '==', deal['Related Company id'])
            );
            const companySnapshot = await getDocs(companyQuery);
            if (!companySnapshot.empty) {
              companyId = companySnapshot.docs[0].id;
            }
          }
          
          // Parse deal value and currency
          const dealValue = parseFloat(deal['Expected Offer value'] || deal['value'] || '0') || 0;
          const currency = deal['Currency'] || deal['currency'] || 'USD';
          
          // Parse dates
          const expectedCloseDate = deal['Expected close date'] || deal['expectedCloseDate'] || null;
          // const createdAt = deal['Created at'] || deal['createdAt'] || null;
          
          // Map offer stage to deal stage
          const offerStage = deal['Offer stage'] || deal['offerStage'] || 'qualification';
          let dealStage = 'qualification'; // Default
          
          // Map Freshsales stages to our stages
          const stageMapping: { [key: string]: string } = {
            'qualification': 'qualification',
            'proposal': 'proposal',
            'negotiation': 'negotiation',
            'closed_won': 'closed_won',
            'closed_lost': 'closed_lost',
            'lead': 'qualification',
            'opportunity': 'qualification',
            'won': 'closed_won',
            'lost': 'closed_lost'
          };
          
          dealStage = stageMapping[offerStage.toLowerCase()] || 'qualification';
          
          const dealData = {
            name: dealName,
            associations: { companies: companyId ? [companyId] : [], contacts: [] },
            stage: dealStage,
            estimatedRevenue: dealValue,
            probability: dealStage === 'closed_won' ? 100 : dealStage === 'closed_lost' ? 0 : 25, // Default probability
            closeDate: expectedCloseDate,
            owner: '', // Will be set by current user
            tags: [],
            notes: '',
            externalId: deal['dealId'] || deal['externalId'] || '',
            externalCompanyId: deal['Related Company id'] || deal['externalCompanyId'] || '',
            externalCompanyName: deal['Related Company'] || deal['externalCompanyName'] || '',
            salesOwnerId: deal['Sales owner id'] || deal['salesOwnerId'] || '',
            salesOwnerName: deal['Sales owner'] || deal['salesOwner'] || '',
            salesOwnerRef: salespeopleMap.get(deal['Sales owner id']) || null,
            currency: currency,
            source: 'freshsales_import',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          
          await addDoc(collection(db, 'tenants', tenantId, 'crm_deals'), dealData);
          successfulDeals++;
          
          console.log(`Successfully imported deal: ${dealName}`);
          
        } catch (err) {
          failedDeals++;
          console.error(`Error importing deal ${dealName}:`, err);
          // Continue with next deal instead of stopping
        }
      }
      
      console.log(`Deal import summary: ${successfulDeals} successful, ${failedDeals} failed`);

      // Show final summary
      // const totalSuccessful = successfulCompanies + successfulContacts + successfulDeals;
      // const totalFailed = failedCompanies + failedContacts + failedDeals;
      
      setSuccess(true);
      setImportSteps(prev => prev.map((step, index) => 
        index === 3 ? { ...step, completed: true } : step
      ));
      
      // Show detailed success message
      // const successMessage = `Import completed! ${totalSuccessful} records imported successfully. ${totalFailed > 0 ? `${totalFailed} records failed and were skipped.` : ''}`;
      setError(''); // Clear any previous errors
      
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 3000);

    } catch (err: any) {
      setError(`Import failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>Upload Freshsales CSV Files</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Upload your CSV files from Freshsales. The system will automatically detect the file type based on the filename.
            </Typography>
            
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".csv"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            
            <Button
              variant="outlined"
              startIcon={<UploadIcon />}
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              sx={{ mb: 2 }}
            >
              Select CSV Files
            </Button>
            
            {loading && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={20} />
                <Typography>Processing files...</Typography>
              </Box>
            )}
          </Box>
        );

      case 1:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>Field Mapping</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Review and adjust the field mappings for your data.
            </Typography>
            
            <Grid container spacing={3}>
              <Grid item xs={12} md={4}>
                <Card>
                  <CardHeader title="Company Fields" avatar={<CompanyIcon />} />
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">
                      {importData.companies.length} companies found
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={4}>
                <Card>
                  <CardHeader title="Contact Fields" avatar={<ContactIcon />} />
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">
                      {importData.contacts.length} contacts found
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={4}>
                <Card>
                  <CardHeader title="Deal Fields" avatar={<DealIcon />} />
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">
                      {importData.deals.length} deals found
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Box>
        );

      case 2:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>Review Import Data</Typography>
            
            <Grid container spacing={3} sx={{ mb: 3 }}>
              <Grid item xs={12} sm={6} md={3}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CompanyIcon color="primary" />
                      <Typography variant="h6">{importData.companies.length}</Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">Companies</Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <ContactIcon color="primary" />
                      <Typography variant="h6">{importData.contacts.length}</Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">Contacts</Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <SalespersonIcon color="primary" />
                      <Typography variant="h6">{importData.salespeople.length}</Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">Salespeople</Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <DealIcon color="primary" />
                      <Typography variant="h6">{importData.deals.length}</Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">Deals</Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            {/* Sample Data Preview */}
            {importData.companies.length > 0 && (
              <Card sx={{ mb: 2 }}>
                <CardHeader title="Sample Companies" />
                <CardContent>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Website</TableCell>
                          <TableCell>Phone</TableCell>
                          <TableCell>Sales Owner</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {importData.companies.slice(0, 5).map((company, index) => (
                          <TableRow key={index}>
                            <TableCell>{company[companyMapping['Name']] || company['Name']}</TableCell>
                            <TableCell>{company[companyMapping['Website']] || company['Website']}</TableCell>
                            <TableCell>{company[companyMapping['Phone']] || company['Phone']}</TableCell>
                            <TableCell>{company[companyMapping['Sales owner']] || company['Sales owner']}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            )}

            {importData.contacts.length > 0 && (
              <Card sx={{ mb: 2 }}>
                <CardHeader title="Sample Contacts" />
                <CardContent>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Email</TableCell>
                          <TableCell>Company</TableCell>
                          <TableCell>Title</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {importData.contacts.slice(0, 5).map((contact, index) => (
                          <TableRow key={index}>
                            <TableCell>
                              {`${contact[contactMapping['First name']] || contact['First name'] || ''} ${contact[contactMapping['Last name']] || contact['Last name'] || ''}`.trim()}
                            </TableCell>
                            <TableCell>{contact[contactMapping['Email']] || contact['Email']}</TableCell>
                            <TableCell>{contact[contactMapping['Company']] || contact['Company']}</TableCell>
                            <TableCell>{contact[contactMapping['Title']] || contact['Title']}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            )}

            {importData.deals.length > 0 && (
              <Card>
                <CardHeader title="Sample Deals" />
                <CardContent>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Value</TableCell>
                          <TableCell>Company</TableCell>
                          <TableCell>Stage</TableCell>
                          <TableCell>Sales Owner</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {importData.deals.slice(0, 5).map((deal, index) => (
                          <TableRow key={index}>
                            <TableCell>{deal[dealMapping['Offer name']] || deal['Offer name']}</TableCell>
                            <TableCell>
                              {deal[dealMapping['Expected Offer value']] || deal['Expected Offer value']} 
                              {deal[dealMapping['Currency']] || deal['Currency']}
                            </TableCell>
                            <TableCell>{deal[dealMapping['Related Company']] || deal['Related Company']}</TableCell>
                            <TableCell>{deal[dealMapping['Offer stage']] || deal['Offer stage']}</TableCell>
                            <TableCell>{deal[dealMapping['Sales owner']] || deal['Sales owner']}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            )}
          </Box>
        );

      case 3:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>Import Data</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Ready to import your data. This will create companies, contacts, deals, and salespeople in your CRM.
              {process.env.REACT_APP_GOOGLE_MAPS_API_KEY ? 
                ' Addresses will be automatically geocoded to coordinates.' : 
                ' Note: Google Maps API key not configured - addresses will not be geocoded.'
              }
            </Typography>
            
            {loading && importProgress.total > 0 && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" gutterBottom>
                  {importProgress.message}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={20} />
                  <Typography variant="body2">
                    {importProgress.current} of {importProgress.total} records
                  </Typography>
                </Box>
              </Box>
            )}
            
            {aiEnhancementProgress.total > 0 && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" gutterBottom color="primary">
                  🤖 {aiEnhancementProgress.message}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={20} color="primary" />
                  <Typography variant="body2" color="primary">
                    AI enhancement: {aiEnhancementProgress.current} of {aiEnhancementProgress.total}
                  </Typography>
                </Box>
              </Box>
            )}
            
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>Import Strategy:</strong>
              </Typography>
              <List dense>
                <ListItem sx={{ py: 0 }}>
                  <ListItemText 
                    primary="1. Clean and validate data"
                    secondary="Standardize phone numbers and validate formats"
                  />
                </ListItem>
                <ListItem sx={{ py: 0 }}>
                  <ListItemText 
                    primary="2. Create salesperson placeholders"
                    secondary="Placeholder records for salespeople (no email invites)"
                  />
                </ListItem>
                <ListItem sx={{ py: 0 }}>
                  <ListItemText 
                    primary="3. Enhance company data with AI"
                    secondary="Extract company names from websites when missing"
                  />
                </ListItem>
                <ListItem sx={{ py: 0 }}>
                  <ListItemText 
                    primary="4. Import companies with address parsing"
                    secondary="Parse units/suites and geocode addresses"
                  />
                </ListItem>
                <ListItem sx={{ py: 0 }}>
                  <ListItemText 
                    primary="5. Import contacts with company associations"
                    secondary="Contacts linked to companies and sales owners"
                  />
                </ListItem>
                <ListItem sx={{ py: 0 }}>
                  <ListItemText 
                    primary="6. Import deals with company linking"
                    secondary="Deals linked to companies and sales owners"
                  />
                </ListItem>
                <ListItem sx={{ py: 0 }}>
                  <ListItemText 
                    primary="7. Link salespeople later"
                    secondary="When actual salespeople are added, link them to placeholders"
                  />
                </ListItem>
              </List>
            </Alert>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        Import Freshsales Data
      </DialogTitle>
      
      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {steps.map((label, index) => (
            <Step key={label}>
              <StepLabel 
                error={importSteps[index]?.error ? true : false}
                icon={
                  importSteps[index]?.completed ? (
                    <CheckIcon color="success" />
                  ) : importSteps[index]?.error ? (
                    <ErrorIcon color="error" />
                  ) : null
                }
              >
                {label}
              </StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Files processed successfully! Found {importData.companies.length} companies, {importData.contacts.length} contacts, {importData.deals.length} deals, and {importData.salespeople.length} salespeople.
          </Alert>
        )}

        {getStepContent(activeStep)}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button 
          onClick={handleBack} 
          disabled={activeStep === 0 || loading}
        >
          Back
        </Button>
        <Button
          onClick={handleNext}
          variant="contained"
          disabled={loading || (activeStep === 0 && importData.companies.length === 0 && importData.contacts.length === 0 && importData.deals.length === 0)}
        >
          {loading ? (
            <CircularProgress size={20} />
          ) : activeStep === steps.length - 1 ? (
            'Import Data'
          ) : (
            'Next'
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CRMImportDialog; 