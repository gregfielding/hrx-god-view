/**
 * ChatGPT Context
 * 
 * Manages the state of the ChatGPT drawer, including open/close state and scope.
 * Scope determines whether to show general chat or a scoped chat (e.g., Sales Coach for a contact).
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export interface ChatGPTScope {
  type: 'general' | 'sales_coach';
  entityType?: 'contact' | 'company' | 'deal';
  entityId?: string;
  entityName?: string;
  tenantId?: string;
  // Sales Coach specific props
  contactCompany?: string;
  contactTitle?: string;
  dealStage?: string;
  associations?: {
    companies?: any[];
    contacts?: any[];
    deals?: any[];
    salespeople?: any[];
    locations?: any[];
  };
}

interface ChatGPTContextType {
  isOpen: boolean;
  scope: ChatGPTScope | null;
  openChatGPT: (scope?: ChatGPTScope) => void;
  closeChatGPT: () => void;
  setScope: (scope: ChatGPTScope | null) => void;
}

const ChatGPTContext = createContext<ChatGPTContextType | undefined>(undefined);

export const useChatGPT = () => {
  const context = useContext(ChatGPTContext);
  if (!context) {
    throw new Error('useChatGPT must be used within a ChatGPTProvider');
  }
  return context;
};

interface ChatGPTProviderProps {
  children: ReactNode;
}

export const ChatGPTProvider: React.FC<ChatGPTProviderProps> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [scope, setScope] = useState<ChatGPTScope | null>(null);

  const openChatGPT = useCallback((newScope?: ChatGPTScope) => {
    console.log('[ChatGPTContext] openChatGPT called with scope:', newScope);
    // Always update scope if provided, even if drawer is already open
    if (newScope) {
      console.log('[ChatGPTContext] Setting scope to:', newScope);
      setScope(newScope);
    } else {
      console.log('[ChatGPTContext] No scope provided, defaulting to general');
      setScope({ type: 'general' });
    }
    setIsOpen(true);
  }, []);

  const closeChatGPT = useCallback(() => {
    setIsOpen(false);
    // Don't clear scope when closing - keep it for next open
    // setScope(null);
  }, []);

  const handleSetScope = useCallback((newScope: ChatGPTScope | null) => {
    setScope(newScope);
  }, []);

  return (
    <ChatGPTContext.Provider
      value={{
        isOpen,
        scope,
        openChatGPT,
        closeChatGPT,
        setScope: handleSetScope,
      }}
    >
      {children}
    </ChatGPTContext.Provider>
  );
};
