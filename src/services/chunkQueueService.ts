/**
 * Chunk Queue Service
 * 
 * This service manages a queue for LLM streaming chunks and rate-limits
 * the rendering to a maximum number of chunks per second.
 * 
 * This prevents the UI from being overwhelmed when fast machines receive
 * chunks too quickly from the LLM.
 */

type ChunkCallback = (accumulatedChunk: string, responseData?: any) => void;

class ChunkQueueService {
  private queue: Array<{ chunk: string; responseData?: any }> = [];
  private isProcessing: boolean = false;
  private callback: ChunkCallback | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private chunksPerSecond: number = 10; // Default: 10 chunks per second
  private intervalMs: number = 100; // 1000ms / 10 = 100ms between renders
  private onDrainCompleteCallback: (() => void) | null = null;

  /**
   * Set the maximum chunks per second rate
   * @param rate - Number of chunks to render per second (e.g., 10)
   */
  setRate(rate: number): void {
    this.chunksPerSecond = Math.max(1, Math.min(60, rate)); // Clamp between 1-60
    this.intervalMs = Math.floor(1000 / this.chunksPerSecond);
    console.log(`📊 Chunk queue rate set to ${this.chunksPerSecond} chunks/sec (${this.intervalMs}ms interval)`);
  }

  /**
   * Get the current rate setting
   */
  getRate(): number {
    return this.chunksPerSecond;
  }

  /**
   * Start the queue processor with a callback for rendering
   * @param callback - Function to call with accumulated chunks
   */
  start(callback: ChunkCallback): void {
    this.callback = callback;
    this.queue = [];
    this.isProcessing = true;

    // Clear any existing interval
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    // Start the processing interval
    this.intervalId = setInterval(() => {
      this.processQueue();
    }, this.intervalMs);

    console.log(`🚀 Chunk queue started with ${this.chunksPerSecond} chunks/sec rate`);
  }

  /**
   * Add a chunk to the queue - splits into individual characters for smoother rendering
   * @param chunk - The text chunk from LLM
   * @param responseData - Optional response data from the stream
   */
  enqueue(chunk: string, responseData?: any): void {
    if (!this.isProcessing) {
      // If not processing, deliver immediately (fallback)
      if (this.callback) {
        this.callback(chunk, responseData);
      }
      return;
    }

    // Split chunk into individual characters for character-by-character rendering
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];
      // Only attach responseData to the last character of the chunk
      const isLastChar = i === chunk.length - 1;
      this.queue.push({ 
        chunk: char, 
        responseData: isLastChar ? responseData : undefined 
      });
    }
  }


  /**
   * Stop accepting new chunks but continue draining the queue one-by-one
   * The interval will auto-stop when the queue is empty
   */
  stop(): void {
    // Stop accepting new chunks
    this.isProcessing = false;

    // If there are remaining chunks, let the interval continue processing them one-by-one
    if (this.queue.length > 0 && this.callback) {
      console.log(`⏳ Chunk queue draining ${this.queue.length} remaining chunks...`);
      
      // Keep the interval running to drain the queue one chunk at a time
      // It will auto-stop when empty (handled in processQueue)
      return;
    }

    // No remaining chunks - stop immediately
    this.cleanup();
  }

  /**
   * Process the queue - called at the rate-limited interval
   * Releases exactly ONE chunk at a time for smooth, controlled rendering
   */
  private processQueue(): void {
    if (this.queue.length === 0) {
      // Queue is empty
      if (!this.isProcessing) {
        // We're in draining mode and queue is now empty - cleanup
        this.cleanup();
      }
      return;
    }

    if (!this.callback) {
      return;
    }

    // Take only ONE chunk from the queue (not all of them)
    const item = this.queue.shift()!;
    
    // Deliver the single chunk
    if (item.chunk) {
      this.callback(item.chunk, item.responseData);
    }
  }

  /**
   * Internal cleanup - clears interval and resets state
   */
  private cleanup(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.callback = null;
    console.log(`⏹️ Chunk queue stopped`);
    
    // Notify that draining is complete
    if (this.onDrainCompleteCallback) {
      this.onDrainCompleteCallback();
      this.onDrainCompleteCallback = null;
    }
  }

  /**
   * Set a callback to be called when the queue finishes draining
   * @param callback - Function to call when queue is empty and draining is complete
   */
  onDrainComplete(callback: () => void): void {
    this.onDrainCompleteCallback = callback;
  }

  /**
   * Check if the queue is currently draining (LLM finished but queue not empty)
   */
  isDraining(): boolean {
    return !this.isProcessing && this.queue.length > 0 && this.intervalId !== null;
  }

  /**
   * Check if there are items in the queue (either processing or draining)
   */
  hasItems(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Force stop - immediately stops and discards remaining chunks
   */
  forceStop(): void {
    this.isProcessing = false;
    this.queue = [];
    this.cleanup();
    console.log(`🛑 Chunk queue force stopped`);
  }

  /**
   * Reset the queue (clear all pending chunks without processing)
   */
  reset(): void {
    this.queue = [];
    console.log(`🔄 Chunk queue reset`);
  }

  /**
   * Check if the queue is currently active
   */
  isActive(): boolean {
    return this.isProcessing;
  }

  /**
   * Get the current queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }
}

// Export a singleton instance
export const chunkQueueService = new ChunkQueueService();

export default chunkQueueService;
