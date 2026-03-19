// Onboarding task definitions and helpers

export type OnboardingStatus = 'In Progress' | 'Cancelled' | 'Completed';
export type OnboardingType = 'employee' | 'contractor';

export interface OnboardingTask {
  id: string;
  label: string;
  category: 'Documents' | 'Background' | 'E-Verify' | 'Orientation' | 'Equipment' | 'Other';
  completed: boolean;
  completedAt?: Date | any;
  completedBy?: string; // userId
  notes?: string;
  required?: boolean; // Whether task is required for completion
}

// Employee onboarding tasks (W2 workers)
export const getEmployeeOnboardingTasks = (): Omit<OnboardingTask, 'completed' | 'completedAt' | 'completedBy' | 'notes'>[] => [
  { id: 'i9', label: 'Complete I-9 Form', category: 'Documents', required: true },
  { id: 'w4', label: 'Submit W-4 Form', category: 'Documents', required: true },
  { id: 'everify', label: 'Complete E-Verify', category: 'E-Verify', required: true },
  { id: 'background', label: 'Background Check', category: 'Background', required: false },
  { id: 'drug', label: 'Drug Screening', category: 'Background', required: false },
  { id: 'direct_deposit', label: 'Submit Direct Deposit Information', category: 'Documents', required: false },
  { id: 'handbook', label: 'Review Employee Handbook', category: 'Orientation', required: false },
  { id: 'orientation', label: 'Complete Orientation/Training', category: 'Orientation', required: false },
];

// Contractor onboarding tasks (1099 workers)
export const getContractorOnboardingTasks = (): Omit<OnboardingTask, 'completed' | 'completedAt' | 'completedBy' | 'notes'>[] => [
  { id: 'w9', label: 'Submit W-9 Form', category: 'Documents', required: true },
  { id: 'background', label: 'Background Check', category: 'Background', required: false },
  { id: 'drug', label: 'Drug Screening', category: 'Background', required: false },
  { id: 'contract', label: 'Review Contractor Agreement', category: 'Documents', required: true },
  { id: 'insurance', label: 'Submit Insurance Information', category: 'Documents', required: false },
];

/**
 * Initialize onboarding tasks for a user
 */
export const initializeOnboardingTasks = (
  type: OnboardingType,
  existingTasks?: OnboardingTask[]
): OnboardingTask[] => {
  const taskDefinitions = type === 'employee' 
    ? getEmployeeOnboardingTasks()
    : getContractorOnboardingTasks();

  // If tasks already exist, preserve their completion status
  if (existingTasks && existingTasks.length > 0) {
    return taskDefinitions.map(def => {
      const existing = existingTasks.find(t => t.id === def.id);
      return existing || {
        ...def,
        completed: false,
      };
    });
  }

  // Create new tasks
  return taskDefinitions.map(def => ({
    ...def,
    completed: false,
  }));
};

/**
 * Check if all required tasks are completed
 */
export const areRequiredTasksComplete = (tasks: OnboardingTask[]): boolean => {
  const requiredTasks = tasks.filter(t => t.required !== false);
  return requiredTasks.length > 0 && requiredTasks.every(t => t.completed);
};

/**
 * Get task completion percentage
 */
export const getTaskCompletionPercentage = (tasks: OnboardingTask[]): number => {
  if (tasks.length === 0) return 0;
  const completed = tasks.filter(t => t.completed).length;
  return Math.round((completed / tasks.length) * 100);
};

