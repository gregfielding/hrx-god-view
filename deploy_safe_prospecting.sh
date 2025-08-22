#!/bin/bash

# Deploy Safe Prospecting Functions
# This script deploys only the new prospecting-related functions

echo "🚀 Deploying Prospecting Hub Functions..."

# Set the Firebase project
PROJECT_ID="hrx1-d3beb"

# Deploy only the prospecting functions
echo "📦 Deploying prospecting functions..."

firebase deploy --only functions:runProspecting,functions:saveProspectingSearch,functions:addProspectsToCRM,functions:createCallList --project $PROJECT_ID

echo "✅ Prospecting functions deployed successfully!"
echo ""
echo "📋 Deployed functions:"
echo "  - runProspecting"
echo "  - saveProspectingSearch" 
echo "  - addProspectsToCRM"
echo "  - createCallList"
echo ""
echo "🎯 Next steps:"
echo "  1. Test the Prospecting Hub tab in the CRM"
echo "  2. Verify Apollo integration is working"
echo "  3. Check AI scoring and deduplication"
echo "  4. Test CRM integration and task creation"
