/**
 * Email Toast Notification Utilities
 * 
 * Provides toast notifications for email actions with undo support
 */

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface EmailToast {
  id: string;
  message: string;
  action?: ToastAction;
  duration?: number;
  type?: 'success' | 'error' | 'info' | 'warning';
}

let toastListeners: ((toast: EmailToast) => void)[] = [];

/**
 * Subscribe to toast notifications
 */
export function subscribeToToasts(callback: (toast: EmailToast) => void): () => void {
  toastListeners.push(callback);
  return () => {
    toastListeners = toastListeners.filter((listener) => listener !== callback);
  };
}

/**
 * Show a toast notification
 */
export function showToast(toast: Omit<EmailToast, 'id'>): void {
  const toastWithId: EmailToast = {
    id: `toast-${Date.now()}-${Math.random()}`,
    duration: 5000,
    type: 'info',
    ...toast,
  };

  toastListeners.forEach((listener) => listener(toastWithId));
}

/**
 * Show success toast
 */
export function showSuccessToast(message: string, action?: ToastAction): void {
  showToast({ message, type: 'success', action });
}

/**
 * Show error toast
 */
export function showErrorToast(message: string, action?: ToastAction): void {
  showToast({ message, type: 'error', action, duration: 7000 });
}

/**
 * Show undo toast with action
 */
export function showUndoToast(
  message: string,
  onUndo: () => void,
  duration = 5000
): void {
  showToast({
    message,
    type: 'info',
    action: {
      label: 'Undo',
      onClick: onUndo,
    },
    duration,
  });
}

