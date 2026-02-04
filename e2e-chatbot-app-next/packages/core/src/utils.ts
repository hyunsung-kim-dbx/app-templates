import type { UIMessagePart } from 'ai';
import type { DBMessage } from '@chat-template/db';
import type { ChatMessage, ChatTools, CustomUIDataTypes } from './types';
import { formatISO } from 'date-fns';
import { Tiktoken } from 'js-tiktoken/lite';
import cl100k_base from 'js-tiktoken/ranks/cl100k_base';

// Initialize tokenizer (cl100k_base is used by GPT-4, Claude, and most modern models)
const tokenizer = new Tiktoken(cl100k_base);

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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

/**
 * Truncates a tool output if it exceeds the token limit.
 * Preserves structure for JSON data.
 */
function truncateToolOutput(
  output: unknown,
  maxTokens = 5000,
): { value: unknown; wasTruncated: boolean } {
  const outputStr =
    typeof output === 'string' ? output : JSON.stringify(output);
  const tokens = tokenizer.encode(outputStr);

  if (tokens.length <= maxTokens) {
    return { value: output, wasTruncated: false };
  }

  // Truncate and add indicator
  const truncatedTokens = tokens.slice(0, maxTokens);
  const truncatedStr = tokenizer.decode(truncatedTokens);

  const indicator = `\n\n[Output truncated: ${tokens.length} tokens → ${maxTokens} tokens]`;

  return {
    value: truncatedStr + indicator,
    wasTruncated: true,
  };
}

/**
 * Estimates token count for a single message.
 * Counts tokens in all text content including parts.
 * Optionally truncates large tool outputs.
 */
function countMessageTokens(
  message: ChatMessage,
  truncateToolOutputs = false,
): { tokens: number; message: ChatMessage } {
  let totalTokens = 0;
  let modified = false;
  const newParts = [...message.parts];

  // Count tokens in each part
  for (let i = 0; i < newParts.length; i++) {
    const part = newParts[i];

    if (part.type === 'text' && part.text) {
      totalTokens += tokenizer.encode(part.text).length;
    } else if (part.type === 'dynamic-tool') {
      // Count tool input
      if (part.input) {
        const inputStr =
          typeof part.input === 'string'
            ? part.input
            : JSON.stringify(part.input);
        totalTokens += tokenizer.encode(inputStr).length;
      }

      // Count/truncate tool output
      if (part.output) {
        if (truncateToolOutputs) {
          const { value, wasTruncated } = truncateToolOutput(part.output, 5000);
          if (wasTruncated) {
            newParts[i] = { ...part, output: value };
            modified = true;
          }
        }

        const outputStr =
          typeof part.output === 'string'
            ? part.output
            : JSON.stringify(part.output);
        totalTokens += tokenizer.encode(outputStr).length;
      }
    }
  }

  // Add overhead for message structure (role, metadata, etc)
  totalTokens += 4; // approximate overhead per message

  return {
    tokens: totalTokens,
    message: modified ? { ...message, parts: newParts } : message,
  };
}

/**
 * Truncates messages to prevent exceeding API request size limits.
 * Uses token-based truncation to handle large data chunks properly.
 * Keeps the most recent messages up to maxTokens limit.
 *
 * Features:
 * - Token-based truncation (accurate for large data chunks)
 * - Truncates individual tool outputs that exceed 5000 tokens
 * - Preserves most recent messages
 * - Logs truncation details for debugging
 *
 * @param messages - Array of chat messages
 * @param maxTokens - Maximum tokens to keep (default: 100000, ~75% of typical 128k context)
 * @returns Truncated array of messages
 */
export function truncateMessages(
  messages: ChatMessage[],
  maxTokens = 100000,
): ChatMessage[] {
  if (messages.length === 0) {
    return messages;
  }

  // Count tokens for each message from newest to oldest
  const messagesWithTokens: Array<{ message: ChatMessage; tokens: number }> =
    [];
  let totalTokens = 0;

  // Iterate from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const rawMessage = messages[i];

    // Count tokens and optionally truncate tool outputs
    const { tokens, message } = countMessageTokens(rawMessage, true);

    if (totalTokens + tokens <= maxTokens) {
      messagesWithTokens.unshift({ message, tokens });
      totalTokens += tokens;
    } else {
      // Check if we have at least 2 messages (for context)
      if (messagesWithTokens.length < 2) {
        // Force include at least 2 messages even if over limit
        messagesWithTokens.unshift({ message, tokens });
        totalTokens += tokens;
        console.warn(
          `[Truncate] Forced inclusion of message to maintain minimum context (${totalTokens} tokens, exceeds ${maxTokens} limit)`,
        );
      } else {
        // Stop adding older messages
        console.log(
          `[Truncate] Token limit reached. Keeping ${messagesWithTokens.length}/${messages.length} messages (${totalTokens}/${maxTokens} tokens)`,
        );
        break;
      }
    }
  }

  // If we kept all messages, no truncation needed
  if (messagesWithTokens.length === messages.length) {
    console.log(
      `[Truncate] All ${messages.length} messages fit within limit (${totalTokens} tokens)`,
    );
    return messages;
  }

  // Extract just the messages (drop token counts)
  const truncated = messagesWithTokens.map((m) => m.message);

  console.log(
    `[Truncate] Reduced from ${messages.length} to ${truncated.length} messages (${totalTokens}/${maxTokens} tokens)`,
  );

  return truncated;
}
