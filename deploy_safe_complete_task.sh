#!/bin/bash

echo "🛡️ DEPLOYING HARDENED COMPLETE TASK (Input Validation & Timeout Handling)"
echo "========================================================================="

# Hardened Complete Task Function (Phase 2)
SAFE_COMPLETE_TASK_FUNCTION=(
  "completeTask"
)

echo ""
echo "📋 Function to deploy (allowlist approach):"
for func in "${SAFE_COMPLETE_TASK_FUNCTION[@]}"; do
  echo "   • $func"
done

echo ""
echo "🔒 Hardening Playbook Compliance:"
echo "   • Circuit breaker enabled (CIRCUIT_BREAKER env var)"
echo "   • Max execution time: 55s (under 60s limit)"
echo "   • Input validation: Strict validation of all task completion fields"
echo "   • Field length limits: actionResult (2000), followUpTask.title (200), etc."
echo "   • Follow-up task validation: Complete validation of follow-up task objects"
echo "   • Repeating task handling: Safe creation of next repeating tasks"
echo "   • AbortSignal timeout handling"

echo ""
echo "⚙️ Production Safety Defaults (Gen2/Cloud Run):"
echo "   • Max instances: 2 (start conservative)"
echo "   • Concurrency: 1 (callable functions)"
echo "   • Min instances: 0 (keep cold)"
echo "   • Timeout: 55s (short timeouts surface bugs)"
echo "   • Memory: 512MiB (task processing requires memory)"
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
for func in "${SAFE_COMPLETE_TASK_FUNCTION[@]}"; do
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
  echo "   2. Test task completion functionality"
  echo "   3. Check Cloud Run logs for any issues"
  echo "   4. Verify input validation is working correctly"
  echo "   5. Test follow-up task creation"
  echo "   6. Test repeating task handling"
  echo ""
  echo "🛡️ Safety Features Active:"
  echo "   • Circuit breaker: Set CIRCUIT_BREAKER=on to disable function"
  echo "   • Timeout limits: Function will abort after 55s"
  echo "   • Input validation: Strict validation of all task completion fields"
  echo "   • Field length limits: Prevents oversized data"
  echo "   • Follow-up task validation: Complete validation of follow-up task objects"
  echo "   • Repeating task handling: Safe creation of next repeating tasks"
  echo "   • Cost tracking: Per-operation cost estimation"
  echo ""
  echo "📊 Monitoring Commands:"
  echo "   • View logs: firebase functions:log --only $FUNCTIONS_LIST"
  echo "   • Check status: firebase functions:list | grep -E '(${FUNCTIONS_LIST//,/|})'"
  echo "   • Monitor costs: Check Firebase Console > Usage and billing"
  echo ""
  echo "🎯 Expected Impact:"
  echo "   • Improved reliability with input validation and timeout handling"
  echo "   • Prevention of oversized data with field length limits"
  echo "   • Better error handling for follow-up and repeating task creation"
  echo "   • Cost predictability with per-call limits"
  echo "   • Enhanced security with strict input validation"
  echo ""
  echo "🎯 Phase 2 Function 2 Complete: Complete Task Hardened (Input Validation)"
  echo "Ready for next Phase 2 function: getTasks"
else
  echo ""
  echo "❌ DEPLOYMENT FAILED!"
  echo "Please check the error messages above and try again."
  exit 1
fi

echo ""
echo "🎯 Phase 2 Function 2 Complete: Complete Task Hardened (Input Validation & Timeout Handling)"
echo "Ready for next Phase 2 function: getTasks"
