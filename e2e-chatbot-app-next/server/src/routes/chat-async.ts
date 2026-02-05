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
import { streamText, convertToModelMessages, type LanguageModelUsage } from 'ai';
import type { LanguageModelV3Usage } from '@ai-sdk/provider';
import {
  authMiddleware,
  requireAuth,
  requireChatAccess,
} from '../middleware/auth';
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
    const { id: chatId, messages, selectedChatModel } = req.body;

    if (!chatId || !messages || !selectedChatModel) {
      return res.status(400).json({
        error: 'Missing required fields: id, messages, selectedChatModel',
      });
    }

    const session = req.session!;
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

  let finalUsage: LanguageModelUsage | undefined;
  let finishReason: string | undefined;

  try {
    const model = await myProvider.languageModel(selectedChatModel);

    // Update job status to streaming
    updateJobStatus(jobId, 'streaming');

    const result = streamText({
      model,
      messages: await convertToModelMessages(uiMessages),
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

    // Save message to database
    if (parts.length > 0) {
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
    }

    // Mark job as completed
    completeJob(jobId, messageId, finishReason || 'stop');

    if (finishReason === 'length') {
      console.warn('[AsyncChat] Response truncated due to token limit');
    }

  } catch (error) {
    console.error('[AsyncChat] Processing error:', error);
    failJob(jobId, error instanceof Error ? error.message : 'Chat processing failed');
  }
}
