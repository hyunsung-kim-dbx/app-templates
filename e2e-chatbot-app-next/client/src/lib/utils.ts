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
  let result = text.replace('<has_function_call>', '');

  // Fix inline markdown tables that are missing line breaks
  // Tables look like: | col1 | col2 | followed by |---|---| followed by | val1 | val2 |
  // When concatenated: text| | col | |---| | val |more text

  // Step 1: Add newline before table start (text followed by | |)
  // Pattern: non-pipe char followed by "| |" or "| col" (start of table)
  result = result.replace(/([^\n|\s])(\| *\||\| *[a-zA-Z_])/g, '$1\n\n$2');

  // Step 2: Add newlines between table rows
  // Pattern: | followed by | | (row boundary) - but not |---|
  result = result.replace(/\| *\| *\|(?!-)/g, '|\n|');

  // Step 3: Add newline after separator row (|---|...|)
  result = result.replace(/(\|[-:\s|]+\|)(?=\s*\|)/g, '$1\n');

  // Step 4: Add newline after table end (| followed by non-table text)
  // Pattern: | followed by non-pipe, non-space start of text
  result = result.replace(/\|([^\n|\s-][^\n|]*)/g, (match, afterPipe) => {
    // Don't break if it looks like table content (starts with space or is short)
    if (afterPipe.match(/^[\s\d]/) || afterPipe.length < 3) {
      return match;
    }
    return `|\n\n${afterPipe}`;
  });

  // Clean up excessive newlines (more than 2 consecutive)
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
