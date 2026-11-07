const measurement = value => ({ status: 'known', value,
    provenance: { sourceType: 'url', kind: 'computed', method: 'synthetic fixture' }, confidence: { score: 1 } });
export function scene(prefix, entries) {
    return {
        version: 1, sourceType: 'url', scope: { kind: 'personal', id: 'matching-fixtures' },
        viewport: { width: 1200, height: 900, devicePixelRatio: 1 },
        coordinates: { unit: 'css-px', unitsPerCssPixel: 1, origin: 'document' },
        nodes: entries.map(([id, role, text, , x = 0, y = 0]) => ({ id: `${prefix}${id}`, role, text,
            bounds: measurement({ x, y, width: 200, height: 60 }) })),
        relationships: entries.filter(e => e[3]).map(([id, , , parent]) => ({
            from: `${prefix}${parent}`, to: `${prefix}${id}`, type: 'parent-child',
            provenance: { sourceType: 'url', kind: 'computed', method: 'fixture hierarchy' }, confidence: { score: 1 },
        })),
    };
}
export const page = [
    ['main', 'main', ''],
    ['services', 'section', '', 'main', 0, 100],
    ['services-title', 'heading', 'Our services', 'services', 0, 100],
    ['alpha', 'group', '', 'services', 0, 180],
    ['alpha-title', 'heading', 'Analytics', 'alpha', 0, 180],
    ['alpha-copy', 'paragraph', 'Explore your reports', 'alpha', 0, 240],
    ['alpha-button', 'button', 'Open', 'alpha', 0, 300],
    ['alpha-image', 'image', '', 'alpha', 0, 360],
    ['beta', 'group', '', 'services', 400, 180],
    ['beta-title', 'heading', 'Automation', 'beta', 400, 180],
    ['beta-copy', 'paragraph', 'Run local checks', 'beta', 400, 240],
    ['beta-button', 'button', 'Open', 'beta', 400, 300],
    ['contact', 'section', '', 'main', 0, 500],
    ['contact-title', 'heading', 'Contact us', 'contact', 0, 500],
    ['contact-copy', 'paragraph', 'Get in touch', 'contact', 0, 560],
];
const copy = () => structuredClone(page);
export const corpus = [
    { name: 'identical semantics, unrelated local IDs', reference: scene('r-', page), target: scene('t-', page), expected: page.map(e => [ `r-${e[0]}`, `t-${e[0]}` ]) },
    (() => {
        const target = copy();
        target.push(['wrapper', 'generic', '', 'services']);
        for (const e of target) if (e[3] === 'alpha') e[3] = 'inner';
        target.push(['inner', 'generic', '', 'alpha']);
        target.find(e => e[0] === 'alpha')[3] = 'wrapper';
        target.find(e => e[0] === 'alpha-title')[1] = 'h2';
        target.find(e => e[0] === 'alpha-image')[1] = 'img';
        return { name: 'different nested neutral wrappers and equivalent role aliases', reference: scene('r-', page), target: scene('t-', target), expected: page.map(e => [`r-${e[0]}`, `t-${e[0]}`]) };
    })(),
    (() => {
        const target = copy();
        // Move whole sections and reorder arrays; identity is content/context, not position/order.
        for (const e of target) e[5] = (e[5] ?? 0) + (e[0].startsWith('contact') ? -450 : 350);
        target.reverse();
        return { name: 'reordered sections', reference: scene('r-', page), target: scene('t-', target), expected: page.map(e => [`r-${e[0]}`, `t-${e[0]}`]) };
    })(),
    (() => {
        const target = copy(); target.find(e => e[0] === 'alpha-copy')[2] = 'A completely refreshed description';
        target.find(e => e[0] === 'contact-copy')[2] = 'Speak with the team today';
        return { name: 'changed paragraphs under stable component context', reference: scene('r-', page), target: scene('t-', target), expected: page.map(e => [`r-${e[0]}`, `t-${e[0]}`]) };
    })(),
    (() => {
        const target = copy().filter(e => e[0] !== 'alpha-copy');
        target.push(['new', 'button', 'Subscribe', 'contact', 0, 700]);
        return { name: 'missing paragraph and added control', reference: scene('r-', page), target: scene('t-', target), expected: page.filter(e => e[0] !== 'alpha-copy').map(e => [`r-${e[0]}`, `t-${e[0]}`]) };
    })(),
];
