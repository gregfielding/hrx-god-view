/**
 * InSource's REVISED "Mass PN" (Prospect Notification) intake workbook —
 * "Revised- MASS PN - Prospect Notification Template.xlsx", sent by Eddie
 * Mastronardi 2026-09-08 ("going forward please use the new one", Gmail
 * thread 1a081b705f20774e). Replaces the flat 24-column 2026-08 layout.
 *
 * Layout, copied VERBATIM from their file — typos, stray spaces and the
 * trailing space in the second sheet's name included, since their intake
 * side may key on exact text:
 *  - Columns A/B rows 1–13: staffing-company block (labels in rows 1/3,
 *    values in A2/B2/A4/B4), Mass PN submission + proposed-effective dates
 *    in B6/B7, and their instruction lines. Data rows share these rows.
 *  - Column C: one-character spacer.
 *  - Columns D–Y: the per-request table, headers in row 1, data from ROW 2.
 *    Client MAILING address (E–H) is now separate from the WORKSITE
 *    address (I–L) — the split Eddie asked for after VenueSmart's MO HQ
 *    showed on a WI worksite row.
 *  - Second sheet "Important Instructions " — their static notes, verbatim.
 *
 * This module is the single source of truth for the sheet CONTENT: the
 * client export / Submit-to-Eddie (src/pages/reports/WcCoveragePage.tsx)
 * and the 14-day auto-submit (functions/src/workersComp/massPnAutoSubmit.ts)
 * both assemble their workbook from this spec, so the two paths produce
 * byte-identical files by construction. Their intake reads cell VALUES;
 * the original's fills/fonts are guidance for human fillers and are not
 * reproduced (SheetJS community edition cannot write styling).
 *
 * shared/ ↔ src/shared/ ↔ functions/src/shared/ are byte-identical
 * mirrors — edit all copies.
 */

/** One carrier-ask row from the WC coverage report (coverageGaps massPn). */
export interface MassPnSheetRow {
  entityName: string;
  accountName: string;
  /** Client HQ / mailing address (top-level account) — columns E–H. */
  accountStreet?: string;
  accountCity?: string;
  accountState?: string;
  accountZip?: string;
  worksiteName: string;
  /** Structured worksite address (job-order-first) — columns I–L. */
  worksiteStreet?: string;
  worksiteCity?: string;
  worksiteState?: string;
  worksiteZip?: string;
  state: string;
  code: string;
  jobTitles: string[];
  periodGross: number;
  workers: number;
  annualEstimate: number;
  suggestedCode?: string | null;
  suggestedBasis?: string[];
  comparableRateMin?: number | null;
  comparableRateMax?: number | null;
}

/** Everything a builder needs to hand SheetJS for one sheet. */
export interface MassPnSheetSpec {
  name: string;
  aoa: (string | number | null)[][];
  /** SheetJS ws['!merges'] ranges (0-based row/col). */
  merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;
  /** SheetJS ws['!cols'] — widths lifted from their template. */
  cols: Array<{ wch: number } | undefined>;
  /** SheetJS ws['!rows'] — heights lifted from their template. */
  rows: Array<{ hpt: number } | undefined>;
}

export const MASS_PN_CONTACT = {
  name: 'Greg Fielding',
  email: 'g.fielding@c1staffing.com',
  phone: '925-448-0579',
};

/** D–Y headers, row 1 (A1/B1 belong to the left block). */
const TABLE_HEADERS: string[] = [
  'Your Client/Prospect Name',
  ' Client Main (Home Office) Street Address',
  'Client City',
  'Client State',
  'Client Zip Code',
  'Project/Worksite Street Address \n(if different than Main Address)',
  'Worksite City',
  'Worksite State',
  'Worksite Zip Code',
  'Client Business Description',
  'Job Description - Be Speicific to the actual job duties',
  'Class Code State',
  'Class Code',
  'Annual Payroll Estimated',
  'Group Transportation          (Yes or No)',
  'Trenching or Excavation (Yes or No)',
  'Height Exposure Above Ground Level (Yes or No)',
  'Chemical Exposure (Yes or No)',
  'Machinery Exposure (Yes or No)',
  'Respirators or Dust Mask (Yes or No)',
  'Airborne/Bloodborn Exposure (Yes or No)',
  'Notes \n(COI or Endorsement Needs, Wording Specifics, etc...) ',
];

/** Column widths A–Z from their file (E and X carry no explicit width). */
const MASS_PN_COLS: Array<{ wch: number } | undefined> = [
  { wch: 51.5 },
  { wch: 31.5 },
  { wch: 1.16 },
  { wch: 48.16 },
  undefined,
  { wch: 20.5 },
  { wch: 9.16 },
  { wch: 12.5 },
  { wch: 50.16 },
  { wch: 29.16 },
  { wch: 15 },
  { wch: 16.83 },
  { wch: 57 },
  { wch: 50 },
  { wch: 14.66 },
  { wch: 14.16 },
  { wch: 17.16 },
  { wch: 19.83 },
  { wch: 21.83 },
  { wch: 22.5 },
  { wch: 19.16 },
  { wch: 21.5 },
  { wch: 25.16 },
  undefined,
  { wch: 166.83 },
  { wch: 66.66 },
];

/** Row heights 1–13 from their file. */
const MASS_PN_ROW_HEIGHTS = [59.25, 47, 47, 47, 20, 19, 19, 21, 19, 17, 18, 21, 20];

const INSTRUCTIONS_SHEET_NAME = 'Important Instructions ';
const INSTRUCTIONS: Array<[number, string]> = [
  [4, 'When filling  the Mass PN spreadsheet, please be specific as possible on the job duties and actual worksite location/address as well as the company operations.'],
  [6, 'Be sure you have your clients full name business name listed under Column D. If you need something specific on the COI or a WOS/AEE please note this in Column Y.'],
  [8, 'If more than one worksite location exists for the same prospect, you will need to list all locations seperately.  If the job is a remote position we will need the physical home address of the employee.  For supervisiory/manager positions, please also indicate if they will be supervising other employees or have employees reporting to them.'],
  [10, 'If you have more than one entity, please be sure the correct entity name is listed for which we are issuing COIs and adding to your policy. Use only one spreadsheet per entity per Mass PN'],
  [12, "Please do not to leave anything blank. If you don't know the class code you may only leave this blank (Column P) and underwriting will verify.  If you are unsure about the estimated payroll amount, it is safe to estimate $50,000 per full time EE, depedning upon the posiiton (Column Q). Estimatated payroll amounts do not affect the class code/rate."],
  [14, 'When completed please email the completed spreadsheet to your Account Manager only. Underwriting and the Carrier may have additional questions about your PN once submitted, and your Account Manager will reach out to you for clarification.'],
  [16, 'Reminder: Policies are NOT written in Seven States: NH, NY, ND, OH, OR, WA or WY. If you need coverage in these states please speak with your agent. Please allow up to 5 business days for this submission to be completed once you have emailed it to your Account Manager. It may be completed sooner if there are no questions from the carrier. Your Account Manager will notify you by email when completed, along with any COIs, WOS/AEE. '],
  [18, 'If you are adding a NEW STATE for the first time for new coverage, there are additional steps required by our carrier that our underwriting team needs to take to offically add to your policy. These states are often refered to as MCP (Multiple Coordinated Policy) which will produce a different workers comp policy # for you for that state, which will be listed on your COI. '],
];

const usd = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** '2026-09-08' → '9/8/2026' (string math — no Date, no timezone drift). */
const usDate = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y}`;
};

const trim = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Build both sheet specs for ONE entity's Mass PN file. `rows` must already
 * be filtered to a single entity; A2 carries that ENTITY's name (their
 * instruction 4: one spreadsheet per entity, correct entity name listed —
 * the entity is what InSource adds to the policy, not the C1 parent).
 * Submission and proposed-effective dates (B6/B7) are the report end date,
 * so the same inputs always produce the same bytes.
 */
export function buildMassPnSheets(
  rows: MassPnSheetRow[],
  startDate: string,
  endDate: string,
): MassPnSheetSpec[] {
  const entityName = rows[0]?.entityName ?? '';
  const rowCount = Math.max(13, rows.length + 1);
  const aoa: (string | number | null)[][] = [];
  for (let i = 0; i < rowCount; i++) aoa.push([]);

  // Left block (columns A/B) — labels, our once-per-file values, their text.
  aoa[0][0] = 'Your Staffing Company Name  ';
  aoa[0][1] = 'Contact Name';
  aoa[1][0] = entityName;
  aoa[1][1] = MASS_PN_CONTACT.name;
  aoa[2][0] = 'Your Email';
  aoa[2][1] = 'Your Phone';
  aoa[3][0] = MASS_PN_CONTACT.email;
  aoa[3][1] = MASS_PN_CONTACT.phone;
  aoa[4][0] = 'Only fill in this section above (Columns A and B, Rows 2 and 4) once';
  aoa[5][0] = 'DATE OF MASS PN SUBMISSION:';
  aoa[5][1] = usDate(endDate);
  aoa[6][0] = 'EFFECTIVE DATE OF PROPOSED COVERAGE:';
  aoa[6][1] = usDate(endDate);
  aoa[7][0] = 'Please complete the dates indicated in Column B, Rows 6 and 7 highlghted in yellow';
  aoa[11][0] = 'If you have more than one entity, please be sure the correct entity name is listed ';
  aoa[12][0] = 'Use only one spreadsheet per entity per Mass PN';

  // Table headers D1–Y1 (C stays a spacer).
  TABLE_HEADERS.forEach((h, i) => {
    aoa[0][3 + i] = h;
  });

  // Data rows from row 2, sharing rows with the left block.
  rows.forEach((r, i) => {
    const notes = [
      r.worksiteName && r.worksiteName !== '(worksite unknown)' ? `Worksite: ${r.worksiteName}` : '',
      `Est. annualized from ${usd(r.periodGross)} over ${startDate}→${endDate} (${r.workers} workers, ${r.entityName})`,
      r.suggestedCode && (r.suggestedBasis?.length ?? 0) > 0
        ? `Code ${r.suggestedCode} suggested from titles rated elsewhere on our policy: ${(r.suggestedBasis ?? []).join(', ')}`
        : '',
      r.comparableRateMin != null
        ? `Comparable rate on existing policy states: ${r.comparableRateMin}${r.comparableRateMax != null && r.comparableRateMax !== r.comparableRateMin ? `–${r.comparableRateMax}` : ''}`
        : '',
    ]
      .filter(Boolean)
      .join('. ');
    const row: (string | number | null)[] = [
      r.accountName || '(fill in client)',
      trim(r.accountStreet),
      trim(r.accountCity),
      trim(r.accountState),
      trim(r.accountZip),
      trim(r.worksiteStreet),
      trim(r.worksiteCity),
      trim(r.worksiteState) || r.state,
      trim(r.worksiteZip),
      '', // client business description — Greg fills in
      r.jobTitles.length ? r.jobTitles.join(', ') : '',
      r.state,
      // Ask for the REAL code — 8040 is our placeholder, not a requestable
      // classification. Unknown stays BLANK per their instruction 5
      // ("you may only leave this blank (Column P)").
      r.suggestedCode || (r.code && r.code !== '8040' ? r.code : ''),
      r.annualEstimate,
      'No',
      'No',
      'No',
      'No',
      'No',
      'No',
      'No',
      notes,
    ];
    row.forEach((v, c) => {
      aoa[1 + i][3 + c] = v;
    });
  });

  const instructionsAoa: (string | number | null)[][] = [];
  for (let i = 0; i < 18; i++) instructionsAoa.push([]);
  instructionsAoa[0][1] = 'Important Notes for Completing The Mass PN (Prospect Notification) Spreadsheet';
  INSTRUCTIONS.forEach(([rowNum, text], i) => {
    instructionsAoa[rowNum - 1][0] = i + 1;
    instructionsAoa[rowNum - 1][1] = text;
  });

  return [
    {
      name: 'Mass PN',
      aoa,
      merges: [{ s: { r: 4, c: 0 }, e: { r: 4, c: 1 } }],
      cols: MASS_PN_COLS,
      rows: MASS_PN_ROW_HEIGHTS.map((hpt) => ({ hpt })),
    },
    {
      name: INSTRUCTIONS_SHEET_NAME,
      aoa: instructionsAoa,
      merges: [],
      cols: [undefined, { wch: 255.66 }],
      rows: [
        { hpt: 25 },
        undefined,
        { hpt: 17 },
        { hpt: 18 },
        { hpt: 18 },
        { hpt: 19 },
        { hpt: 18 },
        { hpt: 38 },
        { hpt: 18 },
        { hpt: 18 },
        { hpt: 18 },
        { hpt: 38 },
        { hpt: 18 },
        { hpt: 38 },
        { hpt: 18 },
        { hpt: 38 },
        { hpt: 18 },
        { hpt: 38 },
      ],
    },
  ];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The slice of the SheetJS module both builders hand in. */
export interface XlsxLike {
  utils: {
    aoa_to_sheet: (aoa: any[][]) => any;
    book_new: () => any;
    book_append_sheet: (wb: any, ws: any, name: string) => void;
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Assemble the two sheets into a SheetJS workbook — kept here so the
 *  client and server builds cannot drift. */
export function assembleMassPnWorkbook(
  XLSX: XlsxLike,
  rows: MassPnSheetRow[],
  startDate: string,
  endDate: string,
): unknown {
  const wb = XLSX.utils.book_new();
  for (const spec of buildMassPnSheets(rows, startDate, endDate)) {
    const ws = XLSX.utils.aoa_to_sheet(spec.aoa);
    ws['!merges'] = spec.merges;
    ws['!cols'] = spec.cols;
    ws['!rows'] = spec.rows;
    XLSX.utils.book_append_sheet(wb, ws, spec.name);
  }
  return wb;
}
