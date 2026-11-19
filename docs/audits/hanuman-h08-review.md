# SHIVAX 0.4.0 HANUMAN · H08-C independent SDK, package and documentation review

19 November 2026, Asia/Calcutta.

**Scope.** Reviewed commit `1a02713` (H08-A) plus the uncommitted H08-B working tree:
- `package.json`, `README.md`, `SECURITY.md`, `CHANGELOG.md`;
- `docs/production.md`, `docs/sdk.md`, `examples/sdk/README.md`;
- `docs/audits/hanuman-h08-docs.md`.

The package is still `shivax@0.3.3`.

**Environment.**
- Node versions, all on Windows 11 x64: v22.23.2 (default), v24.22.2, v26.13.0 (nvm), and v24.18.0 (system install).
- Tools: npm 10.9.8, pnpm 12.8.1, TypeScript 7.0.2.

**Decision.** **H08: CONDITIONAL GO** for the SDK packaging and documentation scope. **NO-GO** for publishing v0.4.0.
- **Packaging and compatibility:**
  - No P0 or P1 was found.
  - No public export, declaration name, export-map target or default bot ID was removed or changed since v0.3.2.
  - ESM, CommonJS and all five TypeScript resolution modes pass from a clean tarball install on three Node majors.
  - The optional Inspectra case works offline.
- **Documentation:** four P2 defects must be fixed before any publish (§10). Three are documentation or metadata accuracy issues: the root-import claim, the cancellation-recovery wording and the description text. The fourth is a release-planning compatibility issue with Inspectra's `shivax` dependency range.
- **Release:** remains blocked by the open H01/H03 P1 findings, the incomplete H07 canary inventory and the absent H05 utilities (H07-D).

This review changed no source, test, script, manifest or documentation other than adding this file and [hanuman-h08.md](hanuman-h08.md). All scratch consumers, tarballs and probes were kept outside the repository. Nothing was published, tagged or pushed, and no npm dist-tag was touched. The npm registry state was not queried, because this review stayed offline.

## Method

Previous reports were read but not relied on. Each claim below was re-measured:
- **Baseline:** a fresh `git archive 37845c7` (v0.3.2) built in a scratch directory with the current toolchain, then packed to a v0.3.2 tarball.
- **Comparison script:**
  - the exports map;
  - runtime names in both ESM and CJS;
  - value kinds and primitive constants;
  - declaration export names, walked through the `.d.ts` re-export graph for both the `import` and `require` declaration trees;
  - default bot IDs and capabilities.
- **Clean installs** of freshly packed tarballs into isolated consumer directories outside the repository, with plain `npm install --offline` and no `--force` or `--legacy-peer-deps`:
  1. without Inspectra;
  2. with `inspectra-engine` from the npm cache;
  3. a scratch repack with only `version` set to `0.4.0`, to check forward resolution.
- **TypeScript consumers:**
  - every v0.3.2 declaration export name: 1,012 references (362 values through `typeof`, 650 type-only names through `import type`);
  - a HANUMAN API consumer;
  - all compiled with `strict`, `skipLibCheck: false`, `lib: ["es2022"]` and `types: []`, so no Node or DOM types were available.
- **Code-level probes** for documentation claims, reusing the H07-D offline host against the current `dist`.
- **Gates and the security regression suites** (§9).

## 1. SDK export compatibility

| Check | Result |
| --- | --- |
| Exports-map keys and targets (13 entries) | **Identical** to v0.3.2: no key added, removed or retargeted |
| `main`, `module`, `types`, `type`, `sideEffects`, `engines`, `peerDependencies`, `peerDependenciesMeta`, `dependencies`, `license` | **Unchanged** |
| Runtime names removed (ESM and CJS, 13 entries) | **0** |
| Value-kind changes | **0** |
| Primitive constant changes | Only `VERSION` (`'0.3.2'` → `'0.3.3'`, the expected patch bump) |
| Declaration export names removed (`import` and `require` trees) | **0**. The import/require name sets are equal for every entry |
| Default bots (`createSpecialistBots()`) | **Identical** IDs, order and capabilities: `sanjay`(3), `brihaspati`(2), `vishwakarma`(3), `chitragupt`(10), `narad`(4), `yudhishthir`(4), `ekalavy`(3). `VishwakarmBot === VishwakarmaBot` |
| 0.3.3 vs 0.3.2 surface | The only source difference between the two is the `VERSION` constant (`git diff 37845c7 3f01ea1 -- src`) |

**Intentional additive changes, runtime names:**

| Entry | Runtime names (before → after) | Additions |
| --- | --- | --- |
| `shivax` | 187 → 202 | `HanumanBot`, `registerHanumanBot`, `HANUMAN_FETCH_URL_CAPABILITY`, `HANUMAN_RESERVED_CAPABILITIES`, `runAbhimanyuPreflight`, `createAshwatthamaObserver`, `validateSafetyProfiles`, `validateSafetyWarning`, `WorkflowSafetyError`, `SAFETY_WARNING_RULES`, `SAFETY_LIMITS`, `ABHIMANYU_RULE_IDS`, `ABHIMANYU_DEFAULT_ENFORCED`, `ASHWATTHAMA_RULE_IDS`, `ASHWATTHAMA_DEFAULT_ENFORCED` |
| `shivax/rudra` | 14 → 25 | The 11 safety names above |
| `shivax/bots` | 14 → 18 | The 4 Hanuman bot names |
| `shivax/integrations` | 5 → 10 | `registerHanumanFetchService`, `HanumanFetchError`, `HANUMAN_BOT_ID`, `HANUMAN_FETCH_CAPABILITY`, `HANUMAN_FETCH_TOOL_ID` |

Declaration names grew as follows: root 525 → 572, rudra 68 → 107, bots 28 → 36, integrations 14 → 32. All other entries are unchanged.

**Notable non-name changes**, read from the source diff:
- `WorkflowErrorCode` gains the union member `'preflight-blocked'`. This is additive, but an exhaustive `switch` in a consumer would see a new case (H08C-07).
- Optional `preflight` and `lifecycle` engine options, and a `preflight` report field, were added.
- `src/security/errors.ts` adds an internal `NON_RETRYABLE` symbol. It is not exported from any entry.
- `vijay.ts` and `tools.ts` add internal rechecks. They change no signature.

**Root-import note:** the root `shivax` re-exports the Hanuman *bot* names but **not** the five Hanuman *gateway* names, which exist only in `shivax/integrations` (`src/index.ts` omits `./integrations/hanuman`). The documentation says otherwise; see H08C-01.

## 2. ESM and CommonJS results

These ran in a clean consumer installed from the packed tarball.

| Node | 13 entries `import` and `require` | ESM/CJS key parity | Default bot IDs | Hanuman opt-in (`unavailable` without tool) | Inspectra/Visynq absent | Jambavan/Kubera factories absent |
| --- | --- | --- | --- | --- | --- | --- |
| v22.23.2 | PASS | 13/13 | PASS | PASS | PASS | PASS |
| v24.22.2 | PASS | 13/13 | PASS | PASS | PASS | PASS |
| v26.13.0 | PASS | 13/13 | PASS | PASS | PASS | PASS |
| v24.18.0 | PASS | 13/13 | PASS | PASS | PASS | PASS |

- **Class identity:** root and subpath share class identity within a format (`shivax.HanumanBot === shivax/bots.HanumanBot`). The ESM and CJS copies are distinct, as `docs/sdk.md` documents.
- **`shivax/package.json`:** not exported, as in v0.3.2, so this is not a regression.
- **Node-specific imports** (static walk of the installed ESM graphs):
  - The only Node builtin is `node:worker_threads`, in `shivax/learning/node` (documented as Node-only).
  - The Inspectra adapter imports `shivax` and dynamically loads `inspectra-engine/node` on first use.
- **Browser-safe imports:** the root, `core`, `rudra`, `bots`, `security`, `models`, `memory`, `integrations`, `learning` and `diagnostics` graphs have no static external or builtin import.
- **`fetch(` in the browser-safe graphs:** the only occurrence is in `dist/sdk/models.esm.js`, the opt-in loopback Ollama adapter. That bundle is byte-identical to v0.3.2 apart from the version string. The Hanuman/`integrations` graph contains no `fetch`.

## 3. TypeScript declaration results

These were compiled against the **installed** tarball, with strict settings, `skipLibCheck: false` and no ambient platform types.

| Mode | v0.3.2 name consumer (1,012 refs) | HANUMAN API consumer | Errors |
| --- | --- | --- | --- |
| `module: esnext`, `moduleResolution: bundler` (`.ts`) | PASS | PASS | 0 |
| Node16 ESM (`.mts`) | PASS | PASS | 0 |
| Node16 CJS (`.cts`) | PASS | PASS | 0 |
| NodeNext ESM (`.mts`) | PASS | PASS | 0 |
| NodeNext CJS (`.cts`) | PASS | PASS | 0 |

**Controls:**
- The same name consumer compiles against the v0.3.2 tarball with 0 errors in all five modes.
- A negative file importing `NotAThing` from `shivax` and `createKuberaReporter` from `shivax/security` fails with TS2305 for both, so the check is sensitive.
- An earlier generator draft that referenced generic types without arguments produced the same 13 errors against *both* versions. It was corrected, and is recorded here only as evidence that the method distinguishes tool artifacts from regressions.

**What the HANUMAN consumer exercises:**
- the `HanumanFetchTransport` request frame (`method: 'GET'`, `redirect: 'error'`, `credentials: 'omit'`);
- `registerHanumanFetchService` with `observe`;
- `registerHanumanBot`;
- the `HANUMAN_*` constants;
- the `HanumanFetchResult['trust']` literal;
- the Abhimanyu and Ashwatthama APIs and types;
- `toSDKDiagnostic`.

**Declaration graph consistency:** for every entry, the `import` and `require` declaration trees export identical name sets, and no re-export in either tree is left unresolved. The package verifier independently passed its own 13-entry × 5-mode compilation.

## 4. Clean-install verification

| Requirement | Result |
| --- | --- |
| Build and pack | `pnpm build` PASS. `npm pack --ignore-scripts` produced `shivax-0.3.3.tgz`: 551 files, 782,997 bytes. A second pack after the gate rebuild gave an **identical SHA-256**, so packing is reproducible |
| Mandatory files present | LICENSE, NOTICE, README, SECURITY, CHANGELOG, `package.json`, root ESM/CJS/d.ts, `dist/types-cjs/package.json`, the Inspectra adapter (`.mjs`, `.d.mts`), `docs/sdk.md`, `docs/production.md`, `examples/sdk/hanuman/host.mjs` |
| Excluded content | No `tests/`, `src/`, `node_modules/`, `.git`, `.env`, logs or `docs/audits/` in the tarball |
| Isolated consumer, no Inspectra | `npm install <tgz> --offline` added 1 package. No sibling repository or workspace link was involved |
| Peer resolution | The optional peer was not auto-installed. `inspectra-engine` and `visynq` fail to resolve (`MODULE_NOT_FOUND`) |
| Private source imports and paths | 0 hits for drive paths, user names or `../src` imports anywhere in the installed package |
| Undocumented external dependencies | None. Examples import only `node:*` builtins and `shivax/*` entries |
| Public examples from the installed copy | **16/16 offline scripts pass on Node 22.23.2, 24.22.2 and 26.13.0:** `registry`, `local-model`, `rudra`, `memory-persistence`, `firewall`, `benchmark`, `model-registry`, `feedback-curation`, `worker-training`, `routing-shadow`, `memory-ranking`, `hanuman`, and `hanuman/{documentation,rest,workflow,denials}`. `ollama.mjs` exits with its documented "Set SHIVAX_OLLAMA_MODEL…" message when unconfigured. `inspectra.mjs` loads as a module and exports `connectInspectra` |
| Repeat after the gate rebuild | The fresh tarball was reinstalled into a new consumer. The runtime checks and the Hanuman, firewall and registry examples pass on Node 22.23.2 and 26.13.0 |

## 5. Optional Inspectra compatibility

| Case | Result |
| --- | --- |
| `npm install <shivax tgz> inspectra-engine@^1.0.4 --offline` | PASS: 227 packages from the npm cache, `inspectra-engine@1.2.1`, resolved from the public registry tarball. `npm ls` exit 0: Inspectra's own `shivax` dependency (`^0.2.0 \|\| ^0.3.0`) deduplicates to the installed `shivax@0.3.3` |
| Engines | Inspectra 1.2.1 declares `node >=22.15`, matching the SHIVAX documentation |
| Real capture through the installed adapter | PASS. `InspectraInspectionProvider` with local headless Chromium (Playwright 1.65.0, browsers from the local cache), all routes aborted, content injected with `setContent` (no network). It returned a normalized snapshot with 5 nodes and `trust`, `snapshot` and `elements` fields, with 0 network requests attempted |
| Incompatible provider | Sanitized error: "Incompatible Inspectra API: expected captureUIPage(page, options)…" |
| **Forward check: same tarball with only `version` set to 0.4.0** | Installs (228 packages), but `npm ls` shows **`inspectra-engine@1.2.1 → shivax@0.3.2` nested beside `shivax@0.4.0`**, because Inspectra's range excludes 0.4.x. The capture still works. This is H08C-04 |

Only Inspectra 1.2.1 was exercised in this phase. The older 1.0.4, 1.1.0 and 1.2.0 results are from the earlier SHIVAX-C01 record and were not re-run.

## 6. HANUMAN documentation accuracy

Each claim was checked against code or a probe.

| Claim (where) | Verdict | Evidence |
| --- | --- | --- |
| Codename and release identity "v0.4.0 HANUMAN - The Action & Automation Release", in preparation and not published (README, CHANGELOG `[Unreleased]`, production, SDK guide) | Accurate | `version` is 0.3.3; no tag |
| Package description | **Inaccurate at publish time** | It says "v0.4.0 HANUMAN (unreleased)" on a 0.3.3 manifest (H08C-03) |
| Actual version 0.3.3 stated (README, SDK guide, production, SECURITY.md) | Accurate | `VERSION` and the manifest |
| Seven bots with exact IDs and roles; only alias `VishwakarmBot`; `hanuman` optional and not in `createSpecialistBots()` (README, production) | Accurate | Runtime roster; `registerHanumanBot` throws `unavailable` without the tool |
| The production guide's per-bot capability table | **Incomplete (pre-existing)** | It lists 2 of 10 Chitragupt and 2 of 4 Narad capabilities (H08C-06) |
| "`shivax` — everything in one import" (README, SDK guide) and "everything below except the Inspectra adapter and licensing" (production) | **Inaccurate** | The Hanuman gateway names are not in the root (H08C-01) |
| `fetch.api` and `research.search` reserved, not implemented; no search provider or contract; no paid API required | Accurate | `HANUMAN_RESERVED_CAPABILITIES`; the bot registers `fetch.url` only |
| Jambavan and Kubera not implemented, not bots; Abhimanyu and Ashwatthama are utilities, not bots; Shabari is repository-only | Accurate | The factories are absent from all 13 entries (runtime and declarations); the safety functions are exported from `shivax`/`shivax/rudra`; no bot with these IDs; `tests/` is not packaged |
| Warning-check snippet and API (`preflight`/`lifecycle` engine options, `enforce`-only blocking, 23 rules) | Accurate | The snippet was re-run in H08-B. `SAFETY_WARNING_RULES` has 23 keys. The engine option types match |
| Firewall: enforce, monitor (mandatory rules, tenant, origin and budgets survive), lockdown (all non-CPU denied) | Accurate | `policy.ts` `evaluate`; H07-D reproducers M01–M10 |
| Node 22+ (`engines >=22`); Inspectra Node 22.15+ | Accurate | Manifest; Inspectra engines; runs on 22, 24 and 26 |
| Errors and cancellation section (generic `bot-failed`, `observe` for detail, `toSDKDiagnostic` on throws) | Accurate | The snippet omits imports for `HANUMAN_FETCH_TOOL_ID` and others (H08C-07) |
| Inspectra version history ("plus the local 1.2.1 candidate") | **Stale** | 1.2.1 is now on the registry (H08C-05) |
| CHANGELOG "Added/Changed/Not included/Known limitations" | Accurate | Matches the source diff and H07-D. Historical entries for 0.3.2 and older are byte-identical (re-checked) |

## 7. Security documentation review

| Requirement | Verdict | Notes |
| --- | --- | --- |
| SSRF limitations explained | Pass | SECURITY.md, production and README all say URL or address validation alone does not prevent SSRF, and that no reviewed transport exists |
| DNS/IP restrictions host-enforced | Pass | The SDK checks *reported* addresses and the peer; socket pinning, TLS and egress belong to the host. The `3fff::/20` gap is listed |
| Redirect handling described | Pass | Redirects are refused (`redirect: 'error'`, 3xx denied), never followed or re-validated hop by hop. Wire behavior is the host's |
| Credentials not exposed | Pass | The frame has `credentials: 'omit'` and two fixed headers. Errors are fixed codes. Hosts are told not to put secrets in catalogs or logs, and the docs say the SDK does no body secret scanning. The README's phrase "with no credentials" describes the request frame; the host-compliance caveat appears in SECURITY.md |
| Untrusted content is not authority | Pass | `trust: 'untrusted'`. Never used for instructions, grants, approval, code or training. Hidden-Unicode advice included |
| Tenant isolation | Pass | Realm, issuer and scope checks are described as SDK-provided; per-tenant registrations and pools are host-provided |
| Mandatory rules survive monitor | Pass | Code: only `optional` deny rules relax |
| Lockdown accurate | Pass | New non-CPU operations are denied and active leases revoked |
| In-flight cancellation limits clear | **Partly** | The production limitations and CHANGELOG are accurate. **SECURITY.md line 160–161 overstates recovery**: "its firewall slots stay in use until your host cancels or restarts". A probe aborting the root signal while the transport ignores abort returned `cancelled`, yet `draining: 2` remained (H08C-02) |
| No promise beyond the implementation | Pass, apart from H08C-02 | The documents explicitly disclaim OS isolation, a built-in transport, search and universal security |

## 8. Examples tested

| Example | Repository run (gate) | Installed run, Node 22/24/26 |
| --- | --- | --- |
| `hanuman/documentation.mjs` (approved documentation) | PASS | PASS / PASS / PASS |
| `hanuman/rest.mjs` (bounded JSON GET through `fetch.url`) | PASS | PASS / PASS / PASS |
| `hanuman/workflow.mjs` (RUDRA + Hanuman) | PASS | PASS / PASS / PASS |
| `hanuman/denials.mjs` (denied origin, lockdown, timeout, cancel and 4 more) | PASS | PASS / PASS / PASS |
| `hanuman.mjs`, `firewall.mjs`, `registry.mjs` and 9 other offline scripts | PASS (verifier) | PASS / PASS / PASS |
| Jambavan and Kubera | Not available | Documented as missing; no API |
| Warning-check and error-handling snippets | Docs only | The H08-B snippet run was reviewed. The cancellation behavior was re-confirmed by probe |

## 9. Test counts

All commands below were run in H08-C on Node 22.23.2. Logs are in the ignored `node_modules/h08c-*.log`.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm lint` | 0 | PASS (TypeScript and ESLint) |
| `pnpm test` | 0 | **1,452/1,452**; 0 failed, skipped, TODO or cancelled |
| `pnpm build` | 0 | PASS |
| `pnpm verify:package` | 0 | PASS: 186 packed gateway, 88 packed bot, 13 H06 tests; 12 + 4 examples; 10 browser graphs; worker training; 13 entries × 5 declaration modes; 550 files |
| `npm pack --dry-run` | 0 | PASS: `shivax@0.3.3`, 551 files, 783.0 kB |
| Hanuman gateway, bot, integration and examples | 0 | **395/395** |
| RUDRA, workflows and agents | 0 | **111/111** |
| NARASIMHA and security (security, firewall ×4) | 0 | **262/262** |
| SARASWATI and cost (learning ×4, model-cost, model-safety) | 0 | **151/151** |
| H04 warning checks (workflow-safety ×2) | 0 | **156/156** |
| H07 Shabari runner self-test | 0 | **4/4** |
| H07 canary runner, 9 selections | 0 | pass (13, 186, 88, 108, 58, 38, 18, 2, 2) |
| Package and SDK tests | 0 | **9/9** |
| H05 utility tests | n/a | **None exist.** Jambavan and Kubera are not implemented, so nothing can be tested |
| Clean consumer: runtime checks on 4 Node versions; 16 examples on 3 Node versions; 5 TypeScript modes × 2 consumers; Inspectra capture; 0.4.0 forward check | 0 | All PASS, except the documented forward-resolution observation (H08C-04) |

The focused counts overlap the full suite. Nothing was skipped. Limits of this environment:
- Windows only;
- Inspectra 1.2.1 only;
- the registry was not queried;
- no network-isolated wire-level transport testing (out of scope; H01D-02).

## 10. Findings

**Summary:** P0: 0 · P1: 0 · P2: 4 (H08C-01 to 04) · P3: 3 (H08C-05 to 07).

### H08C-01 · P2 · The documentation says the root `shivax` import contains everything, but the Hanuman gateway names are missing from it

- **Location:**
  - `src/index.ts` (no `./integrations/hanuman` re-export);
  - `README.md:305`;
  - `docs/sdk.md:15`;
  - `docs/production.md:201`.
- **Reproduction:** in a clean consumer:
  - `import { registerHanumanFetchService, HANUMAN_FETCH_TOOL_ID } from 'shivax'` gives TS2305 for both names (NodeNext);
  - at runtime, `(await import('shivax')).registerHanumanFetchService` is `undefined`, while `registerHanumanBot` is a function.
- **Expected:** the documentation matches the API.
- **Actual:** the five gateway names (`registerHanumanFetchService`, `HanumanFetchError`, `HANUMAN_BOT_ID`, `HANUMAN_FETCH_CAPABILITY`, `HANUMAN_FETCH_TOOL_ID`) and the `Hanuman*` transport types exist only in `shivax/integrations`. `shivax/learning/node` is also excluded from the root, which only the SDK guide's migration table states.
- **Recommended fix:** document the exclusions in all three tables. Adding a root re-export would be an additive API decision for the owner, not a documentation change.
- **Regression test:** a package test asserting the documented root/subpath placement of the Hanuman names, in ESM, CJS and declarations.

### H08C-02 · P2 · SECURITY.md overstates recovery from a transport that ignores cancellation

- **Location:** `SECURITY.md:159-161`, under "HANUMAN threat boundaries".
- **Reproduction:** H07-D offline host (`node_modules/h07d-probes/host.mjs`), with a transport `request()` that never settles and ignores `signal`. Abort the root signal 50 ms into the run.
- **Expected:** what the text promises: slots are freed when the host cancels.
- **Actual:** the run returns `cancelled`, but `firewall.runtime.status()` keeps `active: 0, draining: 2` after 500 ms, matching H07D-01. Only the transport settling, recreating the firewall instance or restarting the process frees them.
- **Recommended fix:** replace "until your host cancels or restarts" with "until the transport settles, or the host recreates the firewall instance or restarts; aborting the task does not release them".
- **Regression test:** keep the H07D-01 regression requirement. A documentation check is optional.

### H08C-03 · P2 · The package description embeds a release state that will be wrong when published

- **Location:** `package.json` `description`.
- **Reproduction:** read the installed manifest: `version: 0.3.3`, description "ShivAX AI v0.4.0 HANUMAN (unreleased): …".
- **Expected:** a description that stays true for the version it ships with.
- **Actual:**
  - Publishing 0.3.3 with this text would advertise unreleased 0.4.0 features on a 0.3.3 package page.
  - Publishing 0.4.0 without editing it would keep "(unreleased)".
  - The H08-B intent (do not claim publication) is met today.
- **Recommended fix:** at the release decision, set a version-neutral description (for example "ShivAX AI - HANUMAN: CPU neural networks, multi-agent orchestration, Jay/Vijay authorization, a NARASIMHA firewall and opt-in protected external retrieval for trusted hosts") together with the version bump, or keep the old text until then.
- **Regression test:** a release checklist item, or a verifier assertion, that the description contains no "unreleased" text when `version` is the release version.

### H08C-04 · P2 · After the 0.4.0 bump, Inspectra 1.2.1 will install a second, older SHIVAX copy

- **Location:** release planning. The cause is outside SHIVAX: `inspectra-engine@1.2.1` declares the dependency `shivax: ^0.2.0 || ^0.3.0`. SHIVAX's peer range `^1.0.4` is fine.
- **Reproduction:** repack the current tarball with only `version: 0.4.0`, then `npm install <tgz> inspectra-engine@^1.0.4 --offline`. `npm ls shivax` shows `inspectra-engine@1.2.1 → shivax@0.3.2` beside `shivax@0.4.0`.
- **Expected:** one SHIVAX copy, as at 0.3.3, where it deduplicates.
- **Actual:** a nested 0.3.2 copy. Capture still works in the probe, but users get duplicate code and two SHIVAX versions in one tree. Without a cached 0.3.x, an offline install would also need the registry.
- **Recommended fix:** before publishing 0.4.0, either coordinate an Inspectra release that accepts `^0.4.0` (Inspectra must not be modified from this project), or document the nested copy in the Inspectra adapter guide and the CHANGELOG.
- **Regression test:** extend `scripts/check-inspectra-matrix.mjs` (or the release checklist) to assert a single deduplicated `shivax` in a consumer with each supported Inspectra release.

### H08C-05 · P3 · Inspectra version references are stale

- **Location:**
  - `README.md:323`, `docs/production.md:218`, `docs/sdk.md:620`: "local 1.2.1 candidate";
  - `examples/sdk/README.md:35`: "`inspectra-engine@1.0.4`", although the peer range is `^1.0.4`.
- **Actual:** 1.2.1 resolves from the public registry, and H08-C verified a capture with it.
- **Fix:** update the wording. The historical C01 records in `release-readiness.md` can stay.
- **Regression test:** none.

### H08C-06 · P3 · The production guide's bot capability table is incomplete (pre-existing)

- **Location:** `docs/production.md`, "The seven specialist bots".
- **Actual:** Chitragupt has 10 capabilities (`memory.save`, `retrieve`, `update`, `delete`, `search`, `list`, `export`, `purge`, `read`, `write`) but the table lists `memory.read` and `memory.write`. Narad also offers `inspection.scan` and `inspection.compare-captured`. The capability set is unchanged from v0.3.2, so this is not an H08 regression, but H08-B did not catch it.
- **Fix:** list all capability IDs, or state that the table is a summary.
- **Regression test:** optional documentation check against `createSpecialistBots()`.

### H08C-07 · P3 · Minor editorial and typing notes

- **Error-handling snippet:** the snippet in `docs/sdk.md` ("Errors and cancellation") uses `jay`, `task`, `rudra` and `HANUMAN_FETCH_TOOL_ID` without imports. Because of H08C-01, a reader could import the constant from `shivax`. Add `import { HANUMAN_FETCH_TOOL_ID } from 'shivax/integrations'`.
- **Changelog:** the CHANGELOG "Changed" section does not mention the new `WorkflowErrorCode` member `'preflight-blocked'`, which exhaustive switches in consumers will see.
- **Verified versions:** `docs/sdk.md` says it was verified on 22.23.2. H08-C also ran on 24.22.2 and 26.13.0.
- **Regression test:** none.

### Upstream findings (not H08 scope; unchanged)

These keep the release NO-GO. They were not re-probed here except where noted.
- **H01D-02 (P1):** no reviewed host transport.
- **H03C-01 (P1):** implicit RUDRA capability allowlist.
- **H07D-01 (P2):** re-observed in H08C-02.
- **H07D-02 (P2):** canary inventory incomplete.
- **H05C-01 (P2):** Jambavan and Kubera absent.
- **Others:** H03C-02/03/04, H06C-01/02 and the P3 items listed in the [H07-D review](hanuman-h07-security-review.md).

## 11. H08 GO / NO-GO

| Criterion | Status |
| --- | --- |
| No removed or changed public exports, legacy bot IDs or export targets since v0.3.2 | Met |
| ESM and CJS on supported Node versions (22, 24, 26) | Met |
| TypeScript Bundler, Node16 and NodeNext (ESM and CJS), consistent declaration graph | Met |
| Clean isolated install without sibling repositories, no force flags, correct optional peer behavior | Met |
| Optional Inspectra case | Met for 1.2.1 at 0.3.3. Forward issue H08C-04 |
| Mandatory packaging files present; no private or test content | Met |
| HANUMAN contract: opt-in bot, seven defaults unchanged, no auto-granted permissions, no default network handler, Vijay and firewall on registered tools, untrusted evidence, no search provider | Met (code and tests; H07-D probes; gates) |
| Utility contract: Jambavan, Kubera, Abhimanyu, Ashwatthama and Shabari are not bots, and the docs match the API | Met |
| Documentation accuracy | **Conditional.** H08C-01 and H08C-02 must be corrected |
| Release metadata | **Conditional.** H08C-03 must be resolved at the release decision; H08C-04 must be planned |
| Security regressions | Met: all suites and gates pass |
| P0/P1 | None |

### **H08 decision: CONDITIONAL GO (SDK packaging and documentation scope); NO-GO for publishing v0.4.0**

**Conditions** before any publish:
1. Fix the documentation for H08C-01 and H08C-02.
2. Resolve H08C-03 with the version decision.
3. Decide how H08C-04 is handled.

**Upstream blockers** for the release are unchanged: H01D-02, H03C-01, H07D-02 and H05C-01, per H07-D.

## Changed paths

| Path | Change |
| --- | --- |
| `docs/audits/hanuman-h08-review.md` | New (this review) |
| `docs/audits/hanuman-h08.md` | New (H08 phase summary) |

The H08-B working-tree changes were reviewed and left unmodified. Scratch consumers, tarballs and scripts are outside the repository, and gate logs are in the ignored `node_modules/h08c-*.log`. Nothing was committed, pushed, tagged or published, Inspectra and Visynq were not modified, and H09 was not started. **H08-C stops here.**
