#!/bin/bash

echo "🛡️ DEPLOYING HARDENED DEAL UPDATED (Playbook Compliant)"
echo "======================================================"

# Hardened Deal Updated Function (Phase 1)
SAFE_DEAL_UPDATED_FUNCTION=(
  "onDealUpdated"
)

echo ""
echo "📋 Function to deploy (allowlist approach):"
for func in "${SAFE_DEAL_UPDATED_FUNCTION[@]}"; do
  echo "   • $func"
done

echo ""
echo "🔒 Hardening Playbook Compliance:"
echo "   • Circuit breaker enabled (CIRCUIT_BREAKER env var)"
echo "   • Max execution time: 55s (under 60s limit)"
echo "   • Change-only processing (§2.2) - only relevant fields trigger updates"
echo "   • Self-write ignore (§2.3) - prevents recursive triggers"
echo "   • Safe batching (§2.6) - max 50 locations per batch with backoff"
echo "   • AbortSignal timeout handling"
echo "   • Input validation and error handling"

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
for func in "${SAFE_DEAL_UPDATED_FUNCTION[@]}"; do
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
  echo "   2. Test deal updates to verify pipeline totals updates work correctly"
  echo "   3. Check Cloud Run logs for any issues"
  echo "   4. Verify circuit breaker functionality"
  echo ""
  echo "🛡️ Safety Features Active:"
  echo "   • Circuit breaker: Set CIRCUIT_BREAKER=on to disable function"
  echo "   • Timeout limits: Function will abort after 55s"
  echo "   • Change-only processing: Only relevant field changes trigger updates"
  echo "   • Self-write ignore: Prevents recursive trigger loops"
  echo "   • Query limits: Max 1000 deals, 100 locations per company"
  echo "   • Revenue calculation: Handles qualification data and timeline projections"
  echo ""
  echo "📊 Monitoring Commands:"
  echo "   • View logs: firebase functions:log --only $FUNCTIONS_LIST"
  echo "   • Check status: firebase functions:list | grep -E '(${FUNCTIONS_LIST//,/|})'"
  echo "   • Monitor costs: Check Firebase Console > Usage and billing"
  echo ""
  echo "🎯 Expected Impact:"
  echo "   • 90%+ reduction in unnecessary invocations (change-only processing)"
  echo "   • Prevention of recursive trigger loops (self-write ignore)"
  echo "   • Controlled query limits (max 1000 deals, 100 locations)"
  echo "   • Graceful timeout handling (55s limit)"
  echo "   • Robust pipeline totals calculation with revenue projections"
else
  echo ""
  echo "❌ DEPLOYMENT FAILED!"
  echo "Please check the error messages above and try again."
  exit 1
fi

echo ""
echo "🎯 Phase 1 Function 4 Complete: Deal Updated Hardened"
echo "Ready for next Phase 1 function: firestorelogAILogCreated"
