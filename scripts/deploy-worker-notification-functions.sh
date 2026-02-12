#!/usr/bin/env bash
# Deploy only the unified worker notification callables (no hosting, no other functions).
# Run from repo root. Ensure you're logged in: firebase login --reauth
set -e
cd "$(dirname "$0")/.."
echo "Deploying 4 worker notification functions only..."
firebase deploy --only functions:markWorkerNotificationRead,functions:markWorkerThreadRead,functions:sendWorkerThreadMessage,functions:registerWorkerDeviceToken
echo "Done."
