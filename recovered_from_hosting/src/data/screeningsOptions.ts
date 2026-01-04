// Standardized screening options based on ScreeningsOptions.md

export interface ScreeningOption {
  value: string;
  label: string;
  description: string;
}

export const backgroundCheckOptions: ScreeningOption[] = [
  { value: 'basic_national', label: 'Basic National Criminal Check', description: 'Nationwide database search for criminal convictions' },
  { value: 'county_7_year', label: '7-Year County Criminal Check', description: 'In-depth search of counties where the candidate lived in past 7 years' },
  { value: 'statewide_criminal', label: 'Statewide Criminal Search', description: 'State-level court record search' },
  { value: 'federal_criminal', label: 'Federal Criminal Search', description: 'Checks federal court databases (e.g., white-collar crimes)' },
  { value: 'ssn_trace', label: 'SSN Trace & Address History', description: 'Verifies identity and address history from SSN' },
  { value: 'sex_offender', label: 'Sex Offender Registry', description: 'National sex offender database search' },
  { value: 'mvr_check', label: 'Motor Vehicle Record (MVR)', description: 'Driving record check (for driver or delivery positions)' },
  { value: 'employment_verification', label: 'Employment Verification', description: 'Verifies past employers and job titles' },
  { value: 'education_verification', label: 'Education Verification', description: 'Verifies degrees, schools, and graduation years' },
  { value: 'license_verification', label: 'Professional License Verification', description: 'Confirms valid certifications (e.g., RN, CNA, HVAC)' },
  { value: 'federal_exclusion', label: 'Federal Exclusion Check (OIG / SAM)', description: 'Required for healthcare and government roles' },
  { value: 'international_criminal', label: 'International Criminal Search', description: 'For candidates who lived outside the U.S.' }
];

export const drugScreeningOptions: ScreeningOption[] = [
  { value: '4_panel_no_thc', label: '4-Panel (No THC)', description: 'Tests for Amphetamines, Cocaine, Opiates, and PCP' },
  { value: '4_panel_thc', label: '4-Panel (With THC)', description: 'Includes THC in the 4-panel test' },
  { value: '7_panel_no_thc', label: '7-Panel (No THC)', description: 'Adds Benzodiazepines, Barbiturates, and Methadone' },
  { value: '7_panel_thc', label: '7-Panel (With THC)', description: 'Common for general employment; includes THC' },
  { value: '10_panel_no_thc', label: '10-Panel (No THC)', description: 'Comprehensive screening for extended substances' },
  { value: '10_panel_thc', label: '10-Panel (With THC)', description: 'Full panel with THC included' },
  { value: '12_panel', label: '12-Panel', description: 'Extended version for healthcare and DOT roles' },
  { value: 'dot_test', label: 'DOT Drug Test', description: 'Federally compliant DOT drug test (49 CFR Part 40)' },
  { value: 'alcohol_screen', label: 'Alcohol Screen (Breath or Saliva)', description: 'Alcohol detection via breathalyzer or saliva' },
  { value: 'random_testing', label: 'Random / Periodic Testing', description: 'Used for ongoing employment compliance' },
  { value: 'post_accident', label: 'Post-Accident / Reasonable Suspicion', description: 'Conducted after workplace incidents' }
];

export const additionalScreeningOptions: ScreeningOption[] = [
  { value: 'tb_skin_test', label: 'TB Skin Test (PPD)', description: 'Standard tuberculosis screening (annual or bi-annual)' },
  { value: 'tb_blood_test', label: 'TB Blood Test (Quantiferon)', description: 'Lab-based TB test (Quantiferon Gold or T-Spot)' },
  { value: 'tb_chest_xray', label: 'Chest X-Ray (TB Follow-up)', description: 'Required for positive TB test follow-up' },
  { value: 'hepatitis_b_titer', label: 'Hepatitis B Titer / Series', description: 'Proof of immunity or vaccination series' },
  { value: 'mmr_titer', label: 'MMR Titer (Measles, Mumps, Rubella)', description: 'Proof of immunity or vaccination' },
  { value: 'varicella_titer', label: 'Varicella (Chickenpox) Titer', description: 'Required for healthcare or child-facing work' },
  { value: 'tdap_vaccine', label: 'Tdap (Tetanus, Diphtheria, Pertussis)', description: 'Proof of updated vaccination' },
  { value: 'covid_vaccine', label: 'COVID-19 Vaccine', description: 'COVID-19 vaccination proof or exemption' },
  { value: 'flu_shot', label: 'Influenza (Flu Shot)', description: 'Annual flu vaccination' },
  { value: 'physical_exam', label: 'Physical Exam (Fit for Duty)', description: 'Medical clearance to perform job duties' },
  { value: 'lift_test', label: 'Lift Test / Functional Assessment', description: 'Tests physical capacity for warehouse roles' },
  { value: 'cpr_bls_cert', label: 'CPR / BLS Certification', description: 'Proof of CPR / Basic Life Support certification' },
  { value: 'acls_cert', label: 'ACLS Certification', description: 'Advanced cardiac life support for RNs and clinicians' },
  { value: 'fingerprinting', label: 'Fingerprinting (Live Scan)', description: 'Background fingerprint scan (state or FBI)' },
  { value: 'drug_confirmation', label: 'Drug Screen Confirmation', description: 'Secondary confirmation test after initial screen' },
  { value: 'respirator_fit', label: 'Respirator Fit Test', description: 'Required for respirator use in clinical or industrial jobs' },
  { value: 'osha_cert', label: 'OSHA Safety Certification', description: 'OSHA 10/30 or equivalent safety credential' },
  { value: 'bloodborne_pathogen', label: 'Bloodborne Pathogens Training', description: 'Required for exposure-prone roles' }
];

// Helper function to get options for a specific screening type
export const getScreeningOptions = (type: 'background' | 'drug' | 'additional'): ScreeningOption[] => {
  switch (type) {
    case 'background':
      return backgroundCheckOptions;
    case 'drug':
      return drugScreeningOptions;
    case 'additional':
      return additionalScreeningOptions;
    default:
      return [];
  }
};

// Helper function to get just the labels for dropdowns
export const getScreeningLabels = (type: 'background' | 'drug' | 'additional'): string[] => {
  return getScreeningOptions(type).map(option => option.label);
};
