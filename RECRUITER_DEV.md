# HRX Recruiter — Development Plan

## 🎯 **Development Overview**

This document serves as the development blueprint for implementing the HRX Recruiter module. It breaks down the specification into actionable phases with detailed implementation guidance, testing strategies, and architectural considerations.

## 📋 **Development Phases**

### **Phase 1: Foundation & Event Bus (Week 1)** ✅ **COMPLETED**

#### **1.1 Project Setup & Architecture** ✅ **COMPLETED**
- **Duration**: 2 days
- **Priority**: Critical
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Create `/src/modules/recruiter/` directory structure
- [x] Set up routing with `/recruiter/*` paths
- [x] Add Recruiter to main navigation menu
- [x] Implement route guards for recruiter access
- [x] Create base TypeScript interfaces and Zod schemas

**Key Files Created:**
```
src/modules/recruiter/
├── index.ts                    # Module entry point ✅
├── routes.tsx                  # Route definitions ✅
├── types/
│   ├── recruiter.types.ts      # Base interfaces ✅
│   └── zod/
│       ├── base.z.ts           # Base schemas ✅
│       └── entities.z.ts       # Entity schemas ✅
```

**Implementation Notes:**
- Route guards should check for `modules.recruiter=true` in tenant config
- Base schemas must include `tenantId` validation
- Use existing CRM navigation patterns for consistency

#### **1.2 Event Bus Architecture** ✅ **COMPLETED**
- **Duration**: 3 days
- **Priority**: Critical
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Create `/events` collection structure
- [x] Implement event creation and processing functions
- [x] Set up event processors for handoff events
- [x] Create event deduplication logic
- [x] Implement event error handling and retry logic

**Functions Built:**
```typescript
// Event Creation ✅
export const createEvent = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Creates event documents with deduplication
});

// Event Processing ✅
export const processEvents = onSchedule('every 1 minutes', async (event) => {
  // Processes unprocessed events with retry logic
});

// Event Processors ✅
export const processHandoffRequested = onDocumentCreated(
  'tenants/{tenantId}/events/{eventId}',
  async (event) => {
    // Handles crm.handoff.requested events
  }
);
```

**Implementation Notes:**
- Events must be idempotent with `dedupeKey` field ✅
- Use exponential backoff for retry logic ✅
- Implement dead letter queue for failed events ✅
- Events should include `processed`, `processedAt`, and `error` fields ✅

#### **1.3 Firestore Rules & Indexes** ✅ **COMPLETED**
- **Duration**: 1 day
- **Priority**: Critical
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Add recruiter collection rules to `firestore.rules`
- [x] Create composite indexes for recruiter queries
- [x] Test tenant isolation enforcement
- [x] Validate permission checks

**Required Indexes Added:**
```json
{
  "collectionGroup": "recruiter_jobOrders",
  "queryScope": "COLLECTION",
  "fields": [
    {"fieldPath": "tenantId", "order": "ASCENDING"},
    {"fieldPath": "status", "order": "ASCENDING"},
    {"fieldPath": "priority", "order": "DESCENDING"}
  ]
}
```

**Phase 1 Completion Summary:**
- ✅ Frontend module structure created with types, schemas, and routing
- ✅ Event bus functions implemented (createEvent, processEvents, cleanupOldEvents)
- ✅ Event processors stubbed for all major event types
- ✅ Firestore rules and indexes added for recruiter collections
- ✅ TypeScript compilation successful
- ✅ Functions deployed and ready for Phase 2

### **Phase 2: Handoff System (Week 2)** ✅ **COMPLETED**

#### **2.1 Handoff Trigger & Guardrails** ✅ **COMPLETED**
- **Duration**: 2 days
- **Priority**: Critical
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Implement `onOpportunityHandoff` trigger function
- [x] Create guardrail validation logic
- [x] Add handoff readiness checks to CRM deals
- [x] Implement handoff event creation

**Functions Built:**
```typescript
// Primary Handoff Trigger ✅
export const onOpportunityHandoff = onDocumentUpdated(
  'tenants/{tenantId}/crm_deals/{dealId}',
  async (event) => {
    // Triggers when deal stage = Closed-Won AND readyForRecruiter = true
  }
);

// Guardrail Validation ✅
export const validateHandoffGuardrails = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Validates MSA, credit, billing, contacts, worksite
});
```

**Guardrail Logic:**
```typescript
interface HandoffGuardrails {
  msaAccepted: boolean;           // Master Service Agreement signed
  creditApproved: boolean;        // Credit check passed
  billingProfileComplete: boolean; // Billing information complete
  primaryContactSet: boolean;     // Primary contact assigned
  worksiteCaptured: boolean;      // Worksite information provided
  allRequirementsMet: boolean;    // All guardrails passed
  missingRequirements: string[];  // List of missing requirements
}
```

#### **2.2 Canonical Data Integration** ✅ **COMPLETED**
- **Duration**: 2 days
- **Priority**: Critical
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Implement `upsertCrmCompany` function
- [x] Create `upsertRecruiterClient` extension logic
- [x] Build `createJobOrdersFromDeal` function
- [x] Implement contact linking logic

**Functions Built:**
```typescript
// CRM Company Management ✅
export const upsertCrmCompany = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Ensures CRM company exists and is complete
});

// Recruiter Client Extension ✅
export const upsertRecruiterClient = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates/updates recruiter client extension
});

// Job Order Creation ✅
export const createJobOrdersFromDeal = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates job orders from deal information
});
```

**Implementation Notes:**
- Recruiter clients use `crm_companyId` as document ID ✅
- Job orders must include `crmCompanyId` and `crmDealId` references ✅
- Use transactions for atomic operations ✅
- Implement rollback logic for failed handoffs ✅

#### **2.3 Write-Through Editing** ✅ **COMPLETED**
- **Duration**: 1 day
- **Priority**: High
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Create `updateCompanyFromRecruiter` function
- [x] Implement `updateContactFromRecruiter` function
- [x] Build cache refresh logic
- [x] Add conflict resolution

**Functions Built:**
```typescript
// Write-Through Updates ✅
export const updateCompanyFromRecruiter = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Updates canonical CRM company from recruiter
});

// Contact Updates ✅
export const updateContactFromRecruiter = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Updates canonical CRM contact from recruiter
});

// Cache Refresh ✅
export const refreshRecruiterCaches = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Refreshes recruiter caches after CRM updates
});
```

**Phase 2 Completion Summary:**
- ✅ Handoff trigger function implemented with event creation
- ✅ Guardrail validation with comprehensive checks (MSA, credit, billing, contacts, worksite)
- ✅ Canonical data integration with CRM company upsert
- ✅ Recruiter client extension creation with proper references
- ✅ Job order creation from deal information with batch processing
- ✅ Write-through editing for companies and contacts
- ✅ Cache refresh system for maintaining data consistency
- ✅ Event-driven architecture for all updates
- ✅ TypeScript compilation successful
- ✅ All functions exported and ready for deployment

**Phase 2 Architecture Achievements:**
- **Event-Driven Handoff**: Complete CRM → Recruiter handoff with event bus
- **Canonical Data Strategy**: CRM remains source of truth, recruiter references via IDs
- **Write-Through Editing**: Recruiter can update CRM data with event notifications
- **Cache Management**: Automatic cache refresh to maintain consistency
- **Comprehensive Validation**: All guardrails checked before handoff
- **Batch Processing**: Efficient operations with atomic transactions

### **Phase 3: Core Recruiter Features (Week 3)** 🔄 **IN PROGRESS**

#### **3.1 Job Orders Management** ✅ **COMPLETED**
- **Duration**: 2 days
- **Priority**: High
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Create JobOrdersTable component
- [x] Implement JobOrderDetail page
- [x] Build job order CRUD operations
- [x] Add filtering and search functionality

**Functions Built:**
```typescript
// Job Order Operations ✅
export const getJobOrders = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Retrieves job orders with filtering and pagination
});

export const updateJobOrder = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Updates job order with validation and business rules
});

export const createJobOrder = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates new job order with validation
});
```

**Features Implemented:**
- ✅ **Advanced Filtering**: Status, priority, recruiter owner, company, worksite
- ✅ **Search Functionality**: Full-text search across title, role category, notes
- ✅ **Pagination**: Configurable limit/offset with total count
- ✅ **Sorting**: Multiple sort fields with ascending/descending order
- ✅ **Business Rules Validation**: Bill rate > pay rate, openings validation
- ✅ **Event-Driven Updates**: Automatic event creation for all changes
- ✅ **Jobs Board Integration**: Auto-post to jobs board when enabled
- ✅ **Completion Logic**: Automatic application status updates when job order is filled/closed

**Phase 3.1 Completion Summary:**
- ✅ Job order retrieval with comprehensive filtering and search
- ✅ Job order creation with validation and business rules
- ✅ Job order updates with conflict resolution and completion logic
- ✅ Integration with recruiter clients and jobs board
- ✅ Event-driven architecture for all operations
- ✅ TypeScript compilation successful
- ✅ All functions exported and ready for deployment

#### **3.2 Candidate Pipeline Management** ✅ **COMPLETED**
- **Duration**: 2 days
- **Priority**: High
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Create candidate CRUD operations
- [x] Implement application tracking
- [x] Build interview scheduling
- [x] Add candidate scoring

**Functions Built:**
```typescript
// Candidate Operations ✅
export const getCandidates = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Retrieves candidates with filtering and pagination
});

export const createCandidate = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates new candidate profile with scoring
});

export const updateCandidate = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Updates candidate with validation and scoring
});
```

**Features Implemented:**
- ✅ **Advanced Filtering**: Status, job order, recruiter owner, search
- ✅ **Search Functionality**: Full-text search across name, email, title, skills
- ✅ **Pagination**: Configurable limit/offset with total count
- ✅ **Sorting**: Multiple sort fields with ascending/descending order
- ✅ **Candidate Scoring**: Automatic score calculation based on profile completeness
- ✅ **Duplicate Prevention**: Email uniqueness validation
- ✅ **Event-Driven Updates**: Automatic event creation for all changes
- ✅ **Hiring Workflow**: Automatic application status updates when candidate is hired
- ✅ **Profile Completeness**: Comprehensive candidate profile management

**Phase 3.2 Completion Summary:**
- ✅ Candidate retrieval with comprehensive filtering and search
- ✅ Candidate creation with validation and automatic scoring
- ✅ Candidate updates with conflict resolution and hiring workflow
- ✅ Integration with applications and job orders
- ✅ Event-driven architecture for all operations
- ✅ TypeScript compilation successful
- ✅ All functions exported and ready for deployment

**Phase 3.3 Completion Summary:**
- ✅ Application retrieval with comprehensive filtering and search
- ✅ Application creation with AI analysis and duplicate detection
- ✅ Application status updates with validated workflow transitions
- ✅ External applicant auto-conversion to candidate profiles
- ✅ Interview and placement auto-creation from status changes
- ✅ Event-driven architecture for all operations
- ✅ TypeScript compilation successful
- ✅ All functions exported and ready for deployment

**Phase 3 Overall Completion Summary:**
- ✅ **Job Orders Management**: Complete CRUD with business rules and jobs board integration
- ✅ **Candidate Pipeline Management**: Full candidate lifecycle with scoring and hiring workflow
- ✅ **Application Management**: Comprehensive application handling with AI analysis and status workflows
- ✅ **Companion Integration**: Enhanced candidate functions with Companion user linking and notification preferences
- ✅ **Event-Driven Architecture**: All operations create events for system integration
- ✅ **TypeScript Compilation**: All functions compile successfully
- ✅ **Ready for Deployment**: All functions exported and ready for production use

**Phase 4 Overall Completion Summary:**
- ✅ **Candidate Management**: Advanced filtering, search, pagination, and Companion integration
- ✅ **Pipeline Board**: Kanban-style drag-and-drop with stage validation and automatic workflows
- ✅ **AI Integration**: Comprehensive candidate-job scoring and duplicate detection
- ✅ **Pipeline Metrics**: Real-time conversion rates and statistics
- ✅ **Stage Workflows**: Automatic interview/offer/placement creation from stage changes
- ✅ **AI Scoring Algorithm**: 7-factor scoring with recommendations and risk analysis
- ✅ **Duplicate Detection**: Multiple detection methods with confidence scoring
- ✅ **Event-Driven Architecture**: All operations create events for system integration
- ✅ **TypeScript Compilation**: All functions compile successfully
- ✅ **Ready for Deployment**: All functions exported and ready for production use

**Phase 5 Overall Completion Summary:**
- ✅ **Jobs Board Posts**: Linked and evergreen posts with comprehensive management
- ✅ **Public Application System**: Complete application flow with validation and candidate creation
- ✅ **Interview Scheduling**: Multi-interviewer support with automated workflows
- ✅ **Interview Scorecards**: Structured evaluation with automated decision making
- ✅ **Status Workflows**: Automatic candidate and application status updates
- ✅ **Metrics Tracking**: Views, applications, conversion rates for posts
- ✅ **Channel Distribution**: Multiple posting channels (Companion, PublicURL, QR, Indeed, LinkedIn)
- ✅ **Event-Driven Architecture**: All operations create events for system integration
- ✅ **TypeScript Compilation**: All functions compile successfully
- ✅ **Ready for Deployment**: All functions exported and ready for production use

#### **3.3 Application Management** ✅ **COMPLETED**
- **Duration**: 2 days
- **Priority**: High
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Create application CRUD operations
- [x] Implement application status workflow
- [x] Build interview scheduling
- [x] Add application scoring

**Functions Built:**
```typescript
// Application Operations ✅
export const getApplications = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Retrieves applications with filtering and pagination
});

export const createApplication = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Creates new application with AI analysis
});

export const updateApplicationStatus = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Updates application status with workflow
});
```

**Features Implemented:**
- ✅ **Advanced Filtering**: Status, job order, candidate, post, source, recruiter
- ✅ **Search Functionality**: Full-text search across applicant data and answers
- ✅ **Pagination**: Configurable limit/offset with total count
- ✅ **Sorting**: Multiple sort fields with ascending/descending order
- ✅ **AI Analysis**: Automatic scoring and recommendations for applications
- ✅ **Duplicate Detection**: Email and phone-based duplicate checking
- ✅ **Status Workflow**: Validated status transitions with automatic actions
- ✅ **External Applicants**: Auto-creation of candidate profiles from applications
- ✅ **Event-Driven Updates**: Automatic event creation for all changes
- ✅ **Interview Integration**: Automatic interview creation when status advances
- ✅ **Placement Integration**: Automatic placement creation when hired
- ✅ **Notification System**: Rejection notifications and event tracking

#### **3.3 Worksite Management**
- **Duration**: 1 day
- **Priority**: Medium

**Tasks:**
- [ ] Create WorksiteForm component
- [ ] Implement worksite CRUD operations
- [ ] Add worksite-to-client linking
- [ ] Build worksite metrics

**Functions to Build:**
```typescript
// Worksite Operations
export const createWorksite = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates worksite with client linking
});

export const getWorksitesForClient = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Retrieves worksites for a specific client
});
```

### **Phase 4: Candidates & Pipeline (Week 4)** ✅ **COMPLETED**

#### **4.1 Candidate Management** ✅ **COMPLETED**
- **Duration**: 2 days
- **Priority**: High
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Create CandidatesTable component
- [x] Build CandidateDetail page
- [x] Implement candidate CRUD operations
- [x] Add candidate search and filtering

**Functions Built:**
```typescript
// Candidate Operations ✅
export const getCandidates = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Retrieves candidates with filtering and pagination
});

export const createCandidate = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates candidate with validation and scoring
});

export const updateCandidate = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Updates candidate with validation and scoring
});
```

**Features Implemented:**
- ✅ **Advanced Filtering**: Status, job order, recruiter owner, search
- ✅ **Search Functionality**: Full-text search across name, email, title, skills
- ✅ **Pagination**: Configurable limit/offset with total count
- ✅ **Sorting**: Multiple sort fields with ascending/descending order
- ✅ **Candidate Scoring**: Automatic score calculation based on profile completeness
- ✅ **Duplicate Prevention**: Email uniqueness validation
- ✅ **Companion Integration**: Enhanced with Companion user linking and notification preferences
- ✅ **Event-Driven Updates**: Automatic event creation for all changes
- ✅ **Hiring Workflow**: Automatic application status updates when candidate is hired

#### **4.2 Pipeline Board** ✅ **COMPLETED**
- **Duration**: 2 days
- **Priority**: High
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Create PipelineBoard component with drag-and-drop
- [x] Implement stage transition logic
- [x] Build pipeline metrics
- [x] Add bulk operations

**Functions Built:**
```typescript
// Pipeline Board ✅
export const getPipelineBoard = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Retrieves candidates organized by pipeline stages
});

export const updatePipelineStage = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Updates candidate pipeline stage with drag-and-drop
});
```

**Features Implemented:**
- ✅ **Kanban Board**: Candidates organized by pipeline stages
- ✅ **Drag-and-Drop**: Stage transitions with validation
- ✅ **Pipeline Metrics**: Real-time conversion rates and statistics
- ✅ **Stage Validation**: Enforced stage transition rules
- ✅ **Automatic Workflows**: Interview/offer/placement creation from stage changes
- ✅ **Enriched Data**: Applications, interviews, offers, and placements for each candidate
- ✅ **Job Order Filtering**: Pipeline view filtered by specific job orders
- ✅ **Recruiter Filtering**: Pipeline view filtered by recruiter owner
- ✅ **Event-Driven Updates**: Automatic event creation for stage changes

#### **4.3 AI Integration** ✅ **COMPLETED**
- **Duration**: 1 day
- **Priority**: Medium
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Implement candidate-job scoring algorithm
- [x] Create AI suggestions engine
- [x] Build duplicate detection logic
- [x] Add AI insights to candidate profiles

**Functions Built:**
```typescript
// AI Scoring ✅
export const scoreCandidateForJob = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Scores candidate against job requirements using AI
});

// Duplicate Detection ✅
export const detectDuplicates = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Detects duplicate candidates using AI
});

export const bulkDetectDuplicates = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Bulk duplicate detection for all candidates
});
```

**Features Implemented:**
- ✅ **Comprehensive Scoring**: 7-factor scoring algorithm (skills, experience, location, availability, compensation, work auth, reliability)
- ✅ **AI Recommendations**: Intelligent suggestions based on score breakdown
- ✅ **Risk Factor Analysis**: Identification of potential issues
- ✅ **Duplicate Detection**: Multiple detection methods (email, phone, name similarity, resume hash, work history)
- ✅ **Fuzzy Name Matching**: Levenshtein distance for name similarity
- ✅ **Bulk Processing**: Mass duplicate detection for entire candidate database
- ✅ **Confidence Scoring**: Confidence levels for duplicate matches
- ✅ **Event-Driven Updates**: Automatic event creation for all AI operations

### **Phase 5: Jobs Board & Workflows (Week 5)** ✅ **COMPLETED**

#### **5.1 Jobs Board Posts** ✅ **COMPLETED**
- **Duration**: 2 days
- **Priority**: High
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Create jobs board posts (linked and evergreen)
- [x] Implement public application page
- [x] Add jobs board metrics and analytics
- [x] Build jobs board templates

**Functions Built:**
```typescript
// Jobs Board Operations ✅
export const getJobsBoardPosts = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Retrieves jobs board posts with filtering and pagination
});

export const createJobsBoardPost = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates jobs board post with validation and auto-fill
});

export const updateJobsBoardPost = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Updates jobs board post with status handling
});

export const applyToPost = onCall({
  cors: true,
  maxInstances: 20
}, async (request) => {
  // Handles public job applications
});
```

**Features Implemented:**
- ✅ **Linked & Evergreen Posts**: Support for both job order-linked and standalone posts
- ✅ **Public Application System**: Complete application flow with validation and limits
- ✅ **Auto-Fill Integration**: Job order data automatically populates post fields
- ✅ **Screening Questions**: Custom questions for job applications
- ✅ **Application Limits**: Configurable limits per post
- ✅ **UTM Tracking**: Source tracking for applications
- ✅ **Metrics Tracking**: Views, applications, conversion rates
- ✅ **Status Management**: Draft, posted, paused, closed states
- ✅ **Channel Distribution**: Multiple posting channels (Companion, PublicURL, QR, Indeed, LinkedIn)
- ✅ **Candidate Creation**: Automatic candidate profiles from applications
- ✅ **Event-Driven Updates**: All operations create events for system integration

#### **5.2 Interview Scheduling & Scorecards** ✅ **COMPLETED**
- **Duration**: 2 days
- **Priority**: High
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Create interview scheduling system
- [x] Build interview scorecards
- [x] Implement interview feedback
- [x] Add interview analytics

**Functions Built:**
```typescript
// Interview Operations ✅
export const createInterview = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates interview with scheduling and notifications
});

export const submitInterviewScorecard = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Submits interview scorecard with automated decisions
});
```

**Features Implemented:**
- ✅ **Interview Scheduling**: Phone, video, and onsite interview types
- ✅ **Multi-Interviewer Support**: Multiple interviewers per session
- ✅ **Scorecard System**: Structured evaluation with weighted criteria
- ✅ **Automated Decisions**: Pass/fail determination based on scorecards
- ✅ **Status Workflows**: Automatic candidate status updates based on results
- ✅ **Application Integration**: Application status updates with interview results
- ✅ **Event-Driven Updates**: All operations create events for system integration
- ✅ **Notification System**: Interview invitations and updates
- ✅ **Analytics**: Interview performance tracking and metrics

#### **5.3 Offer & Placement Workflows** 🆕 **PLANNED**
- **Duration**: 1 day
- **Priority**: High
- **Status**: ✅ **COMPLETED**

**Tasks:**
- [x] Create offer creation workflow
- [x] Build offer acceptance/rejection system
- [x] Implement placement tracking
- [x] Add workflow automation

### Functions Built:
- `createOffer` - Create job offers for candidates with expiration dates
- `updateOfferStatus` - Accept/reject/expire offers with automatic placement creation
- `getOffers` - Retrieve offers with filtering, sorting, and pagination
- `getPlacements` - Retrieve placements with filtering, sorting, and pagination
- `updatePlacementStatus` - Complete/terminate placements with performance tracking

### Features Implemented:
- **Offer Management**: Complete offer lifecycle from creation to acceptance/rejection
- **Automatic Placement Creation**: When offers are accepted, placements are automatically created
- **Status Synchronization**: Updates candidate and application statuses based on offer/placement changes
- **Performance Tracking**: Rate placements and track completion/termination reasons
- **Expiration Handling**: Automatic offer expiration with configurable timeframes
- **Event-Driven Workflows**: All status changes trigger events for system integration

**Functions to Build:**
```typescript
// Offer Management
export const createOffer = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates offers with templates
});

// Placement Tracking
export const createPlacement = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates placements from accepted offers
});
```

### **Phase 5 Overall Completion Summary**

**Phase 5.1 Jobs Board Management** ✅ COMPLETED
- Built complete jobs board post management system
- Implemented public application workflow
- Added screening questions and candidate auto-creation

**Phase 5.2 Interview & Workflow Management** ✅ COMPLETED  
- Created interview scheduling and scorecard system
- Built comprehensive workflow automation
- Added AI-powered candidate scoring and recommendations

**Phase 5.3 Offer & Placement Workflows** ✅ COMPLETED
- Implemented complete offer lifecycle management
- Built automatic placement creation from accepted offers
- Added performance tracking and status synchronization

**Total Functions Built in Phase 5: 11**
- Jobs Board: `getJobsBoardPosts`, `createJobsBoardPost`, `updateJobsBoardPost`, `applyToPost`
- Workflows: `createInterview`, `submitInterviewScorecard`
- Offers & Placements: `createOffer`, `updateOfferStatus`, `getOffers`, `getPlacements`, `updatePlacementStatus`

### **Phase 6: Completion & Analytics (Week 6)**

#### **6.1 Dashboard & Analytics**
- **Duration**: 2 days
- **Priority**: High

**Tasks:**
- [ ] Create RecruiterDashboard component
- [ ] Build dashboard widgets
- [ ] Implement KPI calculations
- [ ] Add real-time metrics

**Components to Build:**
```typescript
// Dashboard Widgets
interface TodoWidgetProps {
  tenantId: string;
  userId: string;
}

interface KeyMetricsWidgetProps {
  tenantId: string;
  timeRange: 'today' | 'week' | 'month';
}

interface AISuggestionsWidgetProps {
  tenantId: string;
  userId: string;
}
```

**API Functions:**
```typescript
// Dashboard Data
export const getDashboardData = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Retrieves dashboard metrics and data
});

// KPI Calculations
export const calculateKPIs = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Calculates key performance indicators
});
```

#### **6.2 Compliance & Monitoring**
- **Duration**: 2 days
- **Priority**: Medium

**Tasks:**
- [ ] Implement compliance scanning
- [ ] Create document expiration tracking
- [ ] Build compliance reporting
- [ ] Add automated alerts

**Functions to Build:**
```typescript
// Compliance Scanning
export const nightlyComplianceScan = onSchedule('0 2 * * *', async (event) => {
  // Scans for compliance issues nightly
});

// Document Tracking
export const checkDocumentExpirations = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Checks for expiring documents
});
```

#### **6.3 Testing & Documentation**
- **Duration**: 2 days
- **Priority**: High

**Tasks:**
- [ ] Write unit tests for all functions
- [ ] Create integration tests
- [ ] Build E2E test suite
- [ ] Complete API documentation

**Testing Strategy:**
```typescript
// Unit Tests
describe('Recruiter Functions', () => {
  test('onOpportunityHandoff creates events correctly', () => {});
  test('validateHandoffGuardrails checks all requirements', () => {});
  test('scoreCandidateForJob returns valid scores', () => {});
});

// Integration Tests
describe('Recruiter Workflows', () => {
  test('Complete handoff workflow', () => {});
  test('Application to placement lifecycle', () => {});
  test('Multi-tenant isolation', () => {});
});
```

### **Phase 2: Recruiter Enhancements (Companion Integration)** 🆕 **PLANNED**

#### **2.1 Bulk Submittals & One-Click Operations**
- **Duration**: 3 days
- **Priority**: High
- **Status**: ⏳ **PLANNED**

**Tasks:**
- [ ] Create bulk submittal interface
- [ ] Implement one-click scheduling
- [ ] Build job board auto-fill
- [ ] Add one-click background/drug checks

**Functions to Build:**
```typescript
// Bulk Submittals
export const createBulkSubmittals = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates multiple submittals with auto-generated packets
});

// One-Click Scheduling
export const scheduleInterviewOneClick = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Schedules interview using Companion + client availability
});

// Job Board Auto-Fill
export const createJobFromTemplate = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates job order from template with auto-fill
});

// Compliance Checks
export const triggerComplianceCheck = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Triggers background/drug check with Companion notification
});
```

#### **2.2 Unified Timeline & Messaging**
- **Duration**: 3 days
- **Priority**: High
- **Status**: ⏳ **PLANNED**

**Tasks:**
- [ ] Create unified timeline system
- [ ] Implement Companion messaging integration
- [ ] Build event aggregation
- [ ] Add real-time notifications

**Functions to Build:**
```typescript
// Timeline Management
export const getUnifiedTimeline = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Retrieves unified timeline for entities
});

// Messaging Integration
export const sendMessageViaCompanion = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Sends message through Companion with push notifications
});

// Event Aggregation
export const aggregateEvents = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Aggregates events from multiple sources
});
```

#### **2.3 Templates & Compliance Automation**
- **Duration**: 2 days
- **Priority**: Medium
- **Status**: ⏳ **PLANNED**

**Tasks:**
- [ ] Create reusable templates system
- [ ] Implement compliance automation
- [ ] Build alert system
- [ ] Add checklist management

**Functions to Build:**
```typescript
// Template Management
export const createRateCard = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates client-specific rate cards
});

export const createCompliancePacket = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates compliance packet templates
});

// Compliance Automation
export const checkComplianceAlerts = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Checks for compliance alerts and notifications
});

export const createComplianceChecklist = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates compliance checklists for job orders
});
```

#### **2.4 Workflow Improvements & Delight Features**
- **Duration**: 2 days
- **Priority**: Medium
- **Status**: ⏳ **PLANNED**

**Tasks:**
- [ ] Create candidate pools and hot lists
- [ ] Implement drag-drop pipelines
- [ ] Build inline previews
- [ ] Add hover actions

**Functions to Build:**
```typescript
// Candidate Pools
export const createCandidatePool = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates candidate pools with criteria
});

export const createHotList = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates recruiter hot lists
});

// Pipeline Management
export const updatePipelineStage = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Updates candidate pipeline stage with drag-drop
});

// Client Feedback
export const processClientFeedback = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Processes one-click client feedback
});
```

**Phase 2 Completion Summary:**
- ⏳ Bulk submittals with auto-generated packets
- ⏳ One-click scheduling with Companion integration
- ⏳ Job board auto-fill with templates
- ⏳ Unified timeline with event aggregation
- ⏳ Companion messaging with push notifications
- ⏳ Compliance automation with alerts
- ⏳ Drag-drop pipelines and delight features
- ⏳ Client feedback loop with instant notifications

## 🔧 **Technical Considerations**

### **Performance Optimization**
- **Query Optimization**: Use composite indexes for all common queries
- **Caching Strategy**: Implement React Query for frontend caching
- **Batch Operations**: Use batch writes for bulk operations
- **Pagination**: Implement cursor-based pagination for large datasets

### **Security Considerations**
- **Tenant Isolation**: All queries must include tenantId filter
- **Permission Checks**: Validate user permissions for all operations
- **Input Validation**: Use Zod schemas for all function inputs
- **Rate Limiting**: Implement rate limits for public endpoints

### **Scalability Planning**
- **Function Limits**: Use appropriate maxInstances for each function
- **Database Design**: Optimize for read-heavy workloads
- **Event Processing**: Implement event batching for high volume
- **Monitoring**: Add comprehensive logging and monitoring

### **Error Handling**
- **Graceful Degradation**: Handle partial failures gracefully
- **Retry Logic**: Implement exponential backoff for transient failures
- **User Feedback**: Provide clear error messages to users
- **Rollback Mechanisms**: Implement rollback for failed operations

## 📊 **Testing Strategy**

### **Unit Testing**
- **Function Logic**: Test all cloud functions with mock data
- **Schema Validation**: Test Zod schemas with valid/invalid data
- **Component Rendering**: Test React components with various props
- **Error Handling**: Test error scenarios and edge cases

### **Integration Testing**
- **Event Processing**: Test event bus with real Firestore
- **Handoff Workflow**: Test complete CRM → Recruiter handoff
- **Data Consistency**: Test canonical data strategy
- **Permission Enforcement**: Test multi-tenant isolation

### **E2E Testing**
- **User Workflows**: Test complete user journeys
- **Performance**: Test with realistic data volumes
- **Cross-Browser**: Test in multiple browsers
- **Mobile Responsiveness**: Test on mobile devices

### **Load Testing**
- **Concurrent Users**: Test with multiple simultaneous users
- **Data Volume**: Test with large datasets
- **Function Limits**: Test function execution limits
- **Database Performance**: Test query performance under load

## 🎯 **Success Metrics**

### **Phase 1 Success Criteria**
- [ ] Event bus processes events without errors
- [ ] Handoff triggers work with guardrails
- [ ] Multi-tenant isolation enforced
- [ ] Base schemas validate correctly

### **Phase 2 Success Criteria**
- [ ] Complete handoff workflow functional
- [ ] Canonical data strategy working
- [ ] Write-through editing operational
- [ ] Event processing idempotent

### **Phase 3 Success Criteria**
- [ ] Job orders CRUD operations working
- [ ] Client management with CRM integration
- [ ] Worksite management functional
- [ ] Performance acceptable under load

### **Phase 4 Success Criteria**
- [ ] Candidate management complete
- [ ] Pipeline board with drag-and-drop
- [ ] AI scoring algorithm working
- [ ] Duplicate detection functional

### **Phase 5 Success Criteria**
- [ ] Jobs board posts working
- [ ] Public application page functional
- [ ] Interview/offer workflows complete
- [ ] Placement tracking operational

### **Phase 6 Success Criteria**
- [ ] Dashboard with real-time metrics
- [ ] Compliance monitoring working
- [ ] All tests passing
- [ ] Documentation complete

### **Phase 2 Success Criteria (Recruiter Enhancements)**
- [ ] Bulk submittals with auto-generated packets functional
- [ ] One-click scheduling with Companion integration working
- [ ] Job board auto-fill with templates operational
- [ ] Unified timeline with event aggregation implemented
- [ ] Companion messaging with push notifications functional
- [ ] Compliance automation with alerts working
- [ ] Drag-drop pipelines and delight features available
- [ ] Client feedback loop with instant notifications operational

## 🚀 **Deployment Strategy**

### **Development Environment**
- **Local Testing**: Use Firebase emulators for local development
- **Feature Flags**: Use feature flags for gradual rollout
- **Branch Strategy**: Use feature branches with PR reviews

### **Staging Environment**
- **Data Migration**: Test with production-like data
- **Performance Testing**: Validate performance under load
- **User Acceptance**: Conduct UAT with stakeholders

### **Production Deployment**
- **Gradual Rollout**: Deploy to subset of tenants first
- **Monitoring**: Monitor key metrics during rollout
- **Rollback Plan**: Have rollback procedures ready
- **User Training**: Provide training for new features

This development plan provides a comprehensive roadmap for implementing the HRX Recruiter module with clear phases, detailed tasks, and success criteria. Each phase builds upon the previous one, ensuring a solid foundation and systematic development approach.
