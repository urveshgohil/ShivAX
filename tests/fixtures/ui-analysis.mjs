export function measurement(value) {
    return { status: 'known', value: structuredClone(value), provenance: { sourceType: 'url', kind: 'computed', method: 'specified fixture measurement' }, confidence: { score: 1 } };
}
export function fixture() {
    const typography = (fontSize, fontWeight) => Object.fromEntries(Object.entries({ fontFamily: 'Arial', fontSize, fontWeight,
        lineHeight: 24, letterSpacing: 0, wordSpacing: 0, color: { r: 20, g: 30, b: 40, a: 1 }, textAlign: 'left' }).map(([key, value]) => [key, measurement(value)]));
    const nodes = [
        { id: 'root', role: 'main', text: 'Playground', bounds: measurement({ x: 0, y: 0, width: 800, height: 800 }) },
        { id: 'panel', role: 'section', text: 'Panel', bounds: measurement({ x: 20, y: 20, width: 600, height: 600 }), layout: {
            flexDirection: measurement('column'), paddingTop: measurement(20), paddingRight: measurement(20), paddingBottom: measurement(20), paddingLeft: measurement(20) } },
        { id: 'title', role: 'heading', text: 'Title', bounds: measurement({ x: 40, y: 40, width: 200, height: 24 }), typography: typography(20, 700) },
        { id: 'description', role: 'paragraph', text: 'Description', bounds: measurement({ x: 40, y: 80, width: 200, height: 24 }), typography: typography(16, 400) },
        { id: 'save', role: 'button', text: 'Save', bounds: measurement({ x: 40, y: 140, width: 100, height: 32 }) },
        { id: 'image', role: 'image', text: 'Preview', bounds: measurement({ x: 40, y: 200, width: 100, height: 100 }) },
    ];
    return { version: 1, sourceType: 'url', scope: { kind: 'personal', id: 'phase4-fixtures' },
        viewport: { width: 800, height: 800, devicePixelRatio: 1 },
        coordinates: { unit: 'css-px', unitsPerCssPixel: 1, origin: 'document' }, nodes,
        relationships: nodes.filter(n => n.id !== 'root').map(n => ({ from: n.id === 'panel' ? 'root' : 'panel', to: n.id,
            type: 'parent-child', provenance: { sourceType: 'url', kind: 'computed', method: 'fixture hierarchy' }, confidence: { score: 1 } })) };
}
export function paired() {
    const baseline = fixture(), target = fixture();
    for (const n of target.nodes) n.id = `target-${n.id}`;
    for (const r of target.relationships) { r.from = `target-${r.from}`; r.to = `target-${r.to}`; }
    return { baseline, target, node: (id) => target.nodes.find(n => n.id === `target-${id}`) };
}
export function unknown() { return { status: 'unknown', provenance: { sourceType: 'url', kind: 'unknown', method: 'not supplied' }, confidence: { score: null } }; }

// Synthetic browser-capture shape: aggregate body text, different framework wrappers,
// the same semantic title, and a direct measured color difference.
export function documentPair() {
    const baseline = fixture(), target = fixture();
    const bounds = () => measurement({ x: 20, y: 20, width: 400, height: 48 });
    baseline.nodes = [
        { id: 'old-body', role: 'document', text: 'Legacy page copy', bounds: bounds() },
        { id: 'old-layout', role: 'generic', text: 'Shared title', bounds: bounds() },
        { id: 'old-title', role: 'heading', text: 'Shared title', bounds: bounds(), typography: { color: measurement({ r: 25, g: 133, b: 104, a: 1 }) } },
    ];
    target.nodes = [
        { id: 'new-body', role: 'document', text: 'Revised page copy', bounds: bounds() },
        { id: 'new-main', role: 'main', text: 'Shared title', bounds: bounds() },
        { id: 'new-layout', role: 'generic', text: 'Shared title', bounds: bounds() },
        { id: 'new-title', role: 'heading', text: 'Shared title', bounds: bounds(), typography: { color: measurement({ r: 16, g: 24, b: 40, a: 1 }) } },
    ];
    for (const snapshot of [baseline, target]) snapshot.relationships = snapshot.nodes.slice(1).map((node, index) => ({
        from: snapshot.nodes[index].id, to: node.id, type: 'parent-child',
        provenance: measurement(1).provenance, confidence: { score: 1 },
    }));
    return { baseline, target };
}
