export { default as WorkerCardShell } from './WorkerCardShell';
export { default as CardDeck } from './CardDeck';
export { default as WorkerCardDeck } from './WorkerCardDeck';
export type { CardDeckProps, WorkerCardDeckProps } from './WorkerCardDeck';

// Dashboard card implementations reused as worker domain cards.
export {
  AssignmentCard,
  ApplicationCard,
  JobRecommendationCard as JobCard,
  JobRecommendationCard,
  ProfileCompletionCard as ProfileImprovementCard,
  ProfileCompletionCard,
  JobReadinessCard,
  GatewayCard,
  CARD_THEMES,
} from '../dashboard/cards';

export type {
  DashboardCardPayload,
  AssignmentCardPayload,
  ApplicationCardPayload,
  ProfileCompletionCardPayload,
  JobReadinessCardPayload,
  JobRecommendationCardPayload,
  GatewayCardPayload,
  JobCategory,
} from '../dashboard/cards';
