# Inspectra adapter for ShivAX

The `shivax/adapters/inspectra` entry point provides ShivAX's `InspectionProvider`
interface on top of Inspectra. It ships with ShivAX in ESM and CommonJS formats.
The nested `@shivax/inspectra-adapter` manifest is private development metadata.
It is not a separate published package.

The optional peer is **inspectra-engine ^1.0.4** (stable >=1.0.4 <2.0.0). Versions
1.0.4 and 1.1.0 are verified with clean npm installs and real offline browser
captures, and 1.2.0 with live ESM and CommonJS capture, normalization, screenshot
and cleanup checks. Future 1.x compatibility assumes the same
`captureUIPage` and snapshot/metadata APIs; rerun the matrix for new releases.
Prereleases and 2.x are outside this range. Install Inspectra when you need live
capture. ShivAX does not require it, and the optional peer setting lets you leave
it out. Package managers may still install it in ShivAX's own development
checkout. Live capture needs Node 22.15+ and a Playwright browser and page set up
by your host. The adapter calls Inspectra's public
`inspectra-engine/node.captureUIPage(page, options)` API. It does not copy
Inspectra's page extraction, settling, screenshot or comparison code.

The adapter loads the installed peer only when a capture starts. A browser front
end should use its own signed-in host client that implements `InspectionProvider`.
Do not bundle this Node adapter or Playwright into React.

```js
import { InspectraInspectionProvider } from 'shivax/adapters/inspectra';

const provider = new InspectraInspectionProvider({
  // Supply your own function. There is no default browser launcher with open access.
  openPage: async (request, context) => {
    return hostBrowser.openApprovedPage({
      url: request.url,
      viewport: request.viewport,
      principal: context.principal,
      session: context.session,
      signal: context.signal,
    });
  },
});
```

CommonJS hosts can use
`const { InspectraInspectionProvider } = require('shivax/adapters/inspectra')`.
Both formats load Inspectra's ESM-only `/node` entry through dynamic `import()`.
Importing or creating the adapter does not load Inspectra. If loading fails, a
capture returns fixed install steps. If the loaded module has no `captureUIPage`,
it returns an incompatible-API error. Errors never include provider exceptions,
paths or secrets. Cancellation and cleanup errors keep their usual priority.

`hostBrowser` is your application's code, not an Inspectra method. It must return
`{page, close, screenshot?}`: a loaded Playwright page at the requested CSS
viewport, a `close` function that is safe to call more than once, and, if you
want a PNG screenshot, `{path, reference}`. Your host picks the path. The
reference is a safe, opaque handle for the file. The adapter passes `path` only to
Inspectra and returns only `reference` in the result. Capture requests never
contain paths or browser commands.

Your host must apply its URL allowlist to navigation, redirects and every
subresource. It must give each capture or session a fresh, isolated context,
honor cancellation while it opens the page, and clean up if opening fails partway.
Checking only the first URL does not stop redirects or subresources. Page scripts
run in the browser. ShivAX never treats page text as instructions for its agents.

The adapter calls `captureUIPage` with the signed-in session's scope, a node cap
(`maxNodes`, 32 by default, 64 at most), a `timeout` (15000 ms by default) and an
optional screenshot path from the host. Cancelling starts page cleanup once. Final
cleanup waits on that same promise, even if repeated `close()` calls return early.
A capture stays pending until cleanup finishes. Your `close` must return a promise
that settles only when cleanup is done. Cleanup errors are reported without raw
details. Do not reuse a page whose `close` function could affect another session.

The adapter keeps Inspectra's snapshot measurements and the links to each node's
nearest captured parent. It adds Inspectra's `flexDirection`, `alignItems` and
`justifyContent` values to the layout fields. Numeric paths like `body/0/1` become
selectors like `body > :nth-child(1) > :nth-child(2)`. These selectors record
where a node was during capture. They are not stable IDs, and they do not grant
permission to act. Inspectra exports only nodes that render as visible. Offscreen
nodes may appear, while hidden or clipped nodes do not. The adapter makes no claim
to list hidden DOM nodes.

## Verification

These checks are for maintainers. The test files, fixtures and scripts they use
are in the ShivAX source repository, not in the npm package.

From the ShivAX repository root, after building:

```sh
node --test tests/inspection.test.mjs
node adapters/inspectra/test-live.mjs
node adapters/inspectra/refresh-fixtures.mjs
```

To check both built adapter formats with the default loader, build first. Then
set `INSPECTRA_ROOT` to an installed `inspectra-engine` package folder in the supported range and
run `node scripts/check-inspectra-package.mjs`. The check builds a separate
package layout and checks imports and capture errors with Inspectra missing. It
then links the installed provider and runs real Chromium capture, layout
normalization, screenshots and page cleanup in ESM and CJS. It installs nothing,
leaves the provider unchanged, and deletes its temporary layout when done.

For the clean-install release matrix, run `node scripts/check-inspectra-matrix.mjs`
after building. Set `SHIVAX_NPM_CLI` to the absolute npm CLI path,
`PLAYWRIGHT_BROWSERS_PATH` to the installed browser cache, and optionally
`INSPECTRA_CANDIDATE` to a local Inspectra directory or tarball. The check packs
the candidate without running its scripts or editing its source. It creates fresh
consumers under the OS temporary directory, installs with normal npm peer checks,
runs `npm ls --all`, all ESM/CJS exports, five TypeScript modes, real offline
capture and security/cancellation/cleanup probes, and 60 firewall/model regressions
per consumer. Logs, tarballs and lockfiles are retained in the printed directory.
No force or legacy-peer resolution flags are used. Missing-provider capture is
expected to fail safely; browser capture is not applicable to that consumer.

The last two commands need the sibling Inspectra checkout and an installed
Playwright browser. `INSPECTRA_ROOT` can point to another checkout, and
`PLAYWRIGHT_BROWSERS_PATH` can point to its browser cache. They do not download
dependencies or browsers. The test-only ESM loader points the local adapter's
ShivAX peer at the local build.

The live test runs the real public API with isolated pages, blocked external
requests, real screenshots and a RUDRA workflow. It deletes only the fixture
folder it created. The refresh command rebuilds six saved captures from the HTML
fixture with the real extractor, and records the Inspectra and Chromium versions.
Unit tests replay these saved captures offline.

The type declarations leave the page and the optional module loader as loose or
`unknown` types on purpose. This way, ShivAX's types do not need Playwright or
Node's global types. At runtime, the adapter checks that the module has a
`captureUIPage` export.
