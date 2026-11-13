import { SPEED_SAMPLE_MS } from '@/constants';

/**
 * Smoothed throughput estimate. Takes cumulative byte counts, samples them at
 * most every SPEED_SAMPLE_MS, and keeps an exponential moving average so the
 * displayed speed doesn't jump around with every chunk.
 */
export class SpeedMeter {
  private lastBytes = 0;
  private lastTime = 0;
  private ema: number | null = null;
  private startedAt = 0;
  private started = false;
  private readonly alpha: number;

  constructor(alpha = 0.3) {
    this.alpha = alpha;
  }

  start(bytes = 0, now = performance.now()) {
    this.lastBytes = bytes;
    this.lastTime = now;
    this.startedAt = now;
    this.started = true;
    this.ema = null;
  }

  /** Feed the cumulative byte count. Returns the smoothed bytes/second, or null while warming up. */
  update(totalBytes: number, now = performance.now()): number | null {
    if (!this.started) this.start(totalBytes, now);
    const dt = now - this.lastTime;
    if (dt < SPEED_SAMPLE_MS) return this.ema;
    const instant = ((totalBytes - this.lastBytes) * 1000) / dt;
    this.ema = this.ema == null ? instant : this.alpha * instant + (1 - this.alpha) * this.ema;
    this.lastBytes = totalBytes;
    this.lastTime = now;
    return this.ema;
  }

  get speed(): number | null {
    return this.ema;
  }

  /** ETA in ms, or null when it can't be estimated reliably yet. */
  eta(remainingBytes: number, now = performance.now()): number | null {
    if (this.ema == null || this.ema <= 1 || now - this.startedAt < 2000) return null;
    return (remainingBytes / this.ema) * 1000;
  }
}
