# Flutter Jobs Board & Application Workflow Specification

## **📋 Complete Jobs Board & Application Workflow Specification for Flutter App**

### **🏗️ Collections and Tenancy**

**Tenant-Scoped Paths:**
```
/tenants/{tenantId}/jobs_board_posts/{postId}
/tenants/{tenantId}/job_orders/{jobOrderId}
/tenants/{tenantId}/applications/{applicationId}
/tenants/{tenantId}/candidates/{candidateId}
/tenants/{tenantId}/interviews/{interviewId}
/tenants/{tenantId}/offers/{offerId}
/tenants/{tenantId}/placements/{placementId}
```

**Public Job Listings:**
- ✅ **Yes, public listings exist**
- **Path**: `/tenants/{tenantId}/jobs_board_posts/{postId}`
- **Auth Rules**: Read access for `visibility: 'public'` posts
- **Visibility Logic**: Only posts with `status: 'posted'` AND `visibility: 'public'` are accessible

**Companion Job Sources:**
- **Primary**: Read from `jobs_board_posts` collection
- **Secondary**: Can also read from `job_orders` for internal job details
- **Relationship**: Posts can be linked to job orders via `jobOrderId` field

### **📄 Jobs Post Data Contract**

**Exact Fields and Types:**
```typescript
interface JobsBoardPost {
  id: string;
  tenantId: string;
  mode: 'linked' | 'evergreen';
  jobOrderId?: string; // For linked posts
  talentPoolKey?: string; // For evergreen posts
  title: string;
  description: string;
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
  benefits?: string;
  visibility: 'public' | 'private' | 'internal';
  channels: ('Companion' | 'PublicURL' | 'QR' | 'Indeed' | 'LinkedIn')[];
  screeningQuestions: ScreeningQuestion[];
  autoReplyTemplateId?: string;
  requireResume: boolean;
  requireCerts: string[];
  applyLimit: number;
  eeoDisclosure: boolean;
  equalPayDisclosure?: boolean;
  privacyLink?: string;
  applicationConsent: boolean;
  status: 'draft' | 'posted' | 'paused' | 'closed';
  metrics: {
    views: number;
    applications: number;
    conversionRate: number;
    sourceBreakdown: Record<string, number>;
  };
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
  searchKeywords: string[];
}

interface ScreeningQuestion {
  id: string;
  question: string;
  type: 'text' | 'yesno' | 'multiselect' | 'number' | 'file';
  required: boolean;
  options?: string[];
}
```

**Example Documents:**

**Example 1 - Linked Post:**
```json
{
  "id": "post_123",
  "tenantId": "tenant_abc",
  "mode": "linked",
  "jobOrderId": "job_456",
  "title": "Warehouse Associate - 2nd Shift",
  "description": "Join our growing warehouse team! We're looking for reliable individuals to help with order fulfillment, inventory management, and shipping operations.",
  "location": "Phoenix, AZ",
  "geo": {
    "lat": 33.4484,
    "lng": -112.0740
  },
  "payRange": {
    "min": 18.50,
    "max": 22.00,
    "period": "hourly"
  },
  "shifts": ["2nd Shift", "Monday-Friday"],
  "benefits": "Health insurance, 401k, paid time off, employee discounts",
  "visibility": "public",
  "channels": ["Companion", "PublicURL", "QR"],
  "screeningQuestions": [
    {
      "id": "q1",
      "question": "Do you have warehouse experience?",
      "type": "yesno",
      "required": true
    },
    {
      "id": "q2",
      "question": "What's your preferred shift?",
      "type": "multiselect",
      "required": true,
      "options": ["1st Shift", "2nd Shift", "3rd Shift", "Flexible"]
    }
  ],
  "requireResume": true,
  "requireCerts": ["Forklift Certification"],
  "applyLimit": 50,
  "status": "posted",
  "metrics": {
    "views": 245,
    "applications": 12,
    "conversionRate": 0.049
  }
}
```

**Example 2 - Evergreen Post:**
```json
{
  "id": "post_789",
  "tenantId": "tenant_abc",
  "mode": "evergreen",
  "talentPoolKey": "general_labor",
  "title": "General Labor - Various Positions",
  "description": "We're always looking for hardworking individuals for various positions across our client companies.",
  "location": "Multiple Locations",
  "payRange": {
    "min": 16.00,
    "max": 25.00,
    "period": "hourly"
  },
  "shifts": ["1st Shift", "2nd Shift", "3rd Shift", "Weekends"],
  "visibility": "public",
  "channels": ["Companion"],
  "screeningQuestions": [
    {
      "id": "q1",
      "question": "What type of work are you interested in?",
      "type": "multiselect",
      "required": true,
      "options": ["Warehouse", "Manufacturing", "Construction", "Office", "Customer Service"]
    }
  ],
  "requireResume": false,
  "applyLimit": 100,
  "status": "posted"
}
```

**Relationship to Job Orders:**
- **Linked Posts**: 1 post maps to 1 job order via `jobOrderId`
- **Evergreen Posts**: No direct job order link, uses `talentPoolKey`

### **🔍 Filters, Search, and Sorting**

**Required Filters:**
- **Location**: City/state/zip radius search
- **Pay Range**: Min/max hourly rate
- **Shift**: Day/night/weekend
- **Employment Type**: Temp, temp-to-hire, direct hire
- **Remote/On-site**: Work location preference
- **Certifications**: Required certifications
- **Company**: Client company name

**Search Strategy:**
- **Full-text search** across: title, description, location, shifts, benefits
- **Search keywords** field contains pre-processed terms
- **Indexing**: Use Firestore's built-in text search capabilities

**Sort Options:**
- **Primary**: Posted date (newest first)
- **Secondary**: Pay rate (highest first)
- **Tertiary**: Location proximity (if geo available)

**Required Firestore Indexes:**
```json
[
  {
    "collectionGroup": "jobs_board_posts",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "tenantId", "order": "ASCENDING" },
      { "fieldPath": "visibility", "order": "ASCENDING" },
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" }
    ]
  },
  {
    "collectionGroup": "jobs_board_posts",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "tenantId", "order": "ASCENDING" },
      { "fieldPath": "location", "order": "ASCENDING" },
      { "fieldPath": "status", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "jobs_board_posts",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "tenantId", "order": "ASCENDING" },
      { "fieldPath": "payRange.min", "order": "DESCENDING" },
      { "fieldPath": "status", "order": "ASCENDING" }
    ]
  }
]
```

### **👁️ Visibility and Eligibility Rules**

**Visibility Logic:**
- **Public**: Accessible to anyone, appears in search
- **Private**: Invite-only, requires specific access codes
- **Internal**: Employee-only, requires authentication

**Auto-Hide Rules:**
- ✅ **Auto-hide when `remainingOpenings` hits 0**
- ✅ **Auto-hide when `status` changes from 'posted'**
- ✅ **Auto-hide when `applyLimit` is reached**

**Geo/Role Gating:**
- **Location-based**: Filter by candidate's location preference
- **Role-based**: Some posts may require specific user roles

### **📱 Job Detail Page Content**

**Required Sections:**
1. **Header**: Title, company, location, pay range
2. **Description**: Full job description
3. **Requirements**: Skills, experience, certifications
4. **Shifts**: Available shifts and schedules
5. **Benefits**: Compensation and benefits package
6. **About Client**: Company information (if available)
7. **Map**: Location visualization (if geo available)

**Attachments/Media:**
- **Company Logo**: `companyLogoUrl` field
- **Job Images**: `images[]` array
- **Benefits PDF**: `benefitsPdfUrl` field

**CTA Actions:**
- **Primary**: "Apply Now"
- **Secondary**: "Save Job", "Share Job", "Ask Question"
- **Tertiary**: "View Company", "Similar Jobs"

### **📝 Application Workflow (End-to-End)**

**Step-by-Step Screens:**

**Step 1: Contact Information**
```typescript
interface ContactInfo {
  name: string; // Required
  email: string; // Required, validated
  phone?: string; // Optional
  workAuth: 'citizen' | 'permanent_resident' | 'work_visa' | 'other'; // Required
}
```

**Step 2: Resume Upload**
```typescript
interface ResumeUpload {
  resumeUrl?: string; // Optional if requireResume is false
  resumeFile?: File; // Max 10MB, PDF/DOC/DOCX
}
```

**Step 3: Screening Questions**
```typescript
interface ScreeningAnswers {
  answers: Array<{
    questionId: string;
    answer: string | string[] | number;
  }>;
}
```

**Step 4: Review & Submit**
- Show summary of all information
- Display consent checkboxes
- Submit button

**Validation Rules:**
- **Required Fields**: name, email, workAuth
- **Email Validation**: Must be valid email format
- **Phone Validation**: Optional, but must be valid if provided
- **Resume**: Required if `requireResume: true`
- **Screening Questions**: All required questions must be answered

**Guest vs Authenticated:**
- **Guest Apply**: ✅ **Supported** - No sign-in required
- **Conversion**: Guest applications create candidate profiles automatically
- **Linking**: If user later signs in, link via email matching

**Source Tagging:**
- **Required Value**: `'Companion'`
- **Additional Sources**: `'QR'`, `'PublicURL'`, `'Indeed'`, `'LinkedIn'`

**Duplicate Policy:**
- **Re-apply Window**: 30 days
- **Withdraw**: Can withdraw within 24 hours
- **Edit After Submit**: Not allowed, must withdraw and re-apply

### **❓ Screening Questions Schema**

**Question Types:**
```typescript
type QuestionType = 'text' | 'yesno' | 'multiselect' | 'number' | 'file';

interface ScreeningQuestion {
  id: string;
  question: string;
  type: QuestionType;
  required: boolean;
  options?: string[]; // For multiselect
  min?: number; // For number type
  max?: number; // For number type
  regex?: string; // For text validation
  conditional?: {
    dependsOn: string; // Question ID
    value: any; // Required value
  };
}
```

**Scoring Rules:**
- **Per-question scoring**: Not implemented in current system
- **Overall application scoring**: Handled by AI after submission
- **Storage**: Scores stored in `aiScore` field on application

### **📋 Applications Write Contract**

**Final Application Shape:**
```typescript
interface Application {
  id: string;
  tenantId: string;
  mode: 'linked' | 'evergreen';
  jobOrderId?: string;
  postId: string;
  candidateId?: string; // Auto-created for guest applications
  externalApplicant?: {
    name: string;
    email: string;
    phone?: string;
    resumeUrl?: string;
  };
  workAuth: 'citizen' | 'permanent_resident' | 'work_visa' | 'other';
  answers: Array<{
    questionId: string;
    answer: string | string[] | number;
  }>;
  source: 'Companion' | 'QR' | 'PublicURL' | 'Indeed' | 'LinkedIn';
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
  referralCode?: string;
  consents: string[];
  status: 'new' | 'screened' | 'advanced' | 'hired' | 'rejected' | 'withdrawn';
  aiScore?: number;
  aiRecommendations?: string[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
  searchKeywords: string[];
}
```

**Example Payloads:**

**Authenticated Candidate:**
```json
{
  "tenantId": "tenant_abc",
  "postId": "post_123",
  "candidateId": "candidate_456",
  "workAuth": "citizen",
  "answers": [
    {"questionId": "q1", "answer": "yes"},
    {"questionId": "q2", "answer": ["2nd Shift"]}
  ],
  "source": "Companion",
  "consents": ["email_communications", "data_processing"],
  "status": "new"
}
```

**Guest Applicant:**
```json
{
  "tenantId": "tenant_abc",
  "postId": "post_123",
  "externalApplicant": {
    "name": "John Smith",
    "email": "john.smith@email.com",
    "phone": "+1-555-123-4567",
    "resumeUrl": "https://storage.googleapis.com/resumes/john_smith.pdf"
  },
  "workAuth": "citizen",
  "answers": [
    {"questionId": "q1", "answer": "yes"},
    {"questionId": "q2", "answer": ["2nd Shift"]}
  ],
  "source": "Companion",
  "consents": ["email_communications", "data_processing"],
  "status": "new"
}
```

**Server-Side Defaults:**
- `status`: `'new'`
- `createdAt`: Current timestamp
- `updatedAt`: Current timestamp
- `createdBy`: `'public'` for guest, user ID for authenticated
- `updatedBy`: Same as createdBy

### **👤 Candidate Linking**

**Auto-Creation Rules:**
- ✅ **Auto-create candidate** when `candidateId` is missing
- **Fields to Seed**:
  ```typescript
  {
    firstName: string; // From name.split(' ')[0]
    lastName: string; // From name.split(' ').slice(1).join(' ')
    email: string;
    phone?: string;
    resumeUrl?: string;
    workAuth: string;
    source: 'jobs_board';
    status: 'applicant';
    score: 0; // Will be calculated by AI
  }
  ```

**Companion User Linking:**
- **Set `companionUserId`** when user is authenticated in Companion app
- **Usage**: For notifications and profile linking
- **When to Set**: During application submission if user is logged in

**Duplicate Merging Rules:**
- **Email Matching**: Primary method for duplicate detection
- **Phone Matching**: Secondary method
- **Auto-Merge**: Not implemented, requires manual review

### **🔄 Status Transitions and Triggers**

**Application Status Flow:**
```
new → screened → advanced → hired
  ↓
rejected/withdrawn/duplicate
```

**Status Triggers:**
- **new → screened**: Manual screening by recruiter
- **screened → advanced**: Interview scheduled
- **advanced → hired**: Offer accepted
- **Any → rejected**: Manual rejection or failed interview
- **Any → withdrawn**: Candidate withdraws

**Interview/Offer Creation:**
- **Interviews**: Created automatically when candidate moves to 'interview' stage
- **Offers**: Created automatically when candidate moves to 'offer' stage
- **Events to Listen For**:
  - `interview.created`
  - `interview.scorecard_submitted`
  - `offer.created`
  - `offer.accepted`
  - `placement.created`

**Push Notifications:**

**Post Published:**
- **Title**: "New Job Available: {title}"
- **Body**: "Apply now for {location} position"
- **Deep Link**: `app://tenant/{tenantId}/job/{postId}`

**Status Updated:**
- **Title**: "Application Update"
- **Body**: "Your application for {jobTitle} has been {status}"
- **Deep Link**: `app://tenant/{tenantId}/application/{applicationId}`

**New Interview:**
- **Title**: "Interview Scheduled"
- **Body**: "You have an interview for {jobTitle} on {date}"
- **Deep Link**: `app://tenant/{tenantId}/interview/{interviewId}`

**New Offer:**
- **Title**: "Job Offer Received"
- **Body**: "Congratulations! You have an offer for {jobTitle}"
- **Deep Link**: `app://tenant/{tenantId}/offer/{offerId}`

### **🔔 Notifications**

**Triggers:**
- `jobs_board_post.posted` → Notify saved job users
- `application.status_updated` → Notify candidate
- `interview.created` → Notify candidate
- `offer.created` → Notify candidate

**Data Payload Format:**
```typescript
interface NotificationPayload {
  type: 'post_published' | 'status_updated' | 'interview_scheduled' | 'offer_received';
  tenantId: string;
  entityId: string;
  entityType: 'post' | 'application' | 'interview' | 'offer';
  title: string;
  body: string;
  deepLink: string;
  data: Record<string, any>;
}
```

**Fallback Logic:**
- **SMS Fallback**: If push fails, send SMS (requires phone number)
- **Email Fallback**: Always send email confirmation
- **Backend vs Client**: Backend handles all fallbacks

### **💾 Saved Jobs and Recommendations**

**Save Job Feature:**
- ✅ **Supported**
- **Data Model**:
  ```typescript
  interface SavedJob {
    id: string;
    tenantId: string;
    userId: string;
    postId: string;
    savedAt: number;
    expiresAt?: number; // Optional expiration
  }
  ```

**Recommendations:**
- ✅ **Supported**
- **Ranking Signals**:
  - `aiScore` (primary)
  - Skills match percentage
  - Location proximity
  - Pay range preference
  - Shift preference

**Limits and Dedupe:**
- **Save Limit**: 50 jobs per user
- **Expiration**: 90 days (optional)
- **Dedupe**: Prevent duplicate saves

### **⚡ Performance and UX**

**Pagination:**
- **Page Size**: 20 jobs per page
- **Prefetch**: Load next page when 3 items from end
- **Infinite Scroll**: Implement smooth scrolling

**Offline Caching:**
- **Read-Only**: Cache job listings for offline viewing
- **Apply Draft**: Save application progress locally
- **Sync**: Upload draft when online

**File Upload Limits:**
- **Max Size**: 10MB per file
- **Types**: PDF, DOC, DOCX
- **Multiple Attachments**: Not supported in current system

### **🔒 Security and Access**

**Firestore Rules:**
```javascript
// Jobs Board Posts
match /tenants/{tenantId}/jobs_board_posts/{postId} {
  allow read: if resource.data.visibility == 'public' && resource.data.status == 'posted';
  allow write: if false; // No client writes
}

// Applications
match /tenants/{tenantId}/applications/{applicationId} {
  allow read: if request.auth != null && 
    (request.auth.uid == resource.data.candidateId || 
     isAssignedToTenant(tenantId));
  allow create: if true; // Public applications allowed
  allow update: if false; // No client updates
}
```

**Rate Limits:**
- **Applications**: 5 per hour per email
- **Job Views**: No limit
- **Bot Prevention**: reCAPTCHA on application submission

### **🔗 Deep Links and Routing**

**Deep Link Patterns:**
- **Job Detail**: `app://tenant/{tenantId}/job/{postId}`
- **Application**: `app://tenant/{tenantId}/application/{applicationId}`
- **Interview**: `app://tenant/{tenantId}/interview/{interviewId}`
- **Offer**: `app://tenant/{tenantId}/offer/{offerId}`

**Web Links:**
- **QR Codes**: `https://jobs.hrx.com/apply/{postId}`
- **Marketing Site**: `https://jobs.hrx.com/job/{postId}`

### **📊 Analytics and Logging**

**Events to Capture:**
```typescript
interface AnalyticsEvent {
  event: 'post_view' | 'filter_apply' | 'start_application' | 'submit_application' | 'abandon_application' | 'error';
  tenantId: string;
  postId?: string;
  applicationId?: string;
  userId?: string;
  properties: Record<string, any>;
  timestamp: number;
}
```

**Required Properties:**
- **post_view**: `postId`, `source`, `location`
- **filter_apply**: `filters`, `resultCount`
- **start_application**: `postId`, `step`
- **submit_application**: `postId`, `applicationId`, `source`
- **abandon_application**: `postId`, `step`, `reason`

### **📄 Copy and Legal**

**Standard Copy:**
- **Apply CTA**: "Apply Now"
- **Save CTA**: "Save Job"
- **Share CTA**: "Share Job"
- **EEO Disclaimer**: "We are an equal opportunity employer"
- **Consent Text**: "I consent to receive communications about this application"

**Required Consent:**
- **Email Communications**: "I agree to receive email updates about my application"
- **Data Processing**: "I consent to the processing of my personal data"
- **Storage Location**: `consents` array in application document

### **✅ Acceptance Criteria**

**Done Criteria:**

**Job Listing:**
- ✅ Display jobs with filters and search
- ✅ Infinite scroll pagination
- ✅ Offline caching
- ✅ Deep link support

**Job Detail:**
- ✅ Show complete job information
- ✅ Display company details
- ✅ Show location on map
- ✅ Support for attachments

**Application Submission:**
- ✅ Multi-step form with validation
- ✅ Resume upload
- ✅ Screening questions
- ✅ Guest and authenticated flows
- ✅ Success confirmation

**Error States:**
- ✅ Network error handling
- ✅ Validation error display
- ✅ Rate limit messaging
- ✅ Duplicate application prevention

**Notifications:**
- ✅ Push notifications for status updates
- ✅ Email confirmations
- ✅ Deep link navigation

### **🔧 API/Function Expectations**

**Callable Functions:**
```typescript
// Score candidate for job
export const scoreCandidateForJob = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  // Scores candidate against job requirements
});

// Apply to post
export const applyToPost = onCall({
  cors: true,
  maxInstances: 20
}, async (request) => {
  // Handles public job applications
});
```

**Example Request/Response:**
```typescript
// Apply to Post Request
{
  tenantId: "tenant_abc",
  postId: "post_123",
  applicant: {
    name: "John Smith",
    email: "john@email.com",
    phone: "+1-555-123-4567"
  },
  workAuth: "citizen",
  answers: [
    {questionId: "q1", answer: "yes"}
  ],
  source: "Companion"
}

// Apply to Post Response
{
  success: true,
  action: "applied",
  applicationId: "app_789",
  message: "Your application has been submitted successfully"
}
```

### **🌍 Internationalization/Formatting**

**Locales:**
- **Primary**: en-US
- **Secondary**: es-MX, fr-CA
- **Currency**: USD formatting
- **Timezone**: UTC timestamps, display in user's timezone

**Feature Flags:**
- **Guest Apply**: `enable_guest_apply`
- **AI Recommendations**: `enable_ai_recommendations`
- **Screening Branching**: `enable_conditional_questions`
- **Save Job**: `enable_save_job`
- **Push Notifications**: `enable_push_notifications`

---

## **🎯 Summary**

This comprehensive specification provides everything needed to build a complete jobs board and application workflow in the Flutter app that integrates seamlessly with the existing HRX Recruiter system. The specification covers:

- **Complete data contracts** for all entities
- **End-to-end application workflow** with validation
- **Real-time notifications** and status updates
- **Security and access controls**
- **Performance and UX guidelines**
- **Analytics and tracking requirements**
- **Internationalization support**

The Flutter app can now implement a fully functional jobs board that matches the web application's capabilities while providing an optimized mobile experience for candidates and employees.
