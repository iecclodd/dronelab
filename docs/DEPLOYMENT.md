# Static website deployment

The visitor-facing product is the generated `dist` directory. Build with `npm ci` and `npm run build`; inspect locally using `npm run preview`, which serves `http://127.0.0.1:4173`. Visitors do not install developer tooling.

This checkout is registered with Sites using `.openai/hosting.json` and a static directory of `dist`. The parent publishes a private preview and returns the successful deployment URL in the chat together with a deployment receipt beside this project. Keep the preview private unless its owner requests a different audience. No provider secret is needed for this static deployment.

For another static HTTPS host, serve the complete `dist` directory with JavaScript MIME types for module workers. Runtime fonts and embedded Rapier WASM are packaged locally. Navigation uses `#fly`, `#experiment`, and `#review`; no server-side route fallback is needed. SharedArrayBuffer and cross-origin isolation are not required.

The optional `apps/api` relay is a separate persistent Node service. It has not been deployed with this static preview. Follow `docs/ai-mcp.md` for exact origin, TLS, server-only secrets, and SDK/browser smoke checks. Missing relay hosting or provider credentials leaves all core browser features available.
