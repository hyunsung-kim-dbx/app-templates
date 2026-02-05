import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage } from '@chat-template/core';
import { generateUUID } from '@/lib/utils';

interface JobStatus {
  jobId: string;
  chatId: string;
  status: 'pending' | 'streaming' | 'completed' | 'error';
  messageId: string | null;
  partialText: string;
  partsReceived: number;
  finishReason: string | null;
  error: string | null;
  updatedAt: string;
}

interface UseAsyncChatOptions {
  chatId: string;
  initialMessages: ChatMessage[];
  selectedChatModel: string;
  onFinish?: (message: ChatMessage) => void;
  onError?: (error: Error) => void;
  pollingInterval?: number;
}

type ChatStatus = 'idle' | 'starting' | 'streaming' | 'error';

/**
 * Async polling-based chat hook
 * Starts a background job and polls for results
 */
export function useAsyncChat(options: UseAsyncChatOptions) {
  const {
    chatId,
    initialMessages,
    selectedChatModel,
    onFinish,
    onError,
    pollingInterval = 2000, // Poll every 2 seconds
  } = options;

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [partialText, setPartialText] = useState<string>('');

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const lastPartsReceivedRef = useRef<number>(0);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Poll for job status
  const pollJobStatus = useCallback(async (jobId: string): Promise<JobStatus | null> => {
    try {
      const response = await fetch(`/api/chat-async/job/${jobId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.warn('[AsyncChat] Job not found:', jobId);
          return null;
        }
        throw new Error(`Failed to poll job: ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      console.error('[AsyncChat] Poll error:', err);
      return null;
    }
  }, []);

  // Start polling for a job
  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    lastPartsReceivedRef.current = 0;

    console.log('[AsyncChat] Starting polling for job:', jobId);

    pollingRef.current = setInterval(async () => {
      const jobStatus = await pollJobStatus(jobId);

      if (!jobStatus) {
        return;
      }

      // Update partial text if new content
      if (jobStatus.partsReceived > lastPartsReceivedRef.current) {
        lastPartsReceivedRef.current = jobStatus.partsReceived;
        setPartialText(jobStatus.partialText);

        // Update streaming message in messages array
        setMessages(prev => {
          const lastIdx = prev.length - 1;
          if (lastIdx >= 0 && prev[lastIdx].role === 'assistant' && !prev[lastIdx].id.includes('-final')) {
            const updated = [...prev];
            updated[lastIdx] = {
              ...updated[lastIdx],
              parts: [{ type: 'text', text: jobStatus.partialText }],
            };
            return updated;
          }
          return prev;
        });
      }

      // Check for completion
      if (jobStatus.status === 'completed') {
        console.log('[AsyncChat] Job completed:', jobId);
        stopPolling();
        setStatus('idle');
        setCurrentJobId(null);

        // Finalize the message
        const finalMessage: ChatMessage = {
          id: jobStatus.messageId || generateUUID(),
          role: 'assistant',
          parts: [{ type: 'text', text: jobStatus.partialText }],
          createdAt: new Date(),
          attachments: [],
        };

        setMessages(prev => {
          // Replace the streaming message with final
          const lastIdx = prev.length - 1;
          if (lastIdx >= 0 && prev[lastIdx].role === 'assistant') {
            const updated = [...prev];
            updated[lastIdx] = finalMessage;
            return updated;
          }
          return prev;
        });

        onFinish?.(finalMessage);

        // Show warning if truncated
        if (jobStatus.finishReason === 'length') {
          console.warn('[AsyncChat] Response was truncated');
        }
      }

      // Check for error
      if (jobStatus.status === 'error') {
        console.error('[AsyncChat] Job failed:', jobStatus.error);
        stopPolling();
        setStatus('error');
        setCurrentJobId(null);

        const err = new Error(jobStatus.error || 'Chat failed');
        setError(err);
        onError?.(err);
      }
    }, pollingInterval);
  }, [pollJobStatus, pollingInterval, stopPolling, onFinish, onError]);

  // Send a message (starts async job)
  const sendMessage = useCallback(async (content: string, attachments: any[] = []) => {
    setError(null);
    setStatus('starting');
    setPartialText('');

    // Create user message
    const userMessage: ChatMessage = {
      id: generateUUID(),
      role: 'user',
      parts: [{ type: 'text', text: content }],
      createdAt: new Date(),
      attachments: attachments.map(a => ({
        type: 'file' as const,
        url: a.url,
        filename: a.name,
        mediaType: a.contentType,
      })),
    };

    // Create placeholder for assistant message
    const placeholderMessage: ChatMessage = {
      id: `${generateUUID()}-streaming`,
      role: 'assistant',
      parts: [],
      createdAt: new Date(),
      attachments: [],
    };

    // Add messages to state
    const updatedMessages = [...messages, userMessage];
    setMessages([...updatedMessages, placeholderMessage]);

    try {
      // Start async job
      const response = await fetch('/api/chat-async/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          id: chatId,
          messages: updatedMessages,
          selectedChatModel,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to start chat: ${response.status}`);
      }

      const { jobId } = await response.json();
      console.log('[AsyncChat] Job started:', jobId);

      setCurrentJobId(jobId);
      setStatus('streaming');

      // Start polling
      startPolling(jobId);

    } catch (err) {
      console.error('[AsyncChat] Failed to start job:', err);
      setStatus('error');
      const error = err instanceof Error ? err : new Error('Failed to start chat');
      setError(error);
      onError?.(error);

      // Remove placeholder message
      setMessages(updatedMessages);
    }
  }, [chatId, messages, selectedChatModel, startPolling, onError]);

  // Stop/cancel current job
  const stop = useCallback(() => {
    stopPolling();
    setStatus('idle');
    setCurrentJobId(null);
    // Note: Server-side job will continue, but we stop tracking it
  }, [stopPolling]);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
    setStatus('idle');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  // Update messages when initialMessages change
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  return {
    messages,
    setMessages,
    status,
    isLoading: status === 'starting' || status === 'streaming',
    error,
    sendMessage,
    stop,
    clearError,
    currentJobId,
    partialText,
  };
}
