/**
 * Email Swipe Actions Utilities
 * 
 * Handles swipe gestures for mobile email actions
 */

export type SwipeDirection = 'left' | 'right';
export type SwipeAction = 'archive' | 'delete' | 'star' | 'markRead';

export interface SwipeActionConfig {
  left?: SwipeAction;
  right?: SwipeAction;
  threshold?: number; // Minimum swipe distance (px)
}

export interface SwipeState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isSwiping: boolean;
  direction: SwipeDirection | null;
  distance: number;
}

/**
 * Create swipe handler
 */
export function createSwipeHandler(
  config: SwipeActionConfig,
  onAction: (action: SwipeAction) => void
) {
  const threshold = config.threshold || 100;
  let swipeState: SwipeState = {
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    isSwiping: false,
    direction: null,
    distance: 0,
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    swipeState = {
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      currentY: touch.clientY,
      isSwiping: true,
      direction: null,
      distance: 0,
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swipeState.isSwiping) return;

    const touch = e.touches[0];
    swipeState.currentX = touch.clientX;
    swipeState.currentY = touch.clientY;

    const deltaX = swipeState.currentX - swipeState.startX;
    const deltaY = swipeState.currentY - swipeState.startY;

    // Determine if horizontal swipe (ignore if too vertical)
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      swipeState.direction = deltaX > 0 ? 'right' : 'left';
      swipeState.distance = Math.abs(deltaX);
    }
  };

  const handleTouchEnd = () => {
    if (!swipeState.isSwiping) return;

    const action =
      swipeState.direction === 'left'
        ? config.left
        : swipeState.direction === 'right'
        ? config.right
        : undefined;

    if (action && swipeState.distance >= threshold) {
      onAction(action);
    }

    swipeState = {
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      isSwiping: false,
      direction: null,
      distance: 0,
    };
  };

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    getSwipeState: () => swipeState,
  };
}

/**
 * Get swipe transform style
 */
export function getSwipeTransform(swipeState: SwipeState): React.CSSProperties {
  if (!swipeState.isSwiping || !swipeState.direction) {
    return {};
  }

  const translateX = swipeState.direction === 'left' ? -swipeState.distance : swipeState.distance;

  return {
    transform: `translateX(${translateX}px)`,
    transition: swipeState.isSwiping ? 'none' : 'transform 0.2s ease-out',
  };
}

/**
 * Get swipe action color
 */
export function getSwipeActionColor(action: SwipeAction): string {
  switch (action) {
    case 'archive':
      return '#1976d2';
    case 'delete':
      return '#d32f2f';
    case 'star':
      return '#ed6c02';
    case 'markRead':
      return '#2e7d32';
    default:
      return '#666';
  }
}

/**
 * Get swipe action icon
 */
export function getSwipeActionIcon(action: SwipeAction): string {
  switch (action) {
    case 'archive':
      return 'archive';
    case 'delete':
      return 'delete';
    case 'star':
      return 'star';
    case 'markRead':
      return 'mark-email-read';
    default:
      return 'more';
  }
}

