/**
 * Chunk Queue Service - Best Practice Implementation
 * 
 * Rate directly controls rendering speed:
 * - rate=30 → Slow typewriter (one char every ~33ms)
 * - rate=100 → Medium speed (one char every 10ms)  
 * - rate=1000+ → Fast (batched for performance)
 * - rate=1000000+ → Instant (all at once, original LLM speed)
 */

type ChunkCallback = (text: string, responseData?: any) => void;

class ChunkQueueService {
  private queue: Array<{ char: string; responseData?: any }> = [];
  private isProcessing: boolean = false;
  private callback: ChunkCallback | null = null;
  private animationFrameId: number | null = null;
  private charsPerSecond: number = 30;
  private onDrainCompleteCallback: (() => void) | null = null;
  private lastRenderTime: number = 0;
  private charDebt: number = 0; // Accumulated chars to render

  /**
   * Set the rate (characters per second)
   */
  setRate(rate: number): void {
    this.charsPerSecond = Math.max(1, rate);
    console.log(`📊 Chunk queue rate: ${this.charsPerSecond} chars/sec`);
  }

  /**
   * Get the current rate
   */
  getRate(): number {
    return this.charsPerSecond;
  }

  /**
   * Start the queue processor
   */
  start(callback: ChunkCallback): void {
    this.callback = callback;
    this.queue = [];
    this.isProcessing = true;
    this.lastRenderTime = performance.now();
    this.charDebt = 0;
    
    this.scheduleRender();
    console.log(`🚀 Chunk queue started at ${this.charsPerSecond} chars/sec`);
  }

  /**
   * Add a chunk to the queue
   */
  enqueue(chunk: string, responseData?: any): void {
    if (!this.isProcessing) {
      if (this.callback) {
        this.callback(chunk, responseData);
      }
      return;
    }

    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];
      const isLastChar = i === chunk.length - 1;
      this.queue.push({ 
        char, 
        responseData: isLastChar ? responseData : undefined 
      });
    }
  }

  /**
   * Schedule the next render using requestAnimationFrame (60fps = ~16ms)
   */
  private scheduleRender(): void {
    if (this.animationFrameId !== null) return;
    
    this.animationFrameId = requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.render();
    });
  }

  /**
   * Render characters based on elapsed time
   */
  private render(): void {
    if (!this.callback) {
      if (!this.isProcessing) this.cleanup();
      return;
    }

    if (this.queue.length === 0) {
      if (!this.isProcessing) {
        this.cleanup();
      } else {
        // Keep checking for new chars
        this.scheduleRender();
      }
      return;
    }

    const now = performance.now();
    const elapsed = now - this.lastRenderTime;
    this.lastRenderTime = now;

    // Calculate how many chars we should have rendered by now
    const charsToRender = (elapsed / 1000) * this.charsPerSecond + this.charDebt;
    const wholeChars = Math.floor(charsToRender);
    this.charDebt = charsToRender - wholeChars; // Keep fractional part

    if (wholeChars > 0 && this.queue.length > 0) {
      // Take up to wholeChars from the queue
      const count = Math.min(wholeChars, this.queue.length);
      let text = '';
      let lastResponseData: any = undefined;

      for (let i = 0; i < count; i++) {
        const item = this.queue.shift()!;
        text += item.char;
        if (item.responseData !== undefined) {
          lastResponseData = item.responseData;
        }
      }

      if (text) {
        this.callback(text, lastResponseData);
      }
    }

    // Continue rendering
    this.scheduleRender();
  }

  /**
   * Stop accepting new chunks but continue draining
   */
  stop(): void {
    this.isProcessing = false;
    if (this.queue.length > 0) {
      console.log(`⏳ Draining ${this.queue.length} remaining chars...`);
    } else {
      this.cleanup();
    }
  }

  private cleanup(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.callback = null;
    console.log(`⏹️ Chunk queue stopped`);
    
    if (this.onDrainCompleteCallback) {
      this.onDrainCompleteCallback();
      this.onDrainCompleteCallback = null;
    }
  }

  onDrainComplete(callback: () => void): void {
    this.onDrainCompleteCallback = callback;
  }

  isDraining(): boolean {
    return !this.isProcessing && this.queue.length > 0;
  }

  hasItems(): boolean {
    return this.queue.length > 0;
  }

  forceStop(): void {
    this.isProcessing = false;
    this.queue = [];
    this.cleanup();
    console.log(`🛑 Chunk queue force stopped`);
  }

  reset(): void {
    this.queue = [];
    this.charDebt = 0;
    console.log(`🔄 Chunk queue reset`);
  }

  isActive(): boolean {
    return this.isProcessing;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

export const chunkQueueService = new ChunkQueueService();
export default chunkQueueService;
