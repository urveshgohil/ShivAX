# SARASWATI S07 — SDK exports, examples and documentation

| Field | Value |
| --- | --- |
| Phase | S07, run against the S07 phase prompt and `SHIVAX_v0.3_SARASWATI_Roadmap.md` §S07 |
| Release codename | **SARASWATI - The Intelligence & Learning Release** (0.3.0, unreleased) |
| Branch / base | `feat/saraswati-v0.3.0` at `580c8b2` (the user's commit of S06). Nothing committed, pushed, tagged or published |
| Date | 2026-11-08 |
| Prerequisites | S01–S06 **PASS**. S06 final state: lint 0, test 897/897, build 0, `verify:package` 0 |
| Release gate | **PASS** (for S07; publication is out of scope) |

## 1. Public API audit (step 1)

| Entry | Content |
| --- | --- |
| `.` (`shivax`) | Everything browser-safe, including all S01, S02 and S04–S06 additions |
| `./core`, `./rudra`, `./bots`, `./security`, `./models`, `./memory`, `./integrations`, `./learning`, `./diagnostics`, `./licensing/server`, `./adapters/inspectra` | Unchanged 0.2.0 entries. SARASWATI additions sit in `learning`, `memory` and `rudra` (types) |
| `./learning/node` | Added in S03. Node-only worker training (13 entries in total) |

**Additive exports.** `src/sdk/*` re-export the modules with `export *`. The
SARASWATI modules were added as one extra line each, and every 0.2.0 name is
still exported.

**`shivax/models` is unchanged.** SARASWATI added no model-provider
functionality, so `models` needed no new exports.

**Declarations and builds.**

- Declarations are emitted by `tsc`, plus CommonJS copies by
  `build-cjs-declarations`.
- Rollup builds ESM and CJS with shared chunks, plus the self-contained
  `learning-worker.mjs`.
- No public declaration references Node or DOM-only types (fixed in S03).

## 2. Export changes (step 2)

**None in S07.** Every completed feature was already exposed through existing
entry points in its own phase:

- S01, S02, S04 and S05 through `shivax/learning`;
- S06 ranking through `shivax/memory`, and its evaluation through
  `shivax/learning`;
- S05 hook types through `shivax/rudra`;
- S03 through the one Node-only subpath, `shivax/learning/node`. That subpath is
  needed so browser bundles never import `worker_threads`.

No other new public packages or subpaths were added. Root and subpath exports
were verified intact: the existing SDK tests check ESM/CJS key parity and
root-identity sharing for every entry.

## 3. Examples (step 3)

All examples are offline. They use only exported APIs (`shivax/*` self-imports)
with fake providers and demo identities, which are labelled as such.

| # | Scenario | Example |
| --- | --- | --- |
| 1 | Verified feedback curation | `examples/sdk/feedback-curation.mjs` (new): provenance, a Jay-verified reviewer attestation and curation |
| 2 | Dataset manifest creation | `feedback-curation.mjs`: prints and re-verifies the hashed manifest |
| 3 | Evaluation comparison | `benchmark.mjs` (S02) |
| 4 | Worker-based async training | `worker-training.mjs` (new): progress events, identical to synchronous training, host timer keeps ticking |
| 5 | Candidate version creation | `model-registry.mjs` (S04) |
| 6 | Human-approved promotion | `model-registry.mjs`: approver and activator are different people |
| 7 | Authorized rollback | `model-registry.mjs` |
| 8 | RUDRA shadow routing | `routing-shadow.mjs` (new): RUDRA runs `summer-a` while the advisor recommends `summer-b` from labelled evidence |
| 9 | Memory relevance search | `memory-ranking.mjs` (new): ranked results with provenance, MRR against the default search |

The new examples are listed in `examples/sdk/README.md`.

## 4. Packaging changes (step 4)

- **`package.json` `files` additions:**
  - the 4 new examples;
  - 7 SARASWATI guides: `docs/learning-evaluation.md`,
    `learning-governance.md`, `learning-benchmarks.md`,
    `learning-worker-training.md`, `learning-registry.md`,
    `learning-routing.md`, `memory-ranking.md`.

  The guides were added because the shipped README links to them; without them,
  the links would break in the tarball. No dependency or script changes.
- **`scripts/check-sdk-package.mjs`** runs 11 offline examples from the packed
  install (was 7).
- **No links outside the package.** No shipped doc or example references a
  sibling repository, and every relative Markdown link in the README,
  `learning-evaluation.md` and `production.md` resolves.
- **`npm pack --dry-run`:** `shivax@0.2.0`, 509 entries, 687,753 bytes packed,
  3,151,986 bytes unpacked, 16 example files, 10 docs. No path contains `..`.

## 5. Documentation (step 5)

| File | Change |
| --- | --- |
| `README.md` | New section "Coming in 0.3.0 SARASWATI - The Intelligence & Learning Release (unreleased)" covering existing ML capability, controlled feedback learning, CPU training, evaluation, human-approved promotion, optional providers, firewall protections, shadow routing and memory relevance, and the fine-tuning limits. Features list updated |
| `docs/production.md` | Worker note; new section "Learning and evaluation (SARASWATI)" with a capability-by-host-responsibility table, human approval, firewall, optional providers and limits |
| `docs/learning-evaluation.md` | SARASWATI additions with links to every guide |
| `SECURITY.md` | Scope note; new section "Learning lifecycle boundary" |
| `CHANGELOG.md` | Release-line table entry `0.3.x SARASWATI - The Intelligence & Learning Release (unreleased)`; `[Unreleased]` heading with a status, migration pointer and examples |
| `docs/sdk.md` | New section "Migrating to 0.3.0 SARASWATI": the breaking bot-id change, additive exports per entry, adoption steps |

The docs make no claim of autonomous intelligence growth. They state that LLM
fine-tuning is not provided and that quality figures come from constructed
fixtures.

## 6. Migration instructions

The full notes are in `docs/sdk.md` § Migrating to 0.3.0 SARASWATI. In short:

1. **Rename the code bot.** It is `vishwakarma` (was `vishwakarm`). This is the
   only breaking change, from commit `4d0a372`. Update firewall `bots` lists,
   policies and routing expectations. `VishwakarmBot` remains an alias.
2. **No existing code changes behaviour.** All other changes are additive and
   opt-in.
3. **Adopt features explicitly.** There is no automatic migration of feedback,
   models or routing:
   - wrap v1 feedback with `createGovernedFeedback`;
   - register models in a registry, then promote them through evidence and
     approval;
   - activate an empty routing policy first, so a rollback target exists.
4. **Keep `shivax/learning/node` out of browser bundles.** It is for Node only.

## 7. Compatibility (step 6)

| Check | Evidence |
| --- | --- |
| ESM imports | `verify:package`: packed install, every entry imported as ESM |
| CommonJS imports | `verify:package`: every entry `require`d, with key parity against ESM |
| TypeScript declarations | `verify:package`: a consumer imports all 13 entries |
| Bundler, Node16 and NodeNext resolution | `PASS declarations` for `ts/bundler`, `mts/Node16`, `cts/Node16`, `mts/NodeNext` and `cts/NodeNext` |
| Node 22+ | Tests and packed examples run on Node v22.23.2. `engines: >=22` is unchanged |
| Browser-safe entries | S03 test W15: no `node:` imports outside `learning-node` and the worker |
| Root and subpath exports preserved | `tests/sdk.test.mjs` (ESM/CJS parity and shared identity) and `tests/package.test.mjs` |

## 8. Package verification (step 7)

| Command | Result |
| --- | --- |
| `pnpm lint` | **exit 0** |
| `pnpm test` | **897 tests, 897 pass**, 0 fail, cancelled, skipped or todo (S07 added no tests; examples are verified from the packed install) |
| `pnpm build` | **exit 0**, 0 warning lines |
| `pnpm verify:package` | **exit 0**. Packed ESM/CJS imports passed; 13 documented example files present; **11 offline examples ran from the packed install in a fresh isolated consumer project**; packed worker training passed (ESM and CJS); declarations passed for 13 entries in 5 modes; **508 packaged files** (was 497) |
| `npm pack --dry-run` | **exit 0**, 509 entries (the extra entry is the `package.json` manifest count), 687,753 bytes |
| Each new example from source | exit 0 (output recorded during development) |

**Fresh install.** `verify:package` packs the SDK, installs the tarball into a
new temporary consumer project outside the repository, and runs the examples
from `node_modules/shivax/examples/sdk/`. The packed examples run are:

- `registry`, `local-model`, `rudra`, `memory-persistence`, `firewall`;
- `benchmark`, `model-registry`;
- `feedback-curation`, `worker-training`, `routing-shadow`, `memory-ranking`.

`ollama.mjs` is syntax-checked only, because it needs a local Ollama server.
`inspectra.mjs` is import-checked only, because it needs a browser.

## 9. Known limits

1. **Not released.** The version in `package.json` is still `0.2.0`, and the
   CHANGELOG marks 0.3.0 as unreleased. Bumping the version, tagging and
   publishing need approval and belong to S09.
2. **Examples are demos.** Their identities, approval and review journals and
   labelled data are stand-ins. The registry example uses the in-memory store,
   which does not survive restarts.
3. **`worker-training.mjs` is Node-only.** The browser has no packaged worker
   training.
4. **Guide links on GitHub.** The SARASWATI guides now ship in the package.
   Whether GitHub links resolve depends on the repository being public, which was
   not verified here.
5. **Open items carried over:**
   - S00 P0-1, the peer-range `ERESOLVE` between `shivax@0.2.0` and
     `inspectra-engine@1.1.0` (H01);
   - stale "0.2.0 not published" statements in `docs/release-readiness.md`;
   - the roadmap's universal rules still list `vishwakarm` (the bot id is
     `vishwakarma`).

## 10. Release gate (S07)

| Gate | Status |
| --- | --- |
| All 0.2.0 public APIs, root and subpath exports preserved | **PASS** |
| SARASWATI features exposed through existing entry points; no unnecessary new packages | **PASS** (only the Node-only `learning/node` subpath from S03) |
| Runnable offline examples for all 9 scenarios, using actual exports | **PASS** |
| Examples included in the npm tarball; no references to inaccessible sibling repositories | **PASS** |
| README, production, learning-evaluation, SECURITY, CHANGELOG and migration notes updated with the codename and required topics; no autonomous-intelligence claims | **PASS** |
| ESM, CJS, declarations, Node16, NodeNext, bundler and Node 22 compatibility | **PASS** |
| `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm verify:package`, `npm pack --dry-run`; fresh install runs the examples | **PASS** |
| Not published; no tags | **PASS** |

**S07: PASS.** S08 has not started.
