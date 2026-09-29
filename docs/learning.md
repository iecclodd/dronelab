# Browser behavior cloning

The browser worker trains a CPU TensorFlow.js 4.22 MLP: 20 state inputs, two tanh hidden layers of 32 units, and four bounded navigation outputs (velocity XYZ and yaw rate). It is behavior cloning, not reinforcement learning or a real-aircraft controller.

Features are `[relativeTarget(3), velocity(3), quaternion(4), angularVelocity(3), range(6), battery(1)]`. Mean and standard deviation are fitted only from complete episodes with seeds below `20000`; episodes from `20000` through `29999` are validation only. The frozen closed-loop test manifest is `30001…30008` and is never selected or tuned against by the trainer.

The worker reports measured epoch loss and validation loss, keeps the lowest-validation weights, yields between epochs so Stop can take effect, and disposes TFJS tensors. Checkpoints carry every split seed, preprocessing values, loss arrays, config, serialized weights, and a content hash. Browser inference uses `packages/learning`'s small pure TypeScript forward pass, which is checked against TFJS before a checkpoint is returned (maximum absolute error below `1e-5`).

Supervised loss is not a flying-success claim. Evaluate scripted, random, and learned controllers on the same frozen seeds and action contract; report episode success with the Wilson interval returned by `wilson(success, total)`.
