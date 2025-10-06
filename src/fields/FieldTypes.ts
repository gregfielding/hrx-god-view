export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'time'
  | 'select'
  | 'multiselect'
  | 'object'
  | 'array';

export type Option = { value: string; label: string; disabled?: boolean };

export type FieldDef = {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  description?: string;
  options?: Option[];
  itemShape?: Record<string, FieldType> | FieldType;
  validator?: string;
  usedBy: Array<'Deal' | 'JobOrder' | 'JobPosting' | 'Both' | 'All'>;
  defaultValue?: any;
  tags?: string[];
  deprecated?: boolean;
  // Stage metadata for Deal/JobOrder stageData routing
  stage?:
    | 'discovery'
    | 'qualification'
    | 'scoping'
    | 'proposalDrafted'
    | 'proposalReview'
    | 'negotiation'
    | 'verbalAgreement'
    | 'closedWon';
  // Dot-path to the canonical location within stageData (or flat doc)
  // Examples: 'qualification.expectedAveragePayRate', 'scoping.compliance.backgroundCheck'
  path?: string;
  // Source of options when dynamic (e.g., from Company Defaults)
  optionsSource?: 'companyDefaults';
  // UI/formatting hints
  hints?: {
    unit?: '%' | '$' | 'hrs' | string;
  };
};

export type Registry = Record<string, FieldDef>;


