/**
 * Opening preference / work-interest section — first screens in worker AI prescreen.
 *
 * Selection is **inclusive** (checkbox / multi-select), never radio-style exclusivity:
 * workers may combine multiple work types, multiple schedule preferences, and multiple
 * tags within each experience follow-up. Persisted as parallel `string[]` fields on
 * `WorkerAiPrescreenAnswers` (see `opening_experience_*` per vertical).
 *
 * Server: `functions/src/workerAiPrescreen/prescreenOpeningKeys.ts`
 */

export const OPENING_TARGET_WORK_TYPES = [
  { value: 'hospitality', label: 'Hospitality' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'events', label: 'Events' },
  { value: 'clerical_admin', label: 'Clerical / Admin' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'other', label: 'Other' },
] as const;

export const OPENING_SCHEDULE_PREFERENCES = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'gig_work', label: 'Gig work' },
  { value: 'temp_to_hire', label: 'Temporary-to-hire' },
  { value: 'seasonal', label: 'Seasonal' },
] as const;

export const OPENING_EXPERIENCE_INDUSTRIAL = [
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'assembly', label: 'Assembly' },
  { value: 'packing_shipping', label: 'Packing / shipping' },
  { value: 'machine_operation', label: 'Machine operation' },
  { value: 'cleaning_janitorial', label: 'Cleaning / janitorial' },
  { value: 'forklift', label: 'Forklift' },
  { value: 'inventory_scanning', label: 'Inventory / scanning' },
] as const;

export const OPENING_EXPERIENCE_HOSPITALITY = [
  { value: 'server', label: 'Server' },
  { value: 'bartender', label: 'Bartender' },
  { value: 'dishwasher', label: 'Dishwasher' },
  { value: 'prep_line_cook', label: 'Prep / line cook' },
  { value: 'banquet_setup', label: 'Banquet setup' },
  { value: 'housekeeping', label: 'Housekeeping' },
  { value: 'cashier_concessions', label: 'Cashier / concessions' },
] as const;

export const OPENING_EXPERIENCE_EVENTS = [
  { value: 'setup_teardown', label: 'Setup / teardown' },
  { value: 'guest_services', label: 'Guest services' },
  { value: 'usher_ticketing', label: 'Usher / ticketing' },
  { value: 'concessions', label: 'Concessions' },
  { value: 'catering_banquet', label: 'Catering / banquet service' },
  { value: 'registration_checkin', label: 'Registration / check-in' },
  { value: 'general_event_labor', label: 'General event labor' },
] as const;

export const OPENING_EXPERIENCE_CLERICAL = [
  { value: 'reception', label: 'Reception' },
  { value: 'data_entry', label: 'Data entry' },
  { value: 'customer_service', label: 'Customer service' },
  { value: 'scheduling_coordination', label: 'Scheduling / coordination' },
  { value: 'office_assistant', label: 'Office assistant' },
  { value: 'filing_records', label: 'Filing / records' },
  { value: 'call_center', label: 'Call center' },
] as const;

export const OPENING_EXPERIENCE_HEALTHCARE = [
  { value: 'caregiving', label: 'Caregiving' },
  { value: 'patient_support', label: 'Patient support' },
  { value: 'medical_office', label: 'Medical office' },
  { value: 'scheduling_front_desk', label: 'Scheduling / front desk' },
  { value: 'environmental_services', label: 'Environmental services' },
  { value: 'dietary_support', label: 'Dietary support' },
  { value: 'other_healthcare_support', label: 'Other healthcare support' },
] as const;

export const OPENING_GIG_TYPES = [
  { value: 'event_shifts', label: 'Event shifts' },
  { value: 'warehouse_day_shifts', label: 'Warehouse day shifts' },
  { value: 'setup_teardown', label: 'Setup / teardown' },
  { value: 'hospitality_shifts', label: 'Hospitality shifts' },
  { value: 'delivery_driving', label: 'Delivery / driving' },
  { value: 'general_labor', label: 'General labor' },
] as const;

/** Core steps inserted before motivation (order matters). */
export const WORKER_AI_PRESCREEN_OPENING_STEPS = [
  {
    id: 'opening_target_work_types',
    type: 'multi_select',
    prompt: 'What type of work are you interested in?',
    options: [...OPENING_TARGET_WORK_TYPES],
  },
  {
    id: 'opening_schedule_preferences',
    type: 'multi_select',
    prompt: 'What kind of schedule are you open to?',
    options: [...OPENING_SCHEDULE_PREFERENCES],
  },
  {
    id: 'opening_experience_industrial',
    type: 'multi_select',
    prompt: 'Which types of industrial work have you done before?',
    options: [...OPENING_EXPERIENCE_INDUSTRIAL],
  },
  {
    id: 'opening_experience_hospitality',
    type: 'multi_select',
    prompt: 'Which hospitality roles have you worked in?',
    options: [...OPENING_EXPERIENCE_HOSPITALITY],
  },
  {
    id: 'opening_experience_events',
    type: 'multi_select',
    prompt: 'What kind of event work have you done?',
    options: [...OPENING_EXPERIENCE_EVENTS],
  },
  {
    id: 'opening_experience_clerical',
    type: 'multi_select',
    prompt: 'Which clerical or admin work have you done?',
    options: [...OPENING_EXPERIENCE_CLERICAL],
  },
  {
    id: 'opening_experience_healthcare',
    type: 'multi_select',
    prompt: 'Which healthcare support roles have you done?',
    options: [...OPENING_EXPERIENCE_HEALTHCARE],
  },
  {
    id: 'opening_gig_types',
    type: 'multi_select',
    prompt: 'What kinds of gig work are you open to?',
    options: [...OPENING_GIG_TYPES],
  },
] as const;
