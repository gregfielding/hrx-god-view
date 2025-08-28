export interface Application {
  /**
   * Unique identifier for the application
   */
  id?: string;
  /**
   * Tenant ID this application belongs to
   */
  tenantId: string;
  /**
   * Jobs board post ID this application is for
   */
  postId: string;
  /**
   * Linked job order ID (if post is linked)
   */
  jobOrderId?: string | null;
  /**
   * Existing candidate ID (if applicant is already in system)
   */
  candidateId?: string | null;
  /**
   * Application mode - authenticated user or guest
   */
  mode?: 'authenticated' | 'guest';
  applicantData: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    resumeUrl?: string;
    coverLetter?: string;
    [k: string]: unknown;
  };
  answers?: {
    questionId: string;
    question: string;
    answer: string;
    type?: 'text' | 'yesno' | 'multiselect' | 'number';
    [k: string]: unknown;
  }[];
  status?: 'new' | 'screened' | 'advanced' | 'interview' | 'offer_pending' | 'hired' | 'rejected' | 'withdrawn';
  /**
   * How the applicant found the job
   */
  source?: 'QR' | 'URL' | 'referral' | 'Companion';
  /**
   * AI-generated match score
   */
  aiScore?: number;
  aiRecommendations?: string[];
  aiRiskFactors?: string[];
  /**
   * Work authorization status
   */
  workAuth?: 'citizen' | 'permanent_resident' | 'work_visa' | 'student_visa' | 'other';
  /**
   * When candidate can start
   */
  availability?: 'immediate' | '2_weeks' | '1_month' | '3_months' | 'flexible';
  /**
   * Application creation timestamp
   */
  createdAt?: number;
  /**
   * Last update timestamp
   */
  updatedAt?: number;
  /**
   * When application was screened
   */
  screenedAt?: number | null;
  /**
   * When candidate advanced to next stage
   */
  advancedAt?: number | null;
  /**
   * When interview was conducted
   */
  interviewedAt?: number | null;
  /**
   * When candidate was hired
   */
  hiredAt?: number | null;
  /**
   * When application was rejected
   */
  rejectedAt?: number | null;
  /**
   * When application was withdrawn
   */
  withdrawnAt?: number | null;
  /**
   * Internal recruiter notes
   */
  recruiterNotes?: string;
  duplicateCheck?: {
    isDuplicate?: boolean;
    duplicateCandidateIds?: string[];
    confidence?: number;
    reasons?: string[];
    [k: string]: unknown;
  };
}
