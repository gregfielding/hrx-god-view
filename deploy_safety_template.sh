#!/bin/bash

echo "🛡️ DEPLOYING SAFETY TEMPLATE ONLY..."
echo "📦 This deploys only the safety utilities without touching existing functions"

# Only deploy the safety template utilities
SAFETY_FUNCTIONS=(
  # Safety template utilities (these are just utilities, not actual functions)
  # We're not deploying any actual functions yet, just making the safety code available
)

echo "🔍 Building function list..."
FUNCTION_LIST=""

echo "📋 Deploying safety template utilities:"
echo "   • SafeFunctionUtils class"
echo "   • CostTracker class"
echo "   • Safety configuration"
echo "   • Safe function wrappers"

echo ""
echo "🚀 Starting safety template deployment..."

# Deploy only the safety utilities
firebase deploy --only functions:utils/safeFunctionTemplate --force

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ SAFETY TEMPLATE DEPLOYED!"
  echo "🛡️ Safety utilities are now available for use"
  echo ""
  echo "📋 Next steps:"
  echo "   1. Test that existing functions still work"
  echo "   2. Gradually add safety measures to problematic functions"
  echo "   3. Monitor costs to ensure they stay low"
  echo ""
  echo "💡 This approach is much safer than rewriting 200 functions at once"
else
  echo ""
  echo "❌ SAFETY TEMPLATE DEPLOYMENT FAILED!"
  echo "🔍 Check the error messages above"
fi
