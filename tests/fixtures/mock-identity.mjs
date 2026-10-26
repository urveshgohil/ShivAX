/** Local test adapter only. No password/token verification is claimed. */
export function createMockIdentityProvider(identity) {
    return {
        identity, valid: true, verifications: 0,
        authenticate() { return this.identity; },
        isSessionValid() { this.verifications++; return this.valid; },
    };
}
