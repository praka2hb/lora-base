/**
 * Retry with exponential backoff for transient API errors (429, 529, 5xx).
 */

const RETRYABLE_STATUS_CODES = [429, 529, 500, 502, 503, 504];

export interface RetryOptions {
  maxRetries?: number;      // default: 3
  baseDelayMs?: number;     // default: 2000
  maxDelayMs?: number;      // default: 30000
  label?: string;           // for logging
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 2000;
  const maxDelay = opts.maxDelayMs ?? 30000;
  const label = opts.label ?? 'API call';

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;

      // Check if this is a retryable error
      const isRetryable = isRetryableError(err);

      if (!isRetryable || attempt >= maxRetries) {
        throw err;
      }

      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = Math.random() * 1000;
      const totalDelay = delay + jitter;

      console.log(`  [retry] ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${(totalDelay / 1000).toFixed(1)}s: ${getErrorMessage(err)}`);

      await new Promise(r => setTimeout(r, totalDelay));
    }
  }

  throw lastError;
}

function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;

  // Anthropic SDK errors have a status property
  const status = (err as Record<string, unknown>).status;
  if (typeof status === 'number' && RETRYABLE_STATUS_CODES.includes(status)) {
    return true;
  }

  // Check error message for known patterns
  const message = getErrorMessage(err).toLowerCase();
  if (message.includes('overloaded') || message.includes('rate limit') ||
      message.includes('too many requests') || message.includes('529') ||
      message.includes('timeout') || message.includes('econnreset')) {
    return true;
  }

  return false;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
