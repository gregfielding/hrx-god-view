import Papa from 'papaparse';

export interface CSVWorkerData {
  firstName: string;
  lastName: string;
  preferredName?: string;
  email: string;
  phone: string;
  dateOfBirth?: string;
  gender?: string;
  securityLevel: string;
  employmentType: string;
  jobTitle?: string;
  departmentId?: string;
  divisionId?: string;
  locationId?: string;
  managerId?: string;
  startDate?: string;
  workStatus: string;
  workerId?: string;
  union?: string;
  workEligibility?: string;
  languages?: string;
  emergencyContactName?: string;
  emergencyContactRelationship?: string;
  emergencyContactPhone?: string;
  transportMethod?: string;
}

export interface CSVValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  data: CSVWorkerData[];
}

export const CSV_COLUMNS = [
  'firstName',
  'lastName', 
  'preferredName',
  'email',
  'phone',
  'dateOfBirth',
  'gender',
  'securityLevel',
  'employmentType',
  'jobTitle',
  'departmentId',
  'divisionId',
  'locationId',
  'managerId',
  'startDate',
  'workStatus',
  'workerId',
  'union',
  'workEligibility',
  'languages',
  'emergencyContactName',
  'emergencyContactRelationship',
  'emergencyContactPhone',
  'transportMethod'
] as const;

export const REQUIRED_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'securityLevel', 'employmentType', 'workStatus'];

export const VALID_SECURITY_LEVELS = ['Applicant', 'Worker', 'Flex'];
export const VALID_EMPLOYMENT_TYPES = ['Full-Time', 'Part-Time', 'Contract', 'Flex'];
export const VALID_WORK_STATUSES = ['Active', 'On Leave', 'Terminated', 'Suspended', 'Pending'];
export const VALID_GENDERS = ['Male', 'Female', 'Nonbinary', 'Other', 'Prefer not to say'];
export const VALID_TRANSPORT_METHODS = ['Car', 'Public Transit', 'Bike', 'Walk'];

export function generateSampleCSV(): string {
  const sampleData = [
    {
      firstName: 'John',
      lastName: 'Doe',
      preferredName: 'Johnny',
      email: 'john.doe@example.com',
      phone: '(555) 123-4567',
      dateOfBirth: '1990-01-15',
      gender: 'Male',
      securityLevel: 'Worker',
      employmentType: 'Full-Time',
      jobTitle: 'Software Engineer',
      departmentId: 'dept_001',
      divisionId: 'div_001',
      locationId: 'loc_001',
      managerId: 'mgr_001',
      startDate: '2023-01-15',
      workStatus: 'Active',
      workerId: 'EMP001',
      union: 'Tech Workers Union',
      workEligibility: 'true',
      languages: 'English,Spanish',
      emergencyContactName: 'Jane Doe',
      emergencyContactRelationship: 'Spouse',
      emergencyContactPhone: '(555) 987-6543',
      transportMethod: 'Car'
    },
    {
      firstName: 'Jane',
      lastName: 'Smith',
      preferredName: '',
      email: 'jane.smith@example.com',
      phone: '(555) 234-5678',
      dateOfBirth: '1985-06-20',
      gender: 'Female',
      securityLevel: 'Flex',
      employmentType: 'Part-Time',
      jobTitle: 'Marketing Specialist',
      departmentId: 'dept_002',
      divisionId: '',
      locationId: 'loc_002',
      managerId: '',
      startDate: '2023-03-01',
      workStatus: 'Active',
      workerId: 'EMP002',
      union: '',
      workEligibility: 'true',
      languages: 'English,French',
      emergencyContactName: 'Bob Smith',
      emergencyContactRelationship: 'Father',
      emergencyContactPhone: '(555) 876-5432',
      transportMethod: 'Public Transit'
    }
  ];

  return Papa.unparse(sampleData);
}

export function validateCSVData(data: any[]): CSVValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const validatedData: CSVWorkerData[] = [];

  data.forEach((row, index) => {
    const rowNumber = index + 2; // +2 because index starts at 0 and we skip header
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];

    // Check required fields
    REQUIRED_FIELDS.forEach(field => {
      if (!row[field] || row[field].trim() === '') {
        rowErrors.push(`Row ${rowNumber}: Missing required field "${field}"`);
      }
    });

    // Validate email format
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      rowErrors.push(`Row ${rowNumber}: Invalid email format "${row.email}"`);
    }

    // Validate phone format (basic check)
    if (row.phone && !/^[\d\s()+-]+$/.test(row.phone)) {
      rowWarnings.push(`Row ${rowNumber}: Phone number may be in incorrect format "${row.phone}"`);
    }

    // Validate security level
    if (row.securityLevel && !VALID_SECURITY_LEVELS.includes(row.securityLevel)) {
      rowErrors.push(`Row ${rowNumber}: Invalid security level "${row.securityLevel}". Must be one of: ${VALID_SECURITY_LEVELS.join(', ')}`);
    }

    // Validate employment type
    if (row.employmentType && !VALID_EMPLOYMENT_TYPES.includes(row.employmentType)) {
      rowErrors.push(`Row ${rowNumber}: Invalid employment type "${row.employmentType}". Must be one of: ${VALID_EMPLOYMENT_TYPES.join(', ')}`);
    }

    // Validate work status
    if (row.workStatus && !VALID_WORK_STATUSES.includes(row.workStatus)) {
      rowErrors.push(`Row ${rowNumber}: Invalid work status "${row.workStatus}". Must be one of: ${VALID_WORK_STATUSES.join(', ')}`);
    }

    // Validate gender
    if (row.gender && !VALID_GENDERS.includes(row.gender)) {
      rowWarnings.push(`Row ${rowNumber}: Gender "${row.gender}" not in standard list. Consider using: ${VALID_GENDERS.join(', ')}`);
    }

    // Validate transport method
    if (row.transportMethod && !VALID_TRANSPORT_METHODS.includes(row.transportMethod)) {
      rowWarnings.push(`Row ${rowNumber}: Transport method "${row.transportMethod}" not in standard list. Consider using: ${VALID_TRANSPORT_METHODS.join(', ')}`);
    }

    // Validate date formats
    if (row.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(row.dateOfBirth)) {
      rowWarnings.push(`Row ${rowNumber}: Date of birth should be in YYYY-MM-DD format "${row.dateOfBirth}"`);
    }

    if (row.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(row.startDate)) {
      rowWarnings.push(`Row ${rowNumber}: Start date should be in YYYY-MM-DD format "${row.startDate}"`);
    }

    // Validate work eligibility
    if (row.workEligibility && !['true', 'false', '1', '0', ''].includes(row.workEligibility.toLowerCase())) {
      rowWarnings.push(`Row ${rowNumber}: Work eligibility should be true/false, got "${row.workEligibility}"`);
    }

    // If no critical errors, add to validated data
    if (rowErrors.length === 0) {
      validatedData.push({
        ...row,
        workEligibility: row.workEligibility ? row.workEligibility.toLowerCase() === 'true' || row.workEligibility === '1' : true,
        languages: row.languages ? row.languages.split(',').map((lang: string) => lang.trim()) : []
      });
    }

    errors.push(...rowErrors);
    warnings.push(...rowWarnings);
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    data: validatedData
  };
}

export function parseCSVFile(file: File): Promise<CSVValidationResult> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          reject(new Error(`CSV parsing errors: ${results.errors.map(e => e.message).join(', ')}`));
          return;
        }

        const validation = validateCSVData(results.data);
        resolve(validation);
      },
      error: (error) => {
        reject(new Error(`Failed to parse CSV: ${error.message}`));
      }
    });
  });
}

export function downloadSampleCSV() {
  const csv = generateSampleCSV();
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', 'worker_import_template.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
} 