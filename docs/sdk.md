# ShivAX SDK

This guide covers version 0.2.0 NARASIMHA. Sections marked **New in 0.2.0** cover
APIs that are not in 0.1.3 or earlier. See `CHANGELOG.md`. For scope, trust
boundaries and limits, read `docs/production.md` first.

Root imports from `shivax` still work. All 13 public entry points ship ESM,
CommonJS and portable ES2020 type declarations.

| Entry point | API |
| --- | --- |
| `shivax` | Everything in one import, as before |
| `shivax/core` | Tensor, math, NeuralNet, text and evaluation metrics |
| `shivax/rudra` | Bot contracts, registry, executor, RUDRA and controlled workflows |
| `shivax/bots` | The seven specialist bots and helpers to combine them |
| `shivax/security` | Jay, Vijay, policies, tools and audit; managed firewall and management (new in 0.2.0) |
| `shivax/models` | Model providers, neural, rules, Ollama and remote adapters, and SLM; guarded model gateway (new in 0.2.0) |
| `shivax/memory` | Memory engine, storage and lifecycle hooks; opt-in ranked retrieval (`MemoryRanker`) and a local hashing embeddings adapter |
| `shivax/integrations` | Portable inspection contracts, service and planner |
| `shivax/adapters/inspectra` | Optional Inspectra adapter, loaded on first use |
| `shivax/learning` | Feedback, evaluation, reproducible benchmarks, curated training, model or config rollback, the durable model registry (approval, atomic activation, rollback), and shadow routing recommendations with promotable routing policies |
| `shivax/learning/node` | Node.js only. `WorkerTrainingPool`, `trainOfflineCandidateInWorker` and `trainCuratedCandidateInWorker` train candidates in `worker_threads` without blocking the host (see `docs/learning-worker-training.md`). Not part of the root `shivax` import |
| `shivax/diagnostics` | `toSDKDiagnostic` and `SDKDiagnostic` |
| `shivax/licensing/server` | ServerLicenseGate, LicenseError and server license contracts |

### Package layout and module formats

- **Shared chunks:** root and subpath imports share build chunks. So a class is
  the same class from either import, within one module format. Keep the whole
  packaged `dist/`, including `chunks/`.
- **Types:** conditional exports give `import` consumers the ESM declarations.
  `require` consumers get the CommonJS declarations under `dist/types-cjs`. If you
  copy the package, keep that folder and its `package.json` scope marker.
  Package checks cover strict bundler, Node16 and NodeNext consumers, including
  `.mts` and `.cts`.
- **One format per host:** create your host's guards in one module format. ESM
  and CJS load separate copies of the code.
- **JavaScript target:** the shipped JavaScript targets ES2022 and keeps native
  private class fields and methods. Use a modern browser engine, or transpile
  dependencies for older browsers. The public type declarations still pass strict
  ES2020-only checks. Public class fields keep their old assignment behaviour
  because the build sets `useDefineForClassFields: false`.
- **Nothing heavy on import:** importing ShivAX loads no model, React, browser
  engine or licensing service.
- **Runtimes:** the core needs Node 22+. Running Inspectra needs Node 22.15+ and
  an optional `inspectra-engine@1.0.4` installed by the host. That is the exact
  optional peer version tested. Neither ShivAX nor its adapter loads Inspectra
  until it is needed. Both the ESM and CommonJS adapters use dynamic import for
  Inspectra's ESM-only `/node` API. If the provider is missing or its API does not
  match, the error gives fixed setup steps and hides the provider's exception.
- **Browsers:** browser bundles leave out services that only work in Node.

```js
import { BotRegistry } from 'shivax/rudra';
import { createSpecialistBots } from 'shivax/bots';
const registry = new BotRegistry();
createSpecialistBots().forEach(bot => registry.register(bot));
console.log(registry.findByCapability('code.patch').map(bot => bot.id));
```

## Examples

These examples ship in the npm package under `examples/sdk/`. In an app that has
`shivax` installed, run `node node_modules/shivax/examples/sdk/<file>`. They find
`shivax/*` imports through package self-reference. In a source checkout, run
`pnpm build` first, then `node examples/sdk/<file>`. `examples/sdk/README.md`
lists what each one needs.

- `examples/sdk/registry.mjs`: registers the specialist bots and finds them.
- `examples/sdk/local-model.mjs`: trains on the CPU and runs local inference.
- `examples/sdk/ollama.mjs`: Ollama inference, off unless you opt in. Set
  SHIVAX_OLLAMA_MODEL to a model already installed on your approved loopback
  Ollama server.
- `examples/sdk/rudra.mjs`: a short workflow with an approval check written in code.
- `examples/sdk/memory-persistence.mjs`: saves to a file in its own temp folder,
  opens it again, then cleans up.
- `examples/sdk/firewall.mjs` (new in 0.2.0): a managed firewall with one CPU
  operation, a default deny and an approved lockdown. It uses a mock identity
  labelled as a demo.
- `examples/sdk/inspectra.mjs`: a module, not a script. It shows how to connect
  the adapter to host page leases and a URL policy. It never navigates on its own
  or grants open resource access.

`pnpm verify:package` checks that every example named here is in the packed
tarball. It also runs the offline ones from an installed copy.

No React example ships with ShivAX, and React is not a dependency. A React demo
exists in the author's separate Visynq Workstation app, which does not ship with
this package. In a browser UI, keep identity checks, approvals, provider keys and
firewall admin on a trusted host. Send the page only results and approval
prompts. See `docs/production.md`.

## Diagnostics

`toSDKDiagnostic(error)` returns a fixed code, a message for users and a
`retryable` flag. It never copies raw exceptions, payloads, stacks, unknown codes
or secrets. For detailed host diagnostics, use the existing capped RUDRA and
security traces.

## Server-verified licensing

`ServerLicenseVerifier.verify(request)` is an interface for a trusted server. It
receives a Jay-verified identity, scope, product, feature and signal. Return an
entitlement of unknown type that contains version 1, `productId`, subject
`{ id, issuer }`, scope, features and `expiresAt`. ServerLicenseGate checks that
the shape is closed, that it matches the request, and that it has not expired.
It checks the session again after verification. Every failure throws a fixed
LicenseError. There are no built-in keys, fetch client, permissive fallback or cache.

```ts
import { ServerLicenseGate, type ServerLicenseVerifier } from 'shivax/licensing/server';
// Supply a real verified server adapter; never pass browser license claims.
declare const serverVerifier: ServerLicenseVerifier;
const gate = new ServerLicenseGate(jay, serverVerifier, 'your-product-id');
await gate.require(authenticatedContext, 'inspection');
// Continue through Vijay authorization and approval for the protected operation.
```

This prepares for a future Lemon Squeezy adapter. It does not include that
adapter's API or webhook code. The server owns provider keys, entitlement lookup,
signature checks where needed, revocation and billing rules. Never ship license or
API secrets to React. Never trust local storage, task text, model output or a
client `licensed` flag. Check the license at each protected server operation,
including retries where they apply. A license does not replace authentication or
grant tool permission.

## Verification

`npm run verify:package` packs the package without lifecycle scripts. It installs
the tarball offline into its own temp consumer project and checks all 12 ESM and
CJS entries. It checks and runs the packaged examples. It also compiles all public
declarations with only ES2020 in five consumer setups. It cleans up after itself
and never publishes.

The following checks live only in the source repository, not in the npm package.
`node adapters/inspectra/test-live.mjs` tests real capture, screenshot metadata,
review and page cleanup, using local fixtures and an installed browser.
`node scripts/check-workstation-browser.mjs` drives the separate Visynq
Workstation app, which does not ship with ShivAX.

See `docs/release-readiness.md` for test results and open release items.

## Managed firewall core

**New in 0.2.0.** This section and the firewall sections after it (protected
execution, guarded model calls and host management) cover APIs that are not in
0.1.3 or earlier. For a runnable example, see `examples/sdk/firewall.mjs`.

`shivax/security` and the root entry point export `createShivaxFirewall`. It puts
a managed boundary around the operations your trusted host registers. Jay still
handles authentication, and Vijay still handles authorization and approvals.
There is no global mode switch. Keep the returned `admin` object at your trusted
composition root. Bots get only narrow host tool clients. They never get the
admin object or a root context.

### Configuration

The configuration is required, and ShivAX checks it and keeps a copy. The first
mode must be `enforce`. A missing, malformed or permissive first configuration
throws. Every operation needs:

- an explicit allow rule that is not marked optional;
- its baseline Vijay policy;
- permission for every capability, provider and location, bot, file and network
  resource it declares.

An empty allowlist denies that resource.

### Modes

- `enforce`: applies every rule.
- `monitor`: only watches the rules marked `optional: true`, which are extra deny
  rules. It still enforces default deny, deny rules that are not optional,
  resource allowlists, authentication, tenant binding, approval, sandbox checks
  and hard budgets.
- `lockdown`: rejects model, workflow, bot, tool, file and network operations.
  CPU operations you allowed keep working, with the required checks. CPU
  operations must be read-only and declare no file or network resources. The
  existing CPU Tensor and NeuralNet APIs do not change.

### Admin capability

The host must set up the root capability policy and a policy for each operation
capability. The admin capability is separate. It must have a state-changing Vijay
policy, so admin changes need its permissions and a person's approval. The
`authorizeAdmin` callback is your own extra role check. ShivAX calls it before
approval and again before it commits the change. Calling it twice must give the
same result. It must not take roles from task or model data. Jay and Vijay must
come from the same module format, ESM or CommonJS.

Here is a sample CPU operation, using a Jay and Vijay you have already set up:

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

### Running operations

`runtime.execute` calls only a registered handler. A task cannot pass in code,
permission data, provider keys or a replacement callback.

Each registration's `check` is a required host function that must return at
once (no promises). It checks keys, sandbox rules and input and resource limits.
It must return the literal value `true` in every mode. It must not call its own
`context.checkExecution()`. Host handlers call that checkpoint after each `await`
and right before each further effect. The checkpoint checks the lease, policy,
identity, baseline authorization and the required `check` again.

### Tool and model operations

`tool` operations use the existing protected tool registry through Vijay.

`model` operations name one trusted provider, an output contract and a full
`ModelLimits` object. Each one has its own long-lived ModelRouter, so it keeps the
R01 exact cost math and the R02 usage checks.

- Each model attempt reserves cost from the shared firewall budget before it
  starts.
- This API has no hidden fallback. A hard model limit or unverifiable usage
  blocks further managed model calls across all operations.
- Policy changes and rollback never refund or reset reservations.
- If billing is unknown, the full ceiling stays reserved. A valid overrun is
  charged, including late responses after cancellation.
- Model failure reasons are kept as they are.
- Output that goes over a declared limit can only be caught after the provider has
  done the work. ShivAX trusts provider prices and declared ceilings.

### Files and network

File permissions match exact absolute paths, in the host's own form, using
forward slashes. There are no globs and no prefix grants. ShivAX rejects relative
paths, `.` and `..` segments, alternate stream syntax and other unclear forms.
The host must resolve symlinks, case and file system aliases, and bind the handler
to the real resources.

Network permissions match exact HTTP or HTTPS origins. Local and remote model
operations must declare at least one origin. Declaring an origin does not
intercept traffic. A trusted transport must enforce the real destinations,
redirects, DNS results and subresources, and keep keys inside its own closure.

### Changing and rolling back policy

`admin.replace(root, expectedVersion, policy)` and
`admin.rollback(root, expectedVersion, targetVersion)` check the expected version
first, and admin changes run one at a time.

- Rollback checks one of the last 32 policies held in memory again, then publishes
  it as a new, higher version.
- If an approved update turns out to be invalid, the firewall stops admitting
  work. To recover, an admin must replace or roll back the policy.
- An unapproved update leaves the current policy as it was.
- Updates revoke existing leases before they wait for a required audit
  acknowledgement. Late approvals cannot bring those leases back.
- Versions, history and budgets live in this one instance. Durable policy storage,
  protection against old policies coming back, and coordination across processes
  are the trusted host's job. This core does not provide them.

### Audit records

Audit records hold fixed reason codes, versions and registered operation IDs.
They leave out inputs, results, principal and session IDs, paths, URLs, keys and
raw exceptions. Use operation IDs that reveal nothing sensitive.

The in-memory log and the optional observer queue have a size cap.
`droppedAuditEvents` counts lost log entries and missed observer deliveries. When
`audit.required` is true, a host `auditSink` must acknowledge `true` before the
operation runs. A missing, failed or timed-out acknowledgement denies it. An
approved lockdown goes ahead even when the external audit sink is down, and the
firewall records the switch in its own log.

### Cancellation

Cancelling rejects the public operation at once and signals work that cooperates.
The runtime keeps the concurrency slot and any possible charges until the real
work finishes. `status().draining` tells you when such work is still running.
Cancellation cannot stop synchronous JavaScript or any remote request. It cannot
reverse a saved write or prove that provider billing stopped. Isolate work that
does not cooperate, and enforce network rules with a trusted host, OS firewall,
proxy or sandbox.

### What the core does not cover

With the default setup (the explicit runtime), other SDK instances need host
integration. Host operations must pass on the supplied signal and checkpoints,
and send nested effects through managed operations where needed.

The workflow `registerModel` path is still separate from this core's ModelRouter
path and keeps its own workflow budget. It now applies the same strict usage and
final-error rules (the R03 G02 fix). A library on npm cannot stop a malicious host
from going around its own code.

### Binding the firewall to protected execution

Set `protectExecution: true` in `createShivaxFirewall` before the Vijay instance
you pass admits any work. Pass that same Vijay to `RudraOrchestrator` or
`RudraWorkflowEngine`. For `createSpecialistSystem`, use the `security` instance it
returns, and attach the controller before the first run. The binding lasts as long
as that Vijay does. ShivAX rejects a late or second binding, so every active
protected authorization belongs to one controller. If you leave the option out,
you keep the explicit R04 runtime API.

Declare the operations and rules for each real path:

- A root task matches a `workflow` operation with its root capability.
- A bot attempt matches a `bot` operation with the chosen bot ID, capability and
  effect.
- A tool matches a `tool` operation with its capability, tool ID and effect. Set
  its `botId` to limit it to the bot that calls it. A tool operation without a bot
  ID can apply to a workflow or a bot, subject to its own Vijay grants.

A missing or unclear match denies admission. Explicit allows, and the policy's
capability and bot lists, still apply. Each boundary uses the registered metadata
and the required `check`. It then runs the work through the existing planner, bot
or tool code.

```ts
const { admin, runtime } = createShivaxFirewall({
  ...hostOptions,
  security: vijay,
  protectExecution: true,
});
const rudra = new RudraOrchestrator(registry, { security: vijay, planner });
const workflows = new RudraWorkflowEngine(toolRegistry, vijay);
```

RUDRA and workflows hold the root lease until the work they track finishes.
Paused and waiting runs get the revocation too. Vijay checks the real input,
security policy, operation and lease around approvals and each dispatch. Tool
handlers must call `context.checkExecution()` after async setup and right before
each later side effect. The signal covers both caller cancellation and firewall
revocation. Bot runs also keep their executor deadline. A saved tool context
expires when its call ends.

Concurrency and operation budgets count nested admissions. For example, one
workflow action can hold a root lease, a capability lease and a tool lease at the
same time. Size the limits for the parallel work you expect. Each retry gets fresh
authorization. Monitor mode only watches optional deny rules. It still enforces
Vijay, required rules, approvals and the controller's resource ceilings. An
operation already admitted through the explicit R04 runtime keeps its own
reservation.

The binding covers calls that go through this Vijay. Direct host I/O and raw
provider calls need their own managed boundary. The workflow model adapter keeps
its own workflow budget, with the R02 usage rules, not the firewall's shared
ledger. Admitting a protected tool does not add ModelRouter accounting to a raw
provider call.

### Guarded model and integration calls (R06)

In protected apps, use `createGuardedModelGateway` from `shivax/models`. Create
the firewall with the `model` operations your host picks, then bind a fixed,
ordered route. Each operation picks one provider, one model capability, an output
contract and model limits. The gateway takes the original Jay context. A copied
context, a prompt, model output or any other runtime object cannot create
authority.

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

The current firewall policy must allow the provider IDs, locations and network
origins. Remote routes also need `allowRemote: true`, which is false by default.
You can add `policy.providers.capabilities` entries in the form
`{ providerId, allow: ModelCapability[] }`. When that list exists, any provider and
capability pair it does not list is denied. R04 policies without the list keep
using the capability fixed in each model operation.

How attempts are handled:

- Every attempt uses the existing exact cost reservation and token accounting.
- All attempts share the controller's total ceilings, including routes that run
  at the same time.
- Confirmed invalid output and retryable provider failures may fall back to the
  next route.
- Hard limits, unverifiable usage, a denied transport, cancellation and timeouts
  end the route.
- A policy change ends an active route, including between attempts.
- One route deadline covers the whole sequence of attempts.
- An operation keeps its own model budget and busy state between calls.
- When billing is uncertain, the safe reservation stays until it is confirmed.
  Unsafe usage can block later model calls, as in R04.

The older `new ModelRouter(...)` and `createModelOperation(...)` APIs still work.
They do not check a Jay identity or pick up a firewall on their own. Build
protected apps with the guarded gateway, and keep the root context in trusted host
code. Bot payloads must never receive the admin controller or choose operations.

#### Remote models

For protected `RemoteModelAdapter` use, set a fixed HTTPS `endpoint` with no
credentials, query string or fragment in the URL. Its loader must return
`inferGuarded(request, policy)` as well as the older `infer` method. The guarded
method receives the exact approved endpoint, `redirect: 'error'` and
`checkDestination(url)`.

The host transport must:

- turn off redirects;
- check resolved addresses and proxy routing;
- protect keys;
- cap request and response sizes;
- pass on the signal;
- call the destination check right before I/O, and again after async setup.

Protected use rejects a transport that offers only the older method. Raw calls to
the older adapter keep their previous contract. Other host-supplied model
providers carry the same trusted transport duty, and they receive
`request.checkNetworkAccess`.

#### Ollama

Ollama keeps its loopback-only transport, cloud-alias checks, disabled redirects
and missing credentials. The firewall checks the registered origin again before it
reads model metadata and before it sends the chat request. If local models are not
allowed, the call is denied before anything loads or any transport runs.

#### Protected tools

Protected tools get live `checkNetworkAccess(url)` and
`checkFileAccess(path, 'read' | 'write')` functions. They check the active lease,
the current policy and that operation's registered resources. This works for both
explicit runtime calls and the R05-bound Vijay path. The functions expire when the
call ends. Host handlers must call them before each later I/O step.

#### Memory

Memory services keep the principal, issuer, tenant and session space taken from
the identity. Direct MemoryEngine calls that carry a protected tool signal also
enforce that signal's signed-in space and resource limits.

- Protected embeddings and custom storage must declare `networkOrigins`. An empty
  array is the trusted host's promise that the adapter does no network I/O.
  Leaving it out fails closed, but only in protected use.
- ShivAX checks destinations before each call. Embeddings receive
  `context.checkNetworkAccess`. Storage receives an optional fourth argument with
  that check, to use after waits and before transport. Both must honor the signal.
- Node file storage checks the real target file for reads. For writes, it needs
  write permission for both the target and its `.pending` sibling. After
  cancellation, it may still clean up a temp file the operation already created.
- Retention, approvals, namespace isolation and transaction checks at commit stay
  in place. Custom adapters and symlink or reparse-point resolution are still the
  trusted host's job.

#### Inspection and Inspectra

Inspection services authorize each page again after the previous capture. They
apply the host URL rule to every destination the provider checks. The optional
Inspectra adapter still loads `inspectra-engine/node` on first use. It stays an
optional peer at the tested version, 1.0.4.

In protected use, `openPage(request, context, security)` receives a fresh
`InspectraPageSecurity` contract. Before it navigates, the trusted host must:

- bind an isolated page or browser context to `security.owner`;
- intercept navigation, redirects and every subresource;
- call `security.checkDestination` for each destination;
- enforce DNS and IP, proxy, browser, time and resource limits;
- clean up anything it opened if the request fails.

After applying the contract, return that exact object as `lease.security`. A
missing or different object denies the capture and closes the lease. This
acknowledgement records a promise the trusted host makes. It does not prove that
the browser is isolated. The adapter enforces its node cap for extraction. It
checks permission again after loading and after opening the page. It closes leases
exactly once on failure or cancellation, even when a page opens late. Protected
screenshots also need write permission for the path the host picks. Unguarded page
leases from earlier versions keep their old shape.

#### Limits of these boundaries

These boundaries apply to SDK calls that cooperate. A library on npm cannot stop a
malicious host that runs arbitrary JavaScript from going around its code. DNS
rebinding, redirect control, file system aliases and full browser network
isolation need the trusted transport, the OS, a proxy or a sandbox. Cancellation
cannot undo saved effects or interrupt synchronous or uncooperative work. This
release adds no network or file system tool with open access.

### Authenticated host management (R07)

`openShivaxFirewallManagement` from `shivax/security` creates a management
controller for the host only. It first loads and checks a saved policy. It needs:

- the existing Jay and Vijay setup;
- a fixed catalog of approved policy profiles;
- transport authentication;
- admin checks for each action;
- a synchronous revocation fence;
- a trusted, exclusive persistent store.

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
authenticate and authorize every request.

- A change picks an approved profile ID. Raw client policies and extra override
  fields are rejected. Changes still need Vijay approval.
- Saves use compare-and-swap versions and one last authorization check.
- The runtime stays closed while the policy is saved. It checks authorization
  again before it publishes the new policy.
- A missing or invalid saved policy stops startup. A failed save stops admission.
  If a save acknowledgement is unclear, reload the real saved version. Do not
  assume it rolled back.

The store owns exclusive realm fencing, atomic saves of the policy and its journal,
and protected admin references. Public audit results leave out those references
and all identity data. The startup signal also controls how long the host lives.
`close()` revokes work and waits for pending saves before it releases ownership.
Policy versions survive a restart. Model billing counters stay in one process.

Keep the management controller at the trusted composition root. Never expose it
as a bot tool, treat a task payload as admin identity, or pass LLM output on as an
admin instruction. ShivAX supplies an adapter that works with any transport. Its
test suite also includes a file-backed test host. It does not ship production
HTTP or IPC routes, an admin identity provider or a production policy store. The
host must provide and secure those. The source repository report
`docs/audits/shivax-r07-management.md` (not in the npm package) covers the full
store contract, how crashes and revocation behave, and what a production setup
must still add.

## Migrating to 0.3.0 SARASWATI

SARASWATI - The Intelligence & Learning Release is unreleased. These notes
describe the development branch.

**Breaking change**

- The code bot is `vishwakarma`, not `vishwakarm`.
- `VishwakarmBot` remains a deprecated alias.
- Update firewall `bots` lists, permission policies and routing expectations that
  name the old id.

**Everything else is additive**

- No 0.2.0 export, signature or default behaviour changed.
- `EvaluatedModelUpdates`, `evaluateDataset`, `MemoryEngine.search` and RUDRA's
  deterministic routing behave as before.

**New exports in existing entry points**

| Entry | Additions |
| --- | --- |
| `shivax/learning` | Provenance and curation, benchmarks, model registry, routing advisor and policies, retrieval evaluation |
| `shivax/memory` | `MemoryRanker`, `createHashingEmbeddings`, `MEMORY_RANKING_LIMITS` |
| `shivax/rudra` | Types for the optional `routing` hook (`RudraRoutingHook`, `RoutingSelectionRequest`) |
| `shivax/learning/node` | **New entry point (Node.js only):** worker training. Browser bundles must not import it |
| `shivax` | Everything above except `shivax/learning/node` |

**Adopting the new features**

- Wrap existing v1 feedback explicitly with `createGovernedFeedback`. There is no
  automatic migration.
- Register your current model in a `createModelRegistry` store, then evaluate,
  approve and activate it. There is no shortcut that marks a model active.
- Start routing with an empty (deterministic) policy as the first active version,
  so a rollback target exists.
- Ranking, worker training and routing policies apply only where you opt in.
