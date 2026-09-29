# Attribution and licenses

DroneLab's direct dependency versions are pinned in `package.json` and the root lockfile. Check installed package metadata and the lockfile before redistribution; transitive notices may change when dependencies change.

Core third-party packages used by the browser include:

* React 19.3.0 and React DOM 19.3.0 — [react.dev](https://react.dev/).
* Three.js 0.186.1 and React Three Fiber 9.8.1 — [threejs.org](https://threejs.org/) and [r3f.docs.pmnd.rs](https://r3f.docs.pmnd.rs/).
* Rapier compatibility runtime 0.21.0 — [rapier.rs](https://rapier.rs/).
* TensorFlow.js 4.22.0 — [tensorflow.org/js](https://www.tensorflow.org/js).
* IndexedDB helper `idb` 8.x, ZIP writer `fflate` 0.8.x, and schema validation `zod` 4.6.5 — [npm idb](https://www.npmjs.com/package/idb), [npm fflate](https://www.npmjs.com/package/fflate), and [zod.dev](https://zod.dev/).

Development and optional relay dependencies include Vite 8.3.1, TypeScript 6.0.3, Vitest 5.0.2, Playwright 1.63.0, Express 5.2.1, CORS 2.8.5, and the official Model Context Protocol SDK 1.31.0. Their package licenses and notices are distributed with the installed packages; the MCP project documents its SDK at [modelcontextprotocol.io](https://modelcontextprotocol.io/).

DroneLab uses no provider SDK credentials in the frontend. OpenAI, Anthropic, or Gemini provider calls are optional server adapters and remain disabled until an operator supplies server-side environment variables. Provider names and logos remain their respective owners' marks.

For a release artifact, retain the repository lockfiles and generate a complete transitive notice from the exact install with the organization's approved license-audit tool. This page records direct pins and official project sources; it is not a substitute for that release audit.
