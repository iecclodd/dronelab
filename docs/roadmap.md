# Roadmap

This roadmap records gaps visible in the current source rather than promising an implementation date.

## Current limitations

* The product is a research game with a modest browser quadrotor model, not a validated aircraft or real-drone controller.
* Learning is supervised behavior cloning. PPO or another reinforcement-learning trainer is not implemented.
* The renderer can capture an RGB PNG at a paused, expected simulation step. Image/depth observations, multimodal policies, and dataset farms are not implemented.
* Runs, checkpoints, and relay state are local or in-memory. There is no shared run registry, durable job queue, or multi-device collaboration.
* The optional relay has no provider credentials by default. Live provider accounts were not verified; the relay is operator-trusted and requires TLS deployment.
* The browser export is the implemented run ZIP; there is no separate fleet dataset catalog or schema migration system.

## Evidence-led next work

1. Add explicit schema/version migration and import validation for run and policy artifacts before sharing them across devices.
2. Add reproducible benchmark reports over the frozen test manifest, with controller and physics versions recorded alongside Wilson intervals.
3. Extend the observation/action contracts only with a documented simulator and browser-performance budget; candidates include image/depth capture and richer tasks.
4. Add a durable authenticated backend for shared runs and queued jobs if collaboration becomes a product requirement.
5. Evaluate RL methods such as PPO as a separate experiment, retaining the current behavior-cloning baseline and held-out seeds.
6. Add real provider and relay deployment verification with test credentials, rate/latency monitoring, and operational rotation procedures.
