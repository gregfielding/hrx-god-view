# HRX Recruiter — Development Plan

## 🎯 **Development Overview**

This document serves as the development blueprint for implementing the HRX Recruiter module. It breaks down the specification into actionable phases with detailed implementation guidance, testing strategies, and architectural considerations.

## 📋 **Development Phases**

### **Phase 1: Foundation & Event Bus (Week 1)**

#### **1.1 Project Setup & Architecture**
- **Duration**: 2 days
- **Priority**: Critical

**Tasks:**
- [ ] Create `/src/modules/recruiter/` directory structure
- [ ] Set up routing with `/recruiter/*` paths
- [ ] Add Recruiter to main navigation menu
- [ ] Implement route guards for recruiter access
- [ ] Create base TypeScript interfaces and Zod schemas

**Key Files:**
```
src/modules/recruiter/
├── index.ts                    # Module entry point
├── routes.tsx                  # Route definitions
├── types/
│   ├── recruiter.types.ts      # Base interfaces
│   └── zod/
│       ├── base.z.ts           # Base schemas
│       ├── events.z.ts         # Event schemas
│       └── entities.z.ts       # Entity schemas
```

**Implementation Notes:**
- Route guards should check for `modules.recruiter=true` in tenant config
- Base schemas must include `tenantId` validation
- Use existing CRM navigation patterns for consistency

#### **1.2 Event Bus Architecture**
- **Duration**: 3 days
- **Priority**: Critical

**Tasks:**
- [ ] Create `/events` collection structure
- [ ] Implement event creation and processing functions
- [ ] Set up event processors for handoff events
- [ ] Create event deduplication logic
- [ ] Implement event error handling and retry logic

**Functions to Build:**
```typescript
// Event Creation
export const createEvent = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Creates event documents with deduplication
});

// Event Processing
export const processEvents = onSchedule('every 1 minutes', async (event) => {
  // Processes unprocessed events with retry logic
});

// Event Processors
export const processHandoffRequested = onDocumentCreated(
  'tenants/{tenantId}/events/{eventId}',
  async (event) => {
    // Handles crm.handoff.requested events
  }
);
```

**Implementation Notes:**
- Events must be idempotent with `dedupeKey` field
- Use exponential backoff for retry logic
- Implement dead letter queue for failed events
- Events should include `processed`, `processedAt`, and `error` fields

#### **1.3 Firestore Rules & Indexes**
- **Duration**: 1 day
- **Priority**: Critical

**Tasks:**
- [ ] Add recruiter collection rules to `firestore.rules`
- [ ] Create composite indexes for recruiter queries
- [ ] Test tenant isolation enforcement
- [ ] Validate permission checks

**Required Indexes:**
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

### **Phase 2: Handoff System (Week 2)**

#### **2.1 Handoff Trigger & Guardrails**
- **Duration**: 2 days
- **Priority**: Critical

**Tasks:**
- [ ] Implement `onOpportunityHandoff` trigger function
- [ ] Create guardrail validation logic
- [ ] Add handoff readiness checks to CRM deals
- [ ] Implement handoff event creation

**Functions to Build:**
```typescript
// Primary Handoff Trigger
export const onOpportunityHandoff = onDocumentUpdated(
  'tenants/{tenantId}/crm_deals/{dealId}',
  async (event) => {
    // Triggers when deal stage = Closed-Won AND readyForRecruiter = true
  }
);

// Guardrail Validation
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
}
```

#### **2.2 Canonical Data Integration**
- **Duration**: 2 days
- **Priority**: Critical

**Tasks:**
- [ ] Implement `upsertCrmCompany` function
- [ ] Create `upsertRecruiterClient` extension logic
- [ ] Build `createJobOrdersFromDeal` function
- [ ] Implement contact linking logic

**Functions to Build:**
```typescript
// CRM Company Management
export const upsertCrmCompany = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Ensures CRM company exists and is complete
});

// Recruiter Client Extension
export const upsertRecruiterClient = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates/updates recruiter client extension
});

// Job Order Creation
export const createJobOrdersFromDeal = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates job orders from deal information
});
```

**Implementation Notes:**
- Recruiter clients use `crm_companyId` as document ID
- Job orders must include `crmCompanyId` and `crmDealId` references
- Use transactions for atomic operations
- Implement rollback logic for failed handoffs

#### **2.3 Write-Through Editing**
- **Duration**: 1 day
- **Priority**: High

**Tasks:**
- [ ] Create `updateCompanyFromRecruiter` function
- [ ] Implement `updateContactFromRecruiter` function
- [ ] Build cache refresh logic
- [ ] Add conflict resolution

**Functions to Build:**
```typescript
// Write-Through Updates
export const updateCompanyFromRecruiter = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Updates canonical CRM company from recruiter
});

// Cache Refresh
export const refreshRecruiterCaches = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Refreshes recruiter caches after CRM updates
});
```

### **Phase 3: Core Recruiter Features (Week 3)**

#### **3.1 Job Orders Management**
- **Duration**: 2 days
- **Priority**: High

**Tasks:**
- [ ] Create JobOrdersTable component
- [ ] Implement JobOrderDetail page
- [ ] Build job order CRUD operations
- [ ] Add filtering and search functionality

**Components to Build:**
```typescript
// Job Orders Table
interface JobOrdersTableProps {
  tenantId: string;
  filters: JobOrderFilters;
  onRowClick: (jobOrderId: string) => void;
}

// Job Order Detail
interface JobOrderDetailProps {
  jobOrderId: string;
  tenantId: string;
}
```

**API Functions:**
```typescript
// Job Order Operations
export const getJobOrders = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Retrieves job orders with filtering
});

export const updateJobOrder = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Updates job order with validation
});
```

#### **3.2 Client Management**
- **Duration**: 2 days
- **Priority**: High

**Tasks:**
- [ ] Create ClientsTable component
- [ ] Build ClientDetail page with CRM integration
- [ ] Implement client extension management
- [ ] Add client metrics calculation

**Components to Build:**
```typescript
// Clients Table (shows CRM companies with recruiter extensions)
interface ClientsTableProps {
  tenantId: string;
  showRecruiterOnly: boolean;
}

// Client Detail (combines CRM + recruiter data)
interface ClientDetailProps {
  crmCompanyId: string;
  tenantId: string;
}
```

**Implementation Notes:**
- Client table queries CRM companies and joins recruiter extensions
- Client detail shows CRM data with recruiter-specific panels
- Use React Query for efficient data fetching and caching

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

### **Phase 4: Candidates & Pipeline (Week 4)**

#### **4.1 Candidate Management**
- **Duration**: 2 days
- **Priority**: High

**Tasks:**
- [ ] Create CandidatesTable component
- [ ] Build CandidateDetail page
- [ ] Implement candidate CRUD operations
- [ ] Add candidate search and filtering

**Components to Build:**
```typescript
// Candidates Table
interface CandidatesTableProps {
  tenantId: string;
  filters: CandidateFilters;
  viewMode: 'table' | 'board';
}

// Candidate Detail
interface CandidateDetailProps {
  candidateId: string;
  tenantId: string;
}
```

**API Functions:**
```typescript
// Candidate Operations
export const getCandidates = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Retrieves candidates with filtering
});

export const createCandidate = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates candidate with validation
});
```

#### **4.2 Pipeline Board**
- **Duration**: 2 days
- **Priority**: High

**Tasks:**
- [ ] Create PipelineBoard component with drag-and-drop
- [ ] Implement stage transition logic
- [ ] Build pipeline metrics
- [ ] Add bulk operations

**Components to Build:**
```typescript
// Pipeline Board
interface PipelineBoardProps {
  tenantId: string;
  stages: PipelineStage[];
  onStageChange: (candidateId: string, newStage: string) => void;
}

// Pipeline Stage
interface PipelineStage {
  id: string;
  name: string;
  candidates: Candidate[];
  color: string;
}
```

**Implementation Notes:**
- Use react-beautiful-dnd for drag-and-drop functionality
- Implement optimistic updates for stage changes
- Add undo functionality for stage transitions
- Track time-in-stage metrics

#### **4.3 AI Integration**
- **Duration**: 1 day
- **Priority**: Medium

**Tasks:**
- [ ] Implement candidate-job scoring algorithm
- [ ] Create AI suggestions engine
- [ ] Build duplicate detection logic
- [ ] Add AI insights to candidate profiles

**Functions to Build:**
```typescript
// AI Scoring
export const scoreCandidateForJob = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Scores candidate against job requirements
});

// Duplicate Detection
export const detectDuplicates = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Detects duplicate candidates
});
```

### **Phase 5: Jobs Board & Workflows (Week 5)**

#### **5.1 Jobs Board Posts**
- **Duration**: 2 days
- **Priority**: High

**Tasks:**
- [ ] Create PostsTable component
- [ ] Build PostEditor with rich text
- [ ] Implement post CRUD operations
- [ ] Add post visibility controls

**Components to Build:**
```typescript
// Posts Table
interface PostsTableProps {
  tenantId: string;
  mode: 'linked' | 'evergreen';
}

// Post Editor
interface PostEditorProps {
  postId?: string;
  mode: 'linked' | 'evergreen';
  jobOrderId?: string;
}
```

**API Functions:**
```typescript
// Jobs Board Operations
export const createJobsBoardPost = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Creates jobs board post
});

export const updateJobsBoardPost = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Updates jobs board post
});
```

#### **5.2 Public Application Page**
- **Duration**: 2 days
- **Priority**: High

**Tasks:**
- [ ] Create PublicApplyPage component
- [ ] Implement application submission logic
- [ ] Add file upload for resumes
- [ ] Build application confirmation flow

**Components to Build:**
```typescript
// Public Apply Page
interface PublicApplyPageProps {
  postId: string;
  tenantId: string;
}

// Application Form
interface ApplicationFormProps {
  post: JobsBoardPost;
  onSubmit: (application: Application) => void;
}
```

**API Functions:**
```typescript
// Application Submission
export const applyToPost = onCall({
  cors: true,
  maxInstances: 20
}, async (request) => {
  // Handles public job applications
});

// File Upload
export const uploadResume = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Handles resume file uploads
});
```

#### **5.3 Interview & Offer Workflows**
- **Duration**: 1 day
- **Priority**: High

**Tasks:**
- [ ] Create interview scheduling system
- [ ] Build offer creation workflow
- [ ] Implement placement tracking
- [ ] Add workflow automation

**Functions to Build:**
```typescript
// Interview Scheduling
export const scheduleInterview = onCall({
  cors: true,
  maxInstances: 5
}, async (request) => {
  // Schedules interviews with calendar integration
});

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
