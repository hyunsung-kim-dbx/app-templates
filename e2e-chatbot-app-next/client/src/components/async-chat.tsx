/**
 * AsyncChat component - uses polling instead of streaming
 * Bypasses proxy timeout by starting background jobs
 */

import type { LanguageModelUsage } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { ChatHeader } from '@/components/chat-header';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import type {
  Attachment,
  ChatMessage,
  VisibilityType,
} from '@chat-template/core';
import { unstable_serialize } from 'swr/infinite';
import { getChatHistoryPaginationKey } from './sidebar-history';
import { toast } from './toast';
import { useSearchParams } from 'react-router-dom';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import type { ClientSession } from '@chat-template/auth';
import { softNavigateToChatId } from '@/lib/navigation';
import { useAsyncChat } from '@/hooks/useAsyncChat';

export function AsyncChat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  session: ClientSession;
  initialLastContext?: LanguageModelUsage;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();

  const [input, setInput] = useState<string>('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selectedChatModel, setSelectedChatModel] = useState<string>(initialChatModel);

  // Ensure initialMessages is always an array
  const safeInitialMessages = initialMessages ?? [];
  const isNewChat = safeInitialMessages.length === 0;
  const didFetchHistoryOnNewChat = useRef(false);

  const fetchChatHistory = useCallback(() => {
    mutate(unstable_serialize(getChatHistoryPaginationKey));
  }, [mutate]);

  const {
    messages,
    setMessages,
    status,
    isLoading,
    sendMessage,
    stop,
  } = useAsyncChat({
    chatId: id,
    initialMessages: safeInitialMessages,
    selectedChatModel,
    selectedVisibilityType: visibilityType,
    onFinish: (message) => {
      console.log('[AsyncChat] Message finished:', message.id);
      fetchChatHistory();
    },
    onError: (error) => {
      console.error('[AsyncChat] Error:', error);
      toast({
        type: 'error',
        description: error.message,
      });
    },
  });

  // Handle new chat - update URL when first message is sent
  useEffect(() => {
    if (isNewChat && messages.length > 0 && !didFetchHistoryOnNewChat.current) {
      didFetchHistoryOnNewChat.current = true;
      // Update URL to include chat ID
      softNavigateToChatId(id);
      fetchChatHistory();
    }
  }, [isNewChat, messages.length, id, fetchChatHistory]);

  // Handle form submit
  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!input.trim() && attachments.length === 0) {
      return;
    }

    const currentInput = input;
    const currentAttachments = [...attachments];

    // Clear input immediately
    setInput('');
    setAttachments([]);

    // Send message
    await sendMessage(currentInput, currentAttachments);
  }, [input, attachments, sendMessage]);

  const [searchParams] = useSearchParams();

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <ChatHeader
        chatId={id}
        selectedChatModel={selectedChatModel}
        setSelectedChatModel={setSelectedChatModel}
        isReadonly={isReadonly}
        autoSelect={searchParams.get('autoselect') === '1'}
      />

      <Messages
        chatId={id}
        status={isLoading ? 'streaming' : 'ready'}
        messages={messages}
        setMessages={setMessages}
        sendMessage={handleSubmit}
        addToolApprovalResponse={() => {
          // No-op: async polling doesn't support tool approvals
        }}
        regenerate={() => {
          // Simple regenerate - remove last assistant message and resend
          const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
          if (lastUserMsg) {
            const textPart = lastUserMsg.parts.find(p => p.type === 'text');
            if (textPart && 'text' in textPart) {
              setMessages(messages.filter(m => m.id !== lastUserMsg.id));
              setInput(textPart.text);
            }
          }
        }}
        isReadonly={isReadonly}
        selectedModelId={selectedChatModel}
      />

      <form className="mx-auto flex w-full gap-2 bg-background px-4 pb-4 md:max-w-3xl md:pb-6">
        <MultimodalInput
          chatId={id}
          input={input}
          setInput={setInput}
          status={isLoading ? 'streaming' : 'ready'}
          stop={stop}
          attachments={attachments}
          setAttachments={setAttachments}
          sendMessage={handleSubmit}
          selectedChatModel={selectedChatModel}
          setSelectedChatModel={setSelectedChatModel}
          isReadonly={isReadonly}
        />
      </form>

      {/* Status indicator for async polling */}
      {status === 'streaming' && (
        <div className='-translate-x-1/2 fixed bottom-20 left-1/2 rounded-full bg-blue-500 px-3 py-1 text-white text-xs'>
          Processing... (polling for updates)
        </div>
      )}
    </div>
  );
}
