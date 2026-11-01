# SHIVAX SDK

Version 0.1.3. Existing `shivax` root imports remain supported. All 12 public entry
points provide ESM, CommonJS and portable ES2020 declarations.

| Entry point | API |
| --- | --- |
| `shivax` | Compatible aggregate API |
| `shivax/core` | Tensor, math, NeuralNet, text and evaluation metrics |
| `shivax/rudra` | Bot contracts, registry, executor, RUDRA and controlled workflows |
| `shivax/bots` | Seven specialists and composition helpers |
| `shivax/security` | Jay, Vijay, policies, tools and audit |
| `shivax/models` | Model providers, neural/rules/Ollama/remote adapters and SLM |
| `shivax/memory` | Memory engine, persistence and lifecycle integration |
| `shivax/integrations` | Portable inspection contracts, service and planner |
| `shivax/adapters/inspectra` | Optional lazy Inspectra adapter |
| `shivax/learning` | Feedback, evaluation, curated training and model/config rollback |
| `shivax/diagnostics` | `toSDKDiagnostic` and `SDKDiagnostic` |
| `shivax/licensing/server` | ServerLicenseGate, LicenseError and server entitlement contracts |

Shared build chunks preserve class identity between root and subpath imports
within one module format. Keep the entire packaged `dist/`, including `chunks/`.
Conditional exports select ESM declarations for imports and the CommonJS
declaration graph under `dist/types-cjs` for require consumers. Keep that graph
and its `package.json` scope marker when copying the package. Package verification
checks strict bundler, Node16 and NodeNext consumers, including `.mts` and `.cts`.
Instantiate a host's guards in one module format; ESM and CJS are separate graphs.
Distributed JavaScript targets ES2022, retaining native private class fields and
methods. Use a compatible modern browser engine or transpile dependency code for
older browsers. TypeScript public declarations still pass strict ES2020-only
consumer checks. Public class fields retain the previous assignment semantics
through explicit `useDefineForClassFields: false` in the build configuration.
No model, React, browser engine or licensing service is loaded on import. The core
requires Node 22+; actual Inspectra execution requires Node 22.15+ and an optional
host-installed `inspectra-engine@1.0.4` (the exact tested optional peer). Neither
SHIVAX nor its adapter eagerly loads Inspectra. Both ESM and CommonJS adapters
use dynamic import for its ESM-only `/node` API. Missing-provider and unsupported-API
errors give fixed setup guidance without exposing provider exception details.
Browser bundles exclude Node-only host services.

```js
import { BotRegistry } from 'shivax/rudra';
import { createSpecialistBots } from 'shivax/bots';
const registry = new BotRegistry();
createSpecialistBots().forEach(bot => registry.register(bot));
console.log(registry.findByCapability('code.patch').map(bot => bot.id));
```

## Examples

Build SHIVAX first, then run these from the package directory:

- `node examples/sdk/registry.mjs`: specialist registration and discovery.
- `node examples/sdk/local-model.mjs`: actual CPU training and local inference.
- `node examples/sdk/ollama.mjs`: opt-in Ollama inference; set SHIVAX_OLLAMA_MODEL
  to a model already installed on your approved loopback Ollama server.
- `node examples/sdk/rudra.mjs`: bounded workflow and explicit fixture approval.
- `node examples/sdk/memory-persistence.mjs`: file save/reopen in an exclusive
  temporary directory, with cleanup.
- `examples/sdk/inspectra.mjs`: actual adapter composition using host page leases
  and URL policy. No implicit navigation or unrestricted resource permissions.

The React example lives in the actual sibling Visynq application:
`../visynq-workstation/src/lib/shivax-demo.ts` and
`../visynq-workstation/src/pages/ShivaxDemoPage.tsx`.
Build SHIVAX, run Visynq's `npm run dev`, then open `/shivax`.
The local workspace maps public SHIVAX imports to this checkout's built entry
points. Installed consumers instead declare their chosen `shivax` dependency.

The page uses recorded Inspectra/Chromium evidence from
`examples/sdk/inspection-fixture.json` and a clearly labelled browser-local mock
identity. Text labels a fixed task; it is not an LLM prompt. Real RUDRA routing
selects Narad for capture/comparison and Yudhishthir for deterministic review.
It displays requests, selections, progress, results, pending approval, measured
issues and the final response. Cancellation/unmount/scope changes revoke approval
and dispose the local host. Results are session-local and untrusted. Real account
verification and live capture remain host integrations. Existing live scanning
is separate. React is not a SHIVAX dependency.

## Diagnostics

`toSDKDiagnostic(error)` returns a fixed code, user-facing message and retryable
flag. It never copies raw exceptions, payloads, stacks, unknown codes or secrets.
Use the existing bounded RUDRA/security traces for detailed host diagnostics.

## Server-verified licensing

`ServerLicenseVerifier.verify(request)` is a trusted server interface. It receives
a Jay-verified identity, scope, product, feature and signal. Return an unknown
entitlement containing version 1, productId, subject `{ id, issuer }`, scope,
features and expiresAt. ServerLicenseGate validates the closed shape, binding and
expiry and rechecks the session after verification. All failures produce a fixed
LicenseError. There is no credential, fetch client, permissive fallback or cache.

```ts
import { ServerLicenseGate, type ServerLicenseVerifier } from 'shivax/licensing/server';
// Supply a real verified server adapter; never pass browser license claims.
declare const serverVerifier: ServerLicenseVerifier;
const gate = new ServerLicenseGate(jay, serverVerifier, 'visynq-workstation');
await gate.require(authenticatedContext, 'inspection');
// Continue through Vijay authorization and approval for the protected operation.
```

This prepares a future Lemon Squeezy adapter, not its API/webhook implementation.
The server owns provider credentials, entitlement lookup, signature checks where
needed, revocation and billing interpretation. Never ship licensing/API secrets
to React, or trust local storage, task text, model output or a client `licensed`
flag. Check licensing at protected server operations, including retries when
applicable. Entitlement does not replace authentication or grant tool permission.

## Verification

`npm run verify:package` packs without lifecycle scripts, installs the tarball
offline into an exclusive temporary consumer, checks all 12 ESM/CJS entries and
compiles all public declarations with ES2020 alone. It cleans up and never publishes.

For the optional browser check, start Visynq at http://127.0.0.1:4185, set
PLAYWRIGHT_BROWSERS_PATH to the installed browser cache, and run
`node scripts/check-workstation-browser.mjs`. It blocks external requests.
`node adapters/inspectra/test-live.mjs` separately tests actual capture, screenshot
metadata, review and page cleanup using local fixtures.

See `docs/release-readiness.md` for acceptance evidence and release blockers.
