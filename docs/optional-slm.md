# Optional local SLM reasoning (Phase 9)

ShivAX exports `SLMProvider`, `SLMClient`, `OllamaProvider` and
`analyzeUIWithSLM`. Existing `NeuralNet`, matching and `analyzeUI` APIs are
unchanged. No runtime dependencies, model weights, downloads, UI or scanner
backend are added. Use a trusted local Node.js runner with Node 22+ and an
already installed Ollama model that supports JSON schema output.

```ts
import { OllamaProvider, SLMClient, analyzeUIWithSLM } from 'shivax';

// baseline and target are validated, normalized UISnapshots in the same scope.
const provider = new OllamaProvider({
    model: 'my-installed-local-model', // configure a model you installed separately
    baseURL: 'http://127.0.0.1:11434',
    limits: { contextTokens: 8192, maxOutputTokens: 1024 },
});
const slm = new SLMClient(provider, {
    scope: baseline.scope,
    enabled: true, // omitted = disabled, with zero inference calls
    timeoutMs: 30_000,
});
const abortController = new AbortController();
try {
    const result = await analyzeUIWithSLM(baseline, target, {
        analysis: { contentPolicy: 'structural' },
        slm,
        tasks: ['semantic-matching', 'content-relationships', 'issue-descriptions', 'css-suggestions'],
        signal: abortController.signal, // optional caller-owned AbortController
    });
    // result.analysis is exactly the existing deterministic analyzeUI result.
    // result.reasoning contains advisory evidence selections or deterministic fallback.
} finally {
    await slm.dispose();
}
```

Omit `slm` for deterministic fallback. Omit `tasks` to enable the four reasoning
tasks above. Use `tasks: ['semantic-matching', 'content-relationships']` when
you only need semantic reasoning; ordinary numeric differences do not trigger
inference in that mode. Empty tasks or no eligible work also skip inference.
All numeric comparison always runs in the existing deterministic engine.

Keep `analysis.issues` as the complete measured result when presenting SLM
advice. Empty/invalid model output and a smaller advice selection never remove
those issues. Scanner UI-check findings are an additional supplied source, not
a reason to hide canonical analysis. An exported report without SLM execution
metadata does not establish that Ollama ran; the current Inspectra compare
runner calls `analyzeUI` directly.

Color comparison requires captured `typography.color` measurements. Missing
color data in an old scene graph cannot be reconstructed by an SLM: recapture
the pages. Inspectra now records computed RGB/sRGB components without extra
rounding and uses explicitly recorded browser-rendered 8-bit sRGB normalization
for other supported CSS color spaces.

For dynamic repeated content, Inspectra identifies short painted inline category
badges and records the inferred classification and confidence in capture metadata.
Category names determine color comparability: different names do not produce
badge color findings, while the same category retains measured comparisons after
reordering. DOM checks use a repeated item's heading to disambiguate duplicate
category names when available. Unresolved canonical badge identities stay
uncertain. This rule does not disable typography or spacing checks, or normal
heading color comparisons, and it does not require model inference.

These rules are site-independent: production code has no category-name or color
allowlist and does not import test fixtures. Flex/grid groups and semantic lists
(`ul`, `ol`, or `role="list"`) supply repeated-content context. Classification is
an inferred structural heuristic, not a guarantee about every possible markup.
Tests generate reproducible labels and palettes from seeds and exercise different
languages, counts, element tags and layouts. In Inspectra, run
`npm run test:dynamic-content` for this contract after changes or before a version
update; the existing `npm run test:ui-check` also includes it. These regressions
check that changed content does not create false color issues while a real
measured color change still gets reported. Existing public APIs are unchanged.

The model receives node IDs, roles, text, supplied relationships, ambiguous
candidates and issue metadata. Context includes nodes referenced by the requested
issues, candidates and content relationships, plus one hop of connected nodes.
Unrelated page text and accepted matches are excluded. Node text is kept whole,
and relationship indices still identify the original snapshots. If the relevant
context exceeds the budget, the entire request falls back without truncation.
Measurements are excluded from the issue
prompt. It selects existing ambiguous candidate pairs, corresponding content
relationships, description focus and whether measured CSS evidence is useful.
It may abstain with empty arrays. Proposals never replace accepted matches,
resolve deterministic uncertainty or create additional measured issues.

Output is a strict JSON object with `semanticMatches`, `relationships` and
`issues` arrays (at most 128 entries each). Unexpected fields, duplicate or
conflicting selections, invented IDs, unsupported relationships, malformed
JSON and supplied values/prose are rejected atomically. ShivAX validates both
shape and evidence references; an Ollama JSON schema alone is insufficient.

Descriptions use deterministic templates selected by the model. CSS suggestions
are structured property/value/unit data copied from direct baseline typography
or layout evidence, with the original confidence and provenance attached.
They contain no generated values or executable CSS. Bounds alone never become
CSS declarations. Unknown measurements remain unknown. All advice requires
review; SLM selections have inferred provenance and `confidence.score: null`
because model confidence is uncalibrated. Unselected issues retain deterministic
descriptions and measured CSS evidence. This constrained format deliberately
excludes unrestricted model prose and arbitrary CSS synthesis.

`reasoning.source` is `slm` only after validation succeeds, otherwise
`deterministic`. `reasoning.diagnostic` explains disabled inference, no work,
scope mismatch, unavailable models, timeouts, cancellation, budget failures,
invalid output or provider failures. Fallback preserves all deterministic
issues and measured values and leaves semantic uncertainty unresolved.
Snapshot/options validation errors still throw, as with `analyzeUI`.

Each client belongs to one immutable company or personal scope; cross-scope
snapshots fail before provider access, and a client refuses a different scope.
Use one provider/client per scope. ShivAX stores no history, page-data cache or
logs. External providers require both `enabled: true` and `allowExternal: true`;
the built-in Ollama adapter only accepts loopback origins, forbids redirects,
and rejects cloud names or remote model metadata. It checks model metadata
before each inference and sends a fresh two-message chat with `keep_alive: 0`.
The local server remains a trust boundary: configure Ollama with
`OLLAMA_NO_CLOUD=1` for server-enforced local-only inference and control its
logging independently. See [Ollama's local-only configuration](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features).

`SLMProvider` supplies `id`, `locality`, `limits`, `initialize(signal)`,
`generate(request)` and `dispose(signal)`. A provider returns raw JSON text and
must honor cancellation, enforce its model's token limits and avoid retaining
page data. `SLMClient.generateJSON(scope, input, validate, signal?)` also supports
custom evidence schemas: pass a schema for generation and a runtime validator
that checks its shape and references and returns the validated value or throws.
Provider failures are reduced to fixed error codes/messages, without provider
bodies or prompts. There are no automatic retries.

Public declarations use portable `SLMSignal`, `SLMFetch`, `SLMFetchOptions` and
`SLMFetchResponse` contracts. Existing core-only TypeScript consumers can use
`lib: ["ES2020"]` without DOM or Node ambient types. Native abort signals satisfy
`SLMSignal`; the default adapter still uses the runtime's native fetch.

Client state moves from `idle` to `ready` after successful initialization, and
to terminal `disposed` on disposal. Initialization and generation share one
deadline (default 30 seconds, maximum 5 minutes). An active request prevents
concurrent reuse (`busy` fallback); disposal cancels it and performs bounded,
idempotent cleanup. Failed initialization can be retried explicitly. A cancelled
or timed-out caller stops waiting even if a custom provider ignores its signal;
custom providers remain responsible for stopping their underlying work. The
client retains its busy guard until that operation settles, including async
cancellation cleanup. A provider that never settles leaves the client busy;
dispose it and use a fresh provider/client instead of reusing the in-flight provider.

Input limits use a conservative UTF-8 byte estimate, including schema, a
512-token template reserve and the requested output budget. This is not an
exact model tokenizer. Oversized context is rejected without truncation or
provider calls. Ollama's `num_ctx` and `num_predict` enforce configured limits;
reported token counts and completion status are checked after generation, and
truncated responses fall back. Model metadata must advertise a sufficient
context length. Response bytes are bounded too. Conservative checks can reject
input that a model's exact tokenizer would otherwise accept.

The adapter follows Ollama's [structured chat API](https://docs.ollama.com/api/chat).
Tests use explicit provider/transport fixtures; they require no installed model
and make no claims about a particular model's reasoning quality. Run
`pnpm build && node --test tests/slm.test.mjs` for the focused contract tests.
