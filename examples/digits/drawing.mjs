/** Pointer capture supports mouse, pen and touch without mixing simultaneous strokes. */
export function attachDrawing(canvas, context, onChange, strokeWidth = () => 22) {
    let active = null;
    const point = event => {
        const rect = canvas.getBoundingClientRect();
        const sx = rect.width / canvas.offsetWidth, sy = rect.height / canvas.offsetHeight;
        return [
            (event.clientX - rect.left - canvas.clientLeft * sx) * canvas.width / (canvas.clientWidth * sx),
            (event.clientY - rect.top - canvas.clientTop * sy) * canvas.height / (canvas.clientHeight * sy),
        ];
    };
    const stop = event => {
        if (event.pointerId !== active) return;
        const id = active;
        active = null;
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    };
    canvas.addEventListener('pointerdown', event => {
        if (active !== null || !event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        active = event.pointerId;
        canvas.setPointerCapture(active);
        context.strokeStyle = context.fillStyle = 'white';
        context.lineWidth = strokeWidth();
        context.lineCap = context.lineJoin = 'round';
        const [x, y] = point(event);
        context.beginPath(); context.arc(x, y, context.lineWidth / 2, 0, Math.PI * 2); context.fill();
        context.beginPath(); context.moveTo(x, y);
        onChange();
    });
    canvas.addEventListener('pointermove', event => {
        if (event.pointerId !== active) return;
        event.preventDefault();
        const samples = event.getCoalescedEvents?.() ?? [];
        for (const sample of samples.length ? samples : [event]) context.lineTo(...point(sample));
        context.stroke();
        onChange();
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, stop);
    return () => { if (active !== null) stop({ pointerId: active }); };
}
