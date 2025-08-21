#!/bin/bash

echo "🛡️ DEPLOYING HARDENED SALESPEOPLE FOR TENANT (Query Limits)"
echo "============================================================"

# Hardened Salespeople for Tenant Function (Phase 1)
SAFE_SALESPEOPLE_FUNCTION=(
  "getSalespeopleForTenant"
)

echo ""
echo "📋 Function to deploy (allowlist approach):"
for func in "${SAFE_SALESPEOPLE_FUNCTION[@]}"; do
  echo "   • $func"
done

echo ""
echo "🔒 Hardening Playbook Compliance:"
echo "   • Circuit breaker enabled (CIRCUIT_BREAKER env var)"
echo "   • Max execution time: 55s (under 60s limit)"
echo "   • Query limits: Max 1000 users per query, 500 salespeople returned"
echo "   • Pagination: Max 10 queries to prevent runaway reads"
echo "   • Input validation: Strict tenantId validation"
echo "   • AbortSignal timeout handling"

echo ""
echo "⚙️ Production Safety Defaults (Gen2/Cloud Run):"
echo "   • Max instances: 2 (start conservative)"
echo "   • Concurrency: 1 (callable functions)"
echo "   • Min instances: 0 (keep cold)"
echo "   • Timeout: 55s (short timeouts surface bugs)"
echo "   • Retries: off (functions are idempotent)"

echo ""
echo "🚀 Building and deploying..."

# Build the functions
echo "📦 Building TypeScript..."
cd functions
npm run build

if [ $? -ne 0 ]; then
  echo "❌ Build failed! Please check for TypeScript errors."
  exit 1
fi

echo "✅ Build successful!"

# Deploy only the hardened function (allowlist approach)
echo ""
echo "🚀 Deploying hardened function..."

# Create deployment list
FUNCTIONS_LIST=""
for func in "${SAFE_SALESPEOPLE_FUNCTION[@]}"; do
  if [ -z "$FUNCTIONS_LIST" ]; then
    FUNCTIONS_LIST="$func"
  else
    FUNCTIONS_LIST="$FUNCTIONS_LIST,$func"
  fi
done

# Deploy with production safety defaults
echo "📤 Deploying: $FUNCTIONS_LIST"
firebase deploy --only functions:$FUNCTIONS_LIST

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ DEPLOYMENT SUCCESSFUL!"
  echo ""
  echo "🔍 Next Steps:"
  echo "   1. Monitor Firebase Console billing for cost reduction"
  echo "   2. Test salespeople retrieval functionality"
  echo "   3. Check Cloud Run logs for any issues"
  echo "   4. Verify query limits are working correctly"
  echo ""
  echo "🛡️ Safety Features Active:"
  echo "   • Circuit breaker: Set CIRCUIT_BREAKER=on to disable function"
  echo "   • Timeout limits: Function will abort after 55s"
  echo "   • Query limits: Max 1000 users per query, 500 salespeople returned"
  echo "   • Pagination: Max 10 queries to prevent runaway reads"
  echo "   • Input validation: Strict tenantId and authentication checks"
  echo ""
  echo "📊 Monitoring Commands:"
  echo "   • View logs: firebase functions:log --only $FUNCTIONS_LIST"
  echo "   • Check status: firebase functions:list | grep -E '(${FUNCTIONS_LIST//,/|})'"
  echo "   • Monitor costs: Check Firebase Console > Usage and billing"
  echo ""
  echo "🎯 Expected Impact:"
  echo "   • Massive cost reduction from query limits (vs fetching all users)"
  echo "   • Prevention of runaway reads with pagination"
  echo "   • Focus on tenant-specific salespeople only"
  echo "   • Graceful timeout handling (55s limit)"
  echo "   • Significant performance improvement for large user bases"
else
  echo ""
  echo "❌ DEPLOYMENT FAILED!"
  echo "Please check the error messages above and try again."
  exit 1
fi

echo ""
echo "🎯 Phase 1 Function 7 Complete: Salespeople for Tenant Hardened (Query Limits)"
echo "Ready for next Phase 1 function: dealCoachAnalyzeCallable"
