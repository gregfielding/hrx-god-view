export interface Candidate {
  /**
   * Unique identifier for the candidate
   */
  id?: string;
  /**
   * Tenant ID this candidate belongs to
   */
  tenantId: string;
  /**
   * Candidate's first name
   */
  firstName: string;
  /**
   * Candidate's last name
   */
  lastName: string;
  /**
   * Primary email address
   */
  email: string;
  /**
   * Primary phone number
   */
  phone?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
    [k: string]: unknown;
  };
  /**
   * Date of birth (YYYY-MM-DD)
   */
  dateOfBirth?: string;
  /**
   * Social Security Number (encrypted)
   */
  ssn?: string;
  /**
   * Work authorization status
   */
  workAuth?: 'citizen' | 'permanent_resident' | 'work_visa' | 'student_visa' | 'other';
  skills?: string[];
  experience?: {
    company: string;
    position: string;
    startDate: string;
    endDate?: string | null;
    description?: string;
    skills?: string[];
    [k: string]: unknown;
  }[];
  education?: {
    institution: string;
    degree: string;
    field?: string;
    graduationDate?: string;
    gpa?: number;
    [k: string]: unknown;
  }[];
  certifications?: {
    name: string;
    issuer: string;
    issueDate?: string;
    expiryDate?: string | null;
    certificateNumber?: string;
    [k: string]: unknown;
  }[];
  /**
   * URL to resume file
   */
  resumeUrl?: string;
  /**
   * URL to profile picture
   */
  profilePictureUrl?: string;
  status?: 'applicant' | 'active_employee' | 'inactive' | 'hired' | 'rejected' | 'terminated' | 'completed';
  pipelineStage?: 'applicant' | 'screened' | 'interview' | 'offer' | 'hired';
  source?: 'manual' | 'jobs_board' | 'referral' | 'import' | 'companion';
  /**
   * Link to Companion user if exists
   */
  companionUserId?: string | null;
  notificationPrefs?: {
    email?: boolean;
    sms?: boolean;
    push?: boolean;
    [k: string]: unknown;
  };
  complianceStatus?: {
    i9Status?: 'pending' | 'complete' | 'pass' | 'fail' | 'expired';
    bgcStatus?: 'pending' | 'complete' | 'pass' | 'fail' | 'expired';
    drugStatus?: 'pending' | 'complete' | 'pass' | 'fail' | 'expired';
    [k: string]: unknown;
  };
  /**
   * Primary recruiter assigned to candidate
   */
  recruiterOwnerId?: string | null;
  /**
   * Internal notes about candidate
   */
  notes?: string;
  tags?: string[];
  /**
   * Creation timestamp
   */
  createdAt?: number;
  /**
   * Last update timestamp
   */
  updatedAt?: number;
  /**
   * Last contact timestamp
   */
  lastContactAt?: number | null;
  duplicateCheck?: {
    isDuplicate?: boolean;
    duplicateCandidateIds?: string[];
    confidence?: number;
    reasons?: string[];
    [k: string]: unknown;
  };
}
