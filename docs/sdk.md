# SHIVAX SDK

This guide describes the current source. Its `package.json` version is 0.1.3, which
is also the latest version published on npm (checked 2026-11-07). Sections marked
**Unreleased** describe source changes that are not in the published 0.1.3 package;
see the `Unreleased` section of `CHANGELOG.md`. For an overview of scope, trust
boundaries and limitations, read `docs/production.md` first.

Existing `shivax` root imports remain supported. All 12 public entry points provide
ESM, CommonJS and portable ES2020 declarations.

| Entry point | API |
| --- | --- |
| `shivax` | Compatible aggregate API |
| `shivax/core` | Tensor, math, NeuralNet, text and evaluation metrics |
| `shivax/rudra` | Bot contracts, registry, executor, RUDRA and controlled workflows |
| `shivax/bots` | Seven specialists and composition helpers |
| `shivax/security` | Jay, Vijay, policies, tools and audit; managed firewall and management (Unreleased) |
| `shivax/models` | Model providers, neural/rules/Ollama/remote adapters and SLM; guarded model gateway (Unreleased) |
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

These examples ship in the npm package under `examples/sdk/`. From an application
that has installed `shivax`, run them as `node node_modules/shivax/examples/sdk/<file>`;
they resolve `shivax/*` imports through package self-reference. From a source
checkout, run `pnpm build` first, then `node examples/sdk/<file>`.
`examples/sdk/README.md` lists what each one needs.

- `examples/sdk/registry.mjs`: specialist registration and discovery.
- `examples/sdk/local-model.mjs`: actual CPU training and local inference.
- `examples/sdk/ollama.mjs`: opt-in Ollama inference; set SHIVAX_OLLAMA_MODEL
  to a model already installed on your approved loopback Ollama server.
- `examples/sdk/rudra.mjs`: bounded workflow and explicit fixture approval.
- `examples/sdk/memory-persistence.mjs`: file save/reopen in an exclusive
  temporary directory, with cleanup.
- `examples/sdk/firewall.mjs` (Unreleased API): managed firewall with one CPU
  registration, default deny and an approved lockdown, using a labelled mock identity.
- `examples/sdk/inspectra.mjs`: a module (not a script) showing adapter composition
  with host page leases and URL policy. No implicit navigation or unrestricted
  resource permissions.

`pnpm verify:package` checks that every example named here is in the packed
tarball and runs the offline ones from an installed copy.

No React example ships with SHIVAX, and React is not a dependency. A React
demonstration exists in the author's separate Visynq Workstation application,
which is not distributed with this package. In a browser user interface, keep
identity verification, approvals, provider credentials and firewall
administration on a trusted host and send the page only results and approval
prompts; see `docs/production.md`.

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
const gate = new ServerLicenseGate(jay, serverVerifier, 'your-product-id');
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
offline into an exclusive temporary consumer, checks all 12 ESM/CJS entries,
checks and runs the packaged examples, and compiles all public declarations with
ES2020 alone in five consumer configurations. It cleans up and never publishes.

The following checks exist only in the source repository, not in the npm package.
`node adapters/inspectra/test-live.mjs` tests actual capture, screenshot metadata,
review and page cleanup using local fixtures and an installed browser.
`node scripts/check-workstation-browser.mjs` drives the separate Visynq Workstation
application, which is not distributed with SHIVAX.

See `docs/release-readiness.md` for acceptance evidence and open release items.

## Managed firewall core

**Unreleased.** This section and the firewall sections that follow (protected
execution binding, guarded model calls and host management) describe source that
is not in the published 0.1.3 package. A runnable example is
`examples/sdk/firewall.mjs`.

`createShivaxFirewall` is exported from `shivax/security` and the root entrypoint.
It adds a managed boundary around trusted host registrations while retaining Jay
authentication and Vijay authorization/approvals. There is no global mode setter.
Keep the returned `admin` object at the trusted composition root; bots receive
only narrow host tool clients, never administrator or root-context references.

Configuration is required, validated and snapshotted. Initial mode must be
`enforce`; omitted, malformed or initially permissive configuration throws.
Every operation needs an explicit non-optional allow rule, its baseline Vijay
policy, and permission for every declared capability, provider/locality, bot,
file and network resource. An empty allowlist denies that resource.

- `enforce`: enforce all rules.
- `monitor`: observe only rules marked `optional: true` (additional deny rules).
  Default deny, non-optional denies, resource allowlists, authentication, tenant
  binding, approval, sandbox checks and hard budgets remain enforced.
- `lockdown`: reject model, workflow, bot, tool, file and network operations.
  Explicitly allowed `cpu` registrations remain usable with mandatory checks.
  CPU registrations must be read-only and declare no file or network resources.
  Existing CPU Tensor/NeuralNet APIs are unchanged.

The host must configure the root capability policy plus each operation capability.
The separate administrator capability must have a state-changing Vijay policy,
so administrative changes require its permissions and human approval. The
`authorizeAdmin` callback is an additional host role check, called before approval
and again before commit; it should be idempotent and must not derive roles from
task/model data. Jay and Vijay must come from the same ESM or CommonJS graph.

Illustrative CPU registration, using an already configured Jay/Vijay pair:

```ts
import { createShivaxFirewall } from 'shivax/security';

// jay, security and isAdministrator are trusted host services.
// Vijay policies for the task, numeric.square and firewall.admin already exist.
const firewall = createShivaxFirewall({
  jay, security,
  realm: { issuer: 'host', scope: { kind: 'company', id: 'tenant' } },
  adminCapability: 'firewall.admin',
  authorizeAdmin: (root, signal) => isAdministrator(root, signal),
  operations: [{
    id: 'square', kind: 'cpu', capability: 'numeric.square', effect: 'read-only',
    files: { read: [], write: [] }, networkOrigins: [],
    check: input => typeof input === 'number' && Number.isFinite(input),
    execute: input => (input as number) ** 2,
  }],
  policy: {
    mode: 'enforce',
    rules: [{ id: 'square.allow', decision: 'allow', operationIds: ['square'] }],
    capabilities: ['numeric.square'], bots: [],
    providers: { ids: [], localities: [] },
    files: { read: [], write: [] }, network: { origins: [] },
    limits: {
      maxConcurrent: 2, maxOperations: 100, maxTokens: 0, maxCostUSD: 0,
      timeoutMs: 1000, maxInputBytes: 4096, maxOutputBytes: 4096,
    },
    audit: { required: false },
  },
});

await firewall.runtime.execute(authenticatedRoot, 'square', 3);
await firewall.admin.lockdown(adminRoot, firewall.runtime.snapshot().version);
```

`runtime.execute` invokes only a registered handler; a task cannot supply code,
permission metadata, provider credentials or a replacement callback. Registration
`check` is a mandatory synchronous host predicate for credentials, sandbox and
input/resource constraints. It must return literal true in every mode. It must not
call its own `context.checkExecution()` recursively. Host handlers call that
checkpoint after awaits and immediately before each additional effect. It
rechecks the lease, policy, identity, baseline authorization and mandatory predicate.

`tool` registrations use the existing protected tool registry through Vijay.
`model` registrations supply one trusted provider, output contract and a complete
`ModelLimits` object. They use a persistent ModelRouter per registration, preserving
R01 exact accounting and R02 usage validation. Each model attempt is reserved
against the shared firewall budget before dispatch. There is no implicit fallback
in this API; a hard model limit or unverifiable usage blocks further managed model
dispatch across registrations. Policy changes and rollback never refund or reset
reservations. Unknown billing retains the full ceiling; valid excess is charged,
including late responses after cancellation. Model failure classifications are
preserved. Model output exceeding a declared bound can only be detected after the
provider has already done work; provider pricing and declared ceilings are trusted.

File permissions match exact host-canonical absolute paths using forward slashes;
there are no globs or prefix grants. Relative paths, dot segments, alternate stream
syntax and ambiguous forms are rejected. The host must resolve symlinks, case and
filesystem aliases and bind the handler to those actual resources. Network
permissions match exact HTTP(S) origins. Local/remote model registrations must
declare at least one origin. Declared metadata is not network interception: a
trusted transport must enforce actual destinations, redirects, DNS resolution
and subresources, and keep credentials inside its own closure.

`admin.replace(root, expectedVersion, policy)` and
`admin.rollback(root, expectedVersion, targetVersion)` use optimistic version
checks and serialized administration. Rollback revalidates one of the last 32
in-memory policies and publishes a new increasing version. An authorized invalid
update closes admission; explicit authorized replacement/rollback is needed for
recovery. Unauthorized updates leave the current policy unchanged. Updates revoke
existing leases before awaiting required audit acknowledgement. Late approvals
cannot restore them. Versions, history and budgets are local to this instance;
durable policy persistence, anti-rollback and multi-process coordination belong to
the trusted host and are not implemented by this core.

Audit records contain fixed reason codes, versions and registered operation IDs;
they omit inputs, results, principal/session IDs, paths, URLs, credentials and raw
exceptions. Use non-sensitive registration IDs. The ring and optional observer
queue are bounded; `droppedAuditEvents` reports lost ring entries or observer
deliveries. When `audit.required` is true, a host `auditSink` must acknowledge true
before business dispatch; missing, failed or timed-out acknowledgements deny.
Authorized lockdown takes priority over external audit availability and records
its transition locally.

Cancellation rejects the public operation promptly and signals cooperating work.
The runtime retains concurrency ownership and potential charges until actual work
settles; `status().draining` distinguishes that work. It cannot preempt synchronous
JavaScript, stop an arbitrary remote request, reverse a committed write or prove
that provider billing stopped. Isolate noncooperative work and enforce egress with
a trusted host, OS firewall, proxy or sandbox.

With the default explicit-runtime configuration, other SDK instances require host integration. Host registrations must propagate the supplied signal and
checkpoints and route nested effects through managed operations where needed.
The workflow `registerModel` path is still distinct from this core's ModelRouter
path and keeps its own workflow budget. It now applies the same fail-closed usage
and terminal-error rules (the R03 G02 fix). An npm library cannot stop a malicious
host from bypassing its own code.

### Binding the firewall to protected execution

Set `protectExecution: true` in `createShivaxFirewall` before the supplied Vijay
instance first admits work. Pass that same Vijay to `RudraOrchestrator` or
`RudraWorkflowEngine`. For `createSpecialistSystem`, use the returned `security`
instance and attach the controller before the first run. A binding lasts for the
lifetime of that Vijay. A late or second binding is rejected so every active
protected authorization belongs to one controller. Omitting the option retains
the explicit R04 runtime API.

Declare the registrations and rules for each actual path. A root task matches a
`workflow` registration with its root capability. A bot attempt matches a `bot`
registration with its selected source bot ID, capability and effect. A tool matches
a `tool` registration with its capability, tool ID and effect. Set its `botId` to
restrict it to that invoking bot. A tool registration without a bot ID can apply
to a workflow or bot, subject to its separate Vijay grants. Missing or ambiguous
matches deny admission. Explicit allows and the policy's capability and bot lists
still apply. A boundary uses the registered metadata and mandatory predicate,
then dispatches through the existing planner, bot or tool implementation.

```ts
const { admin, runtime } = createShivaxFirewall({
  ...hostOptions,
  security: vijay,
  protectExecution: true,
});
const rudra = new RudraOrchestrator(registry, { security: vijay, planner });
const workflows = new RudraWorkflowEngine(toolRegistry, vijay);
```

RUDRA and workflows hold the root lease until tracked work settles. Paused and
waiting runs receive revocation. Vijay checks the actual input, security policy,
registration and lease around approvals and dispatch. Tool handlers must call
`context.checkExecution()` after asynchronous preparation and immediately before
a later side effect. The signal includes caller cancellation and firewall
revocation. Bot execution also retains its executor deadline. A saved tool context
expires after its invocation.

Concurrency and operation budgets count nested admissions. For example, a
workflow action can hold a root lease, a capability lease and a tool lease
simultaneously. Size the limits for the intended parallelism. Retries acquire
fresh authorization. Monitor observes optional denies while enforcing Vijay,
mandatory rules, approvals and controller resource ceilings. An operation
already admitted through the explicit R04 runtime keeps its own reservation.

The binding covers calls through this Vijay. Direct host I/O and raw provider calls
require their own managed boundary. The workflow model adapter enforces its own
workflow budget with the R02 usage rules, not the firewall's shared ledger.
Protected tool admission alone does not add ModelRouter accounting to a raw
provider call.

### Guarded model and integration calls (R06)

Use `createGuardedModelGateway` from `shivax/models` in protected applications.
Create the firewall with host-selected `model` registrations, then bind a fixed
ordered route. Each registration selects one provider, one model capability,
an output contract and bounded model limits. The gateway accepts the original
Jay context. A copied context, prompt, model output or arbitrary runtime object
cannot mint authority.

```ts
import { createGuardedModelGateway } from 'shivax/models';

const infer = createGuardedModelGateway(runtime, {
  capability: 'text-reasoning',
  operationIds: ['local-reasoning', 'approved-remote-reasoning'],
  timeoutMs: 15_000,
  allowRemote: true,
});
const result = await infer(authenticatedRoot, taskData);
```

Provider IDs, localities and network origins must be allowed by the effective
firewall policy. Remote routes additionally require `allowRemote: true`, which
defaults to false. Optional `policy.providers.capabilities` entries use
`{ providerId, allow: ModelCapability[] }`. When that list is present, a missing
provider/capability entry denies. Existing R04 policies without the list continue
to use the capability pinned in each model registration.

Every attempt uses the existing exact cost reservation and token accounting.
All attempts share the controller's cumulative ceilings, including concurrent
routes. Verified invalid output and retryable provider failures may fall back.
Hard limits, unverifiable usage, transport denial, cancellation and timeouts
are terminal. A policy transition invalidates an active route, including between
attempts. One route deadline bounds the complete attempt sequence. An operation
registration retains its own model budget and busy state between calls.
Uncertain billing retains the conservative reservation until verified, and
unsafe usage can close later model admission as in R04.

The legacy `new ModelRouter(...)` and `createModelOperation(...)` APIs remain
available. They do not authenticate a Jay identity or automatically inherit a
firewall. Compose protected applications with the guarded gateway and retain the
root context in trusted host code. Bot payloads must never receive the admin
controller or choose registrations.

For protected `RemoteModelAdapter` use, configure a fixed HTTPS `endpoint`
without URL credentials, query parameters or fragments. Its lazy loader must
return `inferGuarded(request, policy)` in addition to the legacy `infer` method.
The guarded method receives the exact approved endpoint, `redirect: 'error'`
and `checkDestination(url)`. The host transport must disable redirects,
validate resolved addresses and proxy routing, protect credentials, bound request
and response resources, propagate the signal and call the destination check
immediately before I/O and again after asynchronous preparation. A legacy-only
transport is denied in protected use. Raw legacy adapter calls retain their
previous contract. Other host-supplied model providers have the same trusted
transport responsibility and receive `request.checkNetworkAccess`.

Ollama retains its loopback-only transport, cloud-alias checks, disabled
redirects and omitted credentials. The firewall rechecks the registered origin
before metadata acquisition and before chat dispatch. Disabled local permission
denies before loading or transport invocation.

Protected tools receive live `checkNetworkAccess(url)` and
`checkFileAccess(path, 'read' | 'write')` functions. They check the active lease,
current policy and that operation's registered resources. This applies both to
explicit runtime execution and to the R05-bound Vijay path. These callbacks
expire with the invocation. Host handlers must call them before later I/O.

Memory services keep their identity-derived principal, issuer, tenant and
session namespace. Direct MemoryEngine calls carrying a protected tool signal
also enforce that signal's authenticated namespace and resource boundary. Protected embeddings and custom persistence must declare
`networkOrigins`. An empty array is the trusted host's assertion that the
adapter performs no network I/O. Omission fails closed only in protected use.
Destinations are checked before invocation. Embeddings receive
`context.checkNetworkAccess` and persistence receives an optional fourth
argument with that check for use after waits and before transport.
Both must honor the supplied signal. Node file persistence checks the actual
target file for reads and requires write permission for both the target and its
`.pending` sibling. Cleanup of a temporary file already acquired by the
operation remains permitted after cancellation. Retention, approvals, namespace
isolation and transactional commit checks remain in place. Custom adapters and
symlink/reparse-point resolution remain trusted host responsibilities.

Inspection services reauthorize each page after the preceding capture and apply
the host URL predicate to every destination checked by the provider.
The optional Inspectra adapter still lazily imports `inspectra-engine/node`
and remains an optional peer at the existing tested version, 1.0.4.
In protected use, `openPage(request, context, security)` receives a fresh
`InspectraPageSecurity` contract. Before navigating, the trusted host must bind
an isolated page/browser context to `security.owner`, install interception for
navigation, redirects and every subresource, and invoke
`security.checkDestination` for each destination. It must enforce DNS/IP,
proxy, browser, time and resource limits, and clean up acquisitions that reject.

Return that exact contract as `lease.security` after applying it. A missing or
different acknowledgement denies capture and closes the acquired lease.
This acknowledgement expresses a trusted host obligation, not proof of browser
isolation. The adapter enforces its extraction node ceiling, rechecks permission
after loading and acquisition, and closes leases exactly once on failure or
cancellation, including late acquisition. Protected screenshots also require
explicit write permission for the host-selected path. Legacy unguarded page
leases retain their previous shape.

These boundaries constrain cooperating SDK calls. An npm library cannot
prevent a malicious host running arbitrary JavaScript from bypassing its code.
DNS rebinding, redirect enforcement, filesystem aliasing and complete browser
network isolation require the trusted transport, OS, proxy or sandbox.
Cancellation cannot undo committed effects or preempt synchronous or
non-cooperative work. No new unrestricted network or filesystem tool is exposed.

### Authenticated host management (R07)

`openShivaxFirewallManagement` from `shivax/security` creates a host-only
management controller after loading and validating a persistent policy. It
requires the existing Jay/Vijay configuration, an immutable catalog of approved
policy profiles, transport authentication, action-specific administrator checks,
a synchronous revocation fence, and a trusted exclusive persistent store.

```ts
import { openShivaxFirewallManagement } from 'shivax/security';

const host = await openShivaxFirewallManagement(hostManagementOptions, hostSignal);
const configuration = await host.management.readConfiguration(request, requestSignal);
const current = await host.management.readPolicy(request, requestSignal);
const next = await host.management.requestChange(request, {
  expectedVersion: current.version,
  profileId: configuration[0].id,
}, requestSignal);
```

`readPolicy`, `readConfiguration`, `requestChange`, `lockdown` and `readAudit`
authenticate and authorize each request. Changes select an approved profile ID;
raw client policies and extra override fields are rejected. Changes retain Vijay
approval requirements. Storage commits use compare-and-swap versions and a final
authorization check. The runtime stays closed while the policy is being stored
and rechecks authorization before publication. Missing or invalid saved policies
prevent startup. Persistence failure closes admission. An ambiguous acknowledgement
requires reloading the actual durable version, not assuming rollback.

The store owns exclusive realm fencing, atomic policy/journal persistence and
protected administrator references. Public audit results omit those references
and identity data. The startup signal also controls the host lifetime; `close()`
revokes work and waits for pending storage writes before releasing ownership.
Policy versions survive restart. Model billing counters remain process-local.

Retain the management controller at the trusted composition root. Never expose it
as a bot tool, use a task payload as administrator identity, or forward LLM output
as an administrative instruction. SHIVAX supplies a transport-neutral adapter
and, in its test suite, a persistent file-backed test host. It does not ship
production HTTP or IPC routes, an administrator identity provider or a production
policy store; the host must provide and secure those. The source repository report
`docs/audits/shivax-r07-management.md` (not included in the npm package) documents
the complete store contract, crash/revocation semantics and remaining production
integration responsibilities.
