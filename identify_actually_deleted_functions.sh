#!/bin/bash

echo "🔍 IDENTIFYING ACTUALLY DELETED FUNCTIONS..."
echo "📋 This focuses on functions you actually deleted, not all local functions"

# Based on your screenshots and our conversation, these are the functions you actually deleted
ACTUALLY_DELETED_FUNCTIONS=(
  # High-usage functions you deleted from Firebase Console
  "firestoreCompanySnapShotFanout"
  "updateActiveSalespeopleOnDeal"
  "onCompanyLocationUpdated"
  "onDealUpdated"
  "firestorelogAILogCreated"
  "syncApolloHeadquartersLocation"
  "getCompanyLocations"
  "getSalespeopleForTenant"
  "dealCoachAnalyzeCallable"
  "getCalendarStatus"
  "listCalendarEvents"
  "getGmailStatus"
  "createCalendarEvent"
)

# Get deployed functions
echo "📊 Getting currently deployed functions..."
firebase functions:list | grep -E "callable|http|firestore|scheduler" | awk '{print $1}' | sed 's/│//g' | sed 's/^[[:space:]]*//g' | sed 's/[[:space:]]*$//g' | sort > deployed_functions.txt

echo "📊 Checking which deleted functions need rewriting..."

echo "🚨 ACTUALLY DELETED FUNCTIONS THAT NEED SAFE REWRITING:" > actually_deleted_report.txt
echo "=======================================================" >> actually_deleted_report.txt

# Check each function you actually deleted
for func in "${ACTUALLY_DELETED_FUNCTIONS[@]}"; do
  if grep -q "^$func$" deployed_functions.txt; then
    echo "❌ $func - STILL DEPLOYED (not actually deleted)" >> actually_deleted_report.txt
  else
    echo "✅ $func - DELETED, NEEDS SAFE REWRITING" >> actually_deleted_report.txt
  fi
done

echo "" >> actually_deleted_report.txt
echo "📊 SUMMARY:" >> actually_deleted_report.txt
echo "===========" >> actually_deleted_report.txt

# Count actually deleted functions
deleted_count=0
still_deployed_count=0

for func in "${ACTUALLY_DELETED_FUNCTIONS[@]}"; do
  if grep -q "^$func$" deployed_functions.txt; then
    ((still_deployed_count++))
  else
    ((deleted_count++))
  fi
done

echo "Functions you actually deleted: $deleted_count" >> actually_deleted_report.txt
echo "Functions still deployed: $still_deployed_count" >> actually_deleted_report.txt
echo "Total functions checked: ${#ACTUALLY_DELETED_FUNCTIONS[@]}" >> actually_deleted_report.txt

# Display the report
cat actually_deleted_report.txt

echo ""
echo "🎯 PRIORITY FOR SAFE REWRITING:"
echo "================================"

# High-priority functions that caused runaway costs
HIGH_PRIORITY=(
  "firestoreCompanySnapShotFanout"
  "updateActiveSalespeopleOnDeal"
  "onCompanyLocationUpdated"
  "onDealUpdated"
  "firestorelogAILogCreated"
  "syncApolloHeadquartersLocation"
  "getCompanyLocations"
  "getSalespeopleForTenant"
  "dealCoachAnalyzeCallable"
  "getCalendarStatus"
  "listCalendarEvents"
  "getGmailStatus"
)

echo "🔥 HIGH PRIORITY (caused runaway costs):"
for func in "${HIGH_PRIORITY[@]}"; do
  if grep -q "^$func$" deployed_functions.txt; then
    echo "  ❌ $func - Still deployed (not deleted)"
  else
    echo "  ✅ $func - Deleted, needs safe rewriting"
  fi
done

echo ""
echo "📄 Full report saved to: actually_deleted_report.txt"
echo "🎯 Focus on rewriting the functions that are actually deleted"
