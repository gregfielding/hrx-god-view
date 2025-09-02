# AI Logging Cost Containment Policy

## Overview
This document outlines the emergency cost containment measures implemented to prevent runaway Firebase Functions billing due to excessive AI logging.

## Emergency Measures Implemented

### 1. AI Log Creation (`firestoreLogAILogCreated`)
- **Status**: DISABLED (ENABLED: false)
- **Rationale**: This function was creating meta-logs for every AI log entry, causing infinite loops
- **Impact**: 99%+ reduction in AI log creation
- **Version**: v3 (emergency disabled)

### 2. AI Log Processing (`processAILog`)
- **Status**: DISABLED (ENABLED: false)
- **Rationale**: Processing every AI log was expensive and unnecessary during cost crisis
- **Impact**: 100% reduction in AI log processing
- **Version**: v3 (emergency disabled)

### 3. AI Log Action (`logAIAction`)
- **Status**: 1% SAMPLING (99% blocked)
- **Rationale**: Core logging function was being called hundreds of times per second
- **Impact**: 99% reduction in AI log entries
- **Method**: Random sampling with `Math.random() > 0.01`

### 4. AI Log Updated (`firestoreLogAILogUpdated`)
- **Status**: DISABLED
- **Rationale**: Updates on ai_logs are mostly bookkeeping (processed flags, timestamps)
- **Impact**: Eliminates noisy update triggers
- **Policy**: Keep disabled until cost crisis resolved

## Monitoring Strategy

### Functions to Monitor
1. **`processAILog`** - Should be ~0 req/sec (disabled)
2. **`firestoreLogAILogCreated`** - Should be ~0 req/sec (disabled)
3. **`logAIAction`** - Should be ~1% of previous rates (sampling)

### Monitoring Locations
- Firebase Console > Functions > Metrics
- Google Cloud Console > Cloud Functions > Metrics
- Look for request rates and error rates

### Expected Results
- **Before**: 200+ req/sec on AI logging functions
- **After**: 0-5 req/sec on AI logging functions
- **Cost Impact**: 95%+ reduction in function invocation costs

## Re-enablement Strategy

### Phase 1: Cost Stabilization (Current)
- Keep all emergency measures active
- Monitor billing for 24-48 hours
- Confirm req/sec rates remain low

### Phase 2: Selective Re-enablement
1. **Enable `logAIAction`** with 10% sampling (instead of 1%)
2. **Monitor** for 24 hours
3. **If stable**: Increase to 25% sampling
4. **If stable**: Increase to 50% sampling

### Phase 3: Full Restoration
1. **Enable `processAILog`** with aggressive filtering
2. **Enable `firestoreLogAILogCreated`** with selective logging
3. **Monitor** for any cost spikes
4. **Rollback** immediately if costs increase

## Configuration

### Environment Variables
```bash
# Emergency kill switch
AI_LOGGING_DISABLED=true

# Circuit breaker
CIRCUIT_BREAKER=on
```

### Safe Function Configs
```typescript
// In safeFirestoreLogAILogCreated.ts
const SAFE_CONFIG = {
  ENABLED: false, // TEMPORARILY DISABLED
  SAMPLING_RATE: 0.01, // 1% sampling
  MIN_URGENCY_SCORE: 9, // Only critical events
};

// In safeAiEngineProcessor.ts
const SAFE_CONFIG = {
  ENABLED: false, // TEMPORARILY DISABLED
  SAMPLING_RATE: 0.001, // 0.1% sampling
  MAX_ENGINES_TO_PROCESS: 0, // Process no engines
};
```

## Rollback Plan

### Immediate Rollback (if needed)
1. Set `AI_LOGGING_DISABLED=false` in environment
2. Set `ENABLED: true` in safe function configs
3. Deploy functions immediately
4. Monitor for cost spikes

### Emergency Contact
- **Primary**: Development team
- **Escalation**: System administrator
- **Fallback**: Cloud console manual function disable

## Lessons Learned

### Root Causes
1. **Infinite Loops**: AI logging functions triggering each other
2. **Excessive Triggers**: Every document change creating AI logs
3. **No Rate Limiting**: Functions running without limits
4. **Meta-logging**: Logging about logging creating cascades

### Prevention Measures
1. **Circuit Breakers**: Environment-based kill switches
2. **Sampling**: Random sampling for high-volume functions
3. **Selective Logging**: Only log important events
4. **Rate Limiting**: Per-user and per-function limits
5. **Monitoring**: Real-time cost and rate monitoring

## Status
- **Date**: January 2025
- **Status**: EMERGENCY ACTIVE
- **Next Review**: 24 hours
- **Owner**: Development Team
