#!/bin/bash

echo "🛡️ DEPLOYING HARDENED AI LOG CREATED (Selective Logging)"
echo "======================================================="

# Hardened AI Log Created Function (Phase 1)
SAFE_AI_LOG_CREATED_FUNCTION=(
  "firestoreLogAILogCreated"
)

echo ""
echo "📋 Function to deploy (allowlist approach):"
for func in "${SAFE_AI_LOG_CREATED_FUNCTION[@]}"; do
  echo "   • $func"
done

echo ""
echo "🔒 Hardening Playbook Compliance:"
echo "   • Circuit breaker enabled (CIRCUIT_BREAKER env var)"
echo "   • Max execution time: 55s (under 60s limit)"
echo "   • Selective logging - only high-urgency events (score >= 7)"
echo "   • Skip meta-logging events to prevent infinite loops"
echo "   • Skip low-priority event types (cache_hit, system.heartbeat)"
echo "   • AbortSignal timeout handling"

echo ""
echo "⚙️ Production Safety Defaults (Gen2/Cloud Run):"
echo "   • Max instances: 2 (start conservative)"
echo "   • Concurrency: 1 (event triggers)"
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
for func in "${SAFE_AI_LOG_CREATED_FUNCTION[@]}"; do
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
  echo "   2. Check AI logs to verify selective logging is working"
  echo "   3. Check Cloud Run logs for any issues"
  echo "   4. Verify circuit breaker functionality"
  echo ""
  echo "🛡️ Safety Features Active:"
  echo "   • Circuit breaker: Set CIRCUIT_BREAKER=on to disable function"
  echo "   • Timeout limits: Function will abort after 55s"
  echo "   • Selective logging: Only urgency score >= 7 events logged"
  echo "   • Skip meta-logging: Prevents infinite loops"
  echo "   • Skip low-priority events: cache_hit, system.heartbeat, etc."
  echo ""
  echo "📊 Monitoring Commands:"
  echo "   • View logs: firebase functions:log --only $FUNCTIONS_LIST"
  echo "   • Check status: firebase functions:list | grep -E '(${FUNCTIONS_LIST//,/|})'"
  echo "   • Monitor costs: Check Firebase Console > Usage and billing"
  echo ""
  echo "🎯 Expected Impact:"
  echo "   • 90%+ reduction in meta-logging (selective logging)"
  echo "   • Prevention of infinite logging loops"
  echo "   • Focus on high-urgency events only"
  echo "   • Graceful timeout handling (55s limit)"
  echo "   • Significant cost reduction from reduced logging"
else
  echo ""
  echo "❌ DEPLOYMENT FAILED!"
  echo "Please check the error messages above and try again."
  exit 1
fi

echo ""
echo "🎯 Phase 1 Function 6 Complete: AI Log Created Hardened (Selective Logging)"
echo "Ready for next Phase 1 function: getSalespeopleForTenant"
