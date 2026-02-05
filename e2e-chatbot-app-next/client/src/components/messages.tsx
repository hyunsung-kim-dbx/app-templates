import { PreviewMessage, AwaitingResponseMessage } from './message';
import { Greeting } from './greeting';
import { memo, useEffect } from 'react';
import equal from 'fast-deep-equal';
import type { UseChatHelpers } from '@ai-sdk/react';
import { useMessages } from '@/hooks/use-messages';
import type { ChatMessage } from '@chat-template/core';
import { useDataStream } from './data-stream-provider';
import { Conversation, ConversationContent } from './elements/conversation';
import { ArrowDownIcon } from 'lucide-react';

interface MessagesProps {
  chatId: string;
  status: UseChatHelpers<ChatMessage>['status'];
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  addToolApprovalResponse: UseChatHelpers<ChatMessage>['addToolApprovalResponse'];
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
  regenerate: UseChatHelpers<ChatMessage>['regenerate'];
  isReadonly: boolean;
  selectedModelId: string;
}

function PureMessages({
  chatId,
  status,
  messages,
  setMessages,
  addToolApprovalResponse,
  sendMessage,
  regenerate,
  isReadonly,
  selectedModelId,
}: MessagesProps) {
  // Ensure messages is always an array to prevent crashes
  const safeMessages = messages ?? [];

  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
  } = useMessages({
    status,
  });

  useDataStream();

  // Scroll on submit
  useEffect(() => {
    if (status === 'submitted') {
      requestAnimationFrame(() => {
        const container = messagesContainerRef.current;
        if (container) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth',
          });
        }
      });
    }
  }, [status, messagesContainerRef]);

  // Continuous auto-scroll during streaming using interval
  useEffect(() => {
    if (status !== 'streaming') return;

    // Track when user last interacted - pause auto-scroll for 2 seconds after interaction
    let lastInteractionTime = 0;
    const PAUSE_DURATION = 2000; // 2 seconds pause after user interaction

    // Detect user interaction (wheel/touch)
    const handleUserInteraction = () => {
      lastInteractionTime = Date.now();
    };

    const container = messagesContainerRef.current;
    container?.addEventListener('wheel', handleUserInteraction, { passive: true });
    container?.addEventListener('touchstart', handleUserInteraction, { passive: true });
    container?.addEventListener('mousedown', handleUserInteraction, { passive: true });

    // Auto-scroll every 50ms during streaming (10ms was too aggressive)
    const scrollInterval = setInterval(() => {
      const container = messagesContainerRef.current;
      if (!container) return;

      // Skip auto-scroll if user interacted recently
      const timeSinceInteraction = Date.now() - lastInteractionTime;
      if (timeSinceInteraction < PAUSE_DURATION) {
        return;
      }

      // Only scroll if not already at bottom (avoid unnecessary scroll calls)
      const isNearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 50;
      if (!isNearBottom) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'instant',
        });
      }
    }, 50);

    return () => {
      clearInterval(scrollInterval);
      container?.removeEventListener('wheel', handleUserInteraction);
      container?.removeEventListener('touchstart', handleUserInteraction);
      container?.removeEventListener('mousedown', handleUserInteraction);
    };
  }, [status, messagesContainerRef]);

  return (
    <div
      ref={messagesContainerRef}
      className="overscroll-behavior-contain -webkit-overflow-scrolling-touch flex-1 touch-pan-y overflow-y-scroll"
      style={{ overflowAnchor: 'none' }}
    >
      <Conversation className="mx-auto flex min-w-0 max-w-4xl flex-col gap-4 md:gap-6">
        <ConversationContent className="flex flex-col gap-4 px-2 py-4 md:gap-6 md:px-4">
          {safeMessages.length === 0 && <Greeting />}

          {safeMessages.map((message, index) => (
            <PreviewMessage
              key={message.id}
              chatId={chatId}
              message={message}
              allMessages={safeMessages}
              isLoading={
                status === 'streaming' && safeMessages.length - 1 === index
              }
              setMessages={setMessages}
              addToolApprovalResponse={addToolApprovalResponse}
              sendMessage={sendMessage}
              regenerate={regenerate}
              isReadonly={isReadonly}
              requiresScrollPadding={
                hasSentMessage && index === safeMessages.length - 1
              }
            />
          ))}

          {status === 'submitted' &&
            safeMessages.length > 0 &&
            safeMessages[safeMessages.length - 1].role === 'user' &&
            selectedModelId !== 'chat-model-reasoning' && (
              <AwaitingResponseMessage />
            )}

          <div
            ref={messagesEndRef}
            className="min-h-[24px] min-w-[24px] shrink-0"
          />
        </ConversationContent>
      </Conversation>

      {!isAtBottom && (
        <button
          className="-translate-x-1/2 absolute bottom-40 left-1/2 z-10 rounded-full border bg-background p-2 shadow-lg transition-colors hover:bg-muted"
          onClick={() => scrollToBottom('smooth')}
          type="button"
          aria-label="Scroll to bottom"
        >
          <ArrowDownIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.selectedModelId !== nextProps.selectedModelId) return false;
  if ((prevProps.messages?.length ?? 0) !== (nextProps.messages?.length ?? 0)) return false;
  if (!equal(prevProps.messages ?? [], nextProps.messages ?? [])) return false;

  return false;
});
