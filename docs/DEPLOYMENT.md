# Static website deployment

The visitor-facing product is the generated `dist` directory. Build with `npm ci` and `npm run build`; inspect locally using `npm run preview`, which serves `http://127.0.0.1:4173`. Visitors do not install developer tooling.

This checkout supports Vercel with the repository-root `vercel.json`: Vite preset, `npm ci`, `npm run build`, and output directory `dist`. Import the GitHub repository into Vercel with the repository root as its Root Directory. The application source lives under `apps/web`, but its build configuration and lockfile are at the root. Alternatively, authenticate the Vercel CLI, run `vercel link`, then `vercel deploy --prod`. No provider secrets are needed for this static deployment. `.vercel` local linking metadata is ignored by Git.

The earlier private Sites preview remains registered using `.openai/hosting.json`; Vercel ignores that directory. Deployment receipts beside this project record confirmed URLs and published commits. The user explicitly requested GitHub and Vercel as the subsequent source/deployment destination.

For another static HTTPS host, serve the complete `dist` directory with JavaScript MIME types for module workers. Runtime fonts and embedded Rapier WASM are packaged locally. Navigation uses `#fly`, `#experiment`, and `#review`; no server-side route fallback is needed. SharedArrayBuffer and cross-origin isolation are not required.

The optional `apps/api` relay is a separate persistent Node service. It has not been deployed with this static preview. Follow `docs/ai-mcp.md` for exact origin, TLS, server-only secrets, and SDK/browser smoke checks. Missing relay hosting or provider credentials leaves all core browser features available.
