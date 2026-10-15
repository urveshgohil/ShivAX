import {
    normalizeUISnapshot, validateComparisonOptions, horizontalGap,
    type UISnapshot, type Measurement,
} from 'shivax';

// Caller-supplied estimates, not measurements extracted or predicted by ShivAX.
function estimated<T>(value: T): Measurement<T> {
    return {
        status: 'known', value,
        provenance: { sourceType: 'png', kind: 'estimated', method: 'manual annotation' },
        confidence: { score: 0.7 },
    };
}
const snapshot: UISnapshot = {
    version: 1,
    sourceType: 'png',
    scope: { kind: 'personal', id: 'example-only' },
    viewport: { width: 800, height: 600, devicePixelRatio: 2 },
    coordinates: { unit: 'image-px', unitsPerCssPixel: 2, origin: 'viewport' },
    nodes: [
        { id: 'title', bounds: estimated({ x: 40, y: 40, width: 200, height: 60 }),
            typography: { fontSize: estimated(32) } },
        { id: 'button', bounds: estimated({ x: 280, y: 40, width: 160, height: 60 }) },
    ],
    relationships: [],
};
const normalized = normalizeUISnapshot(snapshot);
validateComparisonOptions({ geometryToleranceCssPx: 0.5, minConfidence: 0.6 });
const [title, button] = normalized.nodes;
if (title.bounds.status === 'known' && button.bounds.status === 'known') {
    console.log(horizontalGap(title.bounds.value, button.bounds.value)); // 20 CSS px
}
