import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Explicit routes; never use a request path directly as a filesystem path.
const routes = new Map([
    ['/', ['examples/digits/index.html', 'text/html']],
    ['/style.css', ['examples/digits/style.css', 'text/css']],
    ['/app.mjs', ['examples/digits/app.mjs', 'text/javascript']],
    ['/worker.mjs', ['examples/digits/worker.mjs', 'text/javascript']],
    ['/dist/index.esm.js', ['dist/index.esm.js', 'text/javascript']],
]);
const server = createServer(async (request, response) => {
    const route = routes.get(request.url);
    if (request.method !== 'GET' || !route) { response.writeHead(404).end('Not found'); return; }
    try {
        const content = await readFile(new URL(`../${route[0]}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': `${route[1]}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        response.end(content);
    } catch { response.writeHead(500).end('Build the package before starting this demo.'); }
});
const firstPort = 4173;
const lastPort = firstPort + 9;
let port = firstPort;

server.on('error', error => {
    if (error.code === 'EADDRINUSE' && port < lastPort) {
        console.log(`Port ${port} is in use; trying ${port + 1}…`);
        port++;
        server.listen(port, '127.0.0.1');
        return;
    }
    console.error(error.code === 'EADDRINUSE'
        ? `No available port between ${firstPort} and ${lastPort}. Stop an existing demo with Ctrl+C and retry.`
        : `Unable to start digit lab: ${error.message}`);
    process.exitCode = 1;
});
server.on('listening', () => console.log(`Digit lab: http://127.0.0.1:${port}`));
server.listen(port, '127.0.0.1');
