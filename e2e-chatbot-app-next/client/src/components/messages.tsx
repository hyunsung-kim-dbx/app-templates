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

  // Auto-scroll during streaming - but STOP if user scrolls up
  useEffect(() => {
    if (status !== 'streaming') return;

    let userScrolledUp = false;
    let lastScrollTop = 0;
    const container = messagesContainerRef.current;
    if (!container) return;

    // Initialize lastScrollTop
    lastScrollTop = container.scrollTop;

    const handleScroll = () => {
      const currentScrollTop = container.scrollTop;
      const isAtBottom = currentScrollTop + container.clientHeight >= container.scrollHeight - 100;

      // User scrolled UP (scrollTop decreased)
      if (currentScrollTop < lastScrollTop - 10) {
        userScrolledUp = true;
      }

      // User scrolled back to bottom - resume auto-scroll
      if (isAtBottom) {
        userScrolledUp = false;
      }

      lastScrollTop = currentScrollTop;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    // Auto-scroll every 100ms during streaming
    const scrollInterval = setInterval(() => {
      if (userScrolledUp) return;

      const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 100;
      if (!isAtBottom) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'instant',
        });
      }
    }, 100);

    return () => {
      clearInterval(scrollInterval);
      container.removeEventListener('scroll', handleScroll);
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
