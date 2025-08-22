# Prospecting Hub Implementation

## Overview

The Prospecting Hub is an AI-powered prospect discovery and outreach automation system integrated into the CRM. It allows sales reps to find new business opportunities using natural language prompts and AI-powered scoring.

## Features

### 🎯 Core Functionality
- **Natural Language Search**: Type prompts like "Find me 50 ops managers in Dallas who might need temp workers"
- **AI-Powered Scoring**: Automatic staffing fit and call priority scoring
- **Apollo Integration**: Real-time contact and company data
- **CRM Integration**: Seamless addition of prospects to CRM
- **Task Creation**: Generate call lists with AI-suggested openers
- **Email Campaigns**: Template-based email sequences
- **Deduplication**: Automatic filtering against existing CRM contacts

### 📊 AI Capabilities
- **Prompt Parsing**: Converts natural language to structured search parameters
- **Prospect Scoring**: 0-100 scoring for staffing fit and call priority
- **Personalized Openers**: AI-generated conversation starters
- **Signal Analysis**: Job postings, funding, growth indicators

### 🔧 Technical Features
- **Saved Searches**: Reusable search templates with scheduling
- **Advanced Filters**: Location, industry, company size, scoring thresholds
- **Bulk Operations**: Multi-select actions for efficiency
- **Compliance**: GDPR/CCPA compliant business contact data
- **Analytics**: Comprehensive tracking and reporting

## Architecture

### Frontend Components
```
src/pages/TenantViews/ProspectingHub.tsx     # Main prospecting interface
src/components/EmailTemplatesManager.tsx     # Email template management
src/pages/TenantViews/TenantCRM.tsx          # CRM integration (updated)
```

### Backend Functions
```
functions/src/prospecting.ts                 # Core prospecting logic
functions/src/index.ts                       # Function exports (updated)
```

### Data Models

#### ProspectingResult
```typescript
interface ProspectingResult {
  id: string;
  contact: {
    firstName: string;
    lastName: string;
    title: string;
    email?: string;
    phone?: string;
    linkedinUrl?: string;
  };
  company: {
    name: string;
    domain?: string;
    location?: string;
    industry?: string;
    size?: string;
  };
  scores: {
    staffingFit: number;
    callPriority: number;
    rationale: string;
  };
  opener: string;
  status: 'new' | 'added_to_crm' | 'in_sequence' | 'called' | 'emailed' | 'dismissed';
  signals?: {
    jobPostings?: number;
    funding?: string;
    growth?: string;
    news?: string[];
  };
}
```

#### SavedSearch
```typescript
interface SavedSearch {
  id: string;
  name: string;
  prompt: string;
  parsed: ParsedPrompt;
  createdByUid: string;
  visibility: 'private' | 'team' | 'company';
  schedule?: { freq: 'none' | 'daily' | 'weekly'; byHour?: number };
  lastRun?: Date;
  resultCount?: number;
}
```

## Setup & Installation

### 1. Environment Variables
Ensure these secrets are configured in Firebase:
```bash
APOLLO_API_KEY=your_apollo_api_key
OPENAI_API_KEY=your_openai_api_key
```

### 2. Deploy Functions
```bash
# Deploy only prospecting functions
./deploy_safe_prospecting.sh

# Or deploy manually
firebase deploy --only functions:runProspecting,functions:saveProspectingSearch,functions:addProspectsToCRM,functions:createCallList
```

### 3. Firestore Collections
The system creates these collections automatically:
- `tenants/{tenantId}/prospecting_runs` - Search results and metadata
- `tenants/{tenantId}/prospecting_saved_searches` - Saved search templates
- `tenants/{tenantId}/email_templates` - Email templates and sequences

## Usage Guide

### Basic Workflow

1. **Navigate to CRM** → **Prospect Tab**
2. **Enter Search Prompt**: Natural language description of target prospects
3. **Review Results**: AI-scored prospects with suggested openers
4. **Take Action**: Add to CRM, create call list, or start email campaign

### Advanced Features

#### Saved Searches
- Save frequently used searches for quick access
- Share searches with team members
- Schedule automatic re-runs

#### Email Templates
- Create reusable email templates with variables
- Use dynamic content like `{{first_name}}`, `{{company_name}}`
- Organize by visibility (private/team/company)

#### Bulk Operations
- Select multiple prospects for batch actions
- Export results to CSV
- Create call lists with AI-generated task descriptions

### Example Prompts

```
"Find me 50 operations managers in Dallas who might need temp workers"
"Show me 25 HR directors in healthcare companies in Texas"
"Find 100 manufacturing supervisors in the Midwest with 50+ employees"
"Get me 75 IT managers in tech companies that recently raised funding"
```

## API Endpoints

### runProspecting
Executes a prospecting search with AI scoring.

**Request:**
```typescript
{
  prompt: string;
  filters?: ProspectingFilters;
  tenantId: string;
}
```

**Response:**
```typescript
{
  results: ProspectingResult[];
  summary: ProspectingSummary;
  runId: string;
}
```

### saveProspectingSearch
Saves a search for future use.

**Request:**
```typescript
{
  name: string;
  prompt: string;
  filters?: ProspectingFilters;
  visibility: 'private' | 'team' | 'company';
  tenantId: string;
}
```

### addProspectsToCRM
Adds selected prospects to CRM as contacts and companies.

**Request:**
```typescript
{
  resultIds: string[];
  tenantId: string;
}
```

### createCallList
Creates call tasks from selected prospects.

**Request:**
```typescript
{
  resultIds: string[];
  tenantId: string;
  assignTo?: string;
}
```

## AI Integration

### Prompt Parsing
Uses GPT-4 to extract structured data from natural language:
- Job titles and roles
- Geographic locations
- Industry sectors
- List size requirements
- Exclusion criteria

### Prospect Scoring
AI evaluates each prospect on:
- **Staffing Fit (0-100)**: Likelihood of needing temporary staffing
- **Call Priority (0-100)**: Urgency for outreach
- **Rationale**: AI explanation of scoring
- **Opener**: Personalized conversation starter

### Scoring Factors
- Industry alignment with staffing needs
- Company size and growth indicators
- Job posting activity
- Recent funding or expansion news
- Geographic market demand

## Compliance & Security

### Data Handling
- Business contact data only (B2B)
- GDPR/CCPA compliant
- Automatic unsubscribe mechanisms
- Suppression list management

### Access Control
- Tenant-based data isolation
- Role-based permissions
- Audit logging for all actions

## Monitoring & Analytics

### AI Logging Events
- `prospecting_search_started`
- `prospecting_search_completed`
- `prospecting_search_error`
- `prospecting_search_saved`
- `prospects_added_to_crm`
- `call_list_created`

### Key Metrics
- Searches run per day/week
- Results returned and conversion rates
- CRM additions and task completion
- Email deliverability and response rates

## Troubleshooting

### Common Issues

1. **No Apollo Results**
   - Check APOLLO_API_KEY configuration
   - Verify search parameters are valid
   - Check Apollo API rate limits

2. **AI Scoring Errors**
   - Verify OPENAI_API_KEY configuration
   - Check OpenAI API rate limits
   - Review prompt formatting

3. **CRM Integration Issues**
   - Verify tenant permissions
   - Check Firestore security rules
   - Review data validation

### Debug Mode
Enable detailed logging by setting:
```bash
export DEBUG_PROSPECTING=true
```

## Future Enhancements

### Planned Features
- **Hot Signals Feed**: Real-time hiring alerts
- **Geo Map View**: Visual prospect clustering
- **Reply Classifier**: AI-powered response analysis
- **A/B Testing**: Automated email optimization
- **Advanced Analytics**: Revenue attribution and ROI tracking

### Technical Improvements
- **Caching**: Redis-based result caching
- **Batch Processing**: Background job queues
- **Real-time Updates**: WebSocket notifications
- **Mobile Support**: React Native integration

## Support

For technical support or feature requests:
1. Check the troubleshooting section
2. Review AI logging for error details
3. Contact the development team with specific error messages

## Changelog

### v1.0.0 (Current)
- Initial implementation
- Basic prospecting search
- AI scoring and openers
- CRM integration
- Email template management
- Saved searches
- Bulk operations
