#!/bin/bash

# Gmail Bulk Import Functions Deployment Script
# This script deploys the Gmail bulk import system with Cloud Tasks

set -e

echo "🚀 Deploying Gmail Bulk Import Functions..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the functions directory
if [ ! -f "package.json" ]; then
    print_error "This script must be run from the functions directory"
    exit 1
fi

# Build the project
print_status "Building TypeScript..."
npm run build

if [ $? -ne 0 ]; then
    print_error "Build failed"
    exit 1
fi

print_success "Build completed"

# Deploy the functions
print_status "Deploying Gmail bulk import functions..."

FUNCTIONS_LIST="queueGmailBulkImport,processGmailImport,getGmailImportProgress"

firebase deploy --only functions:$FUNCTIONS_LIST

if [ $? -ne 0 ]; then
    print_error "Deployment failed"
    exit 1
fi

print_success "Gmail bulk import functions deployed successfully!"

# Create Cloud Tasks queue (if it doesn't exist)
print_status "Setting up Cloud Tasks queue..."

# Note: Cloud Tasks queue creation requires gcloud CLI
# This is a manual step that needs to be done once
print_warning "IMPORTANT: You need to create the Cloud Tasks queue manually:"
echo ""
echo "Run this command to create the queue:"
echo "gcloud tasks queues create gmail-import-queue --location=us-central1"
echo ""
echo "Or use the Google Cloud Console to create a queue named 'gmail-import-queue'"
echo ""

# Display usage information
print_success "Deployment complete! Here's how to use the functions:"
echo ""
echo "📧 Gmail Bulk Import Functions:"
echo "   • queueGmailBulkImport - Queue import for multiple users"
echo "   • processGmailImport - Process individual user emails (Cloud Task)"
echo "   • getGmailImportProgress - Check import progress"
echo ""
echo "🔧 Usage Examples:"
echo ""
echo "1. Import for specific user IDs:"
echo "   queueGmailBulkImport({"
echo "     userIds: ['user1', 'user2', 'user3'],"
echo "     tenantId: 'your-tenant-id',"
echo "     daysBack: 90"
echo "   })"
echo ""
echo "2. Import for specific email addresses:"
echo "   queueGmailBulkImport({"
echo "     emailAddresses: ['user1@company.com', 'user2@company.com'],"
echo "     tenantId: 'your-tenant-id',"
echo "     daysBack: 90"
echo "   })"
echo ""
echo "3. Check progress:"
echo "   getGmailImportProgress({"
echo "     requestId: 'gmail_import_1234567890_abc123',"
echo "     tenantId: 'your-tenant-id'"
echo "   })"
echo ""
echo "📊 Progress Tracking:"
echo "   Progress is stored in: tenants/{tenantId}/gmail_imports/{requestId}"
echo "   Status: pending → in_progress → completed/failed"
echo ""
echo "⚙️ Configuration:"
echo "   • Max emails per user: 1000"
echo "   • Batch size: 50 emails"
echo "   • Rate limit: 1 second between API calls"
echo "   • Task timeout: 9 minutes"
echo "   • Retry attempts: 3"
echo ""
print_success "Ready to import Gmail data! 🎉"
