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
  // Agent outputs tables like: "name| | col1 | col2 | |---:|:---| | 0 | val1 | | 1 | val2 |nexttext"

  // Step 1: Add newline before table start
  // Pattern: word characters followed directly by "| |" (table with index column)
  result = result.replace(/(\w)(\| *\| *\w)/g, '$1\n\n$2');

  // Step 2: Add newline before separator row (|---| or |:---|)
  result = result.replace(/\| *(\|[-:]+)/g, '|\n$1');

  // Step 3: Add newline after separator row, before data rows
  result = result.replace(/([-:]\|) *(\| *[\d\w])/g, '$1\n$2');

  // Step 4: Add newlines between data rows
  // Pattern: "| |" followed by a number (new row with index)
  result = result.replace(/\| *\| *(\d)/g, '|\n| $1');

  // Step 5: Add newline after table ends (| followed by letter that starts a word, not a table cell)
  // Look for pattern: |<space>word where word is not a table continuation
  result = result.replace(/\| *([a-zA-Z\u3131-\uD79D]{2,})/g, (match, word) => {
    // If it looks like a table cell value (short, single word), keep it
    // If it looks like start of a sentence (Korean, longer text), add newline
    if (word.length > 10 || /[\u3131-\uD79D]/.test(word)) {
      return `|\n\n${word}`;
    }
    return match;
  });

  // Step 6: Clean up agent/step names that appear before tables or text
  // Pattern: word-with-dashes immediately followed by newline and table/text
  result = result.replace(/([a-z]+-[a-z]+-[a-z]+)\n\n/gi, '$1\n\n---\n\n');

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
