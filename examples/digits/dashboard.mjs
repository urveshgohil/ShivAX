const NS = 'http://www.w3.org/2000/svg';
const svg = (name,attributes={}) => {
    const element = document.createElementNS(NS,name);
    for (const [key,value] of Object.entries(attributes)) element.setAttribute(key,String(value));
    return element;
};
export function chartPoints(history,key,max) {
    return history.map((row,index) => row[key] === null || !Number.isFinite(row[key]) ? null : [34+index/Math.max(1,history.length-1)*350,140-Math.max(0,Math.min(max,row[key]))/max*112]);
}
export function renderChart(target,history,kind) {
    const accuracy = kind === 'accuracy', keys = accuracy ? ['trainingAccuracy','validationAccuracy'] : ['trainingLoss','validationLoss'];
    const values = history.flatMap(row => keys.map(key => row[key])).filter(Number.isFinite);
    const max = accuracy ? 1 : Math.max(0.01,...values)*1.1;
    target.replaceChildren(); target.setAttribute('viewBox','0 0 400 170');
    const title = svg('title'); title.textContent = `${accuracy ? 'Accuracy' : 'Loss'} by epoch. Training mint, validation gold.`; target.append(title);
    for (const [value,y] of [[max,28],[max/2,84],[0,140]]) {
        target.append(svg('line',{x1:34,x2:384,y1:y,y2:y,class:'chart-gridline'}));
        const text = svg('text',{x:30,y:y+4,'text-anchor':'end',class:'chart-label'}); text.textContent = accuracy ? `${Math.round(value*100)}%` : value.toFixed(2); target.append(text);
    }
    keys.forEach((key,series) => {
        let path = '', active = false;
        for (const point of chartPoints(history,key,max)) {
            if (!point) { active=false; continue; }
            path += `${active ? ' L' : ' M'}${point[0]} ${point[1]}`; active=true;
        }
        target.append(svg('path',{d:path,fill:'none',class:series?'series-validation':'series-training','stroke-width':2.5}));
    });
    const text = svg('text',{x:210,y:162,'text-anchor':'middle',class:'chart-label'}); text.textContent = history.length ? `Epoch 1 → ${history.length}` : 'Awaiting training'; target.append(text);
}
export function confusedPairs(matrix) {
    return matrix.flatMap((row,truth) => row.map((count,predicted) => ({truth,predicted,count})))
        .filter(pair => pair.truth !== pair.predicted && pair.count > 0)
        .sort((a,b) => b.count-a.count || a.truth-b.truth || a.predicted-b.predicted);
}
