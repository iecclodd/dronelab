import type { PolicyCheckpoint, SimConfig, Transition } from '../../../packages/contracts/index.ts';

export type TrainingProgress = { epoch: number; loss: number; validationLoss: number };
type Request = { type: 'train'; jobId: number; data: { episodes: { seed: number; transitions: Transition[] }[]; config: SimConfig; trainingSeed: number; epochs: number } } | { type: 'cancel'; jobId: number };
type Response = { type: 'progress'; jobId: number; epoch: number; loss: number; validationLoss: number } | { type: 'complete'; jobId: number; checkpoint: PolicyCheckpoint } | { type: 'cancelled'; jobId: number } | { type: 'error'; jobId: number; error: string };

export class TrainingClient {
  private worker: Worker;
  private current?: { id: number; resolve: (checkpoint: PolicyCheckpoint) => void; reject: (reason: Error) => void; onProgress: (progress: TrainingProgress) => void };
  private nextId = 1;
  constructor() {
    this.worker = new Worker(new URL('./training.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<Response>) => this.handle(data);
    this.worker.onerror = event => this.fail(new Error(event.message || 'Training worker failed'));
  }
  start(episodes: { seed: number; transitions: Transition[] }[], config: SimConfig, onProgress: (progress: TrainingProgress) => void): Promise<PolicyCheckpoint> {
    if (this.current) throw new Error('A training job is already running');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.current = { id, resolve, reject, onProgress };
      const request: Request = { type: 'train', jobId: id, data: { episodes, config, trainingSeed: id, epochs: 24 } };
      this.worker.postMessage(request);
    });
  }
  cancel(): void { if (this.current) this.worker.postMessage({ type: 'cancel', jobId: this.current.id } satisfies Request); }
  dispose(): void { this.cancel(); this.fail(new Error('Training client disposed')); this.worker.terminate(); }
  private handle(message: Response): void {
    const job = this.current;
    if (!job || message.jobId !== job.id) return; // stale worker messages cannot settle a later job
    if (message.type === 'progress') job.onProgress(message);
    else if (message.type === 'complete') { this.current = undefined; job.resolve(message.checkpoint); }
    else { this.current = undefined; job.reject(new Error(message.type === 'error' ? message.error : 'Training cancelled')); }
  }
  private fail(error: Error): void { const job = this.current; if (job) { this.current = undefined; job.reject(error); } }
}
