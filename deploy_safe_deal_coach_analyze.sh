#!/bin/bash

echo "🛡️ DEPLOYING HARDENED DEAL COACH ANALYZE (OpenAI API Limits)"
echo "============================================================="

# Hardened Deal Coach Analyze Function (Phase 1 - Final)
SAFE_DEAL_COACH_FUNCTION=(
  "dealCoachAnalyzeCallable"
)

echo ""
echo "📋 Function to deploy (allowlist approach):"
for func in "${SAFE_DEAL_COACH_FUNCTION[@]}"; do
  echo "   • $func"
done

echo ""
echo "🔒 Hardening Playbook Compliance:"
echo "   • Circuit breaker enabled (CIRCUIT_BREAKER env var)"
echo "   • Max execution time: 55s (under 60s limit)"
echo "   • OpenAI API timeout: 30s with retry logic (2 attempts)"
echo "   • Cost limits: $0.10 max per call"
echo "   • Input validation: Strict parameter validation"
echo "   • Cache optimization: 5-minute TTL for repeated requests"
echo "   • AbortSignal timeout handling"

echo ""
echo "⚙️ Production Safety Defaults (Gen2/Cloud Run):"
echo "   • Max instances: 2 (start conservative)"
echo "   • Concurrency: 1 (callable functions)"
echo "   • Min instances: 0 (keep cold)"
echo "   • Timeout: 55s (short timeouts surface bugs)"
echo "   • Memory: 1GiB (AI processing requires more memory)"
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
for func in "${SAFE_DEAL_COACH_FUNCTION[@]}"; do
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
  echo "   2. Test deal coach analysis functionality"
  echo "   3. Check Cloud Run logs for any issues"
  echo "   4. Verify OpenAI API timeout handling"
  echo "   5. Monitor cache hit rates for performance"
  echo ""
  echo "🛡️ Safety Features Active:"
  echo "   • Circuit breaker: Set CIRCUIT_BREAKER=on to disable function"
  echo "   • Timeout limits: Function will abort after 55s"
  echo "   • OpenAI API limits: 30s timeout with 2 retry attempts"
  echo "   • Cost limits: $0.10 max per call to prevent runaway costs"
  echo "   • Input validation: Strict validation of all parameters"
  echo "   • Cache optimization: 5-minute TTL reduces API calls"
  echo ""
  echo "📊 Monitoring Commands:"
  echo "   • View logs: firebase functions:log --only $FUNCTIONS_LIST"
  echo "   • Check status: firebase functions:list | grep -E '(${FUNCTIONS_LIST//,/|})'"
  echo "   • Monitor costs: Check Firebase Console > Usage and billing"
  echo "   • Monitor OpenAI: Check OpenAI API usage dashboard"
  echo ""
  echo "🎯 Expected Impact:"
  echo "   • Massive cost reduction from OpenAI API limits and caching"
  echo "   • Prevention of runaway API calls with timeout handling"
  echo "   • Improved reliability with retry logic and error handling"
  echo "   • Better performance through intelligent caching"
  echo "   • Cost predictability with per-call limits"
  echo ""
  echo "🎉 PHASE 1 COMPLETE!"
  echo "All 7 high-priority business functions have been hardened and deployed."
  echo "Ready to move to Phase 2 or other optimization work."
else
  echo ""
  echo "❌ DEPLOYMENT FAILED!"
  echo "Please check the error messages above and try again."
  exit 1
fi

echo ""
echo "🎯 Phase 1 Function 8 Complete: Deal Coach Analyze Hardened (OpenAI API Limits)"
echo "🎉 PHASE 1 COMPLETE - All high-priority functions hardened and deployed!"
