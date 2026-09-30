import { ACTION_REPEAT, DEFAULT_CONFIG, VERSION, hashValue, type Action, type Observation, type PhysicalState, type RunRecord, type ScenarioId, type StepResult } from '../../../packages/contracts';
import { SimulationClient } from './simulation';
import { appendChunk, saveRun } from './storage';

/** A separate research session: never changes the player's world, controls or clock. */
export class PolicySandbox {
  private client?: SimulationClient;
  private run?: RunRecord;
  private state?: PhysicalState;
  private observation?: Observation;
  private pending = false;
  private started = 0;
  private persistedTransitions = 0;
  constructor(private readonly onSave: () => Promise<void>) {}
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.pending) throw new Error('A policy command is already pending');
    this.pending = true;
    try { return await fn(); } finally { this.pending = false; }
  }
  async reset(options: { scenario?: ScenarioId; seed?: number; maxSeconds?: number }) {
    return this.exclusive(async () => {
      if (this.run?.status === 'recording') await this.persist(false);
      this.client ??= new SimulationClient();
      const config = { ...DEFAULT_CONFIG, scenario: options.scenario ?? 'hover', seed: options.seed ?? 30001, maxSeconds: options.maxSeconds ?? 10 };
      const fresh = await this.client.request<{ state: PhysicalState; observation: Observation }>('reset', { config, controller: 'manual' });
      await this.client.request('mode', { mode: 'lockstep' });
      this.started = Date.now();
      this.persistedTransitions = 0;
      this.state = fresh.state;
      this.observation = fresh.observation;
      this.run = {
        id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'recording', config, controller: 'manual',
        manifest: { version: VERSION, schema: 'run-v1', source: 'external-policy', configHash: hashValue(config), frame: 'ENU / body FLU / xyzw', observation: 'state-v1', action: 'nav-v1', dt: config.dt, actionRepeat: ACTION_REPEAT, wallStart: this.started },
        transitions: [], metrics: { success: false, reason: 'running', seconds: 0, collisions: 0, trackingError: 0, energy: 0, reward: 0, steps: 0, wallSeconds: 0, throughput: 0 },
      };
      await saveRun(this.run);
      return this.get();
    });
  }
  get() {
    if (!this.run || !this.state || !this.observation) throw new Error('Reset a policy session first');
    return { episodeId: this.run.id, step: this.state.step, observation: this.observation, terminated: this.state.terminated, truncated: this.state.truncated, status: this.run.status, reason: this.state.reason };
  }
  annotate(episodeId: string, source: string, metadata: unknown) {
    if (!this.run || this.run.id !== episodeId || this.run.status !== 'recording') throw new Error('stale_policy_episode');
    const value = metadata as Record<string, unknown>;
    if (!value || !['datasetVersion', 'model', 'mappingVersion'].every(key => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 128)) throw new Error('Policy provenance is missing or invalid');
    const provenance = { source, datasetVersion: value.datasetVersion, model: value.model, mappingVersion: value.mappingVersion };
    if (this.run.manifest.policyRuntime && JSON.stringify(this.run.manifest.policyRuntime) !== JSON.stringify(provenance)) throw new Error('Policy runtime changed within an episode');
    this.run.manifest.policyRuntime = provenance;
  }
  async step(episodeId: string, expectedStep: number, action: Action) {
    return this.exclusive(async () => {
      if (!this.run || this.run.id !== episodeId) throw new Error('stale_policy_episode');
      if (this.run.status !== 'recording') throw new Error('Policy episode finished; reset before stepping');
      const result = await this.client!.request<StepResult>('advance', { action, ticks: ACTION_REPEAT }, expectedStep);
      this.run.transitions.push(result.transition);
      this.state = result.state;
      this.observation = result.observation;
      if (result.state.terminated || result.state.truncated) await this.persist(true);
      else if (this.run.transitions.length - this.persistedTransitions >= 120) {
        await appendChunk(this.run.id, this.persistedTransitions, this.run.transitions.slice(this.persistedTransitions));
        this.persistedTransitions = this.run.transitions.length;
      }
      return { ...this.get(), reward: result.transition.reward };
    });
  }
  async finish(episodeId: string) {
    return this.exclusive(async () => {
      if (!this.run || this.run.id !== episodeId) throw new Error('stale_policy_episode');
      if (this.run.status === 'recording') await this.persist(!!(this.state?.terminated || this.state?.truncated));
      return { ...this.get(), runId: this.run.id };
    });
  }
  private async persist(complete: boolean) {
    const run = { ...this.run! }, state = this.state!;
    run.status = complete ? 'completed' : 'interrupted';
    const wallSeconds = Math.max(0.001, (Date.now() - this.started) / 1000);
    run.metrics = {
      success: complete && state.reason === 'success', reason: complete ? state.reason : 'interrupted', seconds: state.time,
      collisions: state.collisions, energy: state.energy, steps: state.step, wallSeconds, throughput: state.step / wallSeconds,
      reward: run.transitions.reduce((sum, t) => sum + t.reward, 0),
      trackingError: run.transitions.reduce((sum, t) => sum + Math.hypot(...t.state.target.map((v, i) => v - t.state.position[i])), 0) / Math.max(1, run.transitions.length),
    };
    await saveRun(run);
    this.run = run;
    await this.onSave();
  }
  dispose() { this.client?.dispose(); }
}
