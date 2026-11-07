# R07 — Firewall management host adapter

Date: 2026-11-06. Scope: ShivAX 0.1.3 and read-only inspection of the adjacent VISYNQ hosts. No package version change or publication.

## Host inspection

The current workspace is `D:/Project/packages/shivax`. The adjacent
`D:/Project/packages/VISYNQ` and `D:/Project/packages/visynq-workstation`
applications both contain React/Vite workstations and Node local runner scripts.
VISYNQ also contains an Electron main process and preload.

Inspected the two package manifests, their `scripts/local-runner.mjs`,
VISYNQ's `scripts/settings-channel.mjs` and `electron/main.cjs`, the source
file inventory, and ShivAX's existing firewall implementation. No applicable
AGENTS.md was found in these inspected roots or the workspace ancestors.

The existing settings channel is a loopback HTTP service. It checks host/origin,
manages the Inspectra runner token and accepts host Figma configuration. Those
checks do not establish a named application administrator or an action-specific
administrator role. Neither host manifest depends on ShivAX. No ShivAX firewall
composition root, persistent firewall policy store or authenticated firewall
management backend was found.

R07 therefore adds a documented transport-neutral adapter and persistent test
host in ShivAX. It does not add production routes, invent a backend framework,
reuse the runner token as administrator authority, or modify either host project.
Production VISYNQ wiring needs its own trusted administrator identity provider
and persistent store implementation.

## Public contract

Exported through `shivax/security` and the existing root entrypoint:

- `openShivaxFirewallManagement<Request>(options, startupSignal)`
- `FirewallManagementOptions<Request>`, `ManagedShivaxFirewall<Request>`
- `FirewallManagement<Request>`, `FirewallManagementAction`
- `FirewallPolicyProfile`, `FirewallChangeRequest`, `FirewallLockdownRequest`
- `FirewallPolicyStore`, `FirewallPolicyLease`, `FirewallStoredPolicy`
- `FirewallAuthorizationRecord`

The factory returns `runtime`, the host-only `management` controller and an
idempotent `close()`. It never returns the raw firewall admin controller.
The supplied startup signal also controls the host lifetime. Aborting it closes
admission and cancels active managed operations. Call `close()` to release
storage ownership after pending writes settle.

| Management operation | Client-controlled input | Required authorization |
| --- | --- | --- |
| `readPolicy` | Transport request and cancellation signal | Fresh host authentication, Jay identity and admin role; returns policy/version/admission |
| `readConfiguration` | Transport request and signal | Same checks plus action permission; returns immutable approved profiles |
| `requestChange` | Exact `{ expectedVersion, profileId }` | Admin role, action permission, Vijay authorization, required human approval, final revocation fence |
| `lockdown` | Exact `{ expectedVersion }` | Same mutation requirements |
| `readAudit` | Transport request and signal | Fresh admin/action permission; returns sanitized history and runtime events |

`authenticate` must verify the transport/session and return an original root
minted by the configured Jay. It must not turn ordinary task fields into identity.
`authorize` performs a fresh action-specific check and returns an opaque audit
reference from trusted host state. `checkAuthorization` is a synchronous
revocation fence over that verified host authorization. Its implementation must
track current role/session revocation, never trust client role claims, and return
literal true only while authorization remains valid.

Existing `firewall.authorizeAdmin`, Jay checks and Vijay approval remain
mandatory. Checks run again after asynchronous work and immediately before
durable commit and policy publication. Management calls have a bounded timeout
(default 5 seconds). Cancellation does not free ownership of a writer still
performing storage work.

The profile catalog is selected and validated by trusted host code before
startup. Each profile contains a complete firewall policy. Requests cannot supply
raw policies, modes, provider lists, permissions, credentials, storage paths or
identity information as policy overrides. Unknown fields, unknown profile IDs,
accessors and malformed versions are rejected. Rejected client commands do not
fence a healthy runtime, preventing an unauthenticated payload from using policy
validation as a shutdown mechanism.

A bot or LLM output cannot authorize a management request. Keep the management
object, transport authentication adapter and profile catalog outside bot/tool
contexts. A host must never forward generated text as authenticated admin intent.

## Persistence and failure behavior

The trusted store is configured at host startup for one realm. It supplies an
exclusive lifetime lease, durable load, compare-and-swap commit and release.
Other processes must not serve the realm using stale policies while this owner
is active. A production implementation needs cross-process fencing and a
revocation notification that aborts the supplied host lifetime signal on ownership
loss. The SDK checks ownership at management calls and runtime checkpoints.

The persistent envelope has a fixed format/schema version, realm, monotonic
policy version, approved profile ID, validated policy and bounded recent
authorization history. Initial provisioning is a trusted deployment operation,
not a management endpoint. Version 1 starts in enforce mode. Missing storage,
parse failures, invalid policies, foreign realms, unknown profiles, profile drift,
invalid history or failed ownership acquisition prevent runtime creation.
There is no fallback policy, silent default write or automatic reset.

Restarts restore the saved policy and version, including monitor and lockdown.
The saved policy must equal an approved profile, or its lockdown form.
Changing the approved catalog may require a trusted migration of saved state.
With `protectExecution: true`, each new host lifetime needs a fresh Vijay instance,
matching R05's one-way binding. A real process restart naturally constructs one.
Historical core rollback handles remain private; clients choose an approved
profile with a new version rather than decreasing the version counter.

During changes, the core fences admission and revokes active work before
persistence. The store atomically CASes the old version and records the new policy
with its protected authorization entry. It must call the supplied check after
asynchronous preparation and immediately before the durable commit. The SDK
rechecks ownership and authorization after storage and immediately before
publishing the effective policy. CAS conflicts, persistence errors or failures
after fencing leave the manager closed. Recovery requires a fresh validated
startup, not an automatic return to the previous permissive policy.

A durable commit may succeed even if acknowledgement fails or authorization is
revoked just before in-memory publication. The old process stays closed and
reports failure. On restart, the host loads the actual committed version.
Clients must re-read the version instead of assuming a failed response means
nothing was written. Authorization must have been valid at the durable commit
point. This is tested explicitly.

An exclusive lease is retained through timed-out or non-cooperative storage
work. `close()` may wait for that work indefinitely. A production store must
provide bounded operations and fencing that prevents an obsolete writer from
committing after ownership transfer. The SDK cannot manufacture atomicity,
fsync guarantees, anti-rollback storage or distributed consensus.

Policy persistence does not persist model billing ledgers or runtime operation
counters. Those R04/R06 counters remain process-local. Hosts needing budgets
across restart must supply a durable budget authority separately.

## Audit and secret handling

Each committed change records a host-issued opaque `actorRef`, action and
policy version. The store must append the protected journal atomically with the
policy. Only the last 256 entries travel in the policy envelope; the host owns
full journal retention and the protected mapping from opaque reference to
administrator identity.

`readAudit` projects only change version/action plus the existing sanitized core
events. Neither it nor runtime events exposes actor references, principal IDs,
sessions, credentials, identity-provider data or raw exceptions. Policy/profile
responses include only schema-validated policy fields and approved profile IDs.
Keep configuration identifiers free of secrets. Runtime and management handles
are host composition objects, not objects to serialize to bots.

The test store uses a private temporary directory, an exclusive lock file and
0600 files. Its policy and protected journal are replaced together. It is a
persistent test fixture, not a production storage recommendation. Production
storage must also enforce ACLs, durable ownership, atomic commit, crash recovery,
retention and tamper/rollback protection.

## Integration files

| File | Change |
| --- | --- |
| `src/security/firewall/management.ts` | Typed management/store contracts, authentication, approved profiles, validated startup, durable publication and audit projection |
| `src/security/firewall/runtime.ts` | Internal lifecycle hooks for validated restore, fenced persistence, final authorization recheck and host shutdown |
| `src/security/index.ts` | Additive public exports |
| `tests/fixtures/firewall-management-host.mjs` | Persistent file-backed test host with exclusive ownership and injected failure points |
| `tests/firewall-management.test.mjs` | ESM/CJS authorization, concurrency, persistence, restart, lockdown and adversarial coverage |
| `scripts/check-sdk-package.mjs` | Packaged declaration checks for management and rejection of raw policy overrides |
| `docs/sdk.md` | Host integration entrypoint and obligations |

The ordinary `createShivaxFirewall` API still starts at version 1 in enforce mode.
Internal restore/persistence hooks are not exported from SDK entrypoints.
Existing SDK exports, runtime functionality, ML, bots, Inspectra optionality and
package version are preserved.

## Verification

Executed on Node 22.23.2:

- `pnpm lint`: passed.
- `pnpm test`: 774 passed, 0 failed, 0 skipped, including 40 R07 tests.
- `pnpm build`: passed; also rebuilt by the full test command.
- `pnpm verify:package`: passed; all 12 packaged ESM/CJS entrypoints and five TypeScript declaration modes, 442 files.

Tests cover approved changes, every unauthorized management action, LLM/task
payload rejection, invalid commands and stored policies, stale/concurrent
versions, actual disk persistence/reopen, lockdown restart, approval denial,
revocation during persistence, CAS conflicts, ownership loss, command mutation,
timeouts with late writers, startup cancellation, ambiguous acknowledgement,
authorization after storage and audit redaction.

## Remaining production work and trust boundary

VISYNQ needs a host identity/session-to-Jay adapter, action-specific administrator
roles, a maintained synchronous authorization/revocation fence, approved policy
profiles, a durable fenced store and an authenticated transport binding.
The existing origin/token settings channel is not that binding. Production
HTTP/IPC handlers must restrict the allowed administrative operations, validate
request shape, and apply their transport/session protections before calling
this adapter.

Malicious host JavaScript, an administrator editing protected storage directly,
OS-level compromise and non-cooperative external I/O remain outside SDK
enforcement. No production management endpoint was deployed. Stop after R07.
