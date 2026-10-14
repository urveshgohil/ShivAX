/** Debounced, single-flight inference. UI supplies preprocessing and transport. */
export class LiveInference {
    constructor({ prepare, send, result, blank, delay = 160, schedule = (fn,ms) => globalThis.setTimeout(fn,ms), cancel = id => globalThis.clearTimeout(id) }) {
        Object.assign(this, { prepare, send, result, blank, delay, schedule, cancel });
        this.enabled = true; this.ready = false; this.revision = 0; this.sequence = 0;
        this.pending = null; this.timer = null; this.last = null; this.dirty = false; this.manualPending = false;
    }
    clearTimer() { if (this.timer !== null) this.cancel(this.timer); this.timer = null; }
    changed() {
        this.revision++; this.dirty = true; this.clearTimer();
        if (this.enabled && this.ready) this.timer = this.schedule(() => { this.timer = null; this.request(false); }, this.delay);
    }
    setEnabled(value) {
        this.enabled = value; this.clearTimer();
        if (value && this.ready) this.changed();
    }
    setReady(value) {
        this.reset(); this.ready = value;
        if (value && this.enabled) this.changed();
    }
    reset() {
        this.clearTimer(); this.revision++; this.pending = null; this.last = null; this.dirty = false; this.manualPending = false;
    }
    request(manual = true) {
        this.clearTimer();
        if (!this.ready) return;
        if (this.pending) { this.dirty = true; this.manualPending ||= manual; return; }
        const { pixels, blank } = this.prepare();
        this.dirty = false;
        if (blank) { this.last = null; this.blank(); return; }
        const signature = pixels.join(',');
        if (this.last?.signature === signature) { this.result({ ...this.last.response, cached: true }); return; }
        const requestId = ++this.sequence;
        this.pending = { requestId, revision: this.revision, signature };
        this.send({ type: 'predict', pixels, requestId });
    }
    receive(response) {
        if (!this.pending || response.requestId !== this.pending.requestId) return false;
        const pending = this.pending; this.pending = null;
        if (pending.revision === this.revision) {
            this.last = { signature: pending.signature, response }; this.result(response);
        }
        if (this.dirty && (this.enabled || this.manualPending) && this.ready && this.timer === null) {
            const manual = this.manualPending; this.manualPending = false;
            this.timer = this.schedule(() => { this.timer = null; this.request(manual); }, this.delay);
        }
        return true;
    }
    fail(requestId) {
        if (this.pending?.requestId === requestId) { this.pending = null; this.last = null; }
    }
}
