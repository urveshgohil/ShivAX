# ShivAX B02 — TypeScript helper warnings

Date: 2026-11-01 (Asia/Calcutta). Package: `shivax@0.1.2`.
Prior results: [B00](build-baseline.md), [B01](optional-inspectra-b01.md).

## Decision and changes

Use `target: ES2022` and `lib: ["ES2022", "DOM"]`, retaining native private
fields/methods instead of emitting TypeScript private-field helpers. These two
settings were already changed in the working tree when B02 began and were
retained. Explicitly set **`useDefineForClassFields: false`** to preserve the
previous public-field assignment semantics instead of accepting ES2022's changed
default. This setting does not prevent native private fields or reintroduce the
helper warnings.

`strict: true`, `module: ESNext`, `moduleResolution: bundler`, declaration
generation, output locations, and all existing package exports remain unchanged.
No source implementation, licensing policy, or API was changed in B02. No Rollup
warning handler, suppression filter, module context override, or runtime
dependency was added. The B01 Rollup external predicate remains intact.

Added an ESM/CJS subclass-initialization regression in
`tests/class-fields.test.mjs`. README and SDK documentation now distinguish
ES2022 runtime syntax from the still-portable ES2020 public declarations.

## Helper inspection and root cause

Before rebuilding, `dist/licensing/index.js` and the learning, memory, security,
and other generated modules contained guards such as:

```js
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (...) { ... };
```

With ES2020 output, TypeScript lowered private state into WeakMap/WeakSet storage
and inline helpers. Their module-level `this` reuse guards caused Rollup's
`THIS_IS_UNDEFINED` warnings because the input files are ES modules. The guard
was the cause, rather than an incorrect receiver inside the ShivAX methods.

After the change, licensing emits `#verify` and directly calls `this.#verify`;
ToolLease emits its native private controller, state, and methods. A scan of all
**178 generated `.js`/`.cjs` files**, including both chunk trees, found no
`__classPrivateFieldGet`, `__classPrivateFieldSet`, `__classPrivateFieldIn`, or
`(this && this.__...)` helper guard. Both Rollup graph builds complete without
warnings. No global warning suppression was used.

## Class field initialization review

TypeScript documents that standard class fields use different runtime behavior
from its historical field implementation; its class handbook also explains the
base/derived initialization order and redeclaration risks.
Sources: [TSConfig useDefineForClassFields](https://www.typescriptlang.org/tsconfig/useDefineForClassFields.html),
[TypeScript class initialization](https://www.typescriptlang.org/docs/handbook/2/classes.html#initialization-order).

Reviewed 51 TypeScript-emitted classes, including the error subclasses, seven
specialist subclasses, ServerLicenseGate, ToolLease, MemoryTaskLifecycle,
ModelRouter, NeuralNet, and Tensor. None of the emitted derived classes declares
its own instance fields, so there is no current derived field redeclaration that
would overwrite state established by its base constructor.

The private field initializers allocate local containers, counters, controllers,
or helper instances. ToolLease's `#cancel` initializer creates a closure using
the earlier `#controller`; it does not execute the callback during field setup.
Constructor-assigned dependencies remain assigned before use. Licensing still
binds `verifier.verify` to the host verifier and validates product, subject,
scope, features, expiry, revocation, and cancellation through the same code.

Keeping `useDefineForClassFields: false` matters even when the existing tests
pass with standard fields: public field definitions can bypass an inherited
setter, and previously erased uninitialized TypeScript fields can become own
properties with value `undefined`. The new regression constructs a Tensor
subclass with an inherited `shape` setter, checks that it is invoked once, and
checks indexing and matrix multiplication afterward, in both ESM and CJS.
This protects an observable initialization behavior instead of merely checking
compiler configuration text. Native private brands/state remain private and
are initialized by the engine; the public assignment strategy stays explicit.

## Runtime compatibility

**Node:** The minimum `engines.node: >=22` remains appropriate. Node 22.0.0
ships V8 12.4 ([official release notes](https://nodejs.org/en/blog/release/v22.0.0)),
and the complete final suite passed on the exact minimum Node **22.0.0**, as
well as the development Node **26.13.0**. A standalone official Windows x64 Node
22.0.0 executable was downloaded into the host temp directory for testing, without
changing the selected/global Node installation. Its SHA256 matched the
[official checksum manifest](https://nodejs.org/dist/v22.0.0/SHASUMS256.txt):

```text
db174445b3d28314772bc3918e39d8543cfbd18d542cf2a662f431f5cdc259ea
```

**Browsers:** ShivAX documents browser bundles but had no minimum-browser version
matrix. The emitted code now requires native private class fields/methods unless
the application transpiles dependency code. Modern-browser support for these
features is documented by [MDN private elements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_elements)
and [MDN public class fields](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Public_class_fields).
The TypeScript-emitted JavaScript also parsed successfully as ECMAScript 2022
during the emitted-class review.

An actual Chromium **156.0.8078.4** smoke test served the generated ESM files and
chunks over localhost, loaded all 12 public runtime entrypoints through their
ESM output paths, and ran Tensor matrix multiplication, deterministic XOR
training/classification, specialist construction, and ModelRouter construction
and disposal. All passed. The adapter entry used an import map for its lazy
ShivAX self-reference; Inspectra was not loaded in the browser.

This is not a claim that every old browser is supported: the syntax floor rises
from ES2020 to ES2022. ES2020-only browsers need the application's transpilation
step. No Firefox/WebKit or historical browser-version matrix was executed.
The README/SDK now state that limitation explicitly. ES2022 compilation also
does not polyfill fetch, crypto, IndexedDB, or other feature-specific host APIs.
The optional live Inspectra feature retains its separate Node >=22.15 floor.

## Final verification

| Check | Result |
| --- | --- |
| `pnpm build` | Pass: existing cleaner, TypeScript, then both Rollup configurations; no warnings |
| `pnpm test` | Pass: clean rebuild plus **458/458** tests on Node 26.13.0; zero failed/skipped/cancelled |
| Standalone Node 22.0.0 `--test tests/*.test.mjs` | **458/458** passed; zero failed/skipped/cancelled |
| `pnpm lint` | Pass: strict no-emit TypeScript check and ESLint |
| Licensing regression | SDK tests for verified grants, subject/scope/product/feature/expiry, revocation and cancellation pass |
| Security, Memory, Learning, RUDRA, Model router | Their full existing suites pass on both Node versions |
| NeuralNet and Tensor | Foundations/neuralnet-core suites, deterministic legacy ESM/CJS checks, and new subclass checks pass |
| `npm run verify:package` | Pass: all 12 packed ESM/CJS imports and strict ES2020/bundler declarations; 299 packaged files |
| ES2020 vs ES2022 declaration comparison | **110 declaration files, zero byte differences** |
| Browser smoke | All 12 ESM entrypoints and the runtime checks above pass in Chromium |
| B01 optional-provider integration script | Pass: ESM/CJS without Inspectra, then default-loader Chromium capture with installed 1.0.4, normalization, screenshots and cleanup |
| Generated output scan | No private-field helpers/guards across 178 JS outputs; no `THIS_IS_UNDEFINED` or unresolved dependency build warning |
| Whitespace validation | `git diff --check` passes |

The declaration comparison compiled the current source separately to a temporary
directory with `--target ES2020 --lib ES2020,DOM --useDefineForClassFields false`,
then compared every emitted `.d.ts` against the ES2022 build. Existing declaration
consumer checks still use ES2020 alone and no ambient platform types. Raising
the build's library configuration has not added a newer library requirement to
the public types.

Full regressions, rather than only module imports, exercise cancellation,
pending cleanup ownership, authentication/authorization, model budgets, memory
preconditions, learning updates, neural gradients and training determinism.
There was no compatibility test failure requiring a fallback target. Explicit
assignment semantics are the precaution against an unrelated default change.

The Node 26 test-loader deprecation remains separate from Rollup. The B00
Node16-mode CommonJS declaration mismatch and lockfile reproducibility concern
are outside B02. Historical audit documents retain their original findings.

No publication occurred. Phase B02 stops here.
