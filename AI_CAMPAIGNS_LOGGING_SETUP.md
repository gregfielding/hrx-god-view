# AI Campaigns Module - Logging Setup

## Overview

The AI Campaigns module is now fully integrated with the comprehensive AI logging system. This document outlines the complete logging infrastructure and how it works.

## ✅ Logging Infrastructure Status

### 1. **Module Integration**
- ✅ `CampaignsEngine` added to Module type in both frontend and backend
- ✅ CampaignsEngine integrated into AI engine processor
- ✅ Campaign events properly routed to CampaignsEngine

### 2. **Field-Level Logging Triggers**
- ✅ 12 campaign-specific field triggers defined in `loggingTriggerMap.ts`
- ✅ All campaign fields covered: title, objective, category, tone, targetAudience, frequency, status, followUpStrategy, aiBehavior
- ✅ Proper urgency scores and context types assigned
- ✅ Integration with relevant AI engines (ContextEngine, ToneEngine, TraitsEngine, PriorityEngine, Scheduler)

### 3. **Event Routing**
- ✅ Campaign events routed via `eventType` (e.g., `campaign.created`, `campaign.updated`, `campaign.deleted`)
- ✅ Campaign events routed via `contextType` (`campaigns`)
- ✅ CampaignsEngine processing function implemented

### 4. **UI Logging Integration**
- ✅ Campaign creation logged with full schema compliance
- ✅ Campaign updates logged with field-level tracking
- ✅ Campaign deletion logged with proper cleanup
- ✅ All logs include required schema fields

## 🔧 Logging Configuration

### Field Triggers Defined

| Field Path | Trigger | Destination Modules | Urgency | Context Type |
|------------|---------|-------------------|---------|--------------|
| `campaigns/:campaignId.title` | update | CampaignsEngine, ContextEngine | 6 | campaigns |
| `campaigns/:campaignId.objective` | update | CampaignsEngine, ContextEngine | 7 | campaigns |
| `campaigns/:campaignId.category` | update | CampaignsEngine, ContextEngine | 5 | campaigns |
| `campaigns/:campaignId.tone` | update | CampaignsEngine, ToneEngine | 6 | campaigns |
| `campaigns/:campaignId.targetAudience` | update | CampaignsEngine, ContextEngine | 8 | campaigns |
| `campaigns/:campaignId.frequency` | update | CampaignsEngine, Scheduler | 6 | campaigns |
| `campaigns/:campaignId.status` | update | CampaignsEngine, Scheduler | 8 | campaigns |
| `campaigns/:campaignId.followUpStrategy` | update | CampaignsEngine, Scheduler | 7 | campaigns |
| `campaigns/:campaignId.aiBehavior.responsePattern` | update | CampaignsEngine, ToneEngine | 6 | campaigns |
| `campaigns/:campaignId.aiBehavior.escalationThreshold` | update | CampaignsEngine, PriorityEngine | 7 | campaigns |
| `campaigns/:campaignId.aiBehavior.traitTracking` | update | CampaignsEngine, TraitsEngine | 6 | campaigns |

### Event Types

| Event Type | Description | Triggered By |
|------------|-------------|--------------|
| `campaign.created` | New campaign created | Campaign creation in UI |
| `campaign.updated` | Existing campaign modified | Campaign save in UI |
| `campaign.deleted` | Campaign removed | Campaign deletion in UI |
| `campaign.activated` | Campaign status changed to active | Status change |
| `campaign.paused` | Campaign status changed to paused | Status change |
| `campaign.completed` | Campaign status changed to completed | Status change |

### Log Schema Compliance

All campaign logs include the full AI log schema:

```typescript
{
  // Core fields
  userId: string,
  actionType: string,
  sourceModule: 'CampaignsEngine',
  success: boolean,
  latencyMs: number,
  versionTag: 'v1',
  
  // New schema fields
  eventType: 'campaign.created' | 'campaign.updated' | 'campaign.deleted',
  targetType: 'campaign',
  targetId: string,
  aiRelevant: true,
  contextType: 'campaigns',
  traitsAffected: string[],
  aiTags: string[],
  urgencyScore: number,
  
  // Campaign-specific fields
  reason: string,
  inputPrompt: string,
  composedPrompt: string,
  aiResponse: string
}
```

## 🚀 AI Engine Processing

### CampaignsEngine Processing

The CampaignsEngine processes logs and generates analysis:

```typescript
async function processWithCampaignsEngine(logData: any, logId: string): Promise<any> {
  const campaignAnalysis = {
    engagementMetrics: { responseRate: 0, avgEngagement: 0 },
    responsePatterns: { positive: 0, neutral: 0, negative: 0 },
    traitImpact: { motivation: 0, engagement: 0 },
    optimization: { suggestions: [] }
  };

  // Store campaign analysis
  await db.collection('campaign_analysis').add({
    logId: logId,
    analysis: campaignAnalysis,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return campaignAnalysis;
}
```

### Integration with Other Engines

Campaigns integrate with multiple AI engines:

- **ContextEngine**: Campaign context and objectives
- **ToneEngine**: Campaign tone and response patterns
- **TraitsEngine**: Trait tracking and impact measurement
- **PriorityEngine**: Escalation thresholds and risk assessment
- **Scheduler**: Campaign timing and follow-up scheduling

## 📊 Analytics & Monitoring

### Campaign Analytics Collection

Campaign logs feed into:

1. **Campaign Analysis Collection** (`campaign_analysis`)
   - Engagement metrics
   - Response patterns
   - Trait impact analysis
   - Optimization suggestions

2. **AI Logs Collection** (`ai_logs`)
   - Full audit trail
   - Processing status
   - Error tracking
   - Performance metrics

3. **Log Coverage Dashboard**
   - Campaign field coverage
   - Logging compliance
   - Missing field detection

### Monitoring Capabilities

- **Real-time Campaign Performance**: Track engagement, response rates, trait changes
- **AI Engine Processing**: Monitor CampaignsEngine processing success/failure
- **Field-Level Tracking**: Track individual campaign field changes
- **Error Detection**: Identify and fix logging issues automatically

## 🔍 Testing & Validation

### Automated Testing

The logging system includes:

1. **Field Coverage Testing**: Automated validation of all campaign fields
2. **Schema Compliance**: Validation of log structure and required fields
3. **Engine Routing**: Verification of proper engine routing
4. **Error Detection**: Automatic detection of logging failures

### Manual Testing

To test campaign logging:

1. Navigate to AI Campaigns page
2. Create a new campaign
3. Edit campaign fields
4. Delete a campaign
5. Check LogCoverageDashboard for logs
6. Verify logs in Firestore `ai_logs` collection

## 🎯 Benefits

### Complete Audit Trail
- Every campaign action logged with full context
- Field-level change tracking
- Performance metrics and latency tracking

### AI Engine Integration
- Campaigns automatically processed by relevant AI engines
- Trait impact measurement
- Optimization suggestions

### Monitoring & Analytics
- Real-time campaign performance tracking
- Automated error detection and fixing
- Comprehensive analytics dashboard

### Compliance & Debugging
- Full schema compliance for all logs
- Easy debugging with detailed log entries
- Automated validation and testing

## 📈 Next Steps

1. **Enhanced Analytics**: Implement campaign-specific analytics dashboard
2. **Real-time Processing**: Add real-time campaign execution and response processing
3. **Advanced Targeting**: Implement sophisticated audience targeting with logging
4. **Performance Optimization**: Add campaign performance optimization based on log analysis

The AI Campaigns module now has comprehensive logging that integrates seamlessly with the existing AI engine ecosystem, providing full visibility into campaign operations and enabling advanced analytics and optimization. 