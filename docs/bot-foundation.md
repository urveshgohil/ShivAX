# Phase 01 — Multi-bot foundation

SHIVAX provides portable bot contracts, explicit registration, typed lifecycle
events, host-created task contexts and execution of one caller-selected bot.
This phase adds no RUDRA, automatic routing, workflow planner, real specialist
or LLM dependency. Existing neural-network, MNIST, visual and SLM APIs retain
their behavior. All additions are exported from `shivax` in ESM/CJS/declarations.

## Contracts

| Contract | Purpose |
| --- | --- |
| `Bot<I, O>` | Trusted implementation with ID, capabilities, optional required tools, synchronous input/output type predicates and execute method |
| `BotInput<T>` | `{ capability, data }`, with finite plain JSON data |
| `BotResult<T>` | `{ botId, taskId }` plus completed/data or failed/cancelled/timed-out/error |
| `Capability` | ID and description; discovery does not choose a bot |
| `BotTask` | Version 1 request ID, input and optional JSON metadata |
| `TaskStatus` | Pending, running, completed, failed, cancelled or timed-out |
| `ToolDescriptor` | ID/description metadata; no executable tool |
| `SecurityContext` | Host caller ID/issuer, company/personal scope and tool-ID permissions |
| `TaskContext` | Task/session IDs, input/metadata/security snapshots, portable signal and execution limits |
| `BotContext` | Task context passed to execution, with a signal that includes caller cancellation and the deadline |
| Supporting types | `BotValue`, `BotSignal`, `CallerIdentity`, `ExecutionLimits`, `TaskContextOptions`, `BotErrorCode`, `BotErrorDetails`, `BotEventIdentity`, `BotEventMap`, `BotEventType`, `BotEventListener` |

`Task` already means the neural-network task union (`binary`, `multiclass`,
`regression`). It is preserved; use **`BotTask`** for the new contract. Public
declarations still work with ES2020 alone and no DOM/Node ambient types. Native
AbortSignal satisfies `BotSignal`, which reuses the existing structural signal
contract.

## Registry and events

`new BotRegistry(events?)` exposes `register`, `unregister`, `get`, `list`,
`findByCapability` and `listCapabilities`. Duplicate bot IDs and malformed
descriptors throw `BotError`. Capability IDs must be unique within a bot.
Different bots may support the same capability: discovery returns all matches
in registration order. The first registered description represents a shared
capability in the deduplicated capability list.

Registration snapshots/freezes descriptors and binds methods to their original
owner. `get` returns a stable registered snapshot; lists are immutable defensive
arrays. Original descriptor mutation cannot corrupt discovery. Implementation
state remains owned by its creator. Unregister removes discovery only; it does
not cancel work already started by a separate executor. Registration never
invokes bot validators or execution.

`BotEventEmitter` supports typed `on`, `off`, `emit` and `clear`. `on` returns an
idempotent unsubscribe function. Registry/executor instances can share an emitter;
otherwise observers are instance-local. Events are:

- `bot:registered`, `bot:unregistered`: bot ID.
- `bot:started`, `bot:completed`: bot/task/session IDs.
- `bot:failed`, `bot:cancelled`, `bot:timed-out`: those IDs and a fixed error.

Event envelopes are validated/frozen; terminal status and error codes must agree.
They exclude task payloads, identity claims
and raw exceptions. Observers run in subscription order over a subscriber
snapshot. Async observers are not awaited. Failures go to the optional callback
`new BotEventEmitter((error, type) => { ... })`, without affecting execution.
Absent a callback, observer errors are discarded; callback failures are isolated
too. Raw errors reach only that explicit trusted callback, not implicit logs or
task events/results. Public `emit` is for trusted application use and is not
proof that an execution ran.

## Context and trust boundary

`createTaskContext(task, options)` accepts serializable task
`{ version?: 1, id, input, metadata? }` separately from host options
`{ sessionId, security, signal, limits? }`. Task-supplied security/limits are
rejected. Input, metadata, identity and permissions are deeply copied/frozen;
the live signal is retained. Omitted version defaults to 1; contexts always
carry version 1 and unsupported request versions are rejected.

**This phase does not verify identities or implement Jaya/Vijaya.** Caller ID,
issuer and permissions are trusted host assertions. Never derive them from an
unverified request body, model output or browser UI state. The Node/server or
desktop host must authenticate and authorize access to protected resources.
Browser-only instances enforce local application conventions; they cannot grant
authority over a remote runner or storage.

The executor checks that every `requiredTools` ID appears in the host's
`security.toolPermissions`. This is a deterministic precondition, not a tool
executor or resource-aware authorization system. No tool implementations are
injected or called here. Task metadata grants no permissions.

| Execution limit | Default | Accepted integer range |
| --- | --- | --- |
| `timeoutMs` | 30,000 | 1–300,000 |
| `maxInputBytes` | 65,536 | 1–1,048,576 |
| `maxOutputBytes` | 65,536 | 1–1,048,576 |

`DEFAULT_EXECUTION_LIMITS` is frozen. Input budgets include the capability/data
envelope; output budgets include the bot-produced result envelope. Fixed
framework failure envelopes are bounded independently, so tiny allowances can
still report errors. Omitted or explicitly undefined optional limit fields use
defaults; null and other invalid values are rejected. Metadata has a 16,384-byte cap. Traversal rejects depth
over 32 and more than 10,000 visited values; final JSON size uses UTF-8 bytes.
Undefined, nonfinite numbers, functions, symbols, cycles, sparse arrays,
nonplain objects, non-enumerable object fields and accessors are rejected.
Prototype-like keys stay own data
properties. Hostile JavaScript Proxies and arbitrary implementation code are
outside this validation boundary.

## One-bot execution and errors

`new BotExecutor(events?).execute(bot, taskContext)` executes only the supplied
bot. It never consults the registry, chooses a bot, queues, retries or delegates.
The busy guard is per executor and supplied bot object. Use one executor and
stable bot objects for an owned lifecycle; this is not a global scheduler or
isolation across executors/re-registered snapshots.

The executor validates descriptor/context, capability, required permissions and
the input predicate before starting. Predicates must synchronously return
exactly `true`; exceptions, truthy objects and promises fail closed. Accidental
promise rejections are observed. Completed results must match task/bot IDs,
fit the JSON budget, satisfy the result union and pass the output predicate.
Failure envelopes must use a canonical `BotError` code/message and consistent
cancellation/timeout status.

Malformed descriptors/host contexts reject the execute promise before lifecycle
dispatch. Valid execution attempts return frozen `BotResult`s, including
input/permission/capability failures. Recognized thrown `BotError` codes propagate
as fixed errors; ordinary exceptions become `bot-error`. `validateBotInput` and
`validateBotResult` are structural assertion helpers; bot predicates validate
semantics. Its busy reservation is acquired before trusted callbacks, including
input validation, so reentrant calls cannot execute the same bot concurrently
or release another operation's reservation. Admission failures release their
own reservation; started work retains ownership until it settles.

Pre-cancellation invokes neither predicates nor execution. Cancellation/deadline
aborts the signal passed to the bot, returns one terminal result, and prevents
late success/output validation. Elapsed-time checks use the monotonic performance
clock when available, so wall-clock adjustments do not alter execution deadlines
on supported Node/browser hosts (Date.now is the fallback for other hosts).
A bot ignoring cancellation retains its busy
slot until underlying work settles. A timeout cannot preempt blocking JavaScript:
synchronous work must yield before the caller observes cancellation. Workers/
processes remain the future isolation mechanism. Timers/listeners are cleaned
after the caller stops waiting; late promise rejections remain observed.

The foundation performs no filesystem/network I/O and supplies no such tools.
Injected code is trusted and may have its own effects; this is not a JavaScript
sandbox. Mutating adapters, outcome reconciliation/idempotency, multi-specialist
workflows and authoritative authentication/authorization require future phases.

## Two explicit mock bots

`tests/fixtures/mock-bots.mjs` contains `createEchoBot` (uppercase text) and
`createSumBot` (sum finite numbers). They are test doubles, make no AI claims,
and are excluded from the npm package. After building, run
`node --test tests/agents.test.mjs`.

Repository-only example, with imports relative to the repository root:

```js
import { BotRegistry, BotExecutor, createTaskContext } from 'shivax';
import { createEchoBot } from './tests/fixtures/mock-bots.mjs';

const registry = new BotRegistry();
registry.register(createEchoBot());
const selected = registry.findByCapability('mock.echo')[0]; // Caller selects.
const controller = new AbortController();
const context = createTaskContext({
    id: 'demo-task', input: { capability: 'mock.echo', data: 'hello' },
}, {
    sessionId: 'demo-session', signal: controller.signal,
    security: {
        caller: { id: 'local-demo-user', issuer: 'local-demo-host' },
        scope: { kind: 'personal', id: 'local-demo' }, toolPermissions: [],
    },
});
const result = await new BotExecutor(registry.events).execute(selected, context);
// The mock computes 'HELLO'; this is a fixture computation.
```

## Changed files and verification

- `src/agents/types.ts`, `errors.ts`, `validation.ts`, `context.ts`, `events.ts`,
  `registry.ts`, `execute.ts`, `index.ts`: new modules.
- `src/index.ts`: additive root exports.
- `tests/agents.test.mjs`, `tests/fixtures/mock-bots.mjs`: regressions/test doubles.
- `tests/package.test.mjs`: ES2020-only generic bot, typed-event, readonly-context
  and legacy `Task` consumer checks.
- `tests/fixtures/legacy-api.mjs`: pinned pre-foundation public API names, checked
  in both formats and by the declaration consumer. Package tests also run core
  ML with optional provider/browser globals unavailable in an isolated process.
- `docs/bot-foundation.md`, `docs/SHIVAX_ARCHITECTURE.md`, `docs/SHIVAX_PHASES.md`:
  API guide, inventory and phase status.

Verification uses installed tools because the earlier global pnpm wrapper had a
store permissions error:

```text
node scripts/clean.mjs
node node_modules/typescript/bin/tsc
node node_modules/rollup/dist/bin/rollup -c rollup.config.mjs
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
```

See [Phase 01 status](SHIVAX_PHASES.md#phase-01--multi-bot-foundation) for final
results and the [implementation review](bot-foundation-review.md) for reproduced
defects and fixes. No dependencies, manifests, neural-network/digit source or datasets
change. No browser matrix, live model, worker sandbox, RUDRA, publication or
production deployment is included. Stop after Phase 01.
