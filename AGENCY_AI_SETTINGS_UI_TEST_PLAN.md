# Agency AI Settings UI Test Plan

## Overview
This test plan verifies that all migrated Agency AI Settings sections are working correctly with the new LoggableField components.

## Test Environment
- **URL**: http://localhost:3000
- **Target**: Agency AI Settings sections
- **Components**: TraitsEngine, MomentsEngine, FeedbackEngine, VectorSettings

## Test Cases

### 1. Traits Engine Settings Test

#### 1.1 Basic Navigation
- [ ] Navigate to Agency Profile
- [ ] Click on AI Settings tab
- [ ] Verify Traits Engine section is visible
- [ ] Verify Individual Traits accordion expands/collapses

#### 1.2 Trait Weight Sliders
- [ ] Test Reliability trait weight slider (0-1 range)
- [ ] Test Empathy trait weight slider (0-1 range)
- [ ] Test Communication trait weight slider (0-1 range)
- [ ] Test Leadership trait weight slider (0-1 range)
- [ ] Test Coachability trait weight slider (0-1 range)
- [ ] Verify slider values update in real-time
- [ ] Verify changes are logged (check browser console for log messages)

#### 1.3 AI Guidance Text Fields
- [ ] Test editing AI Guidance for Reliability trait
- [ ] Test editing AI Guidance for Empathy trait
- [ ] Test editing AI Guidance for Communication trait
- [ ] Verify text fields accept multiline input
- [ ] Verify changes are logged

#### 1.4 Master Rules Configuration
- [ ] Test Scoring Method select (Cumulative/Averaged/Weighted)
- [ ] Test Update Logic select (Immediate/Batch/Scheduled)
- [ ] Test Decay Logic select (Linear/Exponential/None)
- [ ] Test Confidence Threshold field (0.0-1.0)
- [ ] Verify all selects update correctly
- [ ] Verify changes are logged

#### 1.5 Save Functionality
- [ ] Make changes to trait weights
- [ ] Make changes to AI guidance
- [ ] Make changes to master rules
- [ ] Click "Save Traits Engine Settings"
- [ ] Verify success message appears
- [ ] Verify changes persist after page refresh

### 2. Moments Engine Settings Test

#### 2.1 Basic Navigation
- [ ] Navigate to Moments Engine section
- [ ] Verify Moments accordion expands/collapses
- [ ] Verify individual moment accordions work

#### 2.2 Moment Configuration
- [ ] Test editing Welcome Check-in title
- [ ] Test editing Monthly Wellness title
- [ ] Test editing Quarterly Career title
- [ ] Verify title fields update correctly

#### 2.3 Category Selection
- [ ] Test changing Welcome Check-in category to Wellness
- [ ] Test changing Monthly Wellness category to Growth
- [ ] Test changing Quarterly Career category to Retention
- [ ] Verify category selects work correctly

#### 2.4 Scheduling Configuration
- [ ] Test Scheduling Type select for each moment
- [ ] Test Follow-up Days field for each moment
- [ ] Verify scheduling fields update correctly

#### 2.5 Tone Override Sliders
- [ ] Test Friendliness slider for Welcome Check-in (0-1 range)
- [ ] Test Empathy slider for Welcome Check-in (0-1 range)
- [ ] Test Friendliness slider for Monthly Wellness (0-1 range)
- [ ] Test Empathy slider for Monthly Wellness (0-1 range)
- [ ] Verify tone sliders update in real-time

#### 2.6 AI Modifier Notes
- [ ] Test editing AI Modifier Notes for Welcome Check-in
- [ ] Test editing AI Modifier Notes for Monthly Wellness
- [ ] Test editing AI Modifier Notes for Quarterly Career
- [ ] Verify multiline text input works

#### 2.7 Save Functionality
- [ ] Make changes to moment configurations
- [ ] Click "Save Moments Engine Settings"
- [ ] Verify success message appears
- [ ] Verify changes persist after page refresh

### 3. Feedback Engine Settings Test

#### 3.1 Basic Navigation
- [ ] Navigate to Feedback Engine section
- [ ] Verify Sentiment Scoring accordion expands
- [ ] Verify Manager Access accordion expands
- [ ] Verify AI Follow-up accordion expands

#### 3.2 Sentiment Scoring Configuration
- [ ] Test Enable Sentiment Scoring switch
- [ ] Test Confidence Threshold slider (0.1-1.0 range)
- [ ] Test Update Frequency select (Real-time/Hourly/Daily)
- [ ] Verify slider is disabled when sentiment scoring is disabled
- [ ] Verify select is disabled when sentiment scoring is disabled

#### 3.3 Manager Access Configuration
- [ ] Test Enable Manager Access switch
- [ ] Test Require Worker Opt-in switch
- [ ] Test Access Level select (Summary Only/Detailed Analysis/Full Access)
- [ ] Verify opt-in switch is disabled when manager access is disabled
- [ ] Verify access level select is disabled when manager access is disabled

#### 3.4 AI Follow-up Configuration
- [ ] Test Enable AI-managed Follow-up switch
- [ ] Test Trigger Threshold slider (0.1-1.0 range)
- [ ] Test Max Follow-ups field (1-10 range)
- [ ] Test Follow-up Delay field (1-168 hours)
- [ ] Verify fields are disabled when AI follow-up is disabled

#### 3.5 Save Functionality
- [ ] Make changes to feedback settings
- [ ] Click "Save Feedback Engine Settings"
- [ ] Verify success message appears
- [ ] Verify changes persist after page refresh

### 4. Vector Settings Test

#### 4.1 Basic Navigation
- [ ] Navigate to Vector Settings section
- [ ] Verify Global Settings accordion expands
- [ ] Verify Vector Collections accordion expands

#### 4.2 Global Settings Configuration
- [ ] Test Default Dimensions field (512-4096 range)
- [ ] Test Default Similarity Threshold slider (0.1-1.0 range)
- [ ] Test Default Max Results field (1-100 range)
- [ ] Test Auto Reindex switch
- [ ] Test Reindex Frequency select (Daily/Weekly/Monthly)
- [ ] Verify reindex frequency is disabled when auto reindex is disabled

#### 4.3 Vector Collections Configuration
- [ ] Test Traits Collection enabled switch
- [ ] Test Moments Collection enabled switch
- [ ] Test Feedback Collection enabled switch
- [ ] Test Job Postings Collection enabled switch
- [ ] Test Policies Collection enabled switch

#### 4.4 Collection-Specific Settings
- [ ] Test Dimensions field for Traits Collection (512-4096 range)
- [ ] Test Similarity Threshold slider for Traits Collection (0.1-1.0 range)
- [ ] Test Max Results field for Traits Collection (1-100 range)
- [ ] Test Dimensions field for Moments Collection
- [ ] Test Similarity Threshold slider for Moments Collection
- [ ] Test Max Results field for Moments Collection
- [ ] Verify fields are disabled when collection is disabled

#### 4.5 Reindex Functionality
- [ ] Test Reindex button for Traits Collection
- [ ] Verify "Reindexing..." state appears
- [ ] Verify reindex completes successfully
- [ ] Verify last indexed timestamp updates

#### 4.6 Save Functionality
- [ ] Make changes to vector settings
- [ ] Click "Save Vector Settings"
- [ ] Verify success message appears
- [ ] Verify changes persist after page refresh

### 5. Logging Verification Test

#### 5.1 Browser Console Logging
- [ ] Open browser developer tools
- [ ] Navigate to Console tab
- [ ] Make changes to various fields
- [ ] Verify log messages appear in console
- [ ] Verify log messages contain proper field paths
- [ ] Verify log messages contain proper context types

#### 5.2 Firebase Logging
- [ ] Navigate to Firebase Console
- [ ] Go to Firestore Database
- [ ] Check ai_logs collection
- [ ] Verify new log entries are created for field changes
- [ ] Verify log entries contain proper metadata
- [ ] Verify log entries have correct agencyId

### 6. Error Handling Test

#### 6.1 Network Error Handling
- [ ] Disconnect internet connection
- [ ] Try to save settings
- [ ] Verify error message appears
- [ ] Reconnect internet
- [ ] Verify settings can be saved again

#### 6.2 Validation Error Handling
- [ ] Enter invalid values in numeric fields
- [ ] Try to save settings
- [ ] Verify validation error messages appear
- [ ] Enter valid values
- [ ] Verify settings can be saved

### 7. Performance Test

#### 7.1 Responsiveness
- [ ] Test UI responsiveness on different screen sizes
- [ ] Verify accordions work on mobile devices
- [ ] Verify sliders work on touch devices
- [ ] Verify text fields are properly sized

#### 7.2 Loading Performance
- [ ] Measure time to load Agency AI Settings page
- [ ] Measure time to expand/collapse accordions
- [ ] Measure time to save settings
- [ ] Verify performance is acceptable (< 2 seconds for most operations)

## Test Results

### Pass/Fail Summary
- [ ] Traits Engine Settings: ___/___ tests passed
- [ ] Moments Engine Settings: ___/___ tests passed
- [ ] Feedback Engine Settings: ___/___ tests passed
- [ ] Vector Settings: ___/___ tests passed
- [ ] Logging Verification: ___/___ tests passed
- [ ] Error Handling: ___/___ tests passed
- [ ] Performance: ___/___ tests passed

### Issues Found
1. _________________________________
2. _________________________________
3. _________________________________

### Recommendations
1. _________________________________
2. _________________________________
3. _________________________________

## Test Execution Notes
- **Tester**: AI Assistant
- **Date**: [Current Date]
- **Environment**: Local Development (localhost:3000)
- **Browser**: [Browser used for testing]
- **Test Duration**: [Time taken to complete all tests] 