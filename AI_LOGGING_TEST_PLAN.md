# AI Logging System Test Plan

## Overview
This test plan validates the comprehensive AI logging system implementation, including field-level logging, coverage monitoring, and validation against the master trigger map.

## Test Environment Setup

### Prerequisites
- Firebase project deployed with new functions
- Development server running
- Test customer and agency accounts
- Access to LogCoverageDashboard

### Test Data
- Customer ID: `test-customer-123`
- Agency ID: `test-agency-456`
- Test user with admin access

## Test Suite 1: LoggableField Components

### 1.1 Customer AI Settings - Tone Sliders
**Objective**: Verify tone slider changes are logged correctly

**Steps**:
1. Navigate to Customer Profile → AI Settings
2. Adjust each tone slider (formality, friendliness, conciseness, assertiveness, enthusiasm)
3. Save changes
4. Check LogCoverageDashboard for new logs

**Expected Results**:
- Each slider change creates a log entry
- Log entries contain: `fieldPath`, `oldValue`, `newValue`, `triggerType`, `timestamp`
- Field paths follow pattern: `customers:test-customer-123.aiSettings.tone.{trait}`
- Context type: `tone`, Urgency score: `3`

### 1.2 Customer AI Settings - Custom Prompts
**Objective**: Verify custom prompt changes are logged

**Steps**:
1. Navigate to Customer Profile → AI Settings
2. Modify custom prompts (up to 3)
3. Save changes
4. Check LogCoverageDashboard

**Expected Results**:
- Each prompt change creates a log entry
- Field paths: `customers:test-customer-123.aiSettings.prompts.custom.{index}`
- Context type: `prompts`, Urgency score: `4`

### 1.3 Customer AI Settings - Prompt Frequency
**Objective**: Verify prompt frequency selection is logged

**Steps**:
1. Change prompt frequency from Medium to High
2. Save changes
3. Check LogCoverageDashboard

**Expected Results**:
- Log entry created for frequency change
- Field path: `customers:test-customer-123.aiSettings.prompts.frequency`
- Context type: `prompts`, Urgency score: `3`

### 1.4 Customer AI Settings - Context Fields
**Objective**: Verify website URL and social posts are logged

**Steps**:
1. Update website URL
2. Modify sample social posts
3. Save changes
4. Check LogCoverageDashboard

**Expected Results**:
- Log entries for website URL and social posts
- Field paths: `customers:test-customer-123.aiSettings.context.{field}`
- Context type: `context`, Urgency score: `2`

## Test Suite 2: Agency AI Settings

### 2.1 Agency Tone Settings
**Objective**: Verify agency tone sliders are logged

**Steps**:
1. Navigate to Agency Profile → AI Settings → Tone & Style
2. Adjust tone sliders
3. Save changes
4. Check LogCoverageDashboard

**Expected Results**:
- Log entries for each tone slider change
- Field paths: `agencies:test-agency-456.aiSettings.tone.{trait}`
- Context type: `tone`, Urgency score: `3`

### 2.2 Agency Weights Engine
**Objective**: Verify weights engine sliders are logged

**Steps**:
1. Navigate to Agency Profile → AI Settings → Weights Engine
2. Adjust admin, customer, and employee weights
3. Save changes
4. Check LogCoverageDashboard

**Expected Results**:
- Log entries for each weight change
- Field paths: `agencies:test-agency-456.aiSettings.weights.{category}.{weight}`
- Context type: `weights`, Urgency score: `4`

## Test Suite 3: Admin AI Settings

### 3.1 Admin Tone Settings
**Objective**: Verify admin tone settings are logged

**Steps**:
1. Navigate to Admin → AI → Tone Settings
2. Adjust tone balance sliders
3. Change tone consistency setting
4. Update custom tone instructions
5. Save changes
6. Check LogCoverageDashboard

**Expected Results**:
- Log entries for all tone changes
- Field paths: `appAiSettings.tone.{setting}`
- Context type: `tone`, Urgency scores: `3-5`

## Test Suite 4: LogCoverageDashboard

### 4.1 Dashboard Loading
**Objective**: Verify dashboard loads correctly

**Steps**:
1. Navigate to Admin → AI → Log Coverage Dashboard
2. Check all sections load
3. Verify real-time updates

**Expected Results**:
- Dashboard loads without errors
- Coverage statistics display correctly
- Real-time monitoring active

### 4.2 Coverage Analysis
**Objective**: Verify coverage calculations

**Steps**:
1. Make changes to various AI fields
2. Check coverage percentage updates
3. Verify field breakdown by module

**Expected Results**:
- Coverage percentage increases with field changes
- Module breakdown shows correct distribution
- Missing fields identified correctly

### 4.3 Test Results
**Objective**: Verify test framework functionality

**Steps**:
1. Run field-level tests from dashboard
2. Check test results display
3. Verify failed tests are identified

**Expected Results**:
- Tests run successfully
- Results display in real-time
- Failed tests show detailed error information

## Test Suite 5: Backend Functions

### 5.1 checkRecentAILogs Function
**Objective**: Verify log checking function works

**Steps**:
1. Make a field change
2. Call checkRecentAILogs function
3. Verify response format

**Expected Results**:
- Function returns correct log data
- Response includes: `logFound`, `logValid`, `missingKeys`, `extraKeys`
- Time window filtering works correctly

### 5.2 Log Validation
**Objective**: Verify logs match trigger map expectations

**Steps**:
1. Generate logs for various fields
2. Validate against loggingTriggerMap
3. Check for missing or extra keys

**Expected Results**:
- All required keys present in logs
- No unexpected keys in logs
- Validation passes for all field types

## Test Suite 6: Error Handling

### 6.1 CORS Error Handling
**Objective**: Verify CORS errors are handled gracefully

**Steps**:
1. Simulate network connectivity issues
2. Check local storage fallback
3. Verify retry mechanism

**Expected Results**:
- Failed logs stored locally
- Retry mechanism attempts re-send
- User notified of temporary issues

### 6.2 Data Validation
**Objective**: Verify field data validation

**Steps**:
1. Enter invalid data in fields
2. Check validation messages
3. Verify logs are not created for invalid data

**Expected Results**:
- Invalid data rejected
- Clear error messages displayed
- No logs created for invalid changes

## Test Suite 7: Performance

### 7.1 Logging Performance
**Objective**: Verify logging doesn't impact UI performance

**Steps**:
1. Make rapid field changes
2. Monitor UI responsiveness
3. Check log creation timing

**Expected Results**:
- UI remains responsive
- Logs created within 100ms
- No performance degradation

### 7.2 Dashboard Performance
**Objective**: Verify dashboard performance with many logs

**Steps**:
1. Generate many log entries
2. Load LogCoverageDashboard
3. Check loading times

**Expected Results**:
- Dashboard loads within 2 seconds
- Real-time updates work smoothly
- No memory leaks

## Success Criteria

### Functional Requirements
- [ ] All AI field changes create log entries
- [ ] Log entries contain all required fields
- [ ] LogCoverageDashboard displays accurate coverage
- [ ] Test framework identifies missing logs
- [ ] Error handling works for all scenarios

### Performance Requirements
- [ ] Field changes logged within 100ms
- [ ] Dashboard loads within 2 seconds
- [ ] No UI performance degradation
- [ ] Memory usage remains stable

### Quality Requirements
- [ ] 100% coverage of AI-relevant fields
- [ ] 0% false positives in log validation
- [ ] All error scenarios handled gracefully
- [ ] Comprehensive test coverage

## Test Execution

### Phase 1: Component Testing
- Test individual LoggableField components
- Verify field-level logging
- Check error handling

### Phase 2: Integration Testing
- Test complete forms (Customer, Agency, Admin)
- Verify end-to-end logging flow
- Check dashboard integration

### Phase 3: System Testing
- Test performance under load
- Verify error scenarios
- Check production readiness

### Phase 4: User Acceptance Testing
- Test with real user scenarios
- Verify usability and feedback
- Final validation before deployment

## Reporting

### Test Results Template
```
Test Suite: [Name]
Date: [Date]
Tester: [Name]

Results:
- Passed: [X] tests
- Failed: [X] tests
- Blocked: [X] tests

Issues Found:
1. [Issue description]
2. [Issue description]

Recommendations:
1. [Recommendation]
2. [Recommendation]
```

### Coverage Report
- Overall Coverage: [X]%
- Customer Fields: [X]%
- Agency Fields: [X]%
- Admin Fields: [X]%
- Missing Fields: [List]
- Recommendations: [List]

## Next Steps

1. Execute test plan systematically
2. Document all issues found
3. Fix critical issues before deployment
4. Retest after fixes
5. Deploy to production
6. Monitor real-world usage
7. Iterate based on feedback 