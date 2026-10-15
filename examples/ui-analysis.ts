import { analyzeUI, normalizeUISnapshot, type UISnapshot, type Measurement } from 'shivax';

const computed = <T>(value: T): Measurement<T> => ({ status: 'known', value,
    provenance: { sourceType: 'url', kind: 'computed', method: 'specified example values' }, confidence: { score: 1 } });

const baseline: UISnapshot = {
    version: 1, sourceType: 'url', scope: { kind: 'personal', id: 'example' },
    viewport: { width: 320, height: 200, devicePixelRatio: 1 },
    coordinates: { unit: 'css-px', unitsPerCssPixel: 1, origin: 'viewport' },
    nodes: [
        { id: 'main', role: 'main', text: 'Example', bounds: computed({ x: 0, y: 0, width: 320, height: 200 }) },
        { id: 'title', role: 'heading', text: 'Hello', bounds: computed({ x: 20, y: 20, width: 200, height: 30 }),
            typography: { fontSize: computed(20), color: computed({ r: 20, g: 30, b: 40, a: 1 }) } },
    ],
    relationships: [{ from: 'main', to: 'title', type: 'parent-child',
        provenance: { sourceType: 'url', kind: 'computed', method: 'example hierarchy' }, confidence: { score: 1 } }],
};
const target = normalizeUISnapshot(baseline);
const font = target.nodes[1].typography?.fontSize;
if (font?.status === 'known') font.value = 24;

const result = analyzeUI(baseline, target, {
    contentPolicy: 'structural', tolerances: { fontSize: 0.5, spacing: 1 },
});
console.log(result.issues.map(({ property, expected, actual }) => ({ property, expected, actual })));
// [{ property: 'typography.fontSize', expected: 20, actual: 24 }]
