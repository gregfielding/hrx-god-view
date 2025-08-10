import React from 'react';



import ChatUI from './ChatUI';

interface DevOpsChatProps {
  context: {
    logs?: string;
    error?: string;
    filename?: string;
    filetree?: string;
  };
}

const DevOpsChat: React.FC<DevOpsChatProps> = ({ context }) => {
  return <ChatUI context={context} />;
};

export default DevOpsChat;
