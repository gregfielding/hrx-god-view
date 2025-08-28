export interface Features {
  recruiter?: {
    /**
     * Enable jobs board functionality
     */
    enableJobsBoard?: boolean;
    /**
     * Enable application management
     */
    enableApplications?: boolean;
    /**
     * Enable candidate pipeline
     */
    enablePipeline?: boolean;
    /**
     * Enable offer management
     */
    enableOffers?: boolean;
    /**
     * Enable placement tracking
     */
    enablePlacements?: boolean;
    messaging?: {
      /**
       * Enable SMS fallback for messaging
       */
      fallbackSMS?: boolean;
      /**
       * Enable AI-powered messaging nudges
       */
      aiNudges?: boolean;
      /**
       * Enable automatic responses
       */
      autoResponses?: boolean;
    };
    ai?: {
      /**
       * Enable AI candidate scoring
       */
      enableScoring?: boolean;
      /**
       * Enable duplicate candidate detection
       */
      enableDuplicateDetection?: boolean;
      /**
       * Enable AI recommendations
       */
      enableRecommendations?: boolean;
    };
  };
  companion?: {
    /**
     * Enable jobs board in companion app
     */
    enableJobsBoard?: boolean;
    /**
     * Enable application submission in companion app
     */
    enableApplications?: boolean;
    /**
     * Enable messaging in companion app
     */
    enableMessaging?: boolean;
    /**
     * Enable push notifications
     */
    enableNotifications?: boolean;
  };
}
