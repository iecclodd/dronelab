import { useState } from 'react';
import type { PolicyCheckpoint, RunRecord } from '../../../packages/contracts';
import { validateCheckpoint } from '../../../packages/learning';
import { assessBehaviorCloningEligibility, splitForSeed, validateDatasetImport } from '../../../packages/training-data';
import { exportDataset, savePolicy, saveRun } from './storage';

export function DatasetPanel({ runs, busy, refresh, onTrain, onPolicy, report }: {
  runs: RunRecord[]; busy: boolean; refresh: () => Promise<void>;
  onTrain: (runs: RunRecord[]) => Promise<unknown>; onPolicy: (id: string) => void; report: (error: unknown) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const eligible = runs.filter(r => assessBehaviorCloningEligibility(r).eligible);
  const picked = eligible.filter(r => selected.includes(r.id));
  const count = (split: string) => picked.filter(r => splitForSeed(r.config.seed) === split).length;
  const ingest = async (file: File | undefined, kind: 'dataset' | 'policy') => {
    if (!file) return;
    setLoading(true);
    try {
      if (file.size > (kind === 'policy' ? 2 : 25) * 1024 * 1024) throw new Error('File exceeds import limit (policy 2 MB; dataset 25 MB).');
      const data: unknown = JSON.parse(await file.text());
      if (kind === 'policy') {
        const checkpoint = data as PolicyCheckpoint;
        validateCheckpoint(checkpoint);
        await savePolicy(checkpoint);
        onPolicy(checkpoint.id);
        setMessage('Policy imported. Evaluate on held-out seeds before using its predictions.');
      } else {
        const imported = validateDatasetImport(data, { byteLength: file.size });
        if (runs.length + imported.length > 64) throw new Error('Import would exceed 64 journal runs. Export and remove older runs first.');
        for (let i = 0; i < imported.length; i++) {
          setMessage(`Saving imported episode ${i + 1} / ${imported.length}…`);
          await saveRun(imported[i]);
        }
        setSelected(imported.map(r => r.id));
        setMessage(`${imported.length} external episodes imported with source provenance.`);
      }
      await refresh();
    } catch (error) { report(error); }
    finally { setLoading(false); }
  };
  return <section aria-label="Models and datasets">
    <div className="eyebrow">BRING YOUR MODEL / DATASET</div>
    <p className="copy">Test a pretrained model through the local policy bridge, or import a compatible checkpoint and mapped external episodes. PyTorch and ONNX models run in your local runtime.</p>
    <label>Import dataset JSON
      <input type="file" accept=".json,application/json" disabled={busy || loading} onChange={e => { void ingest(e.target.files?.[0], 'dataset'); e.target.value = ''; }} />
    </label>
    <label>Import policy JSON
      <input type="file" accept=".json,application/json" disabled={busy || loading} onChange={e => { void ingest(e.target.files?.[0], 'policy'); e.target.value = ''; }} />
    </label>
    <p className="copy">Dataset: dronelab-exchange-v1 JSON, ENU / SI / state-v1 / navigation actions. Policy: bc-v1 checkpoint. Images, RPM commands and other observation layouts require an adapter; they are not interchangeable.</p>
    <a href="https://github.com/iecclodd/dronelab/blob/codex/ai-training-integrations/docs/external-datasets.md" target="_blank" rel="noreferrer">Dataset formats and simulator references ↗</a>
    {message && <p role="status">{message}</p>}
    <details>
      <summary>Select journal episodes ({picked.length})</summary>
      <p className="copy">Only complete research navigation episodes are eligible. Choose one mission and unique seeds. Test episodes stay out of training.</p>
      {eligible.map(run => <label key={run.id}>
        <input type="checkbox" checked={selected.includes(run.id)} disabled={busy || loading} onChange={e => setSelected(old => e.target.checked ? [...old, run.id] : old.filter(id => id !== run.id))} />
        {run.config.scenario} · {run.config.seed} · {splitForSeed(run.config.seed)} · {run.manifest.source ? String(run.manifest.source) : run.controller}
      </label>)}
      {!eligible.length && <p>No eligible episodes yet. Import data or use Auto train.</p>}
    </details>
    <p className="copy">Selected: {count('train')} train / {count('validation')} validation / {count('test')} test episodes.</p>
    <div className="controls">
      <button disabled={busy || loading || !count('train') || !count('validation')} onClick={() => void onTrain(picked)}>Train from selected data</button>
      <button disabled={busy || loading || !picked.length} onClick={() => { try { exportDataset(picked); } catch (e) { report(e); } }}>Export selected dataset</button>
    </div>
  </section>;
}
