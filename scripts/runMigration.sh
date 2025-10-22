#!/bin/bash

# Migration Runner Script
# This script uses Firebase CLI authentication to run the migration

echo "🔐 Authenticating with Firebase..."
export GOOGLE_APPLICATION_CREDENTIALS=""

# Use Firebase CLI to run the script with proper auth
firebase --project hrx1-d3beb firestore:execute ../scripts/migrateApplicationData.js 2>/dev/null

# If that doesn't work, try running directly with gcloud auth
if [ $? -ne 0 ]; then
  echo "📝 Running migration script directly..."
  node scripts/migrateApplicationData.js
fi

