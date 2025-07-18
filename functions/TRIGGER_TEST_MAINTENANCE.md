# 🔧 Firestore Trigger Test Maintenance Guide

This guide helps you maintain the Firestore trigger testing system and ensures you don't forget to update tests when adding new logging triggers.

---

## **🔄 When You Need to Update Tests**

### **Add New Triggers**
- ✅ **Add test methods** for new collections/triggers
- ✅ **Update `runAllTests()`** to call new test methods  
- ✅ **Update `getTargetTypeFromCollection()`** for new collections
- ✅ **Update `getEventTypeFromOperation()`** if new event types are added
- ✅ **Update `validateLogStructure()`** if log schema changes
- ✅ **Test manually** before committing
- ✅ **Update the checklist** in `testFirestoreTriggers.ts`

### **Change Existing Triggers**
- ✅ **Update corresponding test methods**
- ✅ **Verify test data matches new schema**
- ✅ **Update validation logic** if needed
- ✅ **Test the changes** manually

### **Remove Triggers**
- ✅ **Remove corresponding test methods**
- ✅ **Update `runAllTests()`** to remove calls
- ✅ **Update coverage detection** lists

---

## **🧪 How to Test Your Changes**

### **Local Testing**
```bash
# Run all tests locally
npm run test:triggers

# Check test coverage
npm run test:triggers:coverage

# Run specific test file
npx ts-node src/testTriggersCLI.ts
npx ts-node src/testTriggersCLI.ts --coverage
```

### **Deployed Testing**
```bash
# Run tests on deployed functions
npm run test:triggers:deployed

# Check coverage on deployed functions  
npm run test:triggers:deployed:coverage
```

### **Manual Testing**
1. **Create/update/delete documents** in Firebase Console
2. **Check `ai_logs` collection** for corresponding entries
3. **Verify log structure** matches expected schema

---

## **📋 Current Collections with Triggers**

### **Main Collections**
- `users` - User profile changes
- `agencies` - Agency management
- `customers` - Customer management
- `assignments` - Worker assignments
- `conversations` - Chat conversations
- `jobOrders` - Job order management
- `campaigns` - Marketing campaigns
- `motivations` - Motivation messages
- `userGroups` - User group management
- `locations` - Location management
- `notifications` - System notifications
- `settings` - System settings
- `ai_logs` - Meta-logging (self-referential)
- `appAiSettings` - Global AI settings
- `departments` - Department management

### **Subcollections**
- `messages` - Chat messages (subcollection)
- `shifts` - Work shifts (subcollection)
- `agencyContacts` - Agency contacts (subcollection)
- `aiSettings` - Customer/Agency AI settings (subcollection)
- `departments` - Customer departments (subcollection)

---

## **🔍 Coverage Detection**

The system automatically detects missing test coverage:

```bash
# Check what's missing
npm run test:triggers:coverage
```

This will show:
- **Missing Tests** - Collections without test methods
- **Extra Tests** - Test methods for non-existent collections
- **Recommendations** - What to add/remove

---

## **📝 Log Schema Validation**

All logs must include these required fields:
```typescript
{
  timestamp: Date,
  actionType: string,
  sourceModule: 'FirestoreTrigger',
  success: boolean,
  eventType: string,
  targetType: string,
  targetId: string,
  aiRelevant: boolean,
  contextType: string,
  urgencyScore: number (1-10),
  reason: string,
  versionTag: string
}
```

---

## **🚨 Common Issues & Solutions**

### **Test Fails: "No AI log found"**
- **Cause:** Trigger not firing or log not being written
- **Solution:** Check trigger deployment, Firestore rules, and log writing logic

### **Test Fails: "Invalid log structure"**
- **Cause:** Log schema doesn't match expected format
- **Solution:** Update trigger to use correct `logAIAction` parameters

### **Coverage Check Shows Missing Tests**
- **Cause:** New collection added without corresponding test
- **Solution:** Add test method and update `runAllTests()`

### **Coverage Check Shows Extra Tests**
- **Cause:** Test exists for removed collection
- **Solution:** Remove test method and update coverage lists

---

## **📅 Maintenance Schedule**

### **Weekly**
- Run coverage check: `npm run test:triggers:coverage`
- Review any missing/extra tests
- Update test coverage if needed

### **Before Deploying New Triggers**
- Add test methods for new collections
- Update coverage detection lists
- Test manually in dev environment
- Run full test suite

### **Monthly**
- Review and update maintenance checklist
- Check for deprecated collections
- Update test data if schema changes

---

## **🛠️ Quick Reference Commands**

```bash
# Development workflow
npm run test:triggers:coverage  # Check what's missing
npm run test:triggers          # Run all tests locally
firebase deploy --only functions  # Deploy changes
npm run test:triggers:deployed # Test deployed functions

# Troubleshooting
firebase functions:log         # Check function logs
firebase emulators:start       # Test locally with emulator
```

---

## **📞 Getting Help**

If you encounter issues:

1. **Check the logs:** `firebase functions:log`
2. **Run coverage check:** `npm run test:triggers:coverage`
3. **Test manually:** Create/update/delete documents in Firebase Console
4. **Review this guide** for common solutions
5. **Check the checklist** in `testFirestoreTriggers.ts`

---

**Last Updated:** [Update this when you modify the guide]
**Next Review:** [Set reminder for 1 month from last update] 