// Test-only hand-authored stroke paths, never used as training samples.
// Coordinates in a 100x100 drawing space: looped/crossed eights and sevens.
export const handwriting = [
    { name: '8-two-loops', digit: 8, paths: [
        [[50,48],[30,37],[28,23],[40,14],[58,15],[69,27],[65,39],[50,48],[31,58],[24,74],[35,87],[57,89],[73,77],[69,61],[50,48]],
    ] },
    { name: '8-narrow-crossing', digit: 8, paths: [
        [[43,48],[31,31],[39,17],[55,14],[65,24],[61,38],[43,48],[32,67],[36,84],[50,91],[65,80],[64,63],[43,48]],
    ] },
    { name: '7-slanted', digit: 7, paths: [[[23,18],[74,18],[60,38],[49,61],[39,86]]] },
    { name: '7-crossbar', digit: 7, paths: [[[23,19],[76,16],[60,40],[45,69],[37,88]],[[32,52],[65,49]]] },
];

/** Supersampled reference rasterizer for repeatable antialiased stroke fixtures. */
export function rasterize({ paths }, { width = 280, height = 280, thickness = 22, dx = 0, dy = 0, scale = 2.5 } = {}) {
    const segments = paths.flatMap(path => path.slice(1).map((p, i) => [path[i], p].map(([x,y]) => [x * scale + dx, y * scale + dy])));
    const pixels = new Float64Array(width * height);
    const distance = (x, y, a, b) => {
        const vx = b[0] - a[0], vy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x-a[0])*vx + (y-a[1])*vy) / (vx*vx + vy*vy)));
        return Math.hypot(x-a[0]-t*vx, y-a[1]-t*vy);
    };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let ink = 0;
        for (const oy of [0.25,0.75]) for (const ox of [0.25,0.75]) {
            if (segments.some(([a,b]) => distance(x+ox,y+oy,a,b) <= thickness/2)) ink++;
        }
        pixels[y*width+x] = ink/4;
    }
    return pixels;
}
