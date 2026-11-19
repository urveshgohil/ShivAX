# SHIVAX 0.4.0 HANUMAN · H08 SDK, package and documentation (phase summary)

Status as of 19 November 2026, Asia/Calcutta. This covers reviewed commit `1a02713` plus the uncommitted H08-B documentation changes. The package is still `shivax@0.3.3`.

**H08: CONDITIONAL GO for the SDK packaging and documentation scope. NO-GO for publishing v0.4.0.**
- **Compatibility:** no P0 or P1 was found, and v0.3.2 compatibility holds in full. Exports, declarations, bot IDs, module formats, TypeScript modes and the clean install all pass.
- **Before any publish:** four P2 findings must be fixed or decided. Two are documentation (H08C-01, H08C-02), one is release metadata (H08C-03) and one is release planning for Inspectra (H08C-04).
- **Release:** remains blocked upstream: H01D-02, H03C-01, H07D-02 and the missing H05 utilities.

| Phase | Document | Outcome |
| --- | --- | --- |
| H08-A SDK and package preparation | [hanuman-h08-sdk.md](hanuman-h08-sdk.md) | Packaging checks expanded (10 browser graphs, installed-content checks, H04 declaration consumers). Gate recorded as FAIL / BLOCKED on upstream phases |
| H08-B documentation, metadata and examples | [hanuman-h08-docs.md](hanuman-h08-docs.md) | Documentation PASS. README, SECURITY.md, production and SDK guides, CHANGELOG `[Unreleased]` and the description were updated; Jambavan and Kubera examples are marked missing |
| H08-C independent review | [hanuman-h08-review.md](hanuman-h08-review.md) | CONDITIONAL GO (scope) / NO-GO (publish). Findings H08C-01 to H08C-07 |

## Key results (H08-C, measured independently)

| Area | Result |
| --- | --- |
| Exports map and manifest fields since v0.3.2 | Identical (13 entries). Only `VERSION` changed among constants |
| Removed runtime or declaration names | 0. Additions: root +15, `rudra` +11, `bots` +4, `integrations` +5 runtime names |
| Default bots | Identical IDs, order and capabilities. `vishwakarma` preserved. `hanuman` stays opt-in |
| ESM/CJS, clean tarball install | 13/13 entries on Node v22.23.2, v24.22.2, v26.13.0 and v24.18.0 |
| TypeScript (strict, `skipLibCheck: false`, no platform types) | 1,012 v0.3.2 declaration names and a HANUMAN API consumer compile with 0 errors in Bundler, Node16 ESM/CJS and NodeNext ESM/CJS. Positive and negative controls behave as expected |
| Browser-safe graphs | 10 entries with no builtin or external import. The only `fetch(` is the unchanged opt-in Ollama adapter |
| Installed examples | 16/16 offline scripts on Node 22, 24 and 26 |
| Packaging | 551 files, reproducible tarball (identical SHA-256 twice). Mandatory files present; no tests, sources, logs or audits in the package |
| Optional Inspectra | 1.2.1 installs offline without force flags and deduplicates at 0.3.3. A real local headless capture works through the adapter. At a simulated 0.4.0, Inspectra pulls a nested `shivax@0.3.2` (H08C-04) |
| Gates | `pnpm lint` PASS · `pnpm test` 1,452/1,452 · `pnpm build` PASS · `pnpm verify:package` PASS · `npm pack --dry-run` PASS (551 files) |
| Security regressions | Hanuman 395/395 · RUDRA/workflows 111/111 · NARASIMHA/security 262/262 · SARASWATI/cost 151/151 · H04 156/156 · Shabari 4/4 plus 9 canary selections · package/SDK 9/9. H05 has no tests because the features are absent |

## Findings

| ID | Sev | Summary |
| --- | --- | --- |
| H08C-01 | P2 | The docs say root `shivax` contains everything. The Hanuman gateway names (`registerHanumanFetchService`, `HANUMAN_FETCH_TOOL_ID` and three more) are only in `shivax/integrations`, so a root import fails with TS2305 |
| H08C-02 | P2 | SECURITY.md says slots held by a transport that ignores abort are freed "until your host cancels or restarts". Root abort leaves `draining: 2`; only settling, recreating the firewall or a restart frees them |
| H08C-03 | P2 | `package.json` description says "v0.4.0 HANUMAN (unreleased)" on a 0.3.3 manifest. It is wrong whichever version is published; fix it with the version decision |
| H08C-04 | P2 | `inspectra-engine@1.2.1` depends on `shivax ^0.2.0 \|\| ^0.3.0`, so a 0.4.0 install nests a second `shivax@0.3.2` |
| H08C-05 | P3 | Stale Inspectra references: "local 1.2.1 candidate" (now published) and `inspectra-engine@1.0.4` in the examples README |
| H08C-06 | P3 | The production guide's capability table omits 8 Chitragupt and 2 Narad capabilities (pre-existing) |
| H08C-07 | P3 | A docs snippet lacks imports; the CHANGELOG omits the new `WorkflowErrorCode` member `'preflight-blocked'`; the list of verified Node versions is incomplete |

## Conditions and next steps (not started)

1. Correct the documentation for H08C-01 and H08C-02, and optionally H08C-05 to H08C-07.
2. Set a version-neutral description together with the 0.4.0 version decision (H08C-03).
3. Decide on Inspectra coordination or documentation for 0.4.0 (H08C-04), and add a single-copy check to the Inspectra matrix.
4. Upstream release blockers remain as in the [H07 summary](hanuman-h07.md).

Nothing was committed, pushed, tagged or published. No npm dist-tag was changed. Inspectra and Visynq were not modified. H09 has not started.
