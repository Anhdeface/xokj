/**
 * Asynchronous FIFO Mutex for serializing storage read-modify-write transactions.
 * Guarantees strict FIFO execution order, rejection isolation (a failing task does
 * not poison subsequent tasks), and zero memory leaks via array-backed resolver queue.
 */
export class AsyncMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  /**
   * Executes an asynchronous task exclusively.
   * Tasks are queued in strict FIFO order. If a task throws or rejects,
   * the caller receives the error, but subsequent queued tasks proceed normally.
   */
  public async runExclusive<T>(task: () => Promise<T> | T): Promise<T> {
    if (typeof task !== 'function') {
      throw new TypeError('Task must be a function');
    }

    if (this.locked) {
      // Contended path: wait for our turn in FIFO queue
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    } else {
      // Synchronous uncontended fast-path: acquire lock immediately without microtask delay
      this.locked = true;
    }

    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) {
        next();
      } else {
        this.locked = false;
      }
    }
  }

  /**
   * Returns true if the mutex is currently locked or has tasks waiting in queue.
   */
  public isLocked(): boolean {
    return this.locked;
  }
}

/**
 * Shared storage mutex instance protecting chrome.storage.local write transactions.
 */
export const storageMutex = new AsyncMutex();
