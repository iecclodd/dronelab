import type { WorkerResponse } from "../../../packages/contracts";

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

export class SimulationClient {
  worker = new Worker(new URL("./sim.worker.ts", import.meta.url), {
    type: "module",
  });
  generation = 0;
  epoch = 0;
  nextId = 1;
  ready: Promise<unknown>;
  listeners = new Set<(message: WorkerResponse) => void>();
  pending = new Map<number, Pending>();
  private readyResolve!: (value: unknown) => void;
  private readyReject!: (error: Error) => void;
  private readySettled = false;
  private disposed = false;
  private failure?: Error;
  constructor() {
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // A worker may fail before a consumer awaits ready; keep that rejection observed.
    void this.ready.catch(() => undefined);
    this.worker.onerror = (event) =>
      this.fail(new Error(event.message || "Simulation worker failed"));
    this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      this.generation = data.generation;
      this.epoch = data.epoch;
      if (data.type === "ready" && !this.readySettled) {
        this.readySettled = true;
        this.readyResolve(data.payload);
      }
      if (data.type === "result" && data.requestId !== undefined) {
        const pending = this.pending.get(data.requestId);
        this.pending.delete(data.requestId);
        if (data.error) pending?.reject(new Error(data.error));
        else pending?.resolve(data.payload);
      }
      this.listeners.forEach((listener) => listener(data));
    };
  }
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    if (!this.readySettled) {
      this.readySettled = true;
      this.readyReject(error);
    }
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
  }
  async request<T = any>(
    type: string,
    payload?: unknown,
    expectedStep?: number,
  ): Promise<T> {
    if (this.disposed) throw new Error("Session closed");
    if (this.failure) throw this.failure;
    await this.ready;
    if (this.disposed) throw new Error("Session closed");
    if (this.failure) throw this.failure;
    const requestId = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({
        type,
        payload,
        requestId,
        generation: this.generation,
        epoch: this.epoch,
        expectedStep,
      });
    });
  }
  subscribe(listener: (message: WorkerResponse) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.fail(new Error("Session closed"));
  }
}
