// Database resilience helpers.
//
// The API talks to Supabase through the pgbouncer pooler, which closes idle
// client connections on its own schedule. A connection that has been recycled
// server-side looks healthy to `pg` until it is used, so the very next query
// fails with "Connection terminated unexpectedly" / "Connection terminated due
// to connection timeout" before anything was actually executed.
//
// These helpers let us recognise that class of failure and retry it safely.

const TRANSIENT_CODES = new Set([
  "P1001", // Prisma: can't reach database server
  "P1002", // Prisma: database server reached but timed out
  "P1008", // Prisma: operation timed out
  "P1017", // Prisma: server has closed the connection
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "08000", // postgres: connection exception
  "08003", // postgres: connection does not exist
  "08006", // postgres: connection failure
  "57P01", // postgres: admin shutdown
]);

const TRANSIENT_MESSAGE_PATTERNS = [
  "connection terminated",
  "connection closed",
  "connection reset",
  "connection timeout",
  "timeout expired",
  "server has closed the connection",
  "socket hang up",
  "econnreset",
  "etimedout",
  "can't reach database server",
];

export function isTransientDbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const err = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (typeof err.code === "string" && TRANSIENT_CODES.has(err.code)) return true;

  const message =
    typeof err.message === "string" ? err.message.toLowerCase() : "";
  if (TRANSIENT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern))) {
    return true;
  }

  // Some adapters surface the Prisma code in the message instead of `code`.
  const upperMessage = message.toUpperCase();
  for (const code of TRANSIENT_CODES) {
    if (upperMessage.includes(code)) return true;
  }

  // driver-adapter errors wrap the underlying socket error in `cause`
  if (err.cause && err.cause !== error) return isTransientDbError(err.cause);
  return false;
}

interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  /** Label used in the retry log line. */
  label?: string;
}

/**
 * Runs a database operation, retrying only when the failure is a dropped or
 * unestablished connection. The operation must therefore be idempotent
 * (a read, a health probe, or an upsert).
 */
export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { attempts = 4, baseDelayMs = 300, label = "db operation" } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isTransientDbError(error) || attempt === attempts) {
        throw error;
      }

      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
      console.warn(
        `[DB] ${label}: transient connection error (attempt ${attempt}/${attempts}), retrying in ${delay}ms —`,
        error instanceof Error ? error.message : error
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
