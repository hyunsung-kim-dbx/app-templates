import type { UIMessagePart } from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { DBMessage } from '@chat-template/db';
import { ChatSDKError, type ErrorCode } from '@chat-template/core/errors';
import type {
  ChatMessage,
  ChatTools,
  CustomUIDataTypes,
} from '@chat-template/core';
import { formatISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new ChatSDKError(code as ErrorCode, cause);
  }

  // Handle 204 No Content - return empty chat history response
  if (response.status === 204) {
    return { chats: [], hasMore: false };
  }

  return response.json();
};

export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      const parsedResponse = await response.json();
      console.log('parsedResponse', parsedResponse);
      const { code, cause } = parsedResponse;
      throw new ChatSDKError(code as ErrorCode, cause);
    }

    return response;
  } catch (error: unknown) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new ChatSDKError('offline:chat');
    }

    throw error;
  }
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function sanitizeText(text: string) {
  // Remove internal markers
  let result = text.replace('<has_function_call>', '');

  // Detect agent/step names (kebab-case patterns like "agent-krafton-meta", "kpi-social-poc")
  // and add visual breaks around them
  // Pattern: word-word or word-word-word at start or after |
  result = result.replace(
    /(\|)?([a-z]+-[a-z]+(?:-[a-z]+)*)(\||\s*[#\u3131-\uD79D])/gi,
    (match, beforePipe, agentName, after) => {
      const prefix = beforePipe ? '|\n\n' : '';
      const suffix = after === '|' ? '\n\n|' : `\n\n${after}`;
      return `${prefix}**🤖 ${agentName}**${suffix}`;
    }
  );

  // Clean up excessive newlines
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

export function convertToUIMessages(messages: DBMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role as 'user' | 'assistant' | 'system',
    parts: message.parts as UIMessagePart<CustomUIDataTypes, ChatTools>[],
    metadata: {
      createdAt: formatISO(message.createdAt),
    },
  }));
}

export function getTextFromMessage(message: ChatMessage): string {
  return (message.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}
