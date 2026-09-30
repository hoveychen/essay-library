export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 2000, onRetry } = options;
  let lastError: Error = new Error("Unknown error");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        onRetry?.(attempt, lastError);
        await new Promise((r) =>
          setTimeout(r, baseDelayMs * Math.pow(2, attempt - 1)),
        );
      }
    }
  }
  throw lastError;
}
