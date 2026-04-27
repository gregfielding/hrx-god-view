#!/usr/bin/env bash
set -euo pipefail

# Phase 3 Deployment Script - Orchestrator and Monitoring
# Deploys the centralized orchestrator and supporting infrastructure

REGION=us-central1
PROJECT_ID="hrx1-d3beb"

echo "🚀 Starting Phase 3 Deployment - Orchestrator and Monitoring"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Ensure we're in the functions directory
cd "$(dirname "$0")/../functions" || exit 1

# Build the TypeScript code
echo "📦 Building TypeScript code..."
npm run build

# Deploy the scheduled orchestrator
echo ""
echo "🎯 Deploying scheduledOrchestrator..."
firebase deploy --only functions:scheduledOrchestrator \
  --project "$PROJECT_ID" \
  --force

# Deploy HTTP workers if not already deployed
echo ""
echo "🔄 Deploying HTTP Workers..."
firebase deploy --only functions:logTaskUpdate,logUserUpdate,updateActiveSalespeople \
  --project "$PROJECT_ID"

# Optional: Set environment variables for feature flags
echo ""
echo "⚙️  Setting environment variables for orchestrator..."
echo "To enable specific subtasks, run:"
echo ""
echo "  firebase functions:config:set \\"
echo "    ENABLE_GMAIL_MONITORING=true \\"
echo "    ENABLE_EXECUTE_CAMPAIGNS=true \\"
echo "    ENABLE_CONTINUOUS_LEARNING=false \\"
echo "    ENABLE_JSI_REPORTS=false \\"
echo "    ENABLE_SCHEDULED_CHECKINS=false"
echo ""
echo "Then redeploy with: firebase deploy --only functions:scheduledOrchestrator"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Phase 3 Deployment Complete!"
echo ""
echo "📊 Next Steps:"
echo "  1. Monitor orchestrator runs in Firebase Console"
echo "  2. Check function_runs collection for metrics"
echo "  3. Review Cloud Logging for structured logs"
echo "  4. Set up BigQuery exports for cost analysis"
echo ""
echo "🔗 Useful Links:"
echo "  • Functions: https://console.firebase.google.com/project/$PROJECT_ID/functions"
echo "  • Logs: https://console.cloud.google.com/logs/query?project=$PROJECT_ID"
echo "  • Firestore: https://console.firebase.google.com/project/$PROJECT_ID/firestore"
echo ""

