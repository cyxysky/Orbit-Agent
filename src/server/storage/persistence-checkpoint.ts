export class PersistenceCheckpointError extends Error {
  readonly code = 'PERSISTENCE_CHECKPOINT_FAILED';

  constructor(operation: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to persist ${operation}: ${detail}`, { cause });
    this.name = 'PersistenceCheckpointError';
  }
}

/** A checkpoint is durable when its own write commits. Delivery is independent. */
export async function commitPersistenceCheckpoint(input: {
  operation: string;
  committed: Promise<void>;
  notify?: () => Promise<unknown>;
  onNotificationError?: (error: unknown) => void;
}) {
  try {
    await input.committed;
  } catch (cause) {
    throw new PersistenceCheckpointError(input.operation, cause);
  }
  if (input.notify) {
    void Promise.resolve().then(input.notify).catch((error) => input.onNotificationError?.(error));
  }
}
