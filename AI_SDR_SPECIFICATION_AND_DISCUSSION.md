# AI SDR Division — Phase 1 Build Specification & Discussion

**Date:** January 2025  
**Status:** Planning Phase  
**Version:** 1.0

---

## Original Specification

### Overview
We are building an **Autonomous AI SDR Division** inside our CRM, powered by GPT-5, that will:
1. **Identify high-potential companies** from internal data, web scraping, and third-party APIs.
2. **Find best-fit contacts** inside those companies (decision-makers, influencers, champions).
3. **Enrich contact details** (emails, phones, LinkedIn URLs) via enrichment APIs & scraping.
4. **Draft and send personalized outreach emails** from a dummy account (e.g., brian@c1staffing.com).
5. **Follow up automatically**, learning and improving based on replies and performance.
6. **Hand off warm leads** directly into the sales pipeline.

The AI will operate continuously in the background, using **Pub/Sub triggers** for new companies and a **daily refresh cycle** for new opportunities.

---

## Firestore Structure & Zod Schemas

### Collections
- `/sdr_candidates`
- `/sdr_contacts`
- `/sdr_outreach`
- `/sdr_logs`

### Original Zod Schemas
```typescript
import { z } from "zod";

export const SDRCandidateSchema = z.object({
  id: z.string(),
  source: z.enum(["api", "scraper", "manual"]),
  companyName: z.string(),
  domain: z.string().url().optional(),
  industry: z.string().optional(),
  location: z.string().optional(),
  size: z.number().optional(),
  status: z.enum(["pending", "enriched", "contact_found", "outreach_started", "closed"]),
  score: z.number().min(0).max(100).optional(),
  createdAt: z.number(),
  updatedAt: z.number()
});

export const SDRContactSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  name: z.string(),
  title: z.string(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  linkedin: z.string().url().optional(),
  role: z.enum(["decision_maker", "influencer", "gatekeeper", "other"]),
  enrichmentScore: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number()
});

export const SDROutreachSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  emailSubject: z.string(),
  emailBody: z.string(),
  sequenceStep: z.number(),
  status: z.enum(["pending", "sent", "opened", "clicked", "replied", "bounced"]),
  sentAt: z.number().optional(),
  updatedAt: z.number()
});

export const SDRLogSchema = z.object({
  id: z.string(),
  type: z.string(),
  message: z.string(),
  meta: z.record(z.any()).optional(),
  createdAt: z.number()
});
```

---

## Enhanced Schema Design (Suggested Improvements)

### Additional Fields for Better Tracking
```typescript
export const SDRCandidateSchema = z.object({
  // ... existing fields ...
  enrichmentAttempts: z.number().default(0),
  lastEnrichmentAttempt: z.number().optional(),
  enrichmentErrors: z.array(z.string()).default([]),
  aiAnalysis: z.object({
    companySummary: z.string().optional(),
    staffingNeeds: z.string().optional(),
    urgencyFactors: z.array(z.string()).optional(),
  }).optional(),
});

export const SDROutreachSchema = z.object({
  // ... existing fields ...
  emailId: z.string().optional(), // For tracking opens/clicks
  replyData: z.object({
    receivedAt: z.number().optional(),
    sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
    content: z.string().optional(),
  }).optional(),
});
```

---

## Implementation Architecture

### Pub/Sub Triggers
```typescript
// functions/src/aiSdr/index.ts
export const onSDRCandidateCreated = onDocumentCreated(
  'tenants/{tenantId}/sdr_candidates/{candidateId}',
  async (event) => {
    // Trigger enrichment pipeline
  }
);

export const dailySDRRefresh = onSchedule('0 9 * * *', async (event) => {
  // Daily enrichment and scoring
});
```

### AI Logging Integration
```typescript
// Use existing AI logging system
await aiLogging.logEvent({
  module: 'ai-sdr',
  eventType: 'candidate_enriched',
  targetType: 'company',
  targetId: candidateId,
  confidenceScore: enrichmentScore,
  traitsAffected: ['company_data', 'contact_info'],
  metadata: {
    source: 'apollo_api',
    contactsFound: contacts.length,
    enrichmentScore
  }
});
```

---

## GPT-5 Prompt Templates

### Sales Research Prompt
```
You are a top-performing SDR researching {{companyName}} for staffing opportunities.
1. Summarize what this company does.
2. Identify the top 3 decision-makers for workforce or HR needs.
3. Suggest why they may need staffing help now.
Return your answer as JSON matching SDRCandidateSchema + SDRContactSchema.
```

### Outreach Prompt
```
You are writing a cold outreach email from C1 Staffing to {{contactName}}, {{contactTitle}} at {{companyName}}.
Tone: professional, warm, concise.
Goal: secure an intro call to discuss staffing solutions.
Include a compelling reason based on their company's recent activities or industry trends.
Output: subject + body in plain text, no HTML.
```

### Follow-Up Prompt
```
Review our last email to {{contactName}} and any response.
Draft a polite follow-up that keeps the conversation going and increases chances of a reply.
If no reply, assume interest is possible but low — be concise.
```

---

## Email Sequencer Logic
- **Step 1:** Intro email (Day 0)
- **Step 2:** Follow-up 1 (Day 3)
- **Step 3:** Follow-up 2 (Day 7)
- **Step 4:** Break-up email (Day 14)

### Reply Handling
- **Positive** → Create a Deal in CRM + assign to rep
- **Neutral** → Continue sequence with adjusted messaging
- **Negative** → Stop sequence + log in /sdr_logs

---

## CRM Integration Points

### 1. Suggested Companies Tab
- Pulls from `/sdr_candidates` with status pending or enriched and score > threshold
- Sales can approve/reject

### 2. Automation on Approve
- Contact records created in `/contacts`
- Deal record created in `/deals` if SDR sequence is active

### 3. Metrics Panel
Track:
- New candidates per day
- Enrichment success rate
- Sequence open/click/reply rates
- Meetings booked

---

## Questions & Clarifications Needed

### 1. Data Sources & APIs
- **Which specific APIs** to prioritize? (Apollo.io, Clearbit, Crunchbase, etc.)
- **Budget considerations** - Some APIs can be expensive at scale
- **Rate limiting** - Existing API keys or new accounts?

### 2. Scoring Algorithm
- **Historical data source** - Where to pull "Closed-Won Similarity Scoring" data from?
- **Scoring weights** - What factors carry the most weight?
- **Threshold values** - What score threshold triggers outreach?

### 3. Email Infrastructure
- **SendGrid integration** - Use existing or create new subdomain?
- **Email templates** - Reference existing C1 Staffing templates?
- **Reply detection** - Webhook integration or polling?

### 4. CRM Integration Points
- **Deal creation** - Specific source tag for AI-created deals?
- **Contact assignment** - How to determine sales rep assignment?
- **Pipeline stages** - Specific starting stage for AI deals?

### 5. Compliance & Security
- **Opt-out management** - How to handle unsubscribe requests?
- **Data retention** - How long to keep SDR logs and outreach data?
- **GDPR compliance** - Specific data processing agreements for EU contacts?

---

## Implementation Priority

### Phase 1A (Week 1-2)
1. Set up Firestore collections and schemas
2. Implement basic candidate enrichment (single API)
3. Create GPT-5 prompts and test with sample data
4. Build basic CRM integration (Suggested Companies tab)

### Phase 1B (Week 3-4)
1. Implement email sequencing logic
2. Add reply detection and sentiment analysis
3. Set up automated deal creation
4. Add metrics dashboard

### Phase 1C (Week 5-6)
1. Implement multi-API enrichment
2. Add advanced scoring algorithm
3. Set up self-learning mechanisms
4. Add compliance features

---

## Technical Considerations

### Security & Compliance
- All email sending from dedicated subdomain (e.g., sdr.c1staffing.com) with SPF/DKIM/DMARC
- Rate-limit outbound emails to avoid blacklisting
- GDPR/CCPA compliant opt-out tracking

### Performance & Scalability
- Pub/Sub triggers for real-time processing
- Daily scheduled tasks for batch operations
- Index optimization for complex queries
- Rate limiting for API calls

### Monitoring & Analytics
- Integration with existing AI logging system
- Performance metrics tracking
- Error handling and retry logic
- Success rate monitoring

---

## Next Steps After Phase 1
- Add LinkedIn InMail automation
- Integrate phone outreach with AI-drafted call scripts
- Expand similarity scoring with more historical data
- Auto-suggest new verticals based on close rates

---

## Questions for Stakeholders

1. **Timeline** - When to start implementation?
2. **API Budget** - Monthly budget for enrichment APIs?
3. **Email Volume** - How many emails per day should the system send?
4. **Success Metrics** - Target conversion rates?
5. **Team Integration** - How should sales team interact with AI-generated leads?

---

## File Structure (Proposed)
```
functions/src/aiSdr/
├── index.ts                 # Main exports
├── schemas.ts              # Zod schemas
├── enrichment/
│   ├── candidateEnrichment.ts
│   ├── contactDiscovery.ts
│   └── emailValidation.ts
├── outreach/
│   ├── emailSequencer.ts
│   ├── replyHandler.ts
│   └── templates.ts
├── scoring/
│   ├── similarityScoring.ts
│   └── aiAnalysis.ts
└── integration/
    ├── crmIntegration.ts
    └── metrics.ts
```

---

**Last Updated:** January 2025  
**Next Review:** TBD
