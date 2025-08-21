#!/bin/bash

echo "🛡️ DEPLOYING HARDENED AI FUNCTIONS (Input Validation & API Limits)"
echo "=================================================================="

# Hardened AI Functions (Phase 2)
SAFE_AI_FUNCTIONS=(
  "startAIThread"
  "sendAIChatMessage"
  "getFirmographics"
)

echo ""
echo "📋 Functions to deploy (allowlist approach):"
for func in "${SAFE_AI_FUNCTIONS[@]}"; do
  echo "   • $func"
done

echo ""
echo "🔒 Hardening Playbook Compliance:"
echo "   • Circuit breaker enabled (CIRCUIT_BREAKER env var)"
echo "   • Max execution time: 55s (under 60s limit)"
echo "   • Input validation: Strict validation of all AI function parameters"
echo "   • API limits: Apollo API timeout (30s), retry logic, AbortController"
echo "   • Field length limits: context (1000), messages (5000), domain (255)"
echo "   • Array limits: keywords (200), tech names (200), suborganizations (25)"
echo "   • Query limits: Max deals query (25), max deals return (5)"
echo "   • AbortSignal timeout handling"

echo ""
echo "⚙️ Production Safety Defaults (Gen2/Cloud Run):"
echo "   • Max instances: 2 (start conservative)"
echo "   • Concurrency: 1 (callable functions)"
echo "   • Min instances: 0 (keep cold)"
echo "   • Timeout: 55s (short timeouts surface bugs)"
echo "   • Memory: 256-512MiB (AI operations require memory)"
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

# Deploy only the hardened functions (allowlist approach)
echo ""
echo "🚀 Deploying hardened functions..."

# Create deployment list
FUNCTIONS_LIST=""
for func in "${SAFE_AI_FUNCTIONS[@]}"; do
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
  echo "   2. Test AI thread creation functionality"
  echo "   3. Test AI chat message handling"
  echo "   4. Test firmographics retrieval"
  echo "   5. Check Cloud Run logs for any issues"
  echo "   6. Verify API limits are working correctly"
  echo "   7. Test input validation with various parameters"
  echo ""
  echo "🛡️ Safety Features Active:"
  echo "   • Circuit breaker: Set CIRCUIT_BREAKER=on to disable functions"
  echo "   • Timeout limits: Functions will abort after 55s"
  echo "   • API limits: Apollo API calls timeout after 30s"
  echo "   • Input validation: Strict validation of all parameters"
  echo "   • Field limits: Prevents oversized data"
  echo "   • Array limits: Prevents oversized arrays"
  echo "   • Cost tracking: Per-operation cost estimation"
  echo ""
  echo "📊 Monitoring Commands:"
  echo "   • View logs: firebase functions:log --only $FUNCTIONS_LIST"
  echo "   • Check status: firebase functions:list | grep -E '(${FUNCTIONS_LIST//,/|})'"
  echo "   • Monitor costs: Check Firebase Console > Usage and billing"
  echo ""
  echo "🎯 Expected Impact:"
  echo "   • Massive cost reduction from API limits and timeout handling"
  echo "   • Improved reliability with input validation and error handling"
  echo "   • Prevention of oversized data with field length limits"
  echo "   • Better performance with controlled API calls"
  echo "   • Enhanced security with strict input validation"
  echo ""
  echo "🎯 Phase 2 Functions 4-6 Complete: AI Functions Hardened (Input Validation & API Limits)"
  echo "Ready for next Phase 2 functions: getRecommendedContacts, logAIUserMessage, etc."
else
  echo ""
  echo "❌ DEPLOYMENT FAILED!"
  echo "Please check the error messages above and try again."
  exit 1
fi

echo ""
echo "🎯 Phase 2 Functions 4-6 Complete: AI Functions Hardened (Input Validation & API Limits)"
echo "Ready for next Phase 2 functions: getRecommendedContacts, logAIUserMessage, etc."
