import { SimulationClient } from "../apps/web/src/simulation";
import {
  DEFAULT_CONFIG,
  type SimConfig,
  type WorkerResponse,
} from "../packages/contracts";

type RawReply = WorkerResponse & { requestId: number };
type RawRequest = {
  type: string;
  payload?: unknown;
  requestId: number;
  generation: number;
  epoch: number;
  expectedStep?: number;
};

function config(overrides: Partial<SimConfig> = {}): SimConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    wind: overrides.wind ?? ([...DEFAULT_CONFIG.wind] as SimConfig["wind"]),
  };
}

function rawSession() {
  const worker = new Worker(
    new URL("../apps/web/src/sim.worker.ts", import.meta.url),
    { type: "module" },
  );
  let generation = 0;
  let epoch = 0;
  const pending = new Map<number, (message: RawReply) => void>();
  const ready = new Promise<WorkerResponse>((resolve, reject) => {
    worker.onerror = (event) => reject(new Error(event.message));
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      generation = data.generation;
      epoch = data.epoch;
      if (data.type === "ready") resolve(data);
      if (data.requestId !== undefined)
        pending.get(data.requestId)?.(data as RawReply);
    };
  });
  async function send(
    type: string,
    payload: unknown,
    requestId: number,
    identity = { generation, epoch },
  ) {
    await ready;
    const result = new Promise<RawReply>((resolve) =>
      pending.set(requestId, resolve),
    );
    const message: RawRequest = { type, payload, requestId, ...identity };
    worker.postMessage(message);
    return result;
  }
  return { worker, send, identity: () => ({ generation, epoch }) };
}

const client = new SimulationClient();
const messages: WorkerResponse[] = [];
client.subscribe((message) => messages.push(message));

const harness = {
  ready: () => client.ready,
  reset: (overrides: Partial<SimConfig> = {}) =>
    client.request("reset", {
      config: config(overrides),
      controller: "manual",
    }),
  request: (type: string, payload?: unknown, expectedStep?: number) =>
    client.request(type, payload, expectedStep),
  messages: () => messages.map((message) => structuredClone(message)),
  clearMessages: () => {
    messages.length = 0;
  },
  dispose: () => client.dispose(),
  rawStaleGeneration: async () => {
    const raw = rawSession();
    try {
      await raw.send("reset", { config: config(), controller: "manual" }, 1, {
        generation: 0,
        epoch: 0,
      });
      return await raw.send("get", undefined, 2, { generation: 0, epoch: 0 });
    } finally {
      raw.worker.terminate();
    }
  },
  rawDuplicateAdvance: async () => {
    const raw = rawSession();
    try {
      await raw.send("reset", { config: config(), controller: "manual" }, 1, {
        generation: 0,
        epoch: 0,
      });
      await raw.send("mode", { mode: "lockstep" }, 2, raw.identity());
      const identity = raw.identity();
      const first = await raw.send("advance", { ticks: 4 }, 9, identity);
      const second = await raw.send("advance", { ticks: 4 }, 9, identity);
      const state = await raw.send("get", undefined, 10, raw.identity());
      return { first, second, state };
    } finally {
      raw.worker.terminate();
    }
  },
};

declare global {
  interface Window {
    workerHarness: typeof harness;
  }
}
window.workerHarness = harness;
