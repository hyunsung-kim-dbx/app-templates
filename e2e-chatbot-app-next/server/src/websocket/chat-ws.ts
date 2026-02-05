import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import { streamText, convertToModelMessages, type LanguageModelUsage } from 'ai';
import type { LanguageModelV3Usage } from '@ai-sdk/provider';
import { saveMessages, updateChatLastContextById } from '@chat-template/db';
import {
  type ChatMessage,
  generateUUID,
  myProvider,
} from '@chat-template/core';
import { setRequestContext } from '@chat-template/ai-sdk-providers';
import {
  CONTEXT_HEADER_CONVERSATION_ID,
  CONTEXT_HEADER_USER_ID,
} from '@chat-template/ai-sdk-providers';

// Convert ai's LanguageModelUsage to @ai-sdk/provider's LanguageModelV3Usage
function toV3Usage(usage: LanguageModelUsage): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage.outputTokens,
      text: undefined,
      reasoning: undefined,
    },
  };
}

interface WebSocketChatMessage {
  type: 'chat';
  chatId: string;
  messages: ChatMessage[];
  selectedChatModel: string;
}

interface WebSocketAuthMessage {
  type: 'auth';
  token?: string;
  headers?: Record<string, string>;
}

type WebSocketIncomingMessage = WebSocketChatMessage | WebSocketAuthMessage;

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  userEmail?: string;
  userAccessToken?: string;
  isAuthenticated?: boolean;
}

/**
 * Initialize WebSocket server for chat streaming
 */
export function initializeWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/ws/chat',
  });

  console.log('[WebSocket] Server initialized on /ws/chat');

  wss.on('connection', (ws: AuthenticatedWebSocket, req: IncomingMessage) => {
    console.log('[WebSocket] New connection');

    // Try to authenticate from headers (for initial connection)
    authenticateFromHeaders(ws, req);

    ws.on('message', async (data) => {
      try {
        const message: WebSocketIncomingMessage = JSON.parse(data.toString());

        if (message.type === 'auth') {
          // Handle authentication message
          handleAuthMessage(ws, message);
          return;
        }

        if (message.type === 'chat') {
          // Handle chat message
          await handleChatMessage(ws, message);
          return;
        }

        ws.send(JSON.stringify({ type: 'error', error: 'Unknown message type' }));
      } catch (error) {
        console.error('[WebSocket] Error processing message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    });

    ws.on('close', () => {
      console.log('[WebSocket] Connection closed');
    });

    ws.on('error', (error) => {
      console.error('[WebSocket] Error:', error);
    });

    // Send ready signal
    ws.send(JSON.stringify({ type: 'connected' }));
  });

  return wss;
}

/**
 * Authenticate WebSocket connection from HTTP headers
 */
function authenticateFromHeaders(ws: AuthenticatedWebSocket, req: IncomingMessage): void {
  const headers = req.headers;

  // Check for Databricks Apps headers
  const userId = headers['x-forwarded-user'] as string;
  const userEmail = headers['x-forwarded-email'] as string;
  const userAccessToken = headers['x-databricks-user-access-token'] as string;

  if (userId) {
    ws.userId = userId;
    ws.userEmail = userEmail;
    ws.userAccessToken = userAccessToken;
    ws.isAuthenticated = true;
    console.log('[WebSocket] Authenticated from headers:', userEmail || userId);
  }
}

/**
 * Handle authentication message from client
 */
function handleAuthMessage(ws: AuthenticatedWebSocket, message: WebSocketAuthMessage): void {
  if (message.headers) {
    const headers = message.headers;
    ws.userId = headers['x-forwarded-user'];
    ws.userEmail = headers['x-forwarded-email'];
    ws.userAccessToken = headers['x-databricks-user-access-token'];
    ws.isAuthenticated = !!ws.userId;

    console.log('[WebSocket] Authenticated via message:', ws.userEmail || ws.userId);
  }

  ws.send(JSON.stringify({
    type: 'auth_result',
    success: ws.isAuthenticated,
    userId: ws.userId,
  }));
}

/**
 * Handle chat message - stream response via WebSocket
 */
async function handleChatMessage(
  ws: AuthenticatedWebSocket,
  message: WebSocketChatMessage
): Promise<void> {
  if (!ws.isAuthenticated) {
    ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
    return;
  }

  const { chatId, messages: uiMessages, selectedChatModel } = message;

  console.log('[WebSocket] Chat request:', {
    chatId,
    messageCount: uiMessages.length,
    model: selectedChatModel
  });

  // Set request context for OBO operations
  if (ws.userAccessToken) {
    setRequestContext({
      userAccessToken: ws.userAccessToken,
      userEmail: ws.userEmail,
    });
  }

  let finalUsage: LanguageModelUsage | undefined;
  let finishReason: string | undefined;

  try {
    const model = await myProvider.languageModel(selectedChatModel);

    // Send start signal
    ws.send(JSON.stringify({ type: 'start', chatId }));

    const result = streamText({
      model,
      messages: await convertToModelMessages(uiMessages),
      headers: {
        [CONTEXT_HEADER_CONVERSATION_ID]: chatId,
        [CONTEXT_HEADER_USER_ID]: ws.userEmail ?? ws.userId ?? '',
      },
      onFinish: ({ usage, finishReason: reason }) => {
        finalUsage = usage;
        finishReason = reason;
      },
    });

    // Stream the response via WebSocket
    const messageId = generateUUID();
    let fullText = '';
    const parts: any[] = [];

    // Send message start
    ws.send(JSON.stringify({
      type: 'message_start',
      messageId,
      role: 'assistant',
    }));

    // Stream text chunks
    for await (const chunk of result.textStream) {
      fullText += chunk;
      ws.send(JSON.stringify({
        type: 'text_delta',
        messageId,
        delta: chunk,
      }));
    }

    // Wait for completion
    await result.response;

    // Build final message parts
    if (fullText) {
      parts.push({ type: 'text', text: fullText });
    }

    // Get tool calls if any (basic support - tool results are complex)
    try {
      const toolCalls = await result.toolCalls;
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          parts.push({
            type: 'tool-invocation',
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            args: 'args' in toolCall ? toolCall.args : {},
            state: 'result',
          });
        }
      }
    } catch (toolErr) {
      console.warn('[WebSocket] Tool calls not available:', toolErr);
    }

    // Send message end
    ws.send(JSON.stringify({
      type: 'message_end',
      messageId,
      finishReason: finishReason || 'stop',
    }));

    // Save message to database
    if (parts.length > 0) {
      try {
        await saveMessages({
          messages: [{
            id: messageId,
            role: 'assistant',
            parts,
            createdAt: new Date(),
            attachments: [],
            chatId,
          }],
        });

        if (finalUsage) {
          await updateChatLastContextById({
            chatId,
            context: toV3Usage(finalUsage),
          });
        }

        console.log('[WebSocket] Message saved:', messageId);
      } catch (saveError) {
        console.error('[WebSocket] Failed to save message:', saveError);
      }
    }

    // Send completion signal
    ws.send(JSON.stringify({
      type: 'done',
      chatId,
      messageId,
      usage: finalUsage,
      finishReason,
    }));

    // Log if truncated
    if (finishReason === 'length') {
      console.warn('[WebSocket] Response truncated due to token limit');
      ws.send(JSON.stringify({
        type: 'warning',
        message: 'Response truncated - output limit reached. Send "continue" to get more.',
      }));
    }

  } catch (error) {
    console.error('[WebSocket] Chat error:', error);
    ws.send(JSON.stringify({
      type: 'error',
      error: error instanceof Error ? error.message : 'Chat failed',
      chatId,
    }));
  }
}
