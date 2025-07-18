# Manual UI Test Instructions for Agency AI Settings

## Prerequisites
- React development server running on http://localhost:3000
- Browser with developer tools enabled
- Access to an Agency Profile in the application

## Test Setup

### 1. Open Browser Developer Tools
1. Open your browser (Chrome, Firefox, Safari, or Edge)
2. Navigate to http://localhost:3000
3. Open Developer Tools (F12 or right-click → Inspect)
4. Go to the Console tab
5. Clear the console to start fresh

### 2. Navigate to Agency AI Settings
1. Log in to the application
2. Navigate to Agencies → Select any agency
3. Click on the "AI Settings" tab
4. Verify the page loads without errors in the console

## Test Execution

### Test 1: Traits Engine Settings

#### 1.1 Basic Navigation
- [ ] Verify "Traits Engine Settings" section is visible
- [ ] Click on "Individual Traits" accordion to expand
- [ ] Verify all 5 traits are visible: Reliability, Empathy, Communication, Leadership, Coachability
- [ ] Click on individual trait accordions to expand them

#### 1.2 Trait Weight Sliders
- [ ] Find the Reliability trait weight slider
- [ ] Drag the slider from 0.8 to 0.9
- [ ] Verify the value updates in real-time
- [ ] Check browser console for log message (should show field change)
- [ ] Repeat for Empathy trait (0.7 to 0.8)
- [ ] Repeat for Communication trait (0.9 to 1.0)

#### 1.3 AI Guidance Text Fields
- [ ] Find the Reliability trait AI Guidance field
- [ ] Click in the text area
- [ ] Add some text: "Updated guidance for reliability assessment"
- [ ] Click outside the field to trigger onBlur
- [ ] Check browser console for log message
- [ ] Repeat for Empathy trait AI Guidance

#### 1.4 Master Rules Configuration
- [ ] Scroll to "Master Rules" accordion
- [ ] Click to expand
- [ ] Test "Scoring Method" select:
  - [ ] Click the dropdown
  - [ ] Select "Averaged" instead of "Cumulative"
  - [ ] Verify the selection updates
  - [ ] Check console for log message
- [ ] Test "Update Logic" select:
  - [ ] Change from "Immediate" to "Batch"
  - [ ] Verify selection updates
- [ ] Test "Decay Logic" select:
  - [ ] Change from "Linear" to "Exponential"
  - [ ] Verify selection updates

#### 1.5 Save Functionality
- [ ] Make several changes to different fields
- [ ] Click "Save Traits Engine Settings" button
- [ ] Verify success message appears
- [ ] Refresh the page
- [ ] Verify changes persist

### Test 2: Moments Engine Settings

#### 2.1 Basic Navigation
- [ ] Scroll to "Moments Engine Settings" section
- [ ] Click on "Moments" accordion to expand
- [ ] Verify 3 moments are visible: Welcome Check-in, Monthly Wellness, Quarterly Career

#### 2.2 Moment Configuration
- [ ] Expand the "Welcome Check-in" moment
- [ ] Find the "Title" field
- [ ] Change the title to "Enhanced Welcome Check-in"
- [ ] Verify the field updates
- [ ] Check console for log message

#### 2.3 Category Selection
- [ ] Find the "Category" select for Welcome Check-in
- [ ] Change from "Onboarding" to "Wellness"
- [ ] Verify the selection updates
- [ ] Check console for log message

#### 2.4 Scheduling Configuration
- [ ] Find "Scheduling Type" select
- [ ] Change from "Tenure Based" to "Recurring"
- [ ] Verify selection updates
- [ ] Find "Follow-up Days" field
- [ ] Change from 3 to 5 days
- [ ] Verify field updates

#### 2.5 Tone Override Sliders
- [ ] Scroll to "Tone Override" section
- [ ] Find "Friendliness" slider
- [ ] Drag from 0.9 to 0.8
- [ ] Verify slider updates
- [ ] Check console for log message
- [ ] Find "Empathy" slider
- [ ] Drag from 0.8 to 0.9
- [ ] Verify slider updates

#### 2.6 AI Modifier Notes
- [ ] Find "AI Modifier Notes" text area
- [ ] Add text: "Enhanced AI instructions for welcome moment"
- [ ] Click outside to trigger onBlur
- [ ] Check console for log message

#### 2.7 Save Functionality
- [ ] Make several changes to moment settings
- [ ] Click "Save Moments Engine Settings"
- [ ] Verify success message appears
- [ ] Refresh page and verify changes persist

### Test 3: Feedback Engine Settings

#### 3.1 Basic Navigation
- [ ] Scroll to "Feedback Engine Settings" section
- [ ] Click on "Sentiment Scoring" accordion to expand
- [ ] Click on "Manager Access" accordion to expand
- [ ] Click on "AI Follow-up" accordion to expand

#### 3.2 Sentiment Scoring Configuration
- [ ] Find "Enable Sentiment Scoring" switch
- [ ] Toggle it off and on
- [ ] Verify switch state changes
- [ ] Check console for log message
- [ ] Find "Confidence Threshold" slider
- [ ] Drag from 0.7 to 0.8
- [ ] Verify slider updates
- [ ] Find "Update Frequency" select
- [ ] Change from "Real-time" to "Hourly"
- [ ] Verify selection updates

#### 3.3 Manager Access Configuration
- [ ] Find "Enable Manager Access" switch
- [ ] Toggle it off and on
- [ ] Verify switch state changes
- [ ] Find "Require Worker Opt-in" switch
- [ ] Toggle it off and on
- [ ] Verify switch state changes
- [ ] Find "Access Level" select
- [ ] Change from "Summary Only" to "Detailed Analysis"
- [ ] Verify selection updates

#### 3.4 AI Follow-up Configuration
- [ ] Find "Enable AI-managed Follow-up" switch
- [ ] Toggle it off and on
- [ ] Verify switch state changes
- [ ] Find "Trigger Threshold" slider
- [ ] Drag from 0.6 to 0.7
- [ ] Verify slider updates
- [ ] Find "Max Follow-ups" field
- [ ] Change from 3 to 5
- [ ] Verify field updates

#### 3.5 Save Functionality
- [ ] Make several changes to feedback settings
- [ ] Click "Save Feedback Engine Settings"
- [ ] Verify success message appears
- [ ] Refresh page and verify changes persist

### Test 4: Vector Settings

#### 4.1 Basic Navigation
- [ ] Scroll to "Vector Settings" section
- [ ] Click on "Global Settings" accordion to expand
- [ ] Click on "Vector Collections" accordion to expand

#### 4.2 Global Settings Configuration
- [ ] Find "Default Dimensions" field
- [ ] Change from 1536 to 2048
- [ ] Verify field updates
- [ ] Find "Default Similarity Threshold" slider
- [ ] Drag from 0.7 to 0.75
- [ ] Verify slider updates
- [ ] Find "Default Max Results" field
- [ ] Change from 10 to 15
- [ ] Verify field updates
- [ ] Find "Auto Reindex" switch
- [ ] Toggle it off and on
- [ ] Verify switch state changes
- [ ] Find "Reindex Frequency" select
- [ ] Change from "Weekly" to "Daily"
- [ ] Verify selection updates

#### 4.3 Vector Collections Configuration
- [ ] Find "Traits Collection" switch
- [ ] Toggle it off and on
- [ ] Verify switch state changes
- [ ] Find "Moments Collection" switch
- [ ] Toggle it off and on
- [ ] Verify switch state changes
- [ ] Find "Feedback Collection" switch
- [ ] Toggle it off and on
- [ ] Verify switch state changes

#### 4.4 Collection-Specific Settings
- [ ] Expand "Traits Collection" accordion
- [ ] Find "Dimensions" field
- [ ] Change from 1536 to 2048
- [ ] Verify field updates
- [ ] Find "Similarity Threshold" slider
- [ ] Drag from 0.7 to 0.75
- [ ] Verify slider updates
- [ ] Find "Max Results" field
- [ ] Change from 10 to 12
- [ ] Verify field updates

#### 4.5 Reindex Functionality
- [ ] Find "Reindex" button for Traits Collection
- [ ] Click the button
- [ ] Verify "Reindexing..." state appears
- [ ] Wait for reindex to complete
- [ ] Verify "Last indexed" timestamp updates

#### 4.6 Save Functionality
- [ ] Make several changes to vector settings
- [ ] Click "Save Vector Settings"
- [ ] Verify success message appears
- [ ] Refresh page and verify changes persist

## Console Log Verification

### Expected Log Messages
Look for log messages in the browser console that contain:
- Field path information (e.g., `agencies:agencyId.aiSettings.traits.reliability.weight`)
- Context type information (e.g., `contextType: "traits"`)
- Urgency score information (e.g., `urgencyScore: 4`)
- Description information (e.g., `description: "Agency trait reliability weight setting"`)

### Log Message Format
```
[AI Field Logging] Field change detected:
- Field: reliability.weight
- Context: agency:agencyId
- Old Value: 0.8
- New Value: 0.9
- Context Type: traits
- Urgency Score: 4
```

## Error Detection

### Common Issues to Watch For
1. **Console Errors**: Look for red error messages in the console
2. **Component Not Rendering**: If sections don't appear, check for import errors
3. **Sliders Not Working**: Verify slider components are properly initialized
4. **Save Not Working**: Check for network errors or validation issues
5. **Logging Not Working**: Verify useAIFieldLogging hook is properly connected

### Performance Issues
1. **Slow Loading**: If page takes > 3 seconds to load, there may be performance issues
2. **Unresponsive UI**: If interactions feel sluggish, check for excessive re-renders
3. **Memory Leaks**: Watch for increasing memory usage in browser dev tools

## Test Completion Checklist

### ✅ All Tests Passed
- [ ] Traits Engine Settings: All sliders, fields, and selects work correctly
- [ ] Moments Engine Settings: All configurations save and persist
- [ ] Feedback Engine Settings: All switches and selects function properly
- [ ] Vector Settings: All collections and global settings work correctly
- [ ] Console Logging: All field changes are properly logged
- [ ] Save Functionality: All sections save successfully
- [ ] Error Handling: No console errors or validation issues
- [ ] Performance: UI is responsive and loads quickly

### ❌ Issues Found
If any issues are found, document them here:
1. _________________________________
2. _________________________________
3. _________________________________

## Next Steps
After completing these tests:
1. If all tests pass: Proceed to production deployment
2. If issues found: Fix issues and re-test
3. Document any unexpected behavior or edge cases
4. Update the test plan based on findings 