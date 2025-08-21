#!/bin/bash

echo "🛡️ DEPLOYING HARDENED CALENDAR/EMAIL FUNCTIONS (Playbook Compliant)"
echo "=================================================================="

# Hardened Calendar/Email Functions (Phase 3)
SAFE_CALENDAR_EMAIL_FUNCTIONS=(
  "getCalendarStatus"
  "listCalendarEvents"
  "createCalendarEvent"
  "getGmailStatus"
)

echo ""
echo "📋 Functions to deploy (allowlist approach):"
for func in "${SAFE_CALENDAR_EMAIL_FUNCTIONS[@]}"; do
  echo "   • $func"
done

echo ""
echo "🔒 Hardening Playbook Compliance:"
echo "   • Circuit breaker enabled (CIRCUIT_BREAKER env var)"
echo "   • Max execution time: 55s (under 60s limit)"
echo "   • No setInterval (replaced with manual cache cleanup)"
echo "   • AbortSignal timeout handling"
echo "   • Rate limiting and caching"
echo "   • Retry logic with exponential backoff"
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

# Deploy only the hardened functions (allowlist approach)
echo ""
echo "🚀 Deploying hardened functions..."

# Create deployment list
FUNCTIONS_LIST=""
for func in "${SAFE_CALENDAR_EMAIL_FUNCTIONS[@]}"; do
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
  echo "   2. Test each function individually"
  echo "   3. Check Cloud Run logs for any issues"
  echo "   4. Verify circuit breaker functionality"
  echo ""
  echo "🛡️ Safety Features Active:"
  echo "   • Circuit breaker: Set CIRCUIT_BREAKER=on to disable all functions"
  echo "   • Timeout limits: Functions will abort after 55s"
  echo "   • Rate limiting: Max 10 API calls per minute"
  echo "   • Caching: 5-minute cache for status checks"
  echo ""
  echo "📊 Monitoring Commands:"
  echo "   • View logs: firebase functions:log --only $FUNCTIONS_LIST"
  echo "   • Check status: firebase functions:list | grep -E '(${FUNCTIONS_LIST//,/|})'"
  echo "   • Monitor costs: Check Firebase Console > Usage and billing"
else
  echo ""
  echo "❌ DEPLOYMENT FAILED!"
  echo "Please check the error messages above and try again."
  exit 1
fi

echo ""
echo "🎯 Phase 3 Complete: Calendar/Email Functions Hardened"
echo "Ready for Phase 4: High-Priority Business Functions"
