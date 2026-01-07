/**
 * useEmailShortcuts Hook
 * 
 * Provides keyboard shortcuts for email navigation and actions
 * Gmail-style keyboard navigation
 */

import { useEffect, useCallback, useRef } from 'react';

export interface EmailShortcutHandlers {
  onNavigateNext?: () => void;
  onNavigatePrevious?: () => void;
  onReply?: () => void;
  onForward?: () => void;
  onArchive?: () => void;
  onStar?: () => void;
  onMarkRead?: () => void;
  onSelect?: () => void;
  onFocusSearch?: () => void;
  onGoToInbox?: () => void;
  onGoToStarred?: () => void;
  onGoToSent?: () => void;
  onGoToArchived?: () => void;
  onDelete?: () => void;
  onClose?: () => void;
  onCompose?: () => void;
}

export interface UseEmailShortcutsOptions {
  enabled?: boolean;
  handlers: EmailShortcutHandlers;
  preventDefault?: boolean;
}

/**
 * Email keyboard shortcuts hook
 * 
 * Shortcuts:
 * - j/k: Navigate next/previous thread
 * - r: Reply
 * - f: Forward
 * - a: Archive
 * - s: Star/unstar
 * - e: Mark read/unread
 * - x: Select thread
 * - /: Focus search
 * - g then i: Go to inbox
 * - g then s: Go to starred
 * - g then a: Go to archived
 * - g then t: Go to sent
 * - c: Compose
 * - #: Delete
 * - Esc: Close thread view
 */
export function useEmailShortcuts(
  options: UseEmailShortcutsOptions
): void {
  const { enabled = true, handlers, preventDefault = true } = options;
  const gKeyPressedRef = useRef(false);
  const gKeyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Ignore if typing in input/textarea/contenteditable
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        // Allow Esc to close even when typing
        if (event.key === 'Escape' && handlers.onClose) {
          if (preventDefault) event.preventDefault();
          handlers.onClose();
        }
        return;
      }

      // Handle 'g' key sequences (gmail-style navigation)
      if (event.key === 'g' || event.key === 'G') {
        if (preventDefault) event.preventDefault();
        gKeyPressedRef.current = true;
        
        // Clear any existing timeout
        if (gKeyTimeoutRef.current) {
          clearTimeout(gKeyTimeoutRef.current);
        }
        
        // Reset after 1 second
        gKeyTimeoutRef.current = setTimeout(() => {
          gKeyPressedRef.current = false;
        }, 1000);
        
        return;
      }

      // Handle second key after 'g'
      if (gKeyPressedRef.current) {
        if (preventDefault) event.preventDefault();
        
        switch (event.key.toLowerCase()) {
          case 'i':
            handlers.onGoToInbox?.();
            break;
          case 's':
            handlers.onGoToStarred?.();
            break;
          case 'a':
            handlers.onGoToArchived?.();
            break;
          case 't':
            handlers.onGoToSent?.();
            break;
        }
        
        gKeyPressedRef.current = false;
        if (gKeyTimeoutRef.current) {
          clearTimeout(gKeyTimeoutRef.current);
        }
        return;
      }

      // Handle single-key shortcuts
      switch (event.key) {
        case 'j':
        case 'J':
          if (preventDefault) event.preventDefault();
          handlers.onNavigateNext?.();
          break;
        case 'k':
        case 'K':
          if (preventDefault) event.preventDefault();
          handlers.onNavigatePrevious?.();
          break;
        case 'r':
        case 'R':
          if (preventDefault) event.preventDefault();
          handlers.onReply?.();
          break;
        case 'f':
        case 'F':
          if (preventDefault) event.preventDefault();
          handlers.onForward?.();
          break;
        case 'a':
        case 'A':
          if (preventDefault) event.preventDefault();
          handlers.onArchive?.();
          break;
        case 's':
        case 'S':
          if (preventDefault) event.preventDefault();
          handlers.onStar?.();
          break;
        case 'e':
        case 'E':
          if (preventDefault) event.preventDefault();
          handlers.onMarkRead?.();
          break;
        case 'x':
        case 'X':
          if (preventDefault) event.preventDefault();
          handlers.onSelect?.();
          break;
        case '/':
          if (preventDefault) event.preventDefault();
          handlers.onFocusSearch?.();
          break;
        case 'c':
        case 'C':
          if (preventDefault) event.preventDefault();
          handlers.onCompose?.();
          break;
        case '#':
          if (preventDefault) event.preventDefault();
          handlers.onDelete?.();
          break;
        case 'Escape':
          if (preventDefault) event.preventDefault();
          handlers.onClose?.();
          break;
      }
    },
    [enabled, handlers, preventDefault]
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (gKeyTimeoutRef.current) {
        clearTimeout(gKeyTimeoutRef.current);
      }
    };
  }, [enabled, handleKeyDown]);
}

