/**
 * W.3 — verify the CSV importer hides `workEligibility` from the export
 * template when the collection flag is on, AND that the parser stays
 * tolerant of legacy CSVs that still include the column.
 *
 * Two-axis matrix: flag on / off × CSV column present / missing.
 */

const FLAG_ENV = 'REACT_APP_WORK_AUTH_COLLECTION_DISABLED';

import * as csvUpload from '../csvUpload';

describe('csvUpload — W.3 work-auth column visibility', () => {
  const ORIGINAL_ENV = process.env[FLAG_ENV];
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env[FLAG_ENV];
    } else {
      process.env[FLAG_ENV] = ORIGINAL_ENV;
    }
  });

  // The flag util reads `process.env` per call (not at module load),
  // so we can flip env between cases without `jest.resetModules`.
  function loadCsvUpload() {
    return csvUpload;
  }

  describe('export template', () => {
    it('drops workEligibility from columns + sample CSV when flag is on', () => {
      process.env[FLAG_ENV] = 'true';
      const { getExportableCsvColumns, generateSampleCSV } = loadCsvUpload();

      const cols = getExportableCsvColumns();
      expect(cols).not.toContain('workEligibility');
      // Other key columns still present (smoke check we didn't drop the wrong field).
      expect(cols).toContain('firstName');
      expect(cols).toContain('email');
      expect(cols).toContain('languages');

      const csv = generateSampleCSV();
      const headerLine = csv.split(/\r?\n/)[0] || '';
      expect(headerLine.split(',')).not.toContain('workEligibility');
      // Sanity: the header still includes a recognizable required field.
      expect(headerLine).toMatch(/firstName/);
    });

    it('includes workEligibility in template when flag is off (rollback)', () => {
      process.env[FLAG_ENV] = 'false';
      const { getExportableCsvColumns, generateSampleCSV } = loadCsvUpload();

      expect(getExportableCsvColumns()).toContain('workEligibility');
      const csv = generateSampleCSV();
      expect(csv.split(/\r?\n/)[0]?.split(',')).toContain('workEligibility');
    });
  });

  describe('legacy CSV parser tolerance', () => {
    it('accepts rows that still carry the workEligibility column (flag on)', () => {
      process.env[FLAG_ENV] = 'true';
      const { validateCSVData } = loadCsvUpload();

      const result = validateCSVData([
        {
          firstName: 'Legacy',
          lastName: 'Worker',
          email: 'legacy@example.com',
          phone: '5551234567',
          securityLevel: 'Worker',
          employmentType: 'Full-Time',
          workStatus: 'Active',
          workEligibility: 'true',
        },
      ]);

      expect(result.errors).toEqual([]);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].workEligibility).toBe(true);
    });

    it('accepts rows that omit the workEligibility column (flag on)', () => {
      process.env[FLAG_ENV] = 'true';
      const { validateCSVData } = loadCsvUpload();

      const result = validateCSVData([
        {
          firstName: 'Modern',
          lastName: 'Worker',
          email: 'modern@example.com',
          phone: '5559876543',
          securityLevel: 'Worker',
          employmentType: 'Full-Time',
          workStatus: 'Active',
        },
      ]);

      expect(result.errors).toEqual([]);
      expect(result.data).toHaveLength(1);
      // Legacy semantic: missing column → defaults to true. W.1's mirror
      // reconciles the value to the authoritative source downstream.
      expect(result.data[0].workEligibility).toBe(true);
    });
  });
});
