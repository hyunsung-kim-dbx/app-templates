/**
 * In-memory job store for async chat processing
 * Jobs track the status of background chat operations
 */

export interface ChatJob {
  id: string;
  chatId: string;
  status: 'pending' | 'streaming' | 'completed' | 'error';
  messageId: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Partial text accumulated during streaming
  partialText: string;
  // Number of parts received
  partsReceived: number;
  // Finish reason when completed
  finishReason: string | null;
}

// In-memory store - jobs are cleaned up after 1 hour
const jobs = new Map<string, ChatJob>();
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Create a new job
 */
export function createJob(jobId: string, chatId: string): ChatJob {
  const job: ChatJob = {
    id: jobId,
    chatId,
    status: 'pending',
    messageId: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    partialText: '',
    partsReceived: 0,
    finishReason: null,
  };

  jobs.set(jobId, job);
  console.log(`[JobStore] Created job ${jobId} for chat ${chatId}`);

  // Schedule cleanup
  setTimeout(() => {
    if (jobs.has(jobId)) {
      jobs.delete(jobId);
      console.log(`[JobStore] Cleaned up expired job ${jobId}`);
    }
  }, JOB_TTL_MS);

  return job;
}

/**
 * Get a job by ID
 */
export function getJob(jobId: string): ChatJob | undefined {
  return jobs.get(jobId);
}

/**
 * Update job status
 */
export function updateJobStatus(
  jobId: string,
  status: ChatJob['status'],
  updates?: Partial<ChatJob>
): ChatJob | undefined {
  const job = jobs.get(jobId);
  if (!job) {
    console.warn(`[JobStore] Job ${jobId} not found for update`);
    return undefined;
  }

  job.status = status;
  job.updatedAt = new Date();

  if (updates) {
    Object.assign(job, updates);
  }

  jobs.set(jobId, job);
  return job;
}

/**
 * Append text to job's partial result
 */
export function appendJobText(jobId: string, text: string): void {
  const job = jobs.get(jobId);
  if (job) {
    job.partialText += text;
    job.partsReceived++;
    job.updatedAt = new Date();
  }
}

/**
 * Mark job as completed
 */
export function completeJob(
  jobId: string,
  messageId: string,
  finishReason: string | null
): void {
  const job = jobs.get(jobId);
  if (job) {
    job.status = 'completed';
    job.messageId = messageId;
    job.finishReason = finishReason;
    job.updatedAt = new Date();
    console.log(`[JobStore] Job ${jobId} completed with message ${messageId}`);
  }
}

/**
 * Mark job as failed
 */
export function failJob(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (job) {
    job.status = 'error';
    job.error = error;
    job.updatedAt = new Date();
    console.log(`[JobStore] Job ${jobId} failed: ${error}`);
  }
}

/**
 * Get all active jobs (for debugging)
 */
export function getActiveJobs(): ChatJob[] {
  return Array.from(jobs.values()).filter(
    (job) => job.status === 'pending' || job.status === 'streaming'
  );
}
