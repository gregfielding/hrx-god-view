#!/bin/bash

echo "🛡️ DEPLOYING HARDENED GET TASKS (Query Limits & Input Validation)"
echo "================================================================="

# Hardened Get Tasks Function (Phase 2)
SAFE_GET_TASKS_FUNCTION=(
  "getTasks"
)

echo ""
echo "📋 Function to deploy (allowlist approach):"
for func in "${SAFE_GET_TASKS_FUNCTION[@]}"; do
  echo "   • $func"
done

echo ""
echo "🔒 Hardening Playbook Compliance:"
echo "   • Circuit breaker enabled (CIRCUIT_BREAKER env var)"
echo "   • Max execution time: 55s (under 60s limit)"
echo "   • Input validation: Strict validation of all task retrieval parameters"
echo "   • Query limits: Max 100 tasks, max 8 filters, max 5 client filters"
echo "   • Array length limits: status (10), type (10), category (10), priority (10), tags (20)"
echo "   • Field length limits: orderBy (50 characters)"
echo "   • AbortSignal timeout handling"

echo ""
echo "⚙️ Production Safety Defaults (Gen2/Cloud Run):"
echo "   • Max instances: 2 (start conservative)"
echo "   • Concurrency: 1 (callable functions)"
echo "   • Min instances: 0 (keep cold)"
echo "   • Timeout: 55s (short timeouts surface bugs)"
echo "   • Memory: 512MiB (task retrieval requires memory)"
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
for func in "${SAFE_GET_TASKS_FUNCTION[@]}"; do
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
  echo "   2. Test task retrieval functionality"
  echo "   3. Check Cloud Run logs for any issues"
  echo "   4. Verify query limits are working correctly"
  echo "   5. Test input validation with various parameters"
  echo "   6. Test client-side filtering functionality"
  echo ""
  echo "🛡️ Safety Features Active:"
  echo "   • Circuit breaker: Set CIRCUIT_BREAKER=on to disable function"
  echo "   • Timeout limits: Function will abort after 55s"
  echo "   • Query limits: Max 100 tasks returned per call"
  echo "   • Filter limits: Max 8 server-side filters, max 5 client-side filters"
  echo "   • Input validation: Strict validation of all parameters"
  echo "   • Array limits: Prevents oversized filter arrays"
  echo "   • Cost tracking: Per-operation cost estimation"
  echo ""
  echo "📊 Monitoring Commands:"
  echo "   • View logs: firebase functions:log --only $FUNCTIONS_LIST"
  echo "   • Check status: firebase functions:list | grep -E '(${FUNCTIONS_LIST//,/|})'"
  echo "   • Monitor costs: Check Firebase Console > Usage and billing"
  echo ""
  echo "🎯 Expected Impact:"
  echo "   • Massive cost reduction from query limits (max 100 vs unlimited)"
  echo "   • Improved reliability with input validation and timeout handling"
  echo "   • Prevention of oversized queries with filter limits"
  echo "   • Better performance with controlled client-side filtering"
  echo "   • Enhanced security with strict input validation"
  echo ""
  echo "🎯 Phase 2 Function 3 Complete: Get Tasks Hardened (Query Limits & Input Validation)"
  echo "Ready for next Phase 2 function: startAIThread"
else
  echo ""
  echo "❌ DEPLOYMENT FAILED!"
  echo "Please check the error messages above and try again."
  exit 1
fi

echo ""
echo "🎯 Phase 2 Function 3 Complete: Get Tasks Hardened (Query Limits & Input Validation)"
echo "Ready for next Phase 2 function: startAIThread"
