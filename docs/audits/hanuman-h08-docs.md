# H08-B HANUMAN documentation, release metadata and examples

19 November 2026, Asia/Calcutta. Base commit `1a02713`. Package is still `shivax@0.3.3`. Windows, Node v22.23.2, pnpm 12.8.1, npm 10.9.8.

**H08-B documentation gate: PASS** for the scope below, with the remaining inaccuracies in §9. Two requested examples (Jambavan and Kubera) are marked missing, because those features are not implemented in the SDK. Documentation, one `package.json` description, and prose only changed. No source, test, script, export, signature or version changed, and nothing was published, tagged or pushed.

## How the audit was done

Before editing, the following were read:
- the H08-A report;
- the H01–H07 phase reports;
- `package.json`, `README.md`, `SECURITY.md`, `CHANGELOG.md`, `docs/production.md`, `docs/sdk.md`;
- `examples/sdk/` and its README;
- the actual sources: `src/sdk/*`, `src/bots/`, `src/integrations/hanuman/`, `src/workflows/safety/`, `src/security/`.

Every identifier, import, example path and behavior documented below was checked against the built package. There is no `src/diagnostics/` directory. Diagnostics live in `src/sdk/diagnostics.ts`.

The audit found these problems (Step 1):

| Problem | Where | Fix |
| --- | --- | --- |
| Stale version labels: "0.3.2" as the current version | README, SDK guide, production guide, SECURITY.md | Now "0.3.3" (package), with HANUMAN labeled as upcoming 0.4.0 |
| Stale description "Narasimha Release" | `package.json` | Replaced |
| No mention of Hanuman, Abhimanyu, Ashwatthama, Jambavan, Kubera or Shabari in the README, production guide or SECURITY.md | README, production guide, SECURITY.md | Added; the SDK guide already covered Hanuman (H01–H06) |
| "`HANUMAN_BOT_ID` is only a reserved identifier" | SDK guide | Reworded. The ID is that of the implemented optional bot |
| Entry-point tables said `shivax/bots` holds "the seven bots" and `shivax/integrations` holds only UI inspection | README, SDK guide, production guide | Added the opt-in Hanuman exports and the Abhimanyu/Ashwatthama exports in `shivax/rudra` |
| No statement that Inspectra and Visynq are optional in the README top matter | README | Added in the intro, the FAQ and the install notes |
| No single place separating SDK controls from host-required controls | Production guide | Added the "Who provides which control" table |
| Trusted-host responsibilities, credential handling and known security limits only in phase-labeled paragraphs | SECURITY.md | Added summary sections |
| No documentation of error and cancellation handling, or of workflow warning checks | SDK guide | Added tested sections |
| Missing examples: Jambavan, Kubera, warning checks | examples README, SDK guide | Marked missing, or a verified snippet (§5) |

## 1. Documents updated

| Path | Change |
| --- | --- |
| `package.json` | `description` only |
| `README.md` | Rewritten top and middle. Added identity, "what ShivAX is and is not", an architecture diagram, a HANUMAN section, bot table with IDs, utilities table, an optional Hanuman section, updated entry-point table and FAQ. The 0.3.0 SARASWATI and 0.2.0 NARASIMHA sections are byte-identical to before (checked against `HEAD`) |
| `SECURITY.md` | Supported-versions note, reporting guidance about synthetic data, intro line about host transports, and new sections: HANUMAN threat boundaries, trusted host responsibilities, untrusted external content, credential handling, known security limitations. Existing sections untouched |
| `docs/production.md` | Version and status, Hanuman and utilities paragraph under the bots section, a "Protected external retrieval (HANUMAN)" section, a "Who provides which control" table covering 12 areas, import-table rows, and three limitations |
| `docs/sdk.md` | Version intro, import-table rows, "Installation requirements", an example-coverage table, a "Workflow warning checks (HANUMAN)" section with a tested snippet, "Read-only utilities and the test harness", "Errors and cancellation" with a tested snippet, and the stale `HANUMAN_BOT_ID` sentence |
| `examples/sdk/README.md` | One paragraph stating which examples do not exist |
| `CHANGELOG.md` | New `v0.4.0 HANUMAN` section and a release-line table row. Entries for 0.3.2 and earlier are byte-identical (checked) |

## 2. Release identity

- **Name:** SHIVAX v0.4.0 - HANUMAN, *The Action & Automation Release*. It is used in the README, the CHANGELOG section title and the production guide.
- **Status wording:** "in preparation", "upcoming and not published". The CHANGELOG section is labeled `[0.4.0]`.
- **`package.json.description`:** `ShivAX AI v0.4.0 HANUMAN: CPU neural networks, multi-agent orchestration, Jay/Vijay authorization, a NARASIMHA firewall and opt-in protected external retrieval for trusted hosts`
- **`package.json.version`:** unchanged (0.3.3). No release decision was made. `dist-tags`, tags and the registry were not touched.

## 3. Bot name and role mapping

IDs were read from the running registry (`createSpecialistBots().map(b => b.id)`).

| Bot | Exact ID | Role documented |
| --- | --- | --- |
| Sanjay | `sanjay` | Vision and observation |
| Brihaspati | `brihaspati` | Reasoning and planning |
| Vishwakarma | `vishwakarma` | Code analysis and development help |
| Chitragupt | `chitragupt` | Scoped memory management |
| Narad | `narad` | Inspection and comparison |
| Yudhishthir | `yudhishthir` | Review and evaluation |
| Ekalavy | `ekalavy` | Feedback and learning |
| Hanuman (optional) | `hanuman` | Approved external evidence retrieval (`fetch.url`). Not in `createSpecialistBots()` |

**Aliases that actually exist:** the deprecated class name `VishwakarmBot`, which equals `VishwakarmaBot` and reports the ID `vishwakarma`. The pre-0.3.0 ID `vishwakarm` is documented as replaced. The spelling "Ekalavya" appears in some existing prose, and the README says so. No ID was renamed.

## 4. Utility and check distinction

The README, production guide and SDK guide state that none of these is a registered specialist bot:

| Name | Documented as | Status stated |
| --- | --- | --- |
| Jambavan | Authorized capability discovery | **Not implemented**; no public API |
| Kubera | Read-only budget reporting | **Not implemented**; no public API |
| Abhimanyu | Workflow preflight warning checks | Implemented (`runAbhimanyuPreflight`, engine option `preflight`) |
| Ashwatthama | Runtime lifecycle warning checks | Implemented (`createAshwatthamaObserver`, engine option `lifecycle`) |
| Shabari | Pre-release canary test harness | Test tooling in the repository only; not exported or packaged |

The validator also asserts that `createJambavanDiscovery` and `createKuberaReporter` do **not** exist in any export, so the docs cannot silently become false.

## 5. Examples verified

All commands ran from the repository root against the fresh build and exited 0.

| Requested example | Documented as | Evidence |
| --- | --- | --- |
| 1. Approved documentation retrieval | `examples/sdk/hanuman/documentation.mjs` | Exit 0; prints evidence with `trust: 'untrusted'` |
| 2. Approved bounded REST GET | `examples/sdk/hanuman/rest.mjs` (through `fetch.url`) | Exit 0; prints `{"status":"ok","version":1,…}` |
| 3. RUDRA + Hanuman evidence workflow | `examples/sdk/hanuman/workflow.mjs` | Exit 0; two steps, `requests: 2` |
| 4. Unauthorized destination denial | `denials.mjs`, case `deniedOrigin` | Exit 0; `requests: 0` |
| 5. Firewall lockdown | `denials.mjs`, case `lockdown`; `examples/sdk/firewall.mjs` | Exit 0 both |
| 6. Timeout and cancellation | `denials.mjs`, cases `timeout` and `cancel` | Exit 0; `cancel` returns `cancelled` |
| 7. Jambavan discovery | **Missing** (feature not implemented) | Marked missing |
| 8. Kubera budget reporting | **Missing** (feature not implemented) | Marked missing |

Also run: `examples/sdk/hanuman.mjs` and `examples/sdk/registry.mjs` (both exit 0). `pnpm verify:package` ran 12 offline SDK examples, the 4 H06 examples and the 13 H06 integration tests from an installed tarball.

New code in the docs was executed rather than only read:
- the Abhimanyu/Ashwatthama snippet (extracted verbatim from `docs/sdk.md` and run through the package self-reference with the documented `shivax/rudra` import): `allow [ 'ABH_NO_EXIT_PATH' ]` and `[ 'ASH_DEADLINE_EXCEEDED' ]`;
- the cancellation behavior: aborting a pending run gave `cancelled` with 0 transport requests, and an already aborted signal made `createContext` throw an error that `toSDKDiagnostic` maps to `{ code: 'cancelled', … }`.

No new example file was created. The warning-check code is a documented snippet, so the package file list and the package verifier are unchanged.

## 6. Security boundaries documented

Hanuman security guide (SECURITY.md, production guide, SDK guide, README):
- explicit bot and tool registration, and no default roster entry;
- capability allowlists (with the open implicit-default caveat);
- Jay and Vijay authorization and literal-`true` approval;
- NARASIMHA enforcement in enforce and monitor mode, and lockdown;
- host-owned target catalog and allowed origins;
- GET only, no redirects, no compression, address checks, and request, response and time limits;
- `AbortSignal` behavior, including what happens when a transport ignores it;
- untrusted evidence, including hidden Unicode characters;
- approval requirements and the fixed error codes;
- credential handling;
- trusted-host and proxy egress obligations.

Statements deliberately made:
- URL or address validation alone does not prevent SSRF.
- ShivAX provides no OS-level network isolation and ships no HTTP client, global `fetch`, search or web crawler.
- No reviewed host transport exists.
- `research.search` and `fetch.api` are reserved and not implemented. There is no search provider and no injected search contract, so no search section describing a supported API was written (Step 7), and no paid API is suggested as required.

## 7. Metadata changes

| Item | Before | After |
| --- | --- | --- |
| `package.json` `description` | `ShivAX AI - Narasimha Release` | HANUMAN description (§2) |
| `package.json` `version`, `files`, `exports`, `engines`, `peerDependencies`, scripts | — | Unchanged |
| CHANGELOG release-line table | 3 rows | Added `0.4.x HANUMAN (in preparation, not published)` |
| Packed size (`npm pack --dry-run`) | 771.5 kB, 551 files | 783.0 kB, 551 files (the increase is documentation) |

## 8. Test commands and results

All run in H08-B after the last edit. The environment used offline dependencies with `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false`, `PNPM_CONFIG_OFFLINE=true`, `PNPM_CONFIG_NODE_LINKER=hoisted` and `PNPM_CONFIG_PACKAGE_IMPORT_METHOD=copy`. Logs are in `node_modules/h08b-*.log`, which is ignored.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm lint` | 0 | PASS |
| `pnpm test` | 0 | **1,452/1,452**; 0 failed, skipped, TODO or cancelled |
| `pnpm build` | 0 | PASS |
| `pnpm verify:package` | 0 | PASS: 186 packed gateway tests, 88 packed bot tests, browser-safe graphs, 14 documented example files present, 12 offline SDK examples, 4 H06 examples, 13 H06 tests, worker training, 13 declaration entries × 5 modes, 550 files |
| `npm pack --dry-run` | 0 | PASS, `shivax@0.3.3`, 551 files |
| Focused `node --test` (Hanuman fetch, bot, integration and examples; Shabari runner; workflow safety ×2; package; SDK) | 0 | **564/564** |
| Seven example scripts | 0 | All exit 0 |
| Documentation validator (scratch script, not in the repository) | 0 | 0 problems |

What the validator checked, over the seven edited documents (README, SECURITY.md, CHANGELOG.md, production guide, SDK guide and the two examples READMEs):
- 27 relative links, 8 of them with anchors, all resolve;
- 16 `shivax` import specifiers all exist in the manifest exports;
- 22 example paths exist;
- every documented identifier is exported (all 13 entry points loaded);
- the absence of Jambavan and Kubera factories;
- no private paths, personal data or secret-shaped strings;
- only existing pnpm/npm commands;
- no stale "0.3.2 is current" labels.

External links (the GitHub issues page) cannot be verified offline.

## 9. Remaining inaccuracies and limitations

- **Phase labels remain in some headings** ("Protected external retrieval (H01-B)", "Registering the optional Hanuman specialist (H02-B)", "Portable Hanuman examples (H06)", and the matching SECURITY.md headings). They are build-phase jargon. They were kept so that existing anchors and links do not break. A later cleanup should rename them and update the links.
- **No CHANGELOG entry for 0.3.3.** The package says 0.3.3 and the runtime `VERSION` matches, but the changelog's latest published entry is 0.3.2. No entry was invented, because whether 0.3.3 is published is a release decision. The HANUMAN section is labeled unreleased.
- **`docs/release-readiness.md` still describes 0.3.2.** It is a historical test record and was not changed.
- **Jambavan and Kubera examples are missing** because the features do not exist (H05). The docs say so. Step 8 items 7 and 8 therefore remain unmet.
- **Warning checks have no shipped example script.** There is a tested snippet in the SDK guide only.
- **Open security findings are described, not fixed.** The "known limitations" lists come from the H07-D review (no reviewed transport, implicit RUDRA capability allowlist, first-by-ID routing, in-flight identity revocation, transports that ignore cancellation, `3fff::/20`). They were not re-probed in this phase. If those findings are fixed, the lists in SECURITY.md, the production guide and the CHANGELOG need updating.
- **The shipped example host still configures always-on firewall admin** (H06C-01). The docs warn against copying it. The example was not changed, because this phase may change documentation and examples only to add safe offline examples and the finding concerns the existing fixture.
- **`rest.mjs` still checks its schema with `assert`** (H06C-02). Existing behavior, documented in the SDK guide.
- **The README links no audit reports.** `docs/audits/` is not in the npm package, so the README and SECURITY.md name the folder as text.
- **Only Node 22.23.2 on Windows was exercised.** Other Node 22+ versions are untested. The Inspectra optional peer was not installed or re-run.
- **Line endings.** Git warns that LF will become CRLF for five edited files (`core.autocrlf` is true). `CHANGELOG.md` and `examples/sdk/README.md` were already CRLF and were edited with CRLF preserved. No normalization was done.
- **Spelling of the Ekalavy/Ekalavya name** still varies in historical prose.
- **Validator scope.** It checks mechanical facts. It cannot judge whether a sentence is correct beyond the identifiers, paths and behaviors listed above, and it was not added to the repository.

## 10. Documentation gate: PASS

| Check | Result |
| --- | --- |
| No source, test, script, public export or signature changed | Met. The diff touches only the seven files in §1 |
| `package.json.version` unchanged; release not claimed as published | Met |
| Seven default bots and exact IDs preserved and documented | Met |
| Hanuman documented as optional, with its IDs | Met |
| Utilities documented as non-bots, with true status | Met |
| Documented imports, identifiers and paths exist | Met |
| Documented examples run | Met. Missing examples are marked missing |
| Security limits stated without universal-security claims | Met |
| Historical entries preserved | Met. README history sections and CHANGELOG 0.3.2 and earlier are byte-identical |
| `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm verify:package`, `npm pack --dry-run` | All pass |

This is a documentation gate only. It does not clear the open H01, H03, H04, H05 and H07 security gates, and live deployment and the 0.4.0 release remain **NO-GO**.

## Changed paths

Modified: `package.json`, `README.md`, `SECURITY.md`, `CHANGELOG.md`, `docs/production.md`, `docs/sdk.md`, `examples/sdk/README.md`. Added: `docs/audits/hanuman-h08-docs.md`. Nothing was committed, pushed, tagged or published. Inspectra and Visynq were not modified. H09 has not started. **H08-B stops here.**
