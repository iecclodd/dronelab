# External trajectory datasets

DroneLab imports only `dronelab-exchange-v1` JSON. It requires ENU coordinates,
meters, seconds, m/s, rad/s, `state-v1` observations, and `nav-v1` world-velocity
actions. An export ZIP includes an importable `exchange.json`, grouped JSONL, and a
provenance manifest. Imports are capped at 25 MiB, 32 episodes, 100,000 transitions,
and 14,400 transitions per journal run. Provenance names/licenses are limited to
256 characters, source URLs to 2,048, and original episode IDs to 128.

The importer rejects missing telemetry. It never invents orientation, range readings,
battery state, yaw rate, terminal state, units, or coordinate axes. It also rejects
body-frame commands presented as world-frame navigation actions.

## Explicit conversion scaffold

Use this only for a source that documents **world-frame NED** position, velocity,
target, angular velocity, quaternion, range, battery, and world-frame desired velocity
plus yaw rate. NED `[north, east, down]` converts to ENU `[east, north, -down]`.
Quaternion conversion must use the source's documented convention; do not guess it.

```ts
const nedToEnu = ([north, east, down]: [number, number, number]) =>
  [east, north, -down] as [number, number, number];
const required = <T>(value: T | undefined, name: string): T => {
  if (value === undefined || value === null) throw new Error(`Missing ${name}`);
  return value;
};

// cmd_body_velocity is incompatible: rotating it needs a documented body-to-world
// transform and quaternion convention. Only map a real world-frame command here.
function mapObservedRow(row: SourceRow, step: number) {
  const position = nedToEnu(required(row.position_world_ned, "position_world_ned"));
  const target = nedToEnu(required(row.target_world_ned, "target_world_ned"));
  return {
    version: "state-v1", sourceStep: step, deliveryStep: step,
    sampleTime: required(row.time_s, "time_s"), deliveryTime: row.time_s,
    position, velocity: nedToEnu(required(row.velocity_world_ned, "velocity_world_ned")),
    quaternion: required(row.quaternion_flu_to_enu_xyzw, "quaternion_flu_to_enu_xyzw"),
    angularVelocity: nedToEnu(required(row.angular_velocity_world_ned_rad_s, "angular_velocity_world_ned_rad_s")),
    relativeTarget: target.map((v, i) => v - position[i]) as [number, number, number],
    range: required(row.range_m_six_rays, "range_m_six_rays"),
    battery: required(row.battery_fraction, "battery_fraction"),
    priorAction: { kind: "nav", velocity: nedToEnu(required(row.cmd_world_ned, "cmd_world_ned")), yawRate: required(row.cmd_yaw_rate_rad_s, "cmd_yaw_rate_rad_s") },
    elapsed: row.time_s,
  };
}
```

The quaternion field must already describe FLU body orientation in ENU world coordinates (xyzw). A NED/FRD attitude needs a full frame rotation, and NED positive-down yaw rate needs sign conversion before supplying `cmd_yaw_rate_rad_s`. Do not simply relabel quaternion components.

Create `nextObservation`, reward components, physical state, and terminal metadata
from real source fields. If any are absent, the dataset is not compatible with
`state-v1`; use a separate adapter or task rather than filling gaps with constants.

## References and limitations

- [Farama Minari](https://minari.farama.org/) supports reproducible offline-RL datasets, but its data is environment-specific and needs an explicit adapter.
- [gym-pybullet-drones](https://github.com/learnsyslab/gym-pybullet-drones) has quadrotor RL environments, but its state/action conventions are not DroneLab exchange data.
- [TartanAir](https://theairlab.org/tartanair-dataset/) has visual-inertial trajectories, but lacks DroneLab navigation actions and six-range/battery observations, so it cannot be behavior-cloning imported directly.
