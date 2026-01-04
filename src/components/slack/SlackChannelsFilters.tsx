// Re-export to keep legacy import paths working.
// Some code imports from `src/components/slack/SlackChannelsFilters` while the
// implementation lives at `src/components/SlackChannelsFilters`.
export { default } from '../SlackChannelsFilters';
export * from '../SlackChannelsFilters';

