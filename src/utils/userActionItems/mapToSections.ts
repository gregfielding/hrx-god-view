import type { ActionItem } from '../../types/actionItems';

export type ActionItemsSections = {
  blocking: ActionItem[];
  nextSteps: ActionItem[];
  watchouts: ActionItem[];
  /** Items that did not fit caps (for future "+N more") */
  overflow: { blocking: number; nextSteps: number; watchouts: number };
};

const MAX_BLOCKING = 3;
const MAX_NEXT = 4;
const MAX_WATCH = 2;

/** Pre-cap counts for header summaries and QA/debug. */
export function countActionItemsByBlockingKind(items: ActionItem[]) {
  return {
    blocking: items.filter((i) => i.blocking === 'hard').length,
    nextSteps: items.filter((i) => i.blocking === 'soft').length,
    watchouts: items.filter((i) => i.blocking === 'informational').length,
  };
}

export function mapActionItemsToSections(items: ActionItem[]): ActionItemsSections {
  const blocking = items.filter((i) => i.blocking === 'hard');
  const nextSteps = items.filter((i) => i.blocking === 'soft');
  const watchouts = items.filter((i) => i.blocking === 'informational');

  const blockingShown = blocking.slice(0, MAX_BLOCKING);
  const nextShown = nextSteps.slice(0, MAX_NEXT);
  const watchShown = watchouts.slice(0, MAX_WATCH);

  return {
    blocking: blockingShown,
    nextSteps: nextShown,
    watchouts: watchShown,
    overflow: {
      blocking: Math.max(0, blocking.length - MAX_BLOCKING),
      nextSteps: Math.max(0, nextSteps.length - MAX_NEXT),
      watchouts: Math.max(0, watchouts.length - MAX_WATCH),
    },
  };
}
