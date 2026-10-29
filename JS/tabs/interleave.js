// ==========================================
// Intercalar PDF: inserta otro PDF cada N hojas (o tras páginas concretas) del PDF de origen
// ==========================================
const interleaveState = {
    source: null, // { file, doc, pageCount }
    insert: null
};

// ---------- Lógica pura (sin DOM), probada también en Node ----------

// Devuelve las posiciones de inserción ordenadas: p = "insertar después de la página p" (0 = antes de la 1).
function computeInterleavePoints(totalPages, opts) {
    const points = new Set();

    if (opts.mode === 'every') {
        const every = opts.every;
        if (!Number.isInteger(every) || every < 1) {
            throw new Error('El periodo debe ser un número entero mayor o igual a 1.');
        }
        const first = (opts.first === null || opts.first === undefined) ? every : opts.first;
        if (!Number.isInteger(first) || first < 0) {
            throw new Error('La primera inserción debe ser un número entero mayor o igual a 0.');
        }
        for (let p = first; p <= totalPages; p += every) points.add(p);
        if (opts.includeEnd && totalPages > 0 && !points.has(totalPages)) points.add(totalPages);
    } else {
        const tokens = String(opts.list || '').split(/[,;\s]+/).filter(t => t !== '');
        if (tokens.length === 0) throw new Error('Escriba al menos una página en la lista.');
        for (const t of tokens) {
            if (!/^\d+$/.test(t)) throw new Error(`Valor no válido en la lista: «${t}».`);
            const p = parseInt(t, 10);
            if (p > totalPages) throw new Error(`La página ${p} no existe (el origen tiene ${totalPages}).`);
            points.add(p);
        }
    }

    return [...points].sort((a, b) => a - b);
}

// Secuencia final de páginas: [{ from: 'source' | 'insert', page }]
function buildInterleaveSequence(totalPages, points, insertPageNums) {
    const pointSet = new Set(points);
    const seq = [];
    for (let p = 0; p <= totalPages; p++) {
        if (pointSet.has(p)) {
            insertPageNums.forEach(n => seq.push({ from: 'insert', page: n }));
        }
        if (p < totalPages) seq.push({ from: 'source', page: p + 1 });
    }
    return seq;
}

// Resume la secuencia en bloques legibles: "Origen 1–3", "Intercalado 1–2", ...
function summarizeInterleaveSequence(seq) {
    const blocks = [];
    for (const item of seq) {
        const last = blocks[blocks.length - 1];
        if (last && last.from === item.from && item.page === last.end + 1) {
            last.end = item.page;
        } else {
            blocks.push({ from: item.from, start: item.page, end: item.page });
        }
    }
    return blocks;
}

if (typeof module !== 'undefined') {
    module.exports = { computeInterleavePoints, buildInterleaveSequence, summarizeInterleaveSequence };
}

// ---------- Interfaz ----------

async function handleInterleaveFile(slot, file) {
    if (!file) return;
    const info = document.getElementById(slot === 'source' ? 'interleaveSourceInfo' : 'interleaveInsertInfo');
    const nameEl = document.getElementById(slot === 'source' ? 'interleaveSourceName' : 'interleaveInsertName');
    const pagesEl = document.getElementById(slot === 'source' ? 'interleaveSourcePages' : 'interleaveInsertPages');

    interleaveState[slot] = null;
    info.style.display = 'block';
    nameEl.textContent = file.name;
    pagesEl.textContent = 'Leyendo...';
    document.getElementById('interleaveResult').style.display = 'none';
    document.getElementById('interleavePreview').style.display = 'none';

    try {
        const bytes = await readPdfBytes(file);
        const doc = await loadPdfWithPasswordFallback(bytes, '');
        const pageCount = doc.getPageCount();
        interleaveState[slot] = { file, doc, pageCount };
        pagesEl.textContent = `${pageCount} página${pageCount === 1 ? '' : 's'}`;

        if (slot === 'insert') {
            document.getElementById('interleaveInsertStart').max = pageCount;
            document.getElementById('interleaveInsertEnd').max = pageCount;
            document.getElementById('interleaveInsertEnd').value = pageCount;
        }
    } catch (e) {
        console.error(e);
        const protegido = /contraseña|password|encrypt/i.test(e.message);
        pagesEl.textContent = protegido
            ? '⚠️ PDF protegido: desbloquéelo primero en la pestaña «Desbloquear PDF».'
            : '⚠️ No se pudo leer el PDF.';
        showToast(pagesEl.textContent, 'error', 5000);
    }
    updateInterleaveForm();
}

function updateInterleaveForm() {
    const scope = document.querySelector('input[name="interleaveInsertScope"]:checked').value;
    document.getElementById('interleaveInsertStart').disabled = scope !== 'range';
    document.getElementById('interleaveInsertEnd').disabled = scope !== 'range';

    const mode = document.getElementById('interleaveMode').value;
    document.getElementById('interleaveEveryBox').style.display = mode === 'every' ? 'block' : 'none';
    document.getElementById('interleaveListBox').style.display = mode === 'list' ? 'block' : 'none';

    const ready = !!(interleaveState.source && interleaveState.insert);
    document.getElementById('interleaveBtn').disabled = !ready;
    document.getElementById('interleavePreviewBtn').disabled = !ready;
}

// Lee el formulario y devuelve { points, insertPageNums, seq } o lanza un Error con mensaje para el usuario
function readInterleavePlan() {
    const total = interleaveState.source.pageCount;
    const insertTotal = interleaveState.insert.pageCount;

    let insertPageNums;
    const scope = document.querySelector('input[name="interleaveInsertScope"]:checked').value;
    if (scope === 'range') {
        const start = parseInt(document.getElementById('interleaveInsertStart').value, 10);
        const end = parseInt(document.getElementById('interleaveInsertEnd').value, 10);
        if (isNaN(start) || isNaN(end) || start < 1 || end < start || end > insertTotal) {
            throw new Error(`Rango del PDF a intercalar no válido (tiene ${insertTotal} páginas).`);
        }
        insertPageNums = [];
        for (let i = start; i <= end; i++) insertPageNums.push(i);
    } else {
        insertPageNums = Array.from({ length: insertTotal }, (_, i) => i + 1);
    }

    const mode = document.getElementById('interleaveMode').value;
    const firstRaw = document.getElementById('interleaveFirst').value.trim();
    const points = computeInterleavePoints(total, {
        mode,
        every: parseInt(document.getElementById('interleaveEvery').value, 10),
        first: firstRaw === '' ? null : Number(firstRaw),
        includeEnd: document.getElementById('interleaveIncludeEnd').checked,
        list: document.getElementById('interleavePageList').value
    });
    if (points.length === 0) {
        throw new Error('Con esa configuración no se insertaría nada. Revise el periodo y la primera inserción.');
    }

    const seq = buildInterleaveSequence(total, points, insertPageNums);
    return { points, insertPageNums, seq };
}

function previewInterleave() {
    const box = document.getElementById('interleavePreview');
    const text = document.getElementById('interleavePreviewText');
    try {
        const { points, seq } = readInterleavePlan();
        const blocks = summarizeInterleaveSequence(seq);
        const range = b => b.start === b.end ? `${b.start}` : `${b.start}–${b.end}`;

        text.innerHTML = '';
        const head = document.createElement('div');
        head.style.marginBottom = '8px';
        head.innerHTML = `<strong>${points.length}</strong> inserción(es) · total final: <strong>${seq.length}</strong> páginas`;
        text.appendChild(head);

        const MAX_BLOCKS = 200;
        blocks.slice(0, MAX_BLOCKS).forEach(b => {
            const span = document.createElement('span');
            span.style.cssText = 'display:inline-block; margin: 2px 4px 2px 0; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem;' +
                (b.from === 'source'
                    ? 'background:#e0f2fe; color:#075985;'
                    : 'background:#fef3c7; color:#92400e;');
            span.textContent = (b.from === 'source' ? 'Origen ' : '📎 Intercalado ') + range(b);
            text.appendChild(span);
        });
        if (blocks.length > MAX_BLOCKS) {
            const more = document.createElement('div');
            more.textContent = `… y ${blocks.length - MAX_BLOCKS} bloques más.`;
            text.appendChild(more);
        }
        box.style.display = 'block';
    } catch (e) {
        box.style.display = 'none';
        showToast(e.message, 'warning', 5000);
    }
}

// Tamaño visual de una página (respeta la rotación /Rotate)
function getVisualPageSize(page) {
    const { width, height } = page.getSize();
    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    return (angle === 90 || angle === 270) ? { width: height, height: width } : { width, height };
}

async function interleavePDFs() {
    if (!interleaveState.source || !interleaveState.insert) return;

    const btn = document.getElementById('interleaveBtn');
    const logs = document.getElementById('interleaveLogs');
    const resultArea = document.getElementById('interleaveResult');
    const fitSize = document.getElementById('interleaveFitSize').checked;
    let outputName = document.getElementById('interleaveOutputName').value.trim() || 'pdf_intercalado.pdf';
    if (!/\.pdf$/i.test(outputName)) outputName += '.pdf';

    let plan;
    try {
        plan = readInterleavePlan();
    } catch (e) {
        showToast(e.message, 'warning', 5000);
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Procesando...';
    resultArea.style.display = 'none';

    try {
        const srcDoc = interleaveState.source.doc;
        const insDoc = interleaveState.insert.doc;
        const insIndices = plan.insertPageNums.map(n => n - 1);
        const pointSet = new Set(plan.points);
        const total = interleaveState.source.pageCount;

        const out = await PDFLib.PDFDocument.create();
        logs.textContent = 'Copiando páginas del origen...';
        const srcPages = await out.copyPages(srcDoc, srcDoc.getPageIndices());

        // En modo "ajustar" se incrustan una sola vez y se dibujan en cada inserción
        const embedded = fitSize ? await out.embedPages(insIndices.map(i => insDoc.getPage(i))) : null;

        let done = 0;
        for (let p = 0; p <= total; p++) {
            if (pointSet.has(p)) {
                done++;
                if (done % 10 === 0) {
                    logs.textContent = `Insertando ${done}/${plan.points.length}...`;
                    await waitAndClearMemory(0);
                }

                if (fitSize) {
                    const ref = srcPages[Math.max(0, p - 1)];
                    const { width: W, height: H } = getVisualPageSize(ref);
                    for (const emb of embedded) {
                        const s = Math.min(W / emb.width, H / emb.height);
                        const w = emb.width * s;
                        const h = emb.height * s;
                        const page = out.addPage([W, H]);
                        page.drawPage(emb, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
                    }
                } else {
                    // copyPages en cada inserción: una misma página copiada no puede añadirse dos veces
                    const copies = await out.copyPages(insDoc, insIndices);
                    copies.forEach(pg => out.addPage(pg));
                }
            }
            if (p < total) out.addPage(srcPages[p]);
        }

        logs.textContent = 'Generando archivo final...';
        const pdfBytes = await out.save();
        triggerDownload(pdfBytes, outputName, 'interleaveDownload', resultArea);
        logs.textContent = `¡Listo! ${plan.points.length} inserción(es), ${out.getPageCount()} páginas en total.`;
        showToast('PDF intercalado generado', 'success');
    } catch (e) {
        console.error(e);
        showToast('Error: ' + e.message, 'error');
        logs.textContent = 'Error al intercalar: ' + e.message;
    } finally {
        btn.disabled = false;
        btn.textContent = '📑 Intercalar PDF';
    }
}

// Arrastrar y soltar: 2 archivos → origen + intercalar; 1 archivo → el hueco libre (o el de intercalar)
function routeFilesToInterleave(pdfFiles) {
    if (pdfFiles.length >= 2) {
        handleInterleaveFile('source', pdfFiles[0]);
        handleInterleaveFile('insert', pdfFiles[1]);
        return;
    }
    handleInterleaveFile(interleaveState.source ? 'insert' : 'source', pdfFiles[0]);
}

if (typeof document !== 'undefined') {
    // Pegar (Ctrl+V) un archivo PDF copiado desde el explorador de archivos
    document.addEventListener('paste', (e) => {
        const active = document.querySelector('.tab-content.active');
        if (!active || active.id !== 'interleave') return;
        const files = Array.from((e.clipboardData && e.clipboardData.files) || [])
            .filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
        if (!files.length) {
            if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length) {
                showToast('Lo pegado no es un PDF.', 'warning');
            }
            return;
        }
        e.preventDefault();
        routeFilesToInterleave(files);
        showToast(`PDF pegado: ${files[0].name}`, 'success');
    });

    document.addEventListener('DOMContentLoaded', updateInterleaveForm);
}
