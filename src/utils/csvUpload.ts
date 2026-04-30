import Papa from 'papaparse';

import { isWorkAuthCollectionDisabled } from './workAuthCollectionFlag';

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
  /**
   * W.3 — dropped from the export template + sample CSV when
   * `WORK_AUTH_COLLECTION_DISABLED` is on (default). The parser still
   * accepts the column for legacy CSVs uploaded before the rollout, so
   * existing pipelines keep working.
   */
  workEligibility?: string | boolean;
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

/**
 * Canonical column ordering for the importer. Used by both the export
 * template (the user-facing CSV they download) and the parser
 * (column-by-column documentation). The W.3 work-auth column is filtered
 * out of the user-facing template via `getExportableCsvColumns()`; the
 * full list still names it so the parser knows it's a recognized field
 * if a legacy CSV still includes it.
 */
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

/**
 * W.3 — fields the export template should EMIT. When work-auth collection
 * is disabled (default), `workEligibility` is dropped so HRX staff aren't
 * prompted to fill in a column that downstream code now sources from
 * `users.workEligibility` (mirrored by W.1's server-side writer).
 *
 * The parser deliberately stays tolerant of legacy CSVs that still carry
 * the column — see `validateCSVData` below.
 */
export function getExportableCsvColumns(): ReadonlyArray<typeof CSV_COLUMNS[number]> {
  if (isWorkAuthCollectionDisabled()) {
    return CSV_COLUMNS.filter((col) => col !== 'workEligibility');
  }
  return CSV_COLUMNS;
}

export const REQUIRED_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'securityLevel', 'employmentType', 'workStatus'];

export const VALID_SECURITY_LEVELS = ['Applicant', 'Worker', 'Flex'];
export const VALID_EMPLOYMENT_TYPES = ['Full-Time', 'Part-Time', 'Contract', 'Flex'];
export const VALID_WORK_STATUSES = ['Active', 'On Leave', 'Terminated', 'Suspended', 'Pending'];
export const VALID_GENDERS = ['Male', 'Female', 'Nonbinary', 'Other', 'Prefer not to say'];
export const VALID_TRANSPORT_METHODS = ['Car', 'Public Transit', 'Bike', 'Walk', 'Other'];

/**
 * Internal — full sample row. `generateSampleCSV` strips the W.3 column
 * before serializing, but keeping the raw data here lets us add new
 * columns without re-doing the row authoring.
 */
function buildSampleRows(): Array<Record<string, string>> {
  return [
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
}

export function generateSampleCSV(): string {
  // W.3 — strip the work-auth column from the user-facing template when
  // collection is disabled. Use Papa's `columns` option so the header
  // row is honored (otherwise Papa derives columns from the first row's
  // keys, which would still include `workEligibility`).
  const columns = getExportableCsvColumns();
  const sampleData = buildSampleRows().map((row) => {
    const trimmed: Record<string, string> = {};
    for (const col of columns) trimmed[col] = row[col] ?? '';
    return trimmed;
  });
  return Papa.unparse(sampleData, { columns: columns as unknown as string[] });
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