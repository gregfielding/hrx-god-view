/**
 * Dashboard Feed Drawer Integration
 * 
 * Helper functions to open the correct drawer type from a feed item.
 */

import { DashboardFeedItem } from '../types/dashboardFeed';

export interface DrawerOpenCallbacks {
  openEmailDrawer: (options: { threadId: string; tenantId: string }) => void;
  openSlackDMDrawer: (options: { threadId: string; tenantId: string }) => void;
  openSlackChannelDrawer: (options: { channelId: string }) => void;
  openMentionsDrawer?: () => void;
}

/**
 * Opens the appropriate drawer based on the feed item's drawer scope
 */
export function openDrawerFromFeedItem(
  item: DashboardFeedItem,
  tenantId: string,
  callbacks: DrawerOpenCallbacks
): void {
  switch (item.drawerScope.scopeType) {
    case 'email':
      if (item.drawerScope.threadId) {
        callbacks.openEmailDrawer({
          threadId: item.drawerScope.threadId,
          tenantId,
        });
      } else {
        console.warn('Email feed item missing threadId', item);
      }
      break;

    case 'slack_dm':
      if (item.drawerScope.channelId) {
        callbacks.openSlackDMDrawer({
          threadId: item.drawerScope.channelId,
          tenantId,
        });
      } else {
        console.warn('Slack DM feed item missing channelId', item);
      }
      break;

    case 'slack_channel':
      if (item.drawerScope.channelId) {
        callbacks.openSlackChannelDrawer({
          channelId: item.drawerScope.channelId,
        });
      } else {
        console.warn('Slack Channel feed item missing channelId', item);
      }
      break;

    case 'mention':
      // Open the mentions drawer to show all mentions
      if (callbacks.openMentionsDrawer) {
        callbacks.openMentionsDrawer();
      } else {
        // Fallback: For Slack mentions, open the Slack channel drawer
        if (item.mentionMetadata?.origin === 'slack' && item.drawerScope.channelId) {
          callbacks.openSlackChannelDrawer({
            channelId: item.drawerScope.channelId,
          });
        } else {
          console.log('HRX mention clicked', item);
        }
      }
      break;

    default:
      console.warn('Unknown drawer scope type', item.drawerScope);
  }
}

