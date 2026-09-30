# AI model and dataset integration research

Researched 2026-09-30. The integrations on this branch are a research layer. Player controls, world geometry, physics, rendering and Claude's game mechanics are unchanged. None of these sources establishes that a DroneLab-trained policy is ready for a real aircraft.

## Simulator and benchmark precedents

| Primary source | What to adopt in DroneLab | Compatibility boundary |
| --- | --- | --- |
| [gym-pybullet-drones](https://github.com/learnsyslab/gym-pybullet-drones), [Learning to Fly (2021)](https://arxiv.org/abs/2103.02142) | Reset/observe/step interface, seeded tasks, comparisons with scripted control | Its observation/action modes and motor dynamics differ. Map units and action semantics explicitly before using a checkpoint. |
| [safe-control-gym](https://github.com/learnsyslab/safe-control-gym), [benchmark paper](https://arxiv.org/abs/2109.06325) | Record constraints, tracking error, collisions and disturbance settings; compare learned and conventional controllers | Safety benchmark results depend on that environment's dynamics and constraints, not just an algorithm's name. |
| [Flightmare](https://github.com/uzh-rpg/flightmare), [paper](https://arxiv.org/abs/2009.00563) | Separate simulation stepping from rendering and model execution; repeatable evaluations | Importing Unity or replacing DroneLab's dynamics is not part of this branch. |
| [LSY drone racing](https://github.com/learnsyslab/lsy_drone_racing) | Evaluate submitted controllers against a defined simulator interface | A racing policy can be hosted locally, but its sensor/control assumptions must be adapted. |
| [Minari](https://github.com/Farama-Foundation/Minari) | Dataset provenance, episodic boundaries, explicit observations/actions, held-out episodes | Minari datasets are not universally drone datasets. An adapter must supply DroneLab's required state and navigation labels. |

## External datasets

[TartanAir](https://theairlab.org/tartanair-dataset/) is valuable for visual navigation and SLAM: it supplies simulated sensor modalities and ground-truth poses. Its [tools](https://github.com/castacks/tartanair_tools) document NED camera poses. DroneLab currently exposes ENU state observations; converting coordinates alone does not create missing motor/navigation action labels, range readings, targets, rewards or battery signals. Use TartanAir to train a compatible perception component in a local runtime; do not relabel it as a ready-to-train DroneLab controller dataset.

[Mid-Air](https://openaccess.thecvf.com/content_CVPRW_2019/papers/UAVision/Fonder_Mid-Air_A_Multi-Modal_Dataset_for_Extremely_Low_Altitude_Drone_Flights_CVPRW_2019_paper.pdf) is another low-altitude drone perception dataset. It is a useful external benchmark reference, but its modalities and task labels also need a deliberate adapter. Check the selected release's license before redistributing data.

A foreign pretrained model does **not** need to upload its entire training dataset into the browser. Keep weights and dataset tooling in Python/PyTorch/ONNX locally, expose a policy endpoint, and evaluate returned navigation actions in lockstep. Import an exchange dataset only when training or inspecting compatible state/action trajectories in DroneLab is useful. See [external datasets](external-datasets.md) and [AI relay](ai-mcp.md).

## Fruit fly connectome

- [FlyWire Codex](https://codex.flywire.ai/) and [FlyWire programmatic tooling](https://blog.flywire.ai/2024/12/20/how-to-use-flywire-for-connectomics/) provide connectome exploration and data access. Record the exact release and neuron IDs: a connectome is structural data, not executable control software.
- [Shiu et al. model](https://github.com/philshiu/Drosophila_brain_model) accompanies the [2024 peer-reviewed sensorimotor-processing paper](https://www.repository.cam.ac.uk/items/f6d6fd8e-ffa0-4e9f-aaca-71732c523253). It offers a concrete leaky integrate-and-fire model whose sensory stimulation and neural outputs can be adapted experimentally.
- [Eon fly-brain](https://github.com/eonsystemspbc/fly-brain) provides multiple implementations of a whole-brain model. Keep such runtimes and their data outside the web bundle; pin versions and record parameters when you run them.
- [FlyGym / NeuroMechFly](https://github.com/NeLy-EPFL/flygym) demonstrates embodied fly sensorimotor simulation. A fly body and a quadrotor have different actuation and sensing; its motor output cannot directly serve as DroneLab velocity commands.
- [FlyVis](https://github.com/TuragaLab/flyvis) provides a connectome-constrained visual model. It is a possible future perception frontend, not an already-integrated state-policy checkpoint.

Implemented boundary: a local connectome service receives a versioned observation and returns bounded ENU navigation commands with dataset/model/mapping provenance. The operator must choose sensory encodings, cell populations, neural time scale, and motor readout. Validate against a scripted baseline and a shuffled-connectome control before attributing performance to biological wiring. No full connectome download, neural simulator installation or biological-fidelity claim is made here.

## Evaluation protocol

1. Pin model, adapter, dataset release/license, source split and simulator configuration.
2. Verify coordinate frame (ENU), units (SI), action bounds and observation shape; reject unknown formats rather than invent missing sensors.
3. Preserve entire trajectories in one split. Keep test episodes out of normalization and fitting.
4. Evaluate the same task/seeds/disturbances for scripted, random and learned policies; retain failures and terminal transitions.
5. Report success counts, tracking error, collisions, reward and runtime. A small held-out set is an initial comparison, not a generalization guarantee.
6. Distinguish task failure from protocol failure, missing runtime, cancellation and timeout.
