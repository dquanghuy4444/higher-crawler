import { BaseQueue } from "./BaseQueue.js";
import { setTimeout } from "node:timers/promises";

/**
 * In-memory queue cho test/local. Hỗ trợ priority, delayed jobs, visibility timeout.
 */
export class MemoryQueue extends BaseQueue {
  constructor(options = {}) {
    super();
    this.pending = [];       // sorted by priority
    this.processing = new Map(); // jobId -> { job, claimedUntil, workerId }
    this.delayed = [];         // jobs chờ retry
    this.failed = [];          // dead letter
    this.completed = 0;
    this.checkInterval = null;
    this._startDelayedCheck();
  }

  async push(job) {
    this.pending.push(job);
    this.pending.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  async claim({ workerId, visibilityTimeout }) {
    // Promote delayed jobs
    const now = Date.now();
    const ready = this.delayed.filter((j) => j.scheduledAt <= now);
    this.delayed = this.delayed.filter((j) => j.scheduledAt > now);
    for (const job of ready) {
      this.pending.push(job);
    }
    if (ready.length) this.pending.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    if (!this.pending.length) return null;

    const job = this.pending.shift();
    job.status = "processing";
    job.claimedBy = workerId;
    job.claimedUntil = now + visibilityTimeout;
    this.processing.set(job.id, { job, claimedUntil: job.claimedUntil, workerId });

    return job;
  }

  async complete(job, result) {
    this.processing.delete(job.id);
    job.status = "done";
    job.completedAt = Date.now();
    job.result = result;
    this.completed++;
  }

  async reschedule(job, delayMs) {
    this.processing.delete(job.id);
    job.status = "pending";
    job.scheduledAt = Date.now() + delayMs;
    this.delayed.push(job);
  }

  async fail(job, error) {
    this.processing.delete(job.id);
    job.status = "failed";
    job.error = error.message;
    job.failedAt = Date.now();
    this.failed.push(job);
  }

  async size() {
    return this.pending.length + this.processing.size + this.delayed.length;
  }

  async close() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  _startDelayedCheck() {
    this.checkInterval = setInterval(() => {
      this.claim({ workerId: "internal", visibilityTimeout: 0 }).catch(() => {});
    }, 1000);
  }
}
