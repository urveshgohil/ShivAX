import { InspectraInspectionProvider } from 'shivax/adapters/inspectra';
import { registerInspectionService } from 'shivax/integrations';
/** Real host integration: inject approved navigation, isolated browser pages and resource policy. */
export function connectInspectra(tools, openPage, authorizeURL) {
    const provider = new InspectraInspectionProvider({ openPage });
    registerInspectionService(tools, provider, { authorizeURL });
    return provider;
}
// The separate adapter's test-live.mjs demonstrates actual local browser capture with blocked network.
