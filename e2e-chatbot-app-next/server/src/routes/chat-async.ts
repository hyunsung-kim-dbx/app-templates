/**
 * Async chat routes for polling-based chat
 * Bypasses proxy timeout by returning immediately and processing in background
 */

import {
  Router,
  type Request,
  type Response,
  type Router as RouterType,
} from 'express';
import {
  streamText,
  convertToModelMessages,
  generateText,
  type LanguageModelUsage,
} from 'ai';
import type { LanguageModelV3Usage } from '@ai-sdk/provider';
import {
  authMiddleware,
  requireAuth,
} from '../middleware/auth';
import {
  saveChat,
  saveMessages,
  updateChatLastContextById,
  isDatabaseAvailable,
} from '@chat-template/db';
import {
  type ChatMessage,
  type VisibilityType,
  checkChatAccess,
  generateUUID,
  myProvider,
  truncateMessages,
} from '@chat-template/core';
import { ChatSDKError } from '@chat-template/core/errors';
import { setRequestContext } from '@chat-template/ai-sdk-providers';
import {
  CONTEXT_HEADER_CONVERSATION_ID,
  CONTEXT_HEADER_USER_ID,
} from '@chat-template/ai-sdk-providers';
import {
  createJob,
  getJob,
  updateJobStatus,
  appendJobText,
  completeJob,
  failJob,
} from '../jobs/job-store';

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

export const chatAsyncRouter: RouterType = Router();

// Apply auth middleware to all routes
chatAsyncRouter.use(authMiddleware);

/**
 * POST /api/chat-async/start
 * Start an async chat job - returns immediately with jobId
 */
chatAsyncRouter.post(
  '/start',
  requireAuth,
  async (req: Request, res: Response) => {
    const dbAvailable = isDatabaseAvailable();
    if (!dbAvailable) {
      console.log('[AsyncChat] Running in ephemeral mode - no persistence');
    }

    const {
      id: chatId,
      messages,
      selectedChatModel,
      selectedVisibilityType = 'private',
    } = req.body;

    if (!chatId || !messages || !selectedChatModel) {
      return res.status(400).json({
        error: 'Missing required fields: id, messages, selectedChatModel',
      });
    }

    const session = req.session;
    if (!session) {
      const error = new ChatSDKError('unauthorized:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    // Check chat access
    const { chat, allowed, reason } = await checkChatAccess(
      chatId,
      session.user.id,
    );

    if (reason !== 'not_found' && !allowed) {
      const error = new ChatSDKError('forbidden:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    // Get the last user message (the one being sent now)
    const userMessage = messages.length > 0
      ? messages[messages.length - 1]
      : null;

    // Create chat if it doesn't exist
    if (!chat && dbAvailable && userMessage) {
      try {
        const title = await generateTitleFromUserMessage({ message: userMessage });
        await saveChat({
          id: chatId,
          userId: session.user.id,
          title,
          visibility: selectedVisibilityType as VisibilityType,
        });
        console.log('[AsyncChat] Created new chat:', chatId);
      } catch (error) {
        console.error('[AsyncChat] Failed to create chat:', error);
        return res.status(500).json({ error: 'Failed to create chat' });
      }
    } else if (chat && chat.userId !== session.user.id) {
      const error = new ChatSDKError('forbidden:chat');
      const response = error.toResponse();
      return res.status(response.status).json(response.json);
    }

    // Save user message to database
    if (dbAvailable && userMessage && userMessage.role === 'user') {
      try {
        await saveMessages({
          messages: [{
            chatId,
            id: userMessage.id,
            role: 'user',
            parts: userMessage.parts,
            attachments: userMessage.attachments || [],
            createdAt: userMessage.createdAt ? new Date(userMessage.createdAt) : new Date(),
          }],
        });
        console.log('[AsyncChat] Saved user message:', userMessage.id);
      } catch (error) {
        console.error('[AsyncChat] Failed to save user message:', error);
        // Continue anyway - don't block on this
      }
    }

    const jobId = generateUUID();

    // Create job immediately
    createJob(jobId, chatId);

    // Return jobId to client immediately (within proxy timeout)
    res.json({
      jobId,
      chatId,
      status: 'pending',
    });

    // Process chat in background (after response sent)
    setImmediate(() => {
      processChat({
        jobId,
        chatId,
        messages,
        selectedChatModel,
        userEmail: session.user.email,
        userId: session.user.id,
        userAccessToken: req.userAccessToken,
      }).catch((error) => {
        console.error('[AsyncChat] Background processing error:', error);
        failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
      });
    });
  }
);

/**
 * GET /api/chat-async/job/:jobId
 * Poll for job status and partial results
 */
chatAsyncRouter.get(
  '/job/:jobId',
  requireAuth,
  async (req: Request, res: Response) => {
    const { jobId } = req.params;

    const job = getJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        jobId,
      });
    }

    // Return current job state
    res.json({
      jobId: job.id,
      chatId: job.chatId,
      status: job.status,
      messageId: job.messageId,
      partialText: job.partialText,
      partsReceived: job.partsReceived,
      finishReason: job.finishReason,
      error: job.error,
      updatedAt: job.updatedAt,
    });
  }
);

/**
 * POST /api/chat-async/job/:jobId/cancel
 * Cancel a running job
 */
chatAsyncRouter.post(
  '/job/:jobId/cancel',
  requireAuth,
  async (req: Request, res: Response) => {
    const { jobId } = req.params;

    const job = getJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        jobId,
      });
    }

    // Mark job as cancelled (same as error state)
    if (job.status === 'pending' || job.status === 'streaming') {
      failJob(jobId, 'Cancelled by user');
      console.log('[AsyncChat] Job cancelled:', jobId);
    }

    res.json({
      jobId: job.id,
      status: 'cancelled',
    });
  }
);

/**
 * Background chat processing
 */
async function processChat(params: {
  jobId: string;
  chatId: string;
  messages: ChatMessage[];
  selectedChatModel: string;
  userEmail?: string;
  userId: string;
  userAccessToken?: string;
}): Promise<void> {
  const {
    jobId,
    chatId,
    messages: uiMessages,
    selectedChatModel,
    userEmail,
    userId,
    userAccessToken,
  } = params;

  console.log('[AsyncChat] Starting background processing:', {
    jobId,
    chatId,
    messageCount: uiMessages.length,
    model: selectedChatModel,
  });

  // Set request context for OBO operations
  if (userAccessToken) {
    setRequestContext({
      userAccessToken,
      userEmail,
    });
  }

  const dbAvailable = isDatabaseAvailable();
  let finalUsage: LanguageModelUsage | undefined;
  let finishReason: string | undefined;

  try {
    const model = await myProvider.languageModel(selectedChatModel);

    // Update job status to streaming
    updateJobStatus(jobId, 'streaming');

    // Truncate messages to prevent exceeding 4MB API request limit
    const truncatedMessages = truncateMessages(uiMessages);

    const result = streamText({
      model,
      messages: await convertToModelMessages(truncatedMessages),
      headers: {
        [CONTEXT_HEADER_CONVERSATION_ID]: chatId,
        [CONTEXT_HEADER_USER_ID]: userEmail ?? userId,
      },
      onFinish: ({ usage, finishReason: reason }) => {
        finalUsage = usage;
        finishReason = reason;
      },
    });

    // Collect text as it streams
    const messageId = generateUUID();
    let fullText = '';

    for await (const chunk of result.textStream) {
      fullText += chunk;
      appendJobText(jobId, chunk);
    }

    // Wait for completion
    await result.response;

    // Build message parts
    const parts: any[] = [];
    if (fullText) {
      parts.push({ type: 'text', text: fullText });
    }

    // Save message to database (only if DB available)
    if (dbAvailable && parts.length > 0) {
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

        console.log('[AsyncChat] Message saved:', messageId);
      } catch (dbError) {
        console.error('[AsyncChat] Failed to save message to DB:', dbError);
        // Continue - job still completed successfully
      }
    }

    // Mark job as completed
    completeJob(jobId, messageId, finishReason || 'stop');

    // Log token usage
    if (finalUsage) {
      console.log(`[AsyncChat] Tokens - Input: ${finalUsage.inputTokens}, Output: ${finalUsage.outputTokens}, Finish: ${finishReason}`);
    }

    if (finishReason === 'length') {
      console.warn('[AsyncChat] Response truncated due to token limit');
    }

  } catch (error) {
    console.error('[AsyncChat] Processing error:', error);
    failJob(jobId, error instanceof Error ? error.message : 'Chat processing failed');
  }
}

/**
 * Generate a title from user message
 */
async function generateTitleFromUserMessage({
  message,
}: {
  message: ChatMessage;
}): Promise<string> {
  try {
    const model = await myProvider.languageModel('title-model');
    const { text: title } = await generateText({
      model,
      system: `\n
      - you will generate a short title based on the first message a user begins a conversation with
      - ensure it is not more than 80 characters long
      - the title should be a summary of the user's message
      - do not use quotes or colons. do not include other expository content ("I'll help...")`,
      prompt: JSON.stringify(message),
    });
    return title;
  } catch (error) {
    console.error('[AsyncChat] Failed to generate title:', error);
    // Return a default title if generation fails
    const textPart = message.parts?.find((p: any) => p.type === 'text');
    const text = textPart && 'text' in textPart ? textPart.text : '';
    return text.slice(0, 50) || 'New Chat';
  }
}
