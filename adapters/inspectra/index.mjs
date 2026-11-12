import { validateInspectionObservation } from 'shivax';

/** Translate actual Inspectra PageCapture data, not an invented scan shape. */
export function normalizeInspectraCapture(raw, { scope, screenshotReference } = {}) {
    if (!raw || raw.snapshot?.sourceType !== 'url' || !raw.metadata?.nodes)
        throw new TypeError('Invalid Inspectra capture.');
    // Inspectra output is trusted adapter data; ShivAX's validator snapshots and bounds the result.
    const snapshot = structuredClone(raw.snapshot);
    const details = raw.metadata.nodes;
    const elements = snapshot.nodes.map((node) => {
        const entry = details[node.id];
        if (!entry || typeof entry.tag !== 'string' || typeof entry.path !== 'string')
            throw new TypeError('Incomplete Inspectra metadata.');
        const parts = entry.path.split('/');
        const selector =
            parts[0] === 'body' &&
            parts.slice(1).every((p) => /^(0|[1-9]\d*)$/.test(p) && Number.isSafeInteger(Number(p)))
                ? 'body' +
                  parts
                      .slice(1)
                      .map((p) => ` > :nth-child(${Number(p) + 1})`)
                      .join('')
                : null;
        // These measured properties live in Inspectra's metadata sidecar, not UISnapshot v1.
        node.layout ??= {};
        for (const key of ['flexDirection', 'alignItems', 'justifyContent']) {
            if (entry.flexGrid?.[key] !== undefined)
                node.layout[key] = structuredClone(entry.flexGrid[key]);
        }
        return {
            nodeId: node.id,
            selector,
            domPath: entry.path,
            tag: entry.tag,
            visibility: 'visible',
        };
    });
    return validateInspectionObservation(
        {
            version: 1,
            providerId: 'inspectra-engine',
            trust: 'untrusted',
            snapshot,
            elements,
            screenshot:
                raw.screenshot && screenshotReference
                    ? {
                          status: 'available',
                          width: raw.screenshot.width,
                          height: raw.screenshot.height,
                          mimeType: 'image/png',
                          reference: screenshotReference,
                      }
                    : { status: 'unavailable' },
        },
        scope
    );
}

/** The host's lease owns navigation and browser isolation; Inspectra owns extraction/settling. */
export class InspectraInspectionProvider {
    id = 'inspectra-engine';
    #openPage;
    #load;
    #maxNodes;
    #timeout;
    constructor({
        openPage,
        load = () => import('inspectra-engine/node'),
        maxNodes = 32,
        timeout = 15000,
    } = {}) {
        if (
            typeof openPage !== 'function' ||
            typeof load !== 'function' ||
            !Number.isInteger(maxNodes) ||
            maxNodes < 1 ||
            maxNodes > 64 ||
            !Number.isInteger(timeout) ||
            timeout < 1 ||
            timeout > 300000
        )
            throw new TypeError('Invalid Inspectra adapter configuration.');
        this.#openPage = openPage;
        this.#load = load;
        this.#maxNodes = maxNodes;
        this.#timeout = timeout;
    }
    async capture(request, context) {
        let lease;
        let cleanup;
        let failureMessage = 'Inspectra capture failed.';
        const checkDestination = (url) => {
            context.checkExecution?.(); context.signal.throwIfAborted();
            context.checkNetworkAccess?.(url);
        };
        // The host acknowledges this exact per-capture lease contract. Never accept it from task data.
        const security = context.checkNetworkAccess ? Object.freeze({
            owner: Object.freeze({ issuer: context.principal.issuer, principalId: context.principal.id,
                sessionId: context.session.id, scope: Object.freeze({ ...context.session.scope }) }),
            checkDestination, maxNodes: this.#maxNodes, timeoutMs: this.#timeout,
        }) : undefined;
        // Abort and finally must await the same invocation, including synchronous
        // close failures and hosts whose repeated close calls return immediately.
        const close = () => (cleanup ??= Promise.resolve().then(() => lease.close()));
        const onAbort = () => {
            void close().catch(() => {});
        };
        try {
            context.checkExecution?.();
            context.signal.throwIfAborted();
            checkDestination(request.url);
            failureMessage =
                'Inspectra is unavailable. Install optional peer inspectra-engine in the supported peer range and its dependencies, or provide a compatible load function exposing captureUIPage.';
            const api = await this.#load();
            failureMessage = 'Inspectra capture failed.';
            context.checkExecution?.();
            context.signal.throwIfAborted();
            if (typeof api?.captureUIPage !== 'function') {
                failureMessage =
                    'Incompatible Inspectra API: expected captureUIPage(page, options) from inspectra-engine/node. Use a supported release or provide a compatible load function.';
                throw new Error('Unsupported Inspectra API.');
            }
            // openPage must enforce allowed navigation, redirects and subresources, and clean up on rejection.
            checkDestination(request.url);
            lease = await this.#openPage(request, context, security);
            if (!lease?.page || typeof lease.close !== 'function')
                throw new Error('Invalid page lease.');
            if (security && lease.security !== security) {
                failureMessage = 'Inspectra host must acknowledge the protected page security contract.';
                throw new Error('Unbound page lease.');
            }
            context.signal.addEventListener('abort', onAbort, { once: true });
            try {
                context.checkExecution?.();
                context.signal.throwIfAborted();
                checkDestination(request.url);
                if (security && lease.screenshot) {
                    if (!context.checkFileAccess) throw new Error('Protected screenshot requires file authorization.');
                    context.checkFileAccess(lease.screenshot.path, 'write');
                }
                const raw = await api.captureUIPage(lease.page, {
                    scope: context.session.scope,
                    maxNodes: this.#maxNodes,
                    timeout: this.#timeout,
                    includeText: true,
                    ...(lease.screenshot ? { screenshotPath: lease.screenshot.path } : {}),
                });
                context.signal.throwIfAborted();
                context.checkExecution?.();
                if (!Array.isArray(raw?.snapshot?.nodes) || raw.snapshot.nodes.length > this.#maxNodes)
                    throw new Error('Inspectra node limit exceeded.');
                return normalizeInspectraCapture(raw, {
                    scope: context.session.scope,
                    screenshotReference: lease.screenshot?.reference,
                });
            } finally {
                context.signal.removeEventListener('abort', onAbort);
            }
        } catch {
            throw new Error(
                context.signal.aborted ? 'Inspection cancelled.' : failureMessage
            );
        } finally {
            if (lease && typeof lease.close === 'function') {
                try {
                    await close();
                } catch {
                    throw new Error('Inspectra cleanup failed.');
                }
            }
        }
    }
}
