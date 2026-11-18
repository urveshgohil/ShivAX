# SHIVAX 0.4.0 HANUMAN H05-B implementation gate

18 November 2026, Asia/Calcutta. Inspected HEAD `272108c` on `feat/hanuman-v0.4.0`. Package version is `0.3.3`.

**PENDING OWNER DECISION. H05-B implementation remains incomplete.**

The supplied H05-A contract requires an owner decision before implementation. Section 0 says “H05-B (implementation) should not start until the owner either waives or closes the H03 and H04 NO-GO items”. Section 8 repeats “Before starting, confirm the owner's decision on the H03 and H04 NO-GO items”. An asynchronous request for that decision was sent during this task. A separate question asks about the optional cost-admission extraction required for estimates. At the time of this report, both answers are pending.

The current H03 review records H03C-01 and H01D-02 as P1 findings, with H03C-03/04 P2 findings. The H04 summary and review retain H04C-01 P1 and H04B-01/02 P2 findings. HEAD matches the H05 contract baseline. These findings have an explicit implementation-gate consequence in the supplied contract, even though the proposed H05 utilities are read-only.

## Existing APIs inspected

| Area | Current API and implementation consequence |
| --- | --- |
| Bot discovery | `BotRegistry.listCapabilities()` deduplicates by registration order. `list()` retains the bot association needed to derive capability-scoped tools and match deterministic routing. The registry has no tenant tag. The host must provide a registry set scoped to the utility's realm. |
| Protected tools | `ProtectedToolRegistry` supports registration, lookup and removal. It has no enumeration API. Candidate tools must come from registered bot declarations or workflow bindings. |
| Workflow tools | `ToolRegistry.list()` and `findByCapability()` expose host bindings. Reports must project allowed metadata and validate binding identity. |
| Identity | Jay stores authority against the exact minted context. `verify()` checks provider session validity asynchronously, and `assertActive()` checks the retained identity and expiry synchronously. |
| Permissions | Vijay owns the policies and tools privately. Its `#assert` checks current policy identity, permission inclusion and the input predicate. A reporting entitlement reader must share the existing permission computation and avoid invoking candidate input predicates. |
| Utility admission | `Vijay.protectTask()` admits the utility's registered root capability and retains a firewall lease when bound. The utility closes this lease after synchronous reads. Without a firewall, the utility still needs a final active-identity and realm check. |
| Firewall | Protected operation matching and `evaluate()` determine admission. Runtime status returns Number projections of cost, while the authoritative retained cost is a private bigint. A bound utility call consumes one firewall operation and requires a matching host workflow descriptor. |
| Model router | Private fields hold effective limits, retained calls/tokens/exact cost, active ownership, blocked state and scope. `budgetUsage` exposes display projections. Only an additive internal reader can supply exact reporting. |
| Cost precision | `src/intelligence/cost.ts` uses bigint units of 10^-324 USD. `costUnits()` parses decimal values and `costUSD()` is the presentation projection. Router admission also uses `reservationUSD()` to fund the provider's Number cap. |
| Workflow budgets | Limits come from `settings()`. Closure counters reserve before approval/invocation and retain reservations. Monetary limits and reservations use safe-integer nanodollars, with existing conservative rounding. Public snapshots expose Number display values. |
| Diagnostics and exports | `toSDKDiagnostic()` already sanitizes security errors. Root and `shivax/security` re-export `src/security/index.ts`. The contract places the factories on those existing entrypoints. |
| Bundling | Rollup uses shared chunks to preserve class identity across ESM entrypoints and across CJS entrypoints. ESM/CJS object mixing requires explicit reader provenance rejection as specified in the contract. |

## Initial change plan

The following is the implementation plan after the pending owner decision.

| Paths | Planned change |
| --- | --- |
| `src/security/vijay.ts` | Extract its permission-subset computation without changing enforcement semantics. Register an internal view of active identity, projected policies, entitlement and tool registration. |
| `src/security/firewall/binding.ts`, `runtime.ts` | Share operation matching between enforcement and a read-only reader. Associate the reader with the enforcing Vijay. Expose fresh exact accounting internally. |
| `src/intelligence/router.ts` | Register an internal reader over existing private limits, retained reservations, scope and lifecycle state. |
| `src/workflows/engine.ts` | Register an internal reader for SDK-created workflow handles over existing closure counters and configuration. |
| `src/security/jambavan.ts` | Implement `createJambavanDiscovery()` with closed configuration/request schemas, realm checks, authorized metadata filtering and bounded frozen results. |
| `src/security/kubera.ts` | Implement `createKuberaReporter()` with exact decimal serialization, source ownership checks, authorized source projections and explicit data availability semantics. |
| `src/security/index.ts` | Export the two factories and approved public interfaces. Keep internal readers outside public entrypoints. |
| Offline examples and focused tests | Exercise visibility, denied contexts/tools, zero execution during discovery, exact costs, pending reservations, missing providers, ownership and ESM/CJS exports. |
| Package verification script | Include the new offline examples and declarations in packed-consumer validation as appropriate. |

The optional admission-cost extraction has its own approval requirement in H05-A sections 4.1 and 8. Without approval, estimates will be omitted and their unavailability documented. The implementation must reuse approved admission arithmetic before exposing projections.

## Regression risks and security boundaries

- Metadata visibility requires current Jay identity, effective Vijay permissions, the configured realm and the bound firewall. Hidden capabilities and unknown IDs must be indistinguishable. A partial required-tool list could reveal restricted registrations.
- Helpers extracted from Vijay or firewall matching can alter authorization unintentionally. Existing security/firewall tests must pass unchanged, with new entitlement tests covering equivalent decisions.
- Registry membership alone cannot establish execution availability. Reports remain point-in-time advisory metadata and execution must pass its normal authorization path.
- Router, firewall and workflow accounting may overlap. Each section must preserve its source units and retained-reservation semantics. Cross-source totals would misrepresent accounting.
- The sources retain reservation ceilings across completed, failed and cancelled work. Actual provider invoices and itemized outstanding reservation amounts are unavailable. Reports must identify those limitations.
- Cost subtraction and comparison must use canonical integers. The existing three-ten-cent-calls-within-thirty-cents regression must retain its behavior.
- Source scope and workflow ownership must be checked before disclosure. Host labels minimize exposure of provider, principal, task and session identifiers.
- Source reads can be synchronous within an event-loop turn. Cross-source atomicity and consistency with external billing remain unavailable.
- No capability predicate, bot, tool or provider should execute as a discovery side effect. Root utility admission still runs its own registered policy checks.

## Actual baseline validation

Validation used the installed dependency layout with process-local `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false`, `PNPM_CONFIG_OFFLINE=true`, `PNPM_CONFIG_NODE_LINKER=hoisted` and `PNPM_CONFIG_PACKAGE_IMPORT_METHOD=copy`.

| Command | Exit | Actual result | Local log |
| --- | --- | --- | --- |
| `pnpm lint` | 0 | PASS TypeScript and ESLint | `node_modules/h05b-lint.log` |
| `pnpm test` | 0 | 1,429 tests, **1,417 pass, 0 fail, 12 TODO**, 0 cancelled/skipped | `node_modules/h05b-test.log` |
| `pnpm build` | 0 | PASS ESM/CJS, declarations and worker build | `node_modules/h05b-build.log` |
| `pnpm verify:package` | 0 | PASS 13 declaration entries in five TS modes, packed ESM/CJS imports, 182 protected-fetch tests, 88 Hanuman bot tests, browser graphs, 12 offline examples, worker training, 544 packaged files | `node_modules/h05b-package.log` |
| Focused command below | 0 | **430 pass, 0 fail/TODO/skipped/cancelled** | `node_modules/h05b-focused.log` |

```powershell
node --test tests/agents.test.mjs tests/security.test.mjs tests/firewall.test.mjs tests/firewall-integration.test.mjs tests/firewall-management.test.mjs tests/firewall-model-integration.test.mjs tests/model-cost.test.mjs tests/model-safety.test.mjs tests/workflows.test.mjs tests/sdk.test.mjs tests/package.test.mjs
```

These runs overlap. Counts represent each command independently. The 12 existing TODO cases remain visible in the full-suite result.

## Deliverable status and changed paths

Baseline validation is **PASS**. The H05-B implementation gate is **PENDING / INCOMPLETE** while the required owner decision is outstanding. Jambavan/Kubera APIs, examples and new tests are pending implementation.

This pass added `docs/audits/hanuman-h05-implementation.md`. The pre-existing untracked `docs/audits/hanuman-h05-contract.md` was preserved. Validation regenerated build artifacts and wrote ignored logs under `node_modules/`.

The implementation must resume with the recorded owner decision. H05-C requires a separate instruction after H05-B completion.
