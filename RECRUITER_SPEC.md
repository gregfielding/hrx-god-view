# HRX Recruiter — Complete Reference Guide

## 🎯 **Executive Summary**

HRX Recruiter is designed to be the most powerful Applicant Tracking System (ATS) in the market, built on our proven tenant-based architecture with seamless CRM integration. This system transforms closed-won deals into fulfilled placements with zero data re-entry, powered by AI-driven candidate matching and comprehensive compliance tracking.

## 🏗️ **Architecture Overview**

### **Core Principles**
1. **Single Source of Truth**: CRM is canonical for Companies & Contacts; Recruiter references via `crm_companyId`
2. **Zero Data Re-entry**: Seamless handoff from CRM Closed-Won to Recruiter fulfillment
3. **AI-First Design**: Every interaction enhanced with intelligent suggestions and automation
4. **Multi-Tenant Isolation**: Complete tenant separation with optional agency/customer scoping
5. **Compliance Excellence**: Built-in EEO/OFCCP support, document tracking, and audit trails
6. **Operational Speed**: One-click actions, batch operations, and aggressive keyboard navigation
7. **Extensible Platform**: Support for both linked job orders and evergreen talent pools
8. **Event-Driven Architecture**: Event bus with idempotent processors for data consistency

### **Canonical Data Strategy**
- **CRM Collections**: `/tenants/{tenantId}/crm_companies`, `/tenants/{tenantId}/crm_contacts`, `/tenants/{tenantId}/crm_deals`
- **Recruiter Extensions**: `/tenants/{tenantId}/recruiter_clients/{crm_companyId}` - recruiter-specific fields only
- **Reference Model**: All recruiter objects store `crm_companyId` and `crm_contactId` references
- **No Duplication**: Companies and contacts are never duplicated; only referenced

### **Firestore Structure**
Following our established patterns with canonical references:

```
/tenants/{tenantId}/
├── crm_companies/{companyId}                    # CANONICAL - Company data
├── crm_contacts/{contactId}                      # CANONICAL - Contact data
├── crm_deals/{dealId}                           # CANONICAL - Deal/Opportunity data
├── recruiter_clients/{crm_companyId}            # Extension - Recruiter-specific fields
├── recruiter_jobOrders/{jobOrderId}             # Links to crm_companyId + crm_dealId
├── recruiter_candidates/{candidateId}            # Independent candidate data
├── recruiter_submittals/{submittalId}           # Links to jobOrderId + candidateId
├── recruiter_interviews/{interviewId}           # Links to jobOrderId + candidateId
├── recruiter_offers/{offerId}                   # Links to jobOrderId + candidateId
├── recruiter_placements/{placementId}           # Links to jobOrderId + candidateId
├── recruiter_jobsBoardPosts/{postId}            # Links to jobOrderId (optional)
├── recruiter_applications/{applicationId}       # Jobs board applications
├── recruiter_worksites/{worksiteId}             # Links to crm_companyId
├── recruiter_auditLogs/{logId}                  # Audit trail
└── events/{eventId}                             # Event bus for data consistency
```

## 📊 **Data Models & Schemas**

### **Base Schema (All Entities)**
```typescript
interface BaseRecruiterEntity {
  tenantId: string; // REQUIRED - tenant isolation
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
  searchKeywords: string[]; // AI-searchable keywords
  status: string;
  tags: string[]; // User-defined tags
  notes: string; // Rich text notes
  attachments: string[]; // Document URLs
  aiInsights?: {
    lastAnalyzed: number;
    confidence: number;
    suggestions: string[];
    riskFactors: string[];
  };
}
```

### **1. Recruiter Client Extension** (`/tenants/{tenantId}/recruiter_clients/{crm_companyId}`)
```typescript
interface RecruiterClientExtension extends BaseRecruiterEntity {
  // Canonical Reference
  crmCompanyId: string; // REQUIRED - References canonical CRM company
  
  // Recruiter-Specific Fields Only (no duplication of CRM data)
  clientTier: 'A' | 'B' | 'C' | 'D';
  
  // Safety & Compliance
  safetyRequirements: string[];
  onboardingPacketId?: string;
  docTemplates: {
    i9: string;
    w4: string;
    nda?: string;
    handbook?: string;
  };
  eeoTracking: boolean;
  
  // SLAs & Preferences
  slas: {
    fulfillmentDays: number;
    submittalHours: number;
    responseHours: number;
  };
  preferredChannels: ('SMS' | 'email' | 'app')[];
  
  // Recruiter Relationships
  worksiteIds: string[];
  jobOrderIds: string[];
  
  // Metrics (denormalized)
  metrics: {
    activeJobOrders: number;
    totalPlacements: number;
    avgTimeToFill: number;
    satisfactionScore: number;
    arRiskScore: number;
  };
  
  // Handoff Information
  handoffComplete: boolean;
  handoffDate?: number;
  sourceOpportunityIds: string[]; // CRM opportunities that created this client
}
```

### **2. Worksite** (`/tenants/{tenantId}/recruiter_worksites/{worksiteId}`)
```typescript
interface Worksite extends BaseRecruiterEntity {
  // Canonical Reference
  crmCompanyId: string; // REQUIRED - References canonical CRM company
  
  // Worksite Information
  label: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  geo: {
    lat: number;
    lng: number;
  };
  
  // Operations
  shiftPatterns: {
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    days: number[];
    breakMinutes: number;
  }[];
  supervisorContacts: {
    crmContactId: string; // References canonical CRM contact
    name: string; // Denormalized for performance
    phone: string;
    email: string;
    role: string;
  }[];
  
  // Technology
  timeclockMode: 'kiosk' | 'mobile_geofence' | 'badge' | 'manual';
  requiredPPE: string[];
  
  // Safety & Compliance
  safetyRequirements: string[];
  emergencyContacts: {
    name: string;
    phone: string;
    role: string;
  }[];
  
  // Metrics
  activeAssignments: number;
  incidentCount: number;
  lastIncidentDate?: number;
}
```

### **3. Job Order** (`/tenants/{tenantId}/recruiter_jobOrders/{jobOrderId}`)
```typescript
interface JobOrder extends BaseRecruiterEntity {
  // Canonical References
  crmCompanyId: string; // REQUIRED - References canonical CRM company
  crmDealId?: string; // Source CRM deal/opportunity
  worksiteId?: string;
  
  // Core Information
  title: string;
  roleCategory: string;
  openings: number;
  remainingOpenings: number; // Derived, updated atomically
  
  // Timeline
  startDate: string;
  endDate?: string;
  targetFillDate?: string;
  
  // Work Details
  shifts: {
    label: string;
    start: string;
    end: string;
    days: number[];
    breakMinutes: number;
    differential?: number;
  }[];
  
  // Compensation
  payRate: number;
  billRate?: number;
  markup?: number;
  otRules: {
    multiplier: number;
    threshold: number;
    cap?: number;
  };
  
  // Requirements
  backgroundCheck: {
    required: boolean;
    package?: string;
    vendor?: string;
  };
  drugTest: {
    required: boolean;
    panel?: string;
    vendor?: string;
  };
  language: string[];
  minExperience: number;
  certifications: string[];
  dressCode: string;
  
  // Operations
  priority: 'low' | 'medium' | 'high' | 'urgent';
  urgencyScore: number; // 0-100, AI-calculated
  recruiterOwnerId: string;
  teamIds: string[];
  
  // Jobs Board
  autoPostToJobsBoard: boolean;
  submittalLimit: number;
  internalOnly: boolean;
  allowOverfill: boolean;
  
  // Status & Lifecycle
  status: 'draft' | 'open' | 'interviewing' | 'offer' | 'partially_filled' | 'filled' | 'closed' | 'canceled';
  
  // Metrics (denormalized)
  metrics: {
    submittals: number;
    interviews: number;
    offers: number;
    placements: number;
    timeToFirstSubmittalHrs?: number;
    timeToFillDays?: number;
    jobAgingDays: number;
  };
}
```

### **4. Jobs Board Post** (`/tenants/{tenantId}/recruiter_jobsBoardPosts/{postId}`)
```typescript
interface JobsBoardPost extends BaseRecruiterEntity {
  // Post Configuration
  mode: 'linked' | 'evergreen';
  jobOrderId?: string; // For linked posts
  talentPoolKey?: string; // For evergreen posts
  
  // Content
  title: string;
  description: string; // Rich text
  location: string;
  geo?: {
    lat: number;
    lng: number;
  };
  payRange?: {
    min: number;
    max: number;
    period: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  };
  shifts: string[];
  benefits: string;
  
  // Visibility & Channels
  visibility: 'public' | 'private' | 'internal';
  channels: ('Companion' | 'PublicURL' | 'QR' | 'Indeed' | 'LinkedIn')[];
  
  // Application Process
  screeningQuestions: {
    id: string;
    question: string;
    type: 'text' | 'yesno' | 'multiselect' | 'number' | 'file';
    required: boolean;
    options?: string[];
  }[];
  autoReplyTemplateId?: string;
  requireResume: boolean;
  requireCerts: string[];
  applyLimit: number; // Per candidate
  
  // Compliance
  eeoDisclosure: boolean;
  equalPayDisclosure?: boolean;
  privacyLink?: string;
  applicationConsent: boolean;
  
  // Status
  status: 'draft' | 'posted' | 'paused' | 'closed';
  
  // Metrics
  metrics: {
    views: number;
    applications: number;
    conversionRate: number;
    sourceBreakdown: Record<string, number>;
  };
}
```

### **5. Application** (`/tenants/{tenantId}/recruiter_applications/{applicationId}`)
```typescript
interface Application extends BaseRecruiterEntity {
  // Application Details
  mode: 'jobOrder' | 'evergreen';
  jobOrderId?: string;
  postId: string;
  
  // Applicant Information
  candidateId?: string; // If existing candidate
  externalApplicant?: {
    name: string;
    email: string;
    phone: string;
    resumeUrl?: string;
  };
  
  // Application Data
  resumeUrl?: string;
  workAuth: 'citizen' | 'permanent_resident' | 'work_visa' | 'other';
  answers: {
    questionId: string;
    answer: string;
  }[];
  
  // Source Tracking
  source: 'QR' | 'URL' | 'referral' | 'Companion' | 'Indeed' | 'LinkedIn';
  utm: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
  referralCode?: string;
  
  // Status
  status: 'new' | 'screened' | 'rejected' | 'advanced' | 'hired' | 'withdrawn' | 'duplicate';
  
  // AI Analysis
  aiScore?: number; // 0-100
  aiRecommendations?: string[];
  duplicateCheck?: {
    isDuplicate: boolean;
    duplicateCandidateId?: string;
    confidence: number;
  };
}
```

### **6. Candidate** (`/tenants/{tenantId}/recruiter_candidates/{candidateId}`)
```typescript
interface Candidate extends BaseRecruiterEntity {
  // Personal Information
  name: string;
  dob?: string;
  phones: {
    number: string;
    type: 'mobile' | 'home' | 'work';
    primary: boolean;
  }[];
  emails: {
    email: string;
    primary: boolean;
  }[];
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  geo?: {
    lat: number;
    lng: number;
  };
  
  // Work Authorization
  workAuth: 'citizen' | 'permanent_resident' | 'work_visa' | 'other';
  languages: string[];
  rightToWorkDocs: {
    type: string;
    url: string;
    expirationDate?: string;
  }[];
  
  // Emergency Contact
  emergencyContact: {
    name: string;
    relationship: string;
    phone: string;
    email?: string;
  };
  
  // Professional Profile
  resumeUrl?: string;
  parsedSkills: string[];
  certifications: {
    name: string;
    issuingOrg: string;
    issueDate: string;
    expirationDate?: string;
    url?: string;
  }[];
  licenses: {
    type: string;
    number: string;
    state: string;
    expirationDate?: string;
  }[];
  equipment: string[]; // e.g., forklift types
  preferences: {
    shift: 'day' | 'night' | 'swing' | 'any';
    travel: boolean;
    minPay: number;
    maxCommute: number;
  };
  traits: string[]; // AI-extracted personality traits
  
  // Status & Lifecycle
  status: 'applicant' | 'active_employee' | 'inactive' | 'do_not_hire';
  
  // Compliance
  i9Status: 'pending' | 'completed' | 'expired';
  bgcStatus: 'pending' | 'passed' | 'failed' | 'expired';
  drugStatus: 'pending' | 'passed' | 'failed' | 'expired';
  docExpirations: {
    type: string;
    expirationDate: string;
    daysUntilExpiry: number;
  }[];
  trainingCompleted: {
    course: string;
    completedDate: string;
    expirationDate?: string;
  }[];
  
  // HRX Integration
  companionUserId?: string;
  notificationPrefs: {
    email: boolean;
    sms: boolean;
    push: boolean;
  };
  
  // Metrics
  metrics: {
    totalApplications: number;
    totalSubmittals: number;
    totalInterviews: number;
    totalOffers: number;
    totalPlacements: number;
    avgTimeToPlace: number;
    reliabilityScore: number;
  };
}
```

### **7. Submittal** (`/tenants/{tenantId}/recruiter_submittals/{submittalId}`)
```typescript
interface Submittal extends BaseRecruiterEntity {
  // Core Information
  jobOrderId: string;
  candidateId: string;
  
  // Submission Details
  resumeSnapshotUrl: string;
  summary: string;
  payExpectation: number;
  availability: {
    startDate: string;
    immediate: boolean;
    noticePeriod?: number;
  };
  notesToClient: string;
  attachments: string[];
  
  // Submitter Information
  submittedBy: string;
  submittedAt: number;
  
  // Client Feedback
  clientFeedback: {
    status: 'review' | 'declined' | 'interview_request' | 'offer';
    rating?: number; // 1-5 stars
    comments?: string;
    feedbackDate?: number;
    feedbackBy?: string;
  };
  
  // Status
  status: 'submitted' | 'reviewed' | 'interview_scheduled' | 'offer_made' | 'placed' | 'rejected';
  
  // Metrics
  timeToResponse?: number; // Hours
  timeToInterview?: number; // Hours
  timeToOffer?: number; // Hours
}
```

### **8. Interview** (`/tenants/{tenantId}/recruiter_interviews/{interviewId}`)
```typescript
interface Interview extends BaseRecruiterEntity {
  // Core Information
  jobOrderId: string;
  candidateId: string;
  clientContactId: string;
  
  // Interview Details
  type: 'phone' | 'video' | 'onsite' | 'panel';
  when: string;
  timezone: string;
  location?: string;
  videoLink?: string;
  
  // Participants
  panel: {
    contactId: string;
    name: string;
    role: string;
    email: string;
  }[];
  
  // Outcome
  outcome: 'pending' | 'advance' | 'reject' | 'reschedule';
  scorecards: {
    interviewerId: string;
    interviewerName: string;
    scores: {
      category: string;
      score: number; // 1-5
      comments: string;
    }[];
    overallScore: number;
    recommendation: 'hire' | 'maybe' | 'no_hire';
  }[];
  
  // Follow-up
  nextSteps?: string;
  followUpDate?: string;
  
  // Reminders
  reminders: {
    type: 'email' | 'sms' | 'push';
    sent: boolean;
    sentAt?: number;
    recipient: string;
  }[];
}
```

### **9. Offer** (`/tenants/{tenantId}/recruiter_offers/{offerId}`)
```typescript
interface Offer extends BaseRecruiterEntity {
  // Core Information
  jobOrderId: string;
  candidateId: string;
  
  // Offer Details
  payRate: number;
  startDate: string;
  shift: string;
  employmentType: 'temp' | 'temp_to_hire' | 'direct';
  
  // Contingencies
  contingencies: {
    backgroundCheck: boolean;
    drugTest: boolean;
    eVerify: boolean;
    other?: string[];
  };
  
  // Timeline
  expiresAt: string;
  state: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
  
  // Communication
  offerLetterUrl?: string;
  sentAt?: number;
  sentBy?: string;
  respondedAt?: number;
  responseNotes?: string;
  
  // Metrics
  timeToAccept?: number; // Hours
  timeToStart?: number; // Days
}
```

### **10. Placement** (`/tenants/{tenantId}/recruiter_placements/{placementId}`)
```typescript
interface Placement extends BaseRecruiterEntity {
  // Core Information
  jobOrderId: string;
  candidateId: string; // Becomes employeeId
  clientId: string;
  worksiteId: string;
  
  // Assignment Details
  startDate: string;
  endDate?: string;
  ratePlan: {
    payRate: number;
    billRate: number;
    otMultiplier: number;
    otThreshold: number;
  };
  
  // Assignment Management
  assignmentId?: string; // Link to scheduling/timesheets
  backfillFor?: string; // Previous placement ID
  
  // Status & Performance
  status: 'active' | 'completed' | 'terminated' | 'no_show';
  incidentCount: number;
  performanceScore?: number; // 1-5
  
  // Metrics
  metrics: {
    daysOnAssignment: number;
    hoursWorked: number;
    incidents: number;
    clientSatisfaction?: number;
  };
  
  // Compliance
  complianceStatus: {
    i9Completed: boolean;
    bgcPassed: boolean;
    drugTestPassed: boolean;
    trainingCompleted: boolean;
  };
}
```

## 🔄 **CRM → Recruiter Handoff Process**

### **Event-Driven Architecture**
```typescript
// Event Document Structure
interface Event {
  id: string;
  type: string; // e.g., 'crm.handoff.requested', 'company.updated'
  tenantId: string;
  entityType: string; // 'deal', 'company', 'contact'
  entityId: string;
  payload: any;
  source: string; // 'crm', 'recruiter', 'system'
  ts: number;
  dedupeKey: string; // For idempotency
  processed: boolean;
  processedAt?: number;
  error?: string;
}

// Event Bus Collection: /tenants/{tenantId}/events/{eventId}
```

### **Trigger Events & Guardrails**
```typescript
// Primary Trigger: Opportunity Closed-Won with Guardrails
export const onOpportunityHandoff = onDocumentUpdated(
  'tenants/{tenantId}/crm_deals/{dealId}',
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    
    // Check if stage changed to Closed-Won AND readyForRecruiter = true
    if (before?.stage !== 'Closed-Won' && 
        after?.stage === 'Closed-Won' && 
        after?.readyForRecruiter === true) {
      
      // Validate guardrails
      const guardrails = await validateHandoffGuardrails(after);
      if (!guardrails.ready) {
        console.log(`Handoff guardrails not met: ${guardrails.reasons.join(', ')}`);
        return;
      }
      
      // Create handoff event
      await createEvent({
        type: 'crm.handoff.requested',
        tenantId: after.tenantId,
        entityType: 'deal',
        entityId: after.id,
        payload: { deal: after, guardrails },
        source: 'crm'
      });
    }
  }
);

// Guardrail Validation
async function validateHandoffGuardrails(deal: any) {
  const checks = {
    msaAccepted: deal.msaAccepted === true,
    creditApproved: deal.creditApproved === true,
    billingProfileComplete: deal.billingProfileComplete === true,
    primaryContactSet: deal.primaryContactId != null,
    worksiteCaptured: deal.worksiteId != null
  };
  
  return {
    ready: Object.values(checks).every(Boolean),
    reasons: Object.entries(checks)
      .filter(([_, passed]) => !passed)
      .map(([check, _]) => check)
  };
}
```

### **Event Processors**
```typescript
// Event Processor: Handoff Requested
export const processHandoffRequested = onDocumentCreated(
  'tenants/{tenantId}/events/{eventId}',
  async (event) => {
    const eventData = event.data?.data();
    if (eventData?.type !== 'crm.handoff.requested') return;
    
    try {
      await onOpportunityHandoff(eventData.payload.deal);
      
      // Mark event as processed
      await updateDoc(event.data?.ref, {
        processed: true,
        processedAt: Date.now()
      });
    } catch (error) {
      await updateDoc(event.data?.ref, {
        processed: true,
        processedAt: Date.now(),
        error: error.message
      });
    }
  }
);
```

### **Handoff Creation Process**
```typescript
async function onOpportunityHandoff(deal: any) {
  const { tenantId, companyId, id: dealId } = deal;
  
  // 1. Ensure CRM company exists and is complete
  await upsertCrmCompany(tenantId, companyId);
  
  // 2. Create/update recruiter client extension
  await upsertRecruiterClient(tenantId, companyId, deal);
  
  // 3. Create job orders linked to deal
  const jobOrders = await createJobOrdersFromDeal(tenantId, companyId, deal);
  
  // 4. Ensure contacts are linked
  await linkDealContacts(tenantId, dealId, deal.contactIds);
  
  // 5. Create kickoff tasks
  await createKickoffTasks(tenantId, deal, jobOrders);
  
  // 6. Mark handoff complete
  await markHandoffComplete(tenantId, companyId, dealId);
  
  // 7. Send notifications
  await sendHandoffNotifications(tenantId, deal, jobOrders);
}
```

### **Data Mapping & Canonical References**
```typescript
interface HandoffMapping {
  // CRM Company → Recruiter Client Extension (No Duplication)
  company: {
    crmCompanyId: company.id, // Reference only
    // No duplication of name, website, industry, etc.
    // Recruiter extension contains only recruiter-specific fields
  };
  
  // CRM Opportunity → Job Orders
  opportunity: {
    crmDealId: opportunity.id, // Reference to canonical deal
    crmCompanyId: opportunity.companyId, // Reference to canonical company
    title: opportunity.name,
    openings: opportunity.estimatedValue / 50000, // Rough estimate
    startDate: opportunity.closeDate,
    payRate: opportunity.estimatedValue / (opportunity.estimatedValue / 50000 * 2080),
    billRate: payRate * 1.4, // 40% markup
    requirements: opportunity.requirements
  };
  
  // CRM Contacts → References Only (No Duplication)
  contacts: opportunity.contactIds.map(contactId => ({
    crmContactId: contactId, // Reference to canonical contact
    // No duplication of contact data
  }));
}

// Write-Through Editing Pattern
interface WriteThroughEditing {
  // When editing company info in Recruiter
  updateCompanyInRecruiter: async (crmCompanyId: string, updates: any) => {
    // 1. Update canonical CRM company
    await updateDoc(doc(db, 'tenants', tenantId, 'crm_companies', crmCompanyId), updates);
    
    // 2. Create event for cache refresh
    await createEvent({
      type: 'company.updated',
      tenantId,
      entityType: 'company',
      entityId: crmCompanyId,
      payload: { updates },
      source: 'recruiter'
    });
  };
}
```

## 🤖 **AI-Powered Features**

### **1. Candidate-Job Matching Algorithm**
```typescript
interface CandidateJobScore {
  candidateId: string;
  jobOrderId: string;
  overallScore: number; // 0-100
  breakdown: {
    skillsMatch: number; // 35% weight
    certifications: number; // 15% weight
    distance: number; // 10% weight
    availability: number; // 15% weight
    payFit: number; // 10% weight
    workHistory: number; // 10% weight
    reliability: number; // 5% weight
  };
  recommendations: string[];
  riskFactors: string[];
}
```

### **2. Duplicate Detection**
- **Email + Phone + Name** exact matching
- **Resume Hash** comparison
- **Name Embedding** similarity (fuzzy matching)
- **Work History** pattern matching

### **3. AI Suggestions Engine**
```typescript
interface AISuggestion {
  type: 'submit_candidate' | 'follow_up' | 'post_job' | 'schedule_interview';
  priority: 'low' | 'medium' | 'high';
  confidence: number;
  description: string;
  actionData: any;
  estimatedImpact: string;
}
```

### **4. Predictive Analytics**
- **Time-to-Fill** predictions
- **Candidate Drop-off** risk assessment
- **Client Satisfaction** forecasting
- **Revenue Impact** modeling

## 🎨 **UI/UX Design Standards**

### **Layout Patterns (Mirroring CRM)**
```typescript
// Page Header Pattern
<Box sx={{ px: 3, py: 4 }}>
  <Typography variant="h6" fontWeight={700}>
    {pageTitle}
  </Typography>
  <Typography variant="subtitle2" color="text.secondary">
    {pageSubtitle}
  </Typography>
  <Stack direction="row" justifyContent="space-between" alignItems="center" mt={2} mb={3}>
    <Box>{filters}</Box>
    <Box>{actions}</Box>
  </Stack>
  <Divider sx={{ my: 2 }} />
</Box>
```

### **Component Standards**
- **Tables**: Sticky headers, 48px rows, compact density option
- **Cards**: 2xl radius, soft shadow, 16-24px padding
- **Chips**: Status colors, priority indicators, stage progression
- **Forms**: Inline validation, auto-save, keyboard shortcuts
- **Navigation**: Breadcrumbs, tabbed interfaces, quick actions

### **Color Palette**
```typescript
const recruiterColors = {
  // Status Colors
  draft: '#9CA3AF',
  open: '#3B82F6',
  interviewing: '#F59E0B',
  offer: '#8B5CF6',
  placed: '#10B981',
  closed: '#6B7280',
  
  // Priority Colors
  low: '#10B981',
  medium: '#F59E0B',
  high: '#EF4444',
  urgent: '#DC2626',
  
  // Stage Colors
  applied: '#3B82F6',
  screened: '#8B5CF6',
  submitted: '#F59E0B',
  interview: '#EC4899',
  offer: '#8B5CF6',
  hired: '#10B981'
};
```

## 🔐 **Security & Permissions**

### **Role-Based Access Control**
```typescript
interface RecruiterPermissions {
  // Recruiter
  recruiter: {
    candidates: 'CRUD';
    submittals: 'CRUD';
    interviews: 'CRUD';
    offers: 'CRUD';
    clients: 'R';
    jobOrders: 'CR';
    reports: 'R';
  };
  
  // Recruiting Manager
  recruitingManager: {
    candidates: 'CRUD';
    submittals: 'CRUD';
    interviews: 'CRUD';
    offers: 'CRUD';
    clients: 'CRUD';
    jobOrders: 'CRUD';
    slas: 'U';
    reports: 'CRUD';
  };
  
  // Sales
  sales: {
    candidates: 'R';
    submittals: 'R';
    interviews: 'R';
    offers: 'R';
    clients: 'R';
    jobOrders: 'R';
    tasks: 'CRUD';
    notes: 'CRUD';
  };
  
  // Client Manager
  clientManager: {
    candidates: 'R'; // Scoped to their clients
    submittals: 'R'; // Scoped to their clients
    interviews: 'CRUD'; // Scoped to their clients
    offers: 'R'; // Scoped to their clients
    clients: 'R'; // Scoped to their clients
    jobOrders: 'R'; // Scoped to their clients
    notes: 'CRUD';
  };
}
```

### **Firestore Security Rules**
```javascript
// Recruiter Collections
match /tenants/{tenantId}/recruiter_{collection}/{docId} {
  allow read: if isAuthenticated() && 
    (isAssignedToTenant(tenantId) || isHRX()) &&
    (hasRecruiterAccess() || isClientManagerForClient(resource.data.clientId));
  
  allow create: if isAuthenticated() && 
    isAssignedToTenant(tenantId) && 
    hasRecruiterAccess() &&
    request.resource.data.tenantId == tenantId;
  
  allow update: if isAuthenticated() && 
    isAssignedToTenant(tenantId) && 
    hasRecruiterAccess() &&
    resource.data.tenantId == tenantId;
  
  allow delete: if isAuthenticated() && 
    isAssignedToTenant(tenantId) && 
    (isRecruitingManager() || isHRX());
}
```

## 📈 **Analytics & KPIs**

### **Key Performance Indicators**
```typescript
interface RecruiterKPIs {
  // Operational Metrics
  openJobOrders: number;
  candidatesInProcess: number;
  interviewsThisWeek: number;
  placementsMTD: number;
  
  // Time Metrics
  avgTimeToFirstSubmittal: number; // Hours
  avgTimeToFill: number; // Days
  avgTimeToInterview: number; // Hours
  avgTimeToOffer: number; // Hours
  
  // Quality Metrics
  submittalsPerHire: number;
  interviewsPerHire: number;
  offersPerHire: number;
  candidateDropoutRate: number;
  
  // Financial Metrics
  placementRevenue: number;
  avgBillRate: number;
  avgMarkup: number;
  revenuePerRecruiter: number;
  
  // Client Metrics
  clientSatisfactionScore: number;
  repeatClientRate: number;
  clientRetentionRate: number;
  
  // Compliance Metrics
  i9CompletionRate: number;
  bgcCompletionRate: number;
  drugTestCompletionRate: number;
  expiringDocsCount: number;
}
```

### **Dashboard Widgets**
1. **To-Do Widget**: Tasks due today/overdue with quick actions
2. **Calendar Widget**: Interviews, start dates, compliance deadlines
3. **Key Metrics Widget**: Real-time KPI display
4. **AI Suggestions Widget**: Intelligent action recommendations
5. **Funnel Widget**: Application → Placement conversion tracking
6. **Hotlist Widget**: Favorited candidates ready to start

## 🔧 **Cloud Functions Architecture**

### **Event Bus Functions**
```typescript
// Event Creation & Processing
export const createEvent = onCall(...);
export const processEvents = onSchedule('every 1 minutes', ...);

// Event Processors
export const processHandoffRequested = onDocumentCreated(...);
export const processCompanyUpdated = onDocumentCreated(...);
export const processContactLinked = onDocumentCreated(...);
```

### **Handoff Functions**
```typescript
// Primary Handoff Trigger
export const onOpportunityHandoff = onDocumentUpdated(...);
export const validateHandoffGuardrails = onCall(...);

// Handoff Processors
export const upsertCrmCompany = onCall(...);
export const upsertRecruiterClient = onCall(...);
export const createJobOrdersFromDeal = onCall(...);
export const linkDealContacts = onCall(...);
export const createKickoffTasks = onCall(...);
export const markHandoffComplete = onCall(...);
export const sendHandoffNotifications = onCall(...);
```

### **Job Order Functions**
```typescript
export const onJobOrderOpen = onDocumentCreated(...);
export const updateJobOrderMetrics = onDocumentUpdated(...);
export const autoPostToJobsBoard = onCall(...);
```

### **Candidate Functions**
```typescript
export const scoreCandidateForJob = onCall(...);
export const detectDuplicates = onCall(...);
export const suggestNextActions = onCall(...);
```

### **Workflow Functions**
```typescript
export const createSubmittals = onCall(...);
export const scheduleInterview = onCall(...);
export const createOffer = onCall(...);
export const acceptOffer = onCall(...);
```

### **Compliance Functions**
```typescript
export const nightlyComplianceScan = onSchedule(...);
export const checkDocumentExpirations = onCall(...);
```

### **Jobs Board Functions**
```typescript
export const createJobsBoardPost = onCall(...);
export const applyToPost = onCall(...);
export const convertApplicationToCandidate = onCall(...);
```

### **Write-Through Functions**
```typescript
export const updateCompanyFromRecruiter = onCall(...);
export const updateContactFromRecruiter = onCall(...);
export const refreshRecruiterCaches = onCall(...);
```

### **Function Hardening**
```typescript
// Rate Limiting
const rateLimit = {
  maxCalls: 100,
  periodSeconds: 60
};

// Idempotency
const idempotencyKey = `${functionName}:${tenantId}:${entityId}:${action}`;

// Error Handling
try {
  // Function logic
} catch (error) {
  console.error(`Function error: ${error.message}`);
  await logToAILogs({
    tenantId,
    function: functionName,
    error: error.message,
    stack: error.stack,
    context: { /* relevant data */ }
  });
  throw new Error(`Function failed: ${error.message}`);
}
```

## 🚀 **Implementation Phases**

### **Phase 1: Foundation & Event Bus (Week 1)**
- [ ] Route scaffolding and navigation (`/recruiter/*`)
- [ ] Firestore rules with tenant enforcement
- [ ] Event bus architecture (`/events` collection)
- [ ] Canonical data strategy implementation
- [ ] Base schemas with `crm_companyId` references

### **Phase 2: Handoff System (Week 2)**
- [ ] Event-driven handoff triggers with guardrails
- [ ] `onOpportunityHandoff` function with validation
- [ ] Event processors for handoff events
- [ ] Write-through editing for company/contact updates
- [ ] Job Orders with canonical references

### **Phase 3: Core Recruiter Features (Week 3)**
- [ ] Recruiter client extensions (no duplication)
- [ ] Job Orders list and detail views
- [ ] Basic submittal workflow
- [ ] Worksite management with CRM references

### **Phase 4: Candidates & Pipeline (Week 4)**
- [ ] Candidate management system
- [ ] Application intake and parsing
- [ ] Pipeline board with drag-and-drop
- [ ] AI scoring and matching

### **Phase 5: Jobs Board & Workflows (Week 5)**
- [ ] Linked and evergreen posts
- [ ] Public application page
- [ ] Application routing system
- [ ] Interview scheduling and scorecards
- [ ] Offer creation and acceptance

### **Phase 6: Completion & Analytics (Week 6)**
- [ ] Placement tracking
- [ ] Compliance monitoring
- [ ] Dashboard widgets
- [ ] AI suggestions engine
- [ ] Comprehensive reporting
- [ ] E2E testing and validation

## 🎯 **Competitive Advantages**

### **Beyond Bullhorn & Leading ATS**
1. **Seamless CRM Integration**: Zero data re-entry from sales to fulfillment
2. **AI-First Design**: Every interaction enhanced with intelligent suggestions
3. **Multi-Tenant Architecture**: True isolation with optional agency relationships
4. **Compliance Excellence**: Built-in EEO/OFCCP support with document tracking
5. **Operational Speed**: One-click actions and aggressive keyboard navigation
6. **Extensible Platform**: Support for both traditional and modern recruiting models
7. **Real-time Analytics**: Live dashboards with predictive insights
8. **Mobile-First**: Companion app integration for candidates and employees

### **Unique Features**
- **Deal Intelligence**: AI-powered deal analysis and risk assessment
- **Evergreen Talent Pools**: Continuous candidate sourcing and matching
- **Predictive Compliance**: Proactive document expiration monitoring
- **Client Portal**: Real-time feedback and collaboration
- **Revenue Optimization**: AI-driven pricing and markup suggestions
- **Performance Tracking**: Comprehensive metrics and benchmarking

## 📋 **Testing Strategy**

### **Unit Tests**
- Schema validation with canonical references
- Function logic with event processing
- Component rendering with CRM data integration
- Permission checks for multi-tenant access

### **Integration Tests**
- CRM → Recruiter handoff with guardrails
- Event bus processing and idempotency
- Write-through editing from Recruiter to CRM
- Jobs Board application flow
- Interview scheduling workflow
- Offer acceptance process

### **E2E Tests**
- Complete placement lifecycle with canonical data
- Multi-tenant isolation and data separation
- Permission enforcement across roles
- Event processing and cache refresh
- Performance benchmarks with large datasets

### **Load Tests**
- Concurrent user simulation
- Large dataset handling
- Real-time update performance
- Function execution limits
- Event processing throughput

## ✅ **Acceptance Criteria**

### **Core Functionality**
- [ ] Closing an opportunity with guardrails satisfied → creates recruiter client extension + job orders
- [ ] Recruiter UI references canonical `/crm_companies` and `/crm_contacts`
- [ ] Editing company/contact info in Recruiter updates canonical docs in CRM
- [ ] No duplicated company/contact records in Recruiter; only references
- [ ] Events processed idempotently, caches refreshed

### **Data Integrity**
- [ ] All recruiter entities include `tenantId` and canonical references
- [ ] Event bus maintains data consistency across CRM and Recruiter
- [ ] Write-through editing preserves single source of truth
- [ ] Handoff guardrails prevent incomplete data migration

### **Performance & Security**
- [ ] Multi-tenant isolation enforced in all queries
- [ ] Event processing handles high-volume scenarios
- [ ] Real-time updates maintain responsiveness
- [ ] Permission checks prevent unauthorized access

## 🤔 **Open Questions & Decisions**

### **Data Management**
- **Q**: Should recruiters be able to add/edit contacts directly in Recruiter (write-through to CRM), or lock that to CRM users only?
- **A**: Allow write-through editing with proper validation and audit trails

- **Q**: How to manage conflicting edits between CRM and Recruiter? Event versioning or last-write-wins?
- **A**: Implement optimistic locking with conflict resolution and user notification

### **Event Processing**
- **Q**: Should events be processed synchronously or asynchronously?
- **A**: Asynchronous processing with retry logic and dead letter queues

- **Q**: How to handle event processing failures?
- **A**: Implement exponential backoff, manual retry mechanisms, and alerting

### **UI/UX Decisions**
- **Q**: Should company/contact editing be inline or in side-panels?
- **A**: Side-panels for complex editing, inline for simple updates

- **Q**: How to indicate canonical vs. recruiter-specific data in UI?
- **A**: Visual indicators and tooltips showing data source

## 📁 **File Structure**

### **Frontend Structure**
```
src/
├── modules/recruiter/
│   ├── index.ts
│   ├── routes.tsx
│   ├── components/
│   │   ├── Dashboard/
│   │   │   ├── RecruiterDashboard.tsx
│   │   │   └── widgets/
│   │   │       ├── TodoWidget.tsx
│   │   │       ├── CalendarWidget.tsx
│   │   │       ├── KeyMetricsWidget.tsx
│   │   │       ├── AISuggestionsWidget.tsx
│   │   │       ├── FunnelWidget.tsx
│   │   │       └── HotlistWidget.tsx
│   │   ├── JobOrders/
│   │   │   ├── JobOrdersTable.tsx
│   │   │   ├── JobOrderDetail.tsx
│   │   │   ├── JobOrderHeader.tsx
│   │   │   └── tabs/
│   │   │       ├── JobOrderOverview.tsx
│   │   │       ├── JobOrderCandidates.tsx
│   │   │       ├── JobOrderInterviews.tsx
│   │   │       ├── JobOrderOffers.tsx
│   │   │       └── JobOrderActivity.tsx
│   │   ├── Clients/
│   │   │   ├── ClientsTable.tsx
│   │   │   ├── ClientDetail.tsx
│   │   │   └── ClientExtensionPanel.tsx
│   │   ├── Candidates/
│   │   │   ├── CandidatesTable.tsx
│   │   │   ├── CandidateDetail.tsx
│   │   │   └── PipelineBoard.tsx
│   │   ├── JobsBoard/
│   │   │   ├── PostsTable.tsx
│   │   │   ├── PostEditor.tsx
│   │   │   └── PublicApplyPage.tsx
│   │   └── Shared/
│   │       ├── StatusChip.tsx
│   │       ├── CanonicalDataIndicator.tsx
│   │       └── WriteThroughEditor.tsx
│   ├── api/
│   │   ├── events.ts
│   │   ├── handoff.ts
│   │   ├── jobOrders.ts
│   │   ├── candidates.ts
│   │   └── jobsBoard.ts
│   ├── hooks/
│   │   ├── useCanonicalData.ts
│   │   ├── useEventProcessing.ts
│   │   └── useWriteThroughEditing.ts
│   └── types/
│       ├── recruiter.types.ts
│       └── zod/
│           ├── jobOrder.z.ts
│           ├── recruiterClient.z.ts
│           └── events.z.ts
```

### **Functions Structure**
```
functions/src/recruiter/
├── events/
│   ├── createEvent.ts
│   ├── processEvents.ts
│   └── processors/
│       ├── handoffRequested.ts
│       ├── companyUpdated.ts
│       └── contactLinked.ts
├── handoff/
│   ├── onOpportunityHandoff.ts
│   ├── validateGuardrails.ts
│   ├── upsertCrmCompany.ts
│   ├── upsertRecruiterClient.ts
│   └── createJobOrdersFromDeal.ts
├── workflow/
│   ├── createSubmittals.ts
│   ├── scheduleInterview.ts
│   ├── createOffer.ts
│   └── acceptOffer.ts
├── writeThrough/
│   ├── updateCompanyFromRecruiter.ts
│   ├── updateContactFromRecruiter.ts
│   └── refreshCaches.ts
└── utils/
    ├── eventBus.ts
    ├── canonicalData.ts
    └── validation.ts
```

## 🎯 **Definition of Done (Phase 1)**

### **Core Functionality**
- [ ] **Event Bus**: `/events` collection with idempotent processors
- [ ] **Handoff System**: CRM → Recruiter handoff with guardrails working
- [ ] **Canonical Data**: All recruiter entities reference CRM companies/contacts
- [ ] **Write-Through Editing**: Company/contact updates flow from Recruiter to CRM
- [ ] **Multi-Tenant Isolation**: Complete tenant separation enforced

### **UI/UX**
- [ ] **Recruiter Dashboard**: To-Dos, Calendar, Key Metrics, AI Suggestions
- [ ] **Navigation**: `/recruiter/*` routes with proper guards
- [ ] **Tabs Operational**: Job Orders, Clients, Candidates, Jobs Board
- [ ] **Canonical Indicators**: Visual indicators for CRM vs. recruiter data

### **Workflows**
- [ ] **Jobs Board**: Linked + evergreen posts with applications
- [ ] **Pipeline**: Application → Submittal → Interview → Offer → Placement
- [ ] **AI Integration**: Candidate scoring and suggestions
- [ ] **Compliance**: Document tracking and expiration monitoring

### **Quality Assurance**
- [ ] **Testing**: Unit, integration, and E2E tests passing
- [ ] **Performance**: Handles concurrent users and large datasets
- [ ] **Security**: Permission checks and tenant isolation verified
- [ ] **Documentation**: Complete API and user documentation

## 🔮 **Future Enhancements**

### **Phase 2 Features**
- **Advanced AI**: Machine learning for candidate matching
- **Video Interviews**: Built-in video conferencing
- **Background Check Integration**: Direct vendor APIs
- **Payroll Integration**: Seamless timesheet and payment processing
- **Mobile App**: Native iOS/Android applications
- **Advanced Analytics**: Predictive modeling and insights

### **Phase 3 Features**
- **AI Chatbot**: Candidate and client support
- **Blockchain Verification**: Immutable credential verification
- **Advanced Compliance**: Automated regulatory reporting
- **Market Intelligence**: Competitive analysis and pricing
- **Global Expansion**: Multi-language and multi-currency support

---

This specification provides a comprehensive foundation for building the most powerful ATS in the market, leveraging our existing architecture while adding cutting-edge features that go beyond traditional recruiting software. The canonical data strategy ensures single points of truth throughout the application, while the event-driven architecture maintains data consistency and enables scalable, reliable operations.
