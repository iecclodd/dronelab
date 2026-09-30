import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { DEFAULT_CONFIG, type RunRecord } from "../packages/contracts/index.ts";
import { DroneEnvironment, initPhysics } from "../packages/sim-core/index.ts";
import {
  assessBehaviorCloningEligibility,
  buildDatasetExport,
  generateCurriculum,
  splitForSeed,
  validateDatasetImport,
} from "../packages/training-data/index.ts";

function run(seed: number, overrides: Partial<RunRecord> = {}): RunRecord {
  const nav = { kind: "nav" as const, velocity: [0, 0, 0] as [number, number, number], yawRate: 0 };
  const terminal = {
    observation: {} as never,
    requestedAction: nav,
    appliedAction: nav,
    nextObservation: {} as never,
    reward: 0,
    components: { tracking: 0, progress: 0, energy: 0, collision: 0, success: 0, total: 0 },
    state: {} as never,
    startStep: 0, endStep: 4, ticks: 4, decision: 0, terminated: false, truncated: true,
    reason: "time_limit", wallTime: 0, validThroughStep: 4,
  };
  return {
    id: `run-${seed}`,
    createdAt: "2026-09-30T00:00:00.000Z",
    status: "completed",
    config: { ...DEFAULT_CONFIG, seed },
    controller: "scripted",
    manifest: { schema: "run-v1", batchId: "curriculum-a" },
    transitions: [terminal],
    metrics: { success: false, reason: "time_limit", seconds: 1, collisions: 0, trackingError: 0, energy: 0, reward: 0, steps: 4, wallSeconds: 1, throughput: 4 },
    ...overrides,
  };
}

describe("training datasets", () => {
  it("generates deterministic research-only, disjoint curriculum configurations", () => {
    const episodes = generateCurriculum(
      { ...DEFAULT_CONFIG, flightFeel: "research", wind: [0.1, 0, 0] },
      { train: 2, validation: 2, test: 2 },
    );
    expect(episodes.map((episode) => episode.split)).toEqual(["train", "train", "validation", "validation", "test", "test"]);
    expect(new Set(episodes.map((episode) => episode.config.seed)).size).toBe(6);
    expect(episodes.every((episode) => episode.config.flightFeel === "research")).toBe(true);
    expect(episodes.map((episode) => splitForSeed(episode.config.seed))).toEqual(episodes.map((episode) => episode.split));
    expect(episodes[1]!.config.noise).toBeGreaterThan(episodes[0]!.config.noise);
  });

  it("rejects interrupted, arcade, and rate-control behavior-cloning data", () => {
    expect(assessBehaviorCloningEligibility(run(1000, { status: "interrupted" })).eligible).toBe(false);
    expect(assessBehaviorCloningEligibility(run(1000, { config: { ...DEFAULT_CONFIG, seed: 1000, flightFeel: "arcade" } })).reasons).toContain("arcade dynamics are excluded");
    expect(assessBehaviorCloningEligibility(run(1000, { controller: "rate" })).reasons).toContain("rate-controller actions are excluded");
  });

  it("exports provenance and separate whole-episode JSONL split files", () => {
    const artifact = buildDatasetExport([run(1000), run(20000), run(30000)], {
      batchId: "batch-test",
      exportedAt: "2026-09-30T12:00:00.000Z",
    });
    const contents = unzipSync(artifact.zip);
    expect(Object.keys(contents).sort()).toEqual([
      "exchange.json",
      "manifest.json",
      "transitions/test.jsonl",
      "transitions/train.jsonl",
      "transitions/validation.jsonl",
    ]);
    expect(artifact.manifest.splits).toMatchObject({
      train: { seeds: [1000] }, validation: { seeds: [20000] }, test: { seeds: [30000] },
    });
    expect(artifact.manifest.sources[0]).toMatchObject({ batchId: "curriculum-a", split: "train" });
    expect(JSON.parse(strFromU8(contents["transitions/train.jsonl"]!))).toMatchObject({ runId: "run-1000", seed: 1000 });
  });

  it("round-trips a real complete DroneLab run through exchange.json", async () => {
    await initPhysics();
    const make = (seed: number): RunRecord => {
      const env = new DroneEnvironment({ ...DEFAULT_CONFIG, seed, maxSeconds: 0.001 });
      const transition = env.step(env.scriptedAction(), 4).transition;
      const result = run(seed, { transitions: [transition], metrics: { success: transition.reason === "success", reason: transition.reason, seconds: transition.state.time, collisions: transition.state.collisions, trackingError: 0, energy: transition.state.energy, reward: transition.reward, steps: transition.endStep, wallSeconds: 1, throughput: 4 } });
      env.dispose();
      return result;
    };
    const artifact = buildDatasetExport([make(1000), make(20000), make(30000)]);
    const exchange = JSON.parse(strFromU8(unzipSync(artifact.zip)["exchange.json"]!));
    const imported = validateDatasetImport(exchange);
    expect(imported).toHaveLength(3);
    expect(imported.map((episode) => episode.config.seed)).toEqual([1000, 20000, 30000]);
  });

  it("prevents duplicate-seed leakage and requires validation data", () => {
    expect(() => buildDatasetExport([run(1000), run(1000), run(20000)])).toThrow("Duplicate episode seed");
    expect(() => buildDatasetExport([run(1000), run(1001)])).toThrow("train and validation");
  });

  it("bounds source provenance before it can be copied into journal episodes", () => {
    for (const field of ["name", "license", "url"]) {
      const source = { name: "External corpus", license: "CC-BY-4.0", url: "https://example.org/dataset", [field]: "x".repeat(field === "url" ? 2049 : 257) };
      expect(() => validateDatasetImport({ schema: "dronelab-exchange-v1", source })).toThrow(`dataset.source.${field} exceeds`);
    }
  });

  it("rejects incompatible exchange layouts before they reach journal storage", () => {
    expect(() => validateDatasetImport({ schema: "foreign-v1" })).toThrow("Unsupported dataset schema");
    expect(() => validateDatasetImport({ schema: "dronelab-exchange-v1" }, { byteLength: 30 * 1024 * 1024 })).toThrow("import limit");
  });
});
