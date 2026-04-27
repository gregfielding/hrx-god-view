#!/bin/bash
# SMS Queue Smoke Test Runner
# Usage: ./test-sms-queue.sh

set -e

echo "🚀 SMS Queue Smoke Tests"
echo "========================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test A: Queue Infrastructure
echo -e "${YELLOW}Test A: Queue Infrastructure${NC}"
echo "Creating Cloud Tasks queue..."
if gcloud tasks queues create sms-outbound --location=us-central1 2>&1 | grep -q "already exists"; then
  echo -e "${GREEN}✅ Queue already exists${NC}"
else
  echo -e "${GREEN}✅ Queue created${NC}"
fi

echo ""
echo "Verifying queue exists..."
if gcloud tasks queues describe sms-outbound --location=us-central1 > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Queue verified${NC}"
else
  echo -e "${RED}❌ Queue not found${NC}"
  exit 1
fi

echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Deploy functions: cd functions && npm run deploy"
echo "2. Run manual tests via Firebase Console or test script"
echo "3. Check Cloud Tasks in Console: https://console.cloud.google.com/cloudtasks"
echo ""
echo "For detailed test execution, use the testSmsQueue.ts functions"
echo "or create test requests manually in Firestore."
