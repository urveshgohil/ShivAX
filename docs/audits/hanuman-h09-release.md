# SHIVAX 0.4.0 HANUMAN · H09-D release decision and approval package

19 November 2026, Asia/Calcutta. **Final decision: NO-GO.**

v0.4.0 HANUMAN (stable) and the proposed prerelease 0.4.0-beta.1 must not be published. The mandatory security gate "no unresolved P1" fails (H01D-02, H03C-01). Two other things are also missing:
- **CI:** no CI execution exists for any job.
- **Features:** two required HANUMAN utilities (Jambavan, Kubera) do not exist.

This phase changed no source, version, tag, registry state or deployment. It adds only this report.

## 1. Exact release candidate

| Field | Value | Evidence |
| --- | --- | --- |
| Source commit | `1f814226babdc55cad8f0cd58869664ddd5f6687`, branch `feat/hanuman-v0.4.0` (built from a clean tree, per `artifact.json`) | `git rev-parse` |
| Repository HEAD now | `caa275e`. Since the candidate, `6aaed8b` added `hanuman-h09-package.md` and `hanuman-h09-validation.md`, and `caa275e` added `hanuman-h09-security.md`. Audit documents only | `git log`, `git status` |
| Packaged inputs since the candidate commit | **Unchanged**: `src`, `package.json`, scripts, examples, tests, build configuration, adapters and every packaged document. `docs/audits/` is not in the package allowlist | `git diff --quiet 1f81422 HEAD -- …` |
| Artifact | `node_modules/h09-candidate-1f814226/shivax-0.3.3.tgz`: 782,997 bytes, 551 files, 3,531,937 bytes unpacked | Measured |
| **SHA-256** | **`e35aef8e0f810e60b2e57b466b2f11c30855f392f91b5f02e7e4518a9b6dbd12`** | `sha256sum` in H09-D |
| Manifest version | `0.3.3`. The target 0.4.0 is not applied | `artifact.json` and the extracted `package.json` |
| Export map | Identical to the current manifest and to v0.3.2 (13 entries) | `artifact.json.exportMap` compared with `package.json.exports` |
| Build metadata | Node v22.23.2, pnpm 12.8.1, `releaseGate: NO-GO` | `artifact.json` |

**Evidence consistency (Step 1):** H09-A, H09-B, H09-C and H09-D all evaluated the **same bytes**:
- the same commit and version;
- the same SHA-256, recorded by H09-A, re-measured by H09-B, H09-C and H09-D, and reproduced by a clean rebuild-and-repack in H09-C;
- the same export map.

H08-C's packed tarball also had this SHA-256, so its Node 24 and 26 consumer results apply to this artifact. No stale evidence had to be invalidated. Any version or metadata change, including 0.4.0-beta.1, produces a **new** artifact and invalidates all of this evidence (§11).

## 2. Baseline compatibility (v0.3.2)

**Baseline identity:**
- The registry reports `shivax@0.3.2` with integrity `sha512-cqt8P/M03ZgVloQZdRveW36ZgKCHRzBURGYp5RLhUAUGJ/g4GgQppPoD+4D0kKr4zfd/oxr6et7/1ts+3Lr75A==`, 509 files, and `gitHead faadd6d`.
- `faadd6d`'s own manifest says 0.3.1. Its direct child `37845c7`, the audited baseline, changes only the version (manifest and `VERSION`), documentation and a matrix script.
- The cached published 0.3.2 tarball (integrity identical to the registry) has **474 `dist` files, all byte-identical** to the H08-C rebuild of `37845c7`.
- So the baseline used throughout H07–H09 is the artifact users actually installed. The publish evidently came from an uncommitted version bump on top of `faadd6d`, which is a provenance note, not a defect.

| v0.3.2 capability | Status | Evidence |
| --- | --- | --- |
| Seven default bots (IDs, order, 29 capabilities; `vishwakarma`) | PASS | H08-C comparison; H09-A/B frozen consumer; H09-D runtime check on Node 22/24/26 |
| Existing public APIs | PASS | 0 runtime or declaration names removed (H08-C: 1,012 v0.3.2 declaration names compile in 5 TypeScript modes). Additive only |
| RUDRA | PASS | `src/agents` unchanged since v0.3.2; RUDRA and workflow suites 111/111 (H09-C) |
| Jay/Vijay | PASS | Small tightening-only edits; security suites 262/262 (H09-C) |
| NARASIMHA firewall | PASS | `src/security/firewall` unchanged; mandatory monitor rules and lockdown re-verified (H09-C) |
| ModelRouter budgets | PASS | Unchanged source. $0.30: 3 × $0.10 succeed, the 4th gives `cost-limit` with 3 provider calls (H09-C case 14; `model-cost`) |
| SARASWATI learning | PASS | `src/learning` unchanged; SARASWATI, cost and memory suites 252/252 (H09-C) |
| Model approval and rollback | PASS | `learning-registry` and `learning-routing` (L8–L11) within the 252 |
| Memory | PASS | `memory` and `memory-ranking` within the 252; `memory-persistence` example |
| Optional Inspectra | PASS at manifest 0.3.3 | The Inspectra 1.2.1 install deduplicates and a real local capture works (H08-C). H08C-04: a 0.4.x version would nest `shivax@0.3.2` |
| ESM/CJS/TypeScript declarations | PASS | 13 entries in both formats; Bundler, Node16 and NodeNext ESM/CJS (H08-C, `verify:package` in H09-D) |
| Historical suite | PASS | v0.3.2's own 897 tests pass 897/897 on its archived build (H07-B, H09-B) |

## 3. Local test results (H09-D, this phase)

Environment: Windows 11 x64, Node v22.23.2, pnpm 12.8.1. Offline pnpm settings were the same as previous phases. Logs are `node_modules/h09d-*.log`.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm lint` | 0 | PASS |
| `pnpm test` | 0 | **1,452/1,452**; 0 failed, skipped, TODO or cancelled |
| `pnpm build` | 0 | PASS |
| `pnpm verify:package` | 0 | PASS: 186 packed gateway, 88 packed bot, 13 H06 tests; 12 + 4 examples; 10 browser graphs; 13 entries × 5 declaration modes; 550 files (pnpm-packed copy of the same source) |
| `npm pack --dry-run` | 0 | PASS, 551 files |
| Shabari canary runner (9 selections) | 0 | pass |

## 4. CI matrix

The CI configuration exists only as `.github/workflows/package-verification.yml` (GitHub Actions). The candidate commit exists only on the **GitLab** remote, which has **no `.gitlab-ci.yml`**. The GitHub remote holds only `main` at `3f01ea1`. No job IDs, run URLs or logs exist anywhere in the repository or workspace. A YAML file is not evidence.

| Job | Status |
| --- | --- |
| Windows · Node 22 | NOT RUN |
| Windows · Node 24 | NOT RUN |
| Windows · Node 26 | NOT RUN |
| Linux · Node 22 | NOT RUN |
| Linux · Node 24 | NOT RUN |
| Linux · Node 26 | NOT RUN |

## 5. Packed consumer tests (frozen tarball)

All consumers ran outside the repository with `npm install --offline --ignore-scripts --no-audit --no-fund --package-lock=false`, with no force flags.

| Phase | Node | Checks | Result |
| --- | --- | --- | --- |
| H09-D | v22.23.2, v24.22.2, v26.13.0 (local Windows) | SHA-256 re-checked before install. Runtime check: 13 entries ESM and CJS, key parity, seven-bot roster, Hanuman needs the tool, Inspectra/Visynq absent, Jambavan/Kubera factories absent. All 16 offline examples | **PASS** on all three |
| H09-D | v22, v24, v26 | 14 independent adversarial cases (H09-C suite) | **14/14** on each |
| H09-C | v22.23.2 | 14 adversarial cases; 53 H07-D reproducers identical; bypass, Ashwatthama and lease-drain probes | PASS (known findings reproduced) |
| H09-A / H09-B | v22.23.2 | Standalone consumer and cached Inspectra 1.2.1 install, tree and import | PASS |
| H08-C (same SHA-256) | v22.23.2, v24.22.2, v26.13.0, v24.18.0 | ESM/CJS and examples; 5-mode TypeScript compilation of 1,012 legacy names; real local Inspectra capture | PASS |

The full repository test suite has run only on Node 22, on Windows.

## 6. Security audit decision

**H09-C: SECURITY NO-GO.**

| Mandatory security gate | Status | Basis |
| --- | --- | --- |
| No unresolved P0 | PASS | None found in H07-D or H09-C |
| No unresolved P1 | **FAIL** | **H01D-02:** no reviewed host transport, so production network enforcement cannot be verified. **H03C-01:** implicit RUDRA capability allowlist |
| No known unauthorized network access | PASS within the SDK; production unverifiable | No case dispatched outside the registered target, origin, tenant or approval. The wire level depends on the absent transport |
| No cross-tenant data leakage | PASS | Cases 6 and 14; S10 parallel tenants; Ashwatthama tenant probe |
| No permission escalation | PASS | Forged contexts and direct tool calls are denied; injection cannot change policy, approval or targets |
| No broken mandatory firewall rule | PASS | Firewall source unchanged; monitor keeps mandatory rules; lockdown blocks dispatch |
| No unapproved model promotion | PASS | Registry and routing suites; source unchanged |
| No budget accounting regression | PASS | $0.30 regression; router scope isolation |
| No unsafe credential exposure | PASS | Fixed headers, `credentials: 'omit'`, sanitized errors and observer events (case 5) |

**One mandatory gate fails, so the result is NO-GO.**

## 7. Canary results

| Item | Status |
| --- | --- |
| Implemented Shabari selections (7 suites + `SHB-NET-12.6`/`12.7`) | PASS (H09-D) |
| Byte-cap boundary fixtures detect off-by-one mutants in both directions | PASS (H07-D mutation check) |
| Required H07-A canary inventory | **FAIL**: 2 of 338 numbered variants implemented (H07D-02). No `net`/`dns`/`tls` tripwires or mutation controls in the repository |

## 8. Known limitations and benchmark review

**Limitations:**
- No transport, DNS, TLS or egress code ships. The host owns all wire-level security.
- A transport that ignores cancellation can pin firewall leases until restart.
- Identity-provider revocation stops in-flight retrieval only through root-signal abort.
- `research.search` and `fetch.api` are reserved. Jambavan and Kubera are absent.
- Fetched evidence can contain hidden Unicode characters.
- Testing ran only locally on Windows. The full suite ran only on Node 22. Inspectra was checked only at 1.2.1.
- No dependency supply-chain audit was performed, and the toolchain lockfile is not committed.

**Benchmarks (Step 5):** measured values only.

| Measurement | v0.3.2 baseline | v0.4 candidate | Comparable? |
| --- | --- | --- | --- |
| Repository test count | 897 (own suite, archived build) | 1,452 (897 pre-existing-file tests unchanged + 555 new) | Counts only. The new tests cover H01–H08 features with no 0.3.2 equivalent |
| Suite elapsed time | 4,618 ms (H09-B) | 10,209 ms (H09-B) | **No**: different inventories |
| Package files / unpacked bytes | 509 / 3,157,371 (registry) | 551 / 3,531,937 | Yes (size only) |
| Runtime export names (root) | 187 | 202 | Yes (additive) |
| H04 footprint (preflight 3.5 ms for 100 actions; observer 4,096 operations ≈ 5.8 MB) | n/a | Indicative probe (H04-C) | No baseline |

**No performance improvement or regression is claimed.** No reproducible comparative performance benchmark exists.

## 9. Open findings

| ID | Sev | Summary | Blocks |
| --- | --- | --- | --- |
| H01D-02 | **P1** | No reviewed host transport; production SSRF, TLS and egress unverifiable | Beta and stable |
| H03C-01 | **P1** | `rudra.run(ctx)` without options admits the root network capability | Beta and stable |
| H09C-01 | P2 | No CI execution evidence; candidate only on GitLab, which has no CI config | Beta and stable (required verification) |
| H07D-02 | P2 | Canary inventory 2 of 338 | Stable; required verification for beta |
| H05C-01 / H07B-02 | P2 | Jambavan and Kubera not implemented (declared HANUMAN scope) | Scope decision needed |
| H07D-01 | P2 | Cancellation-ignoring transport pins leases | Should fix or accept formally |
| H03C-02 / 03 / 04 | P2 | Route capture by ID; in-flight identity-provider revocation; deadline reported as denial | Should fix or accept formally |
| H08C-01 / 02 | P2 | Docs: root-import claim; SECURITY.md overstates stuck-transport recovery | Fix before any publish |
| H08C-03 | P2 | Description says "v0.4.0 HANUMAN (unreleased)" on a 0.3.3 manifest | Fix with the version change |
| H08C-04 | P2 | Inspectra 1.2.1 `shivax ^0.2 \|\| ^0.3`, so 0.4.x nests a second copy | Decide before 0.4.x publish |
| H06C-01 / 02 | P2 | Example host auto-approves admin; missing negative tests | Before host.mjs is a template |
| H09C-02, H09C-03, H07D-03/04/05, H08C-05/06/07, H01D-07/08/09/10/11, H02D-04, other H03C/H04C/H06C P3s | P3 | Quality, documentation and hardening items (see the H07-D, H08-C and H09-C reviews) | Schedule |

**Phase gate status:**

| Phase | Decision |
| --- | --- |
| H00 | PASS (baseline) |
| H01 | NO-GO |
| H02 | GO (conditional) |
| H03 | NO-GO |
| H04 | NO-GO pending independent re-run |
| H05 | NO-GO |
| H06 | CONDITIONAL GO (offline examples) |
| H07 | NO-GO |
| H08 | CONDITIONAL GO (packaging and documentation) / NO-GO for publishing |
| H09-A | Artifact FAIL / NO-GO |
| H09-B | FAIL / NO-GO |
| H09-C | SECURITY NO-GO |

## 10. Release matrix and final decision

| Area | Status | Basis |
| --- | --- | --- |
| Source readiness | FAIL | Open P1s; Jambavan and Kubera absent; earlier phase gates NO-GO |
| SDK compatibility | PASS | Exports, declarations, bot IDs, ESM/CJS, 5 TypeScript modes |
| Package integrity | PASS | Same SHA-256 across H09 phases and rebuild; contents list matches; no hooks, maps, secrets or binaries |
| Dependency compatibility | PASS | At manifest 0.3.3: no runtime dependencies; optional peer not auto-installed; Inspectra 1.2.1 deduplicates. H08C-04 open for 0.4.x |
| Local test results | PASS | §3 |
| Windows CI | NOT RUN | §4 |
| Linux CI | NOT RUN | §4; Linux never exercised |
| Node 22 | PASS | Full suite, gates, consumer (local Windows) |
| Node 24 | PASS (packed consumer only; full suite NOT RUN) | H09-D and H08-C consumers, examples, adversarial cases |
| Node 26 | PASS (packed consumer only; full suite NOT RUN) | Same |
| Security review | FAIL | H09-C SECURITY NO-GO |
| Offline canary tests | PASS for implemented selections; FAIL for required inventory | §7 |
| Legacy functionality | PASS | §2 |
| Documentation | FAIL | H08C-01 and H08C-02 uncorrected |
| Release metadata | FAIL | Version is 0.3.3, not the proposed 0.4.0-beta.1; description wording (H08C-03); Inspectra range (H08C-04) |

### **Final decision: NO-GO**

Reasons:
1. A mandatory security gate fails: unresolved P1 findings H01D-02 and H03C-01.
2. Required CI verification is entirely absent (H09C-01): 0 of 6 matrix jobs, and no Linux execution.
3. The declared HANUMAN scope is incomplete: Jambavan and Kubera are absent, and the canary inventory is incomplete.
4. Documentation and release metadata are not release-correct (H08C-01, H08C-02, H08C-03).

Even with the P1 findings resolved, the remaining missing verifications would make the result at best CONDITIONAL / INCOMPLETE until CI evidence exists.

## 11. Prerelease recommendation

**Do not publish 0.4.0-beta.1 now.**

**Registry state**, queried read-only in H09-D with `npm view`:
- `version` = `0.3.2`;
- `dist-tags` = `{ "latest": "0.3.2" }`;
- `versions` = `0.0.0-stage, 0.1.2, 0.1.3, 0.2.0, 0.3.0, 0.3.1, 0.3.2`;
- `time` lists `0.1.0` (2026-10-21), which is not in `versions`, so it was previously unpublished.

So 0.3.3 is **not** published, and no beta tag exists.

**About the proposed version 0.4.0-beta.1:**
- The candidate says `0.3.3`. Applying `0.4.0-beta.1` requires changing `package.json.version` **and** the runtime `VERSION` constant in `src/index.ts`, because the package tests assert they match. It also requires a version-neutral description (H08C-03).
- That is a source and metadata change, and it produces a new artifact. **Return to H09-A**, freeze and hash the new tarball, then repeat H09-B (including the CI matrix) and H09-C against the new SHA-256.
- Note that `inspectra-engine@1.2.1` does not accept `0.4.0-beta.1`: the range `^0.2.0 || ^0.3.0` excludes it (H08C-04).

**Process to follow only after a GO and separate written authorization.** These commands were not run.

```sh
# 0. Preconditions: P1s closed or formally accepted; docs/metadata fixed; version set to 0.4.0-beta.1
#    in package.json and src/index.ts; new artifact frozen in H09-A; H09-B CI matrix green
#    (6 jobs with recorded run IDs); H09-C re-run on the new SHA-256.
git status --short                     # must be clean
pnpm lint && pnpm test && pnpm build && pnpm verify:package
npm pack --ignore-scripts --pack-destination ./release-artifacts
sha256sum ./release-artifacts/shivax-0.4.0-beta.1.tgz   # must equal the hash approved in H09-B/C

# 1. Publish the exact verified tarball to the beta dist-tag only (never 'latest').
npm whoami
npm publish ./release-artifacts/shivax-0.4.0-beta.1.tgz --tag beta --access public

# 2. Verify the registry: 'latest' must remain 0.3.2.
npm view shivax dist-tags --json       # expect {"latest":"0.3.2","beta":"0.4.0-beta.1"}
npm view shivax@0.4.0-beta.1 dist.integrity dist.shasum
```

**Stable 0.4.0** requires another explicit approval after all of:
- a beta canary period;
- feedback triage;
- a final candidate verification (H09-A to H09-D on the stable artifact);
- a separate `npm publish … --tag latest` decision.

**Rollback and unpublish contingency:**
- **Preferred:** `npm deprecate shivax@0.4.0-beta.1 "<reason>"`, then move or remove the tag (`npm dist-tag rm shivax beta`, or `npm dist-tag add shivax@<previous> beta`).
- **Unpublishing is not always possible.** npm policy restricts it, for example time windows and existing dependents. A published version number **can never be reused** even after unpublishing (as the registry's unpublished `0.1.0` shows). Plan to fix forward with `0.4.0-beta.2`.
- `latest` is untouched by a beta publish, so 0.3.2 users are unaffected.

## 12. Required user approval actions

None of these were performed by this phase.

1. **Accept or reject this NO-GO.** If you accept it, decide which findings must be fixed versus formally accepted:
   - H01D-02: deliver a reviewed transport, or formally descope it with a documented "no wire-level guarantee";
   - H03C-01;
   - H07D-01;
   - H03C-02, H03C-03, H03C-04.
2. **Decide the HANUMAN scope** for Jambavan and Kubera: implement them (H05-B), or formally move them out of 0.4.0 and update the CHANGELOG.
3. **Authorize CI execution:** push the branch to a remote whose CI runs, or add GitLab CI. Then archive the 6 job IDs, the logs and the packed SHA-256. Pushing is an owner action.
4. **Approve the version and metadata change** (0.4.0-beta.1 in `package.json` and `VERSION`, version-neutral description), and the documentation corrections H08C-01 and H08C-02. Then authorize a new H09-A to H09-C cycle on the new artifact.
5. **Decide on Inspectra coordination** for the 0.4.x dependency range (H08C-04). Inspectra must not be modified from this project.
6. **Publish only later:** after a future GO, give separate written authorization to publish the exact hashed tarball with `--tag beta`. Stable 0.4.0 needs a further approval.

## Changed paths

| Path | Change |
| --- | --- |
| `docs/audits/hanuman-h09-release.md` | New (this report) |

The `npm view` queries were read-only, and no registry state was changed. Nothing else changed:
- no source, version, description, tag, commit, push, publish or deploy;
- `hanuman-h09-security.md` was committed by the user as `caa275e` during this phase; packaged inputs are still identical to `1f81422`;
- consumers and logs are outside the repository or in the ignored `node_modules/h09d-*`.

**H09-D stops here.**
