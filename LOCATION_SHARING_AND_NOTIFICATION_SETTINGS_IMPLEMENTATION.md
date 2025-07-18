# Location Sharing & Notification Settings Implementation

## Overview
This document outlines the implementation of comprehensive location sharing and notification settings for the HRX platform user profiles. The implementation provides users with granular control over their privacy, location sharing, and notification preferences.

## What Information We Collect & Track

### 1. Location Sharing Settings
- **Location Sharing Status**: Whether the user has enabled location sharing in the mobile app
- **Location Sharing Granularity**: 
  - `always` - Share location continuously
  - `work_hours` - Share only during work hours
  - `assignments_only` - Share only when on active assignments
  - `manual` - Share only when manually triggered
  - `disabled` - No location sharing
- **Last Location Update**: Timestamp of last location update
- **Location Accuracy**: Preferred accuracy level (high/medium/low)
- **Geofencing**: Whether to use geofencing for automatic check-ins
- **Background Location**: Whether to allow location tracking when app is in background
- **Battery Optimization**: Whether to optimize for battery life
- **Data Usage Optimization**: Whether to limit data usage for location updates

### 2. Notification Preferences
- **Push Notifications**: Enable/disable push notifications
- **Email Notifications**: Enable/disable email notifications
- **SMS Notifications**: Enable/disable SMS notifications
- **Notification Categories**:
  - Schedule updates
  - Assignment changes
  - System announcements
  - Emergency alerts
  - Companion/AI interactions
  - Performance feedback
  - Training opportunities
  - Marketing emails

### 3. Privacy Controls
- **Profile Visibility**: Who can see their profile (public/team/private)
- **Contact Information Sharing**: Whether to show contact info to others
- **Schedule Visibility**: Whether to show work schedule to others
- **Data Analytics Consent**: Whether to allow data for analytics

## Where It's Logically Placed

### 1. **New "Privacy & Notifications" Tab in User Profile**
- **Location**: `src/pages/UserProfile/components/PrivacySettingsTab.tsx`
- **Access**: Available to users viewing their own profile or admins/managers viewing any profile
- **Features**:
  - Three collapsible sections: Location Sharing, Notification Preferences, Privacy Settings
  - Real-time saving with feedback
  - Permission-based editing (users can only edit their own settings unless they're admins/managers)

### 2. **Location Status Indicator in Profile Overview**
- **Location**: `src/pages/UserProfile/components/ProfileOverview.tsx` (AI Insights section)
- **Purpose**: Quick visual indicator of current location sharing status
- **Shows**: 
  - Whether location sharing is enabled/disabled
  - Current sharing mode (if enabled)
  - Last location update timestamp (if available)

### 3. **Updated Type Definitions**
- **Location**: `src/types/UserProfile.ts`
- **Added Interfaces**:
  - `NotificationSettings`
  - `PrivacySettings` 
  - `LocationSettings`
- **Integration**: These are now part of the main `UserProfile` interface

## Technical Implementation

### Data Structure
```typescript
interface LocationSettings {
  locationSharingEnabled: boolean;
  locationGranularity: 'always' | 'work_hours' | 'assignments_only' | 'manual' | 'disabled';
  lastLocationUpdate?: Date;
  locationAccuracy: 'high' | 'medium' | 'low';
  geofencingEnabled: boolean;
  backgroundLocationEnabled: boolean;
  batteryOptimizationEnabled: boolean;
  dataUsageOptimized: boolean;
}

interface NotificationSettings {
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  scheduleUpdates: boolean;
  assignmentUpdates: boolean;
  systemUpdates: boolean;
  marketingEmails: boolean;
  companionNotifications: boolean;
  performanceFeedback: boolean;
  trainingOpportunities: boolean;
  emergencyAlerts: boolean;
}

interface PrivacySettings {
  profileVisibility: 'public' | 'private' | 'team';
  showContactInfo: boolean;
  showSchedule: boolean;
  allowDataAnalytics: boolean;
  allowLocationSharing: boolean;
}
```

### Firestore Storage
- **Collection**: `users`
- **Fields**: 
  - `notificationSettings` (object)
  - `privacySettings` (object)
  - `locationSettings` (object)
- **Updates**: Real-time with `onSnapshot` listeners

### Permission System
- **Users**: Can edit their own settings
- **Admins/Managers**: Can edit any user's settings (security level 4+)
- **View-only**: Other users can view but not edit

## Mobile App Integration Points

### Location Sharing Implementation
The mobile app (Flutter) should:

1. **Check User Preferences**: Read `locationSettings` from Firestore
2. **Respect Granularity**: Only share location based on selected mode
3. **Update Status**: Send location updates to Firestore when sharing
4. **Handle Permissions**: Request location permissions based on user settings
5. **Battery Optimization**: Adjust location update frequency based on settings
6. **Geofencing**: Implement automatic check-ins when entering work locations

### Notification Implementation
The mobile app should:

1. **Check Notification Settings**: Read `notificationSettings` from Firestore
2. **Respect Categories**: Only send notifications for enabled categories
3. **Handle Channels**: Use appropriate notification channels (push/email/SMS)
4. **Emergency Override**: Always send emergency alerts regardless of settings

## User Experience

### Profile Overview Tab
- Users see a quick status indicator of their location sharing
- Shows current mode and last update time
- Provides immediate visual feedback

### Privacy & Notifications Tab
- **Accordion Layout**: Organized into logical sections
- **Visual Indicators**: Icons and colors show current status
- **Granular Control**: Detailed settings for each preference
- **Real-time Saving**: Changes are saved immediately with feedback
- **Permission Awareness**: UI adapts based on user permissions

### Navigation
- **Main Menu**: "Privacy & Notifications" accessible from sidebar
- **Profile Tab**: Integrated into user profile as a dedicated tab
- **Consistent Access**: Same functionality available in both locations

## Security & Privacy Considerations

### Data Protection
- **User Control**: Users have full control over their privacy settings
- **Granular Permissions**: Different levels of access based on role
- **Audit Trail**: All changes are logged with timestamps
- **Default Privacy**: Conservative defaults (location sharing disabled by default)

### Compliance
- **GDPR Ready**: Users can control data usage and analytics consent
- **Transparency**: Clear explanations of what each setting does
- **Opt-out Options**: Users can disable any data collection
- **Emergency Override**: Critical safety notifications can bypass preferences

## Future Enhancements

### Potential Additions
1. **Location History**: View and manage location history
2. **Geofence Management**: Create and manage custom geofences
3. **Notification Scheduling**: Set quiet hours for notifications
4. **Advanced Privacy**: More granular privacy controls
5. **Analytics Dashboard**: View how settings affect data collection

### Mobile App Features
1. **Background Location**: Implement background location tracking
2. **Geofencing**: Automatic check-ins at work locations
3. **Battery Optimization**: Smart location update scheduling
4. **Offline Support**: Cache settings for offline use
5. **Push Notifications**: Rich push notifications with actions

## Testing Considerations

### Manual Testing
1. **Permission Changes**: Test all location sharing modes
2. **Notification Categories**: Verify each notification type respects settings
3. **Role-based Access**: Test editing permissions for different user roles
4. **Real-time Updates**: Verify settings sync across devices
5. **Edge Cases**: Test with missing or corrupted settings data

### Integration Testing
1. **Mobile App Sync**: Verify settings are respected by mobile app
2. **Firebase Functions**: Test any backend processing of location data
3. **Notification Services**: Verify notification delivery respects settings
4. **Data Analytics**: Ensure analytics respect privacy settings

## Conclusion

This implementation provides a comprehensive, user-friendly system for managing location sharing and notification preferences. The design prioritizes user privacy while maintaining the functionality needed for effective workforce management. The modular approach allows for easy expansion and integration with the mobile app. 