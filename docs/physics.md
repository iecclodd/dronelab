# DroneLab physics and control model

The simulation uses SI units in a right-handed **ENU** world frame: `x` east,
`y` north and `z` up.  The vehicle body is **FLU**: forward, left and up.
Quaternions use `[x, y, z, w]`.  Rendering is deliberately outside sim-core;
`enuToThreePosition([x,y,z])` returns `[x,z,-y]`, and the companion quaternion
conversion is `[x,z,-y,w]`.

The 1 kg quad is one Rapier dynamic rigid body with a cuboid chassis and a
ground collider.  Four rotor forces act at body arm locations (front-left,
front-right, rear-right, rear-left): `(+x,+y)`, `(+x,-y)`, `(-x,-y)`,
`(-x,+y)`.  Their yaw reaction signs are `+ - + -`.  Motors are clamped to
5.8 N each and follow a first-order 45 ms lag.  Linear/angular drag, wind and
ground contact are included.  This is an intentionally modest flight model,
useful for browser gameplay and navigation experiments, not aircraft design.

Navigation actions contain bounded ENU velocity (±3 m/s) and yaw rate
(±1.5 rad/s).  They enter a velocity/position loop that produces a desired
acceleration and attitude, followed by an attitude/rate loop and a four-motor
mixer.  Rate actions carry normalized body rates and collective thrust.  The
scripted controller reads the same delayed/noisy `Observation` supplied to a
learned controller; it never reads hidden ground truth.  Random actions are
only a baseline.

Observations contain relative target, velocity, quaternion, angular velocity,
six axis-aligned normalized range values and battery (20 values total).  Sensor
noise and delay are driven by a seeded PRNG.  Snapshots include Rapier's world
bytes plus controller/motor state, PRNG state and the delayed observation
queue.  Each transition sums tick reward components: tracking, progress,
energy, collision and success.  A repeated step stops immediately at terminal
or timeout and records its actual number of physics ticks.
