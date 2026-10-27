# Inspectra adapter for SHIVAX

This separately versioned, private ESM package implements SHIVAX's portable
`InspectionProvider`. It is not bundled into the SHIVAX npm artifact. Nothing is
published by this phase. Its peers are `shivax` and optionally `inspectra-engine`.
The package name in the inspected repository is **inspectra-engine 1.0.1**, not
`inspectra-automation`. The adapter uses the actual public
`inspectra-engine/node.captureUIPage(page, options)` API. It does not copy its
browser extraction, settling, screenshot or comparison engines.

The installed peer is imported lazily at capture time. A browser frontend should
provide a separate authenticated host client implementing `InspectionProvider`;
do not bundle this Node adapter or Playwright into React.

```js
import { InspectraInspectionProvider } from '@shivax/inspectra-adapter';

const provider = new InspectraInspectionProvider({
  // Supply an application-owned function; no default unrestricted browser launcher.
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

`hostBrowser` is an application integration point, not an Inspectra method. It
must return `{page, close, screenshot?}`: a loaded Playwright page at the requested
CSS viewport, idempotent cleanup, and optionally `{path, reference}` for a PNG
screenshot. Paths are host selected; reference is a safe opaque artifact handle.
The adapter forwards `path` only to Inspectra, returning only `reference` in the
observation. Capture requests never contain paths or browser commands.

The host must enforce its URL allowlist on navigation, redirects and subresources,
provide fresh isolated contexts per capture/session, honor cancellation during
page acquisition, and clean up partial acquisition failures. Root URL admission
alone is not a redirect/subresource firewall. Browser scripts execute in the
browser; SHIVAX does not execute page text as agent instructions.

The adapter calls `captureUIPage` with the verified session's scope, bounded
`maxNodes` (default 32, hard limit 64), `timeout` (default 15000ms), and optional
host screenshot path. Abort initiates lease cleanup once; final cleanup awaits
that same promise, even if the host's repeated `close()` calls would return early.
Capture remains pending until cleanup settles. Hosts must return a promise that
settles only when cleanup finishes; cleanup errors are reported without raw details.
Do not reuse a lease whose close function can affect another session.

Normalization retains Inspectra's snapshot measurements and nearest captured
DOM-ancestor relationships. It adds its computed `flexDirection`, `alignItems`
and `justifyContent` sidecar measurements to the existing layout fields. Numeric
`body/0/1` paths become positional `body > :nth-child(1) > :nth-child(2)` selectors;
these selectors are capture evidence, not durable identity or permission to act.
Only rendered-visible nodes are exported by Inspectra: offscreen nodes may be
included; hidden/clipped nodes are omitted. No hidden DOM inventory is claimed.

## Verification

From the SHIVAX repository root, after building:

```sh
node --test tests/inspection.test.mjs
node adapters/inspectra/test-live.mjs
node adapters/inspectra/refresh-fixtures.mjs
```

The last two commands explicitly require the existing sibling Inspectra checkout
and installed Playwright browser. `INSPECTRA_ROOT` can select another checkout;
`PLAYWRIGHT_BROWSERS_PATH` can select its installed browser cache. They do not
download dependencies or browsers. The test-only ESM loader resolves the local
uninstalled adapter's SHIVAX peer to the built local entry point.

The live test exercises the real public API with isolated pages, blocked external
requests, real screenshots and a RUDRA workflow. It deletes only its exclusively
created workspace fixture directory. The refresh command regenerates six checked-in
captures from the HTML fixture through the real extractor; provenance includes
Inspectra and Chromium versions. Unit tests replay these real captures offline.

The declaration deliberately keeps the leased page and optional module loader
structural/unknown, so SHIVAX declarations do not require Playwright or Node
ambient types. Runtime checks the module's actual `captureUIPage` export.
