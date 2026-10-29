let mergeSeqRanges = [];

function initMergeSeqRanges() {
    const container = document.getElementById('mergeSeqRangesContainer');
    if (!container) return;
    container.innerHTML = '';
    mergeSeqRanges = [];
    addMergeSeqRange();
}

function addMergeSeqRange() {
    const container = document.getElementById('mergeSeqRangesContainer');
    if (!container) return;

    const idx = mergeSeqRanges.length;
    mergeSeqRanges.push({ start: 1, end: 1 });

    const row = document.createElement('div');
    row.className = 'merge-seq-row';
    row.style.cssText = 'display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px; background: var(--bg-body); border: 1px solid var(--border); border-radius: var(--radius);';
    row.dataset.index = idx;

    row.innerHTML = `
        <div style="display: flex; gap: 8px; flex: 1; min-width: 200px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 80px;">
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Inicio</label>
                <input type="number" id="msStart${idx}" min="1" value="1" style="width: 100%;" onchange="updateMergeSeqRange(${idx})">
            </div>
            <div style="flex: 1; min-width: 80px;">
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Fin</label>
                <input type="number" id="msEnd${idx}" min="1" value="1" style="width: 100%;" onchange="updateMergeSeqRange(${idx})">
            </div>
        </div>
        <button class="btn" onclick="removeMergeSeqRange(${idx})" title="Eliminar rango" style="background: #ef4444; color: white; padding: 6px 10px; font-size: 0.85rem; width: auto; align-self: flex-end;">
            🗑️
        </button>
    `;

    container.appendChild(row);
}

function updateMergeSeqRange(idx) {
    const startEl = document.getElementById(`msStart${idx}`);
    const endEl = document.getElementById(`msEnd${idx}`);

    if (mergeSeqRanges[idx]) {
        mergeSeqRanges[idx].start = parseInt(startEl?.value || '1');
        mergeSeqRanges[idx].end = parseInt(endEl?.value || '1');
    }
}

function removeMergeSeqRange(idx) {
    const container = document.getElementById('mergeSeqRangesContainer');
    if (!container) return;

    const row = container.querySelector(`[data-index="${idx}"]`);
    if (row) row.remove();

    const rows = container.querySelectorAll('.merge-seq-row');
    const newRanges = [];
    rows.forEach((r, i) => {
        r.dataset.index = i;
        // Cada input numérico está en su propio div, así que :nth-of-type no sirve aquí
        const [startInput, endInput] = r.querySelectorAll('input[type="number"]');
        const removeBtn = r.querySelector('button');

        if (startInput) {
            startInput.id = `msStart${i}`;
            startInput.setAttribute('onchange', `updateMergeSeqRange(${i})`);
        }
        if (endInput) {
            endInput.id = `msEnd${i}`;
            endInput.setAttribute('onchange', `updateMergeSeqRange(${i})`);
        }
        if (removeBtn) {
            removeBtn.setAttribute('onclick', `removeMergeSeqRange(${i})`);
        }

        newRanges.push({
            start: parseInt(startInput?.value || '1'),
            end: parseInt(endInput?.value || '1')
        });
    });

    mergeSeqRanges = newRanges;

    if (mergeSeqRanges.length === 0) {
        addMergeSeqRange();
    }
}

async function mergeSequencePages() {
    const input = document.getElementById('merge-sequenceFileInput');
    const logs = document.getElementById('mergeSeqLogs');
    const resultArea = document.getElementById('mergeSeqResult');
    const btn = document.getElementById('merge-sequenceBtn');
    const password = document.getElementById('merge-sequenceFilePass').value;
    const outputName = document.getElementById('mergeSeqOutputName').value || 'SecuenciaUnida.pdf';
    const useRasterMode = document.getElementById('mergeSeqRasterMode').checked;

    if (!input.files.length) return;

    // Sync latest values
    const rows = document.querySelectorAll('#mergeSeqRangesContainer .merge-seq-row');
    mergeSeqRanges = [];
    rows.forEach((r, i) => {
        const start = parseInt(r.querySelector(`#msStart${i}`)?.value || '1');
        const end = parseInt(r.querySelector(`#msEnd${i}`)?.value || '1');
        mergeSeqRanges.push({ start, end });
    });

    // Validate ranges
    for (let i = 0; i < mergeSeqRanges.length; i++) {
        const r = mergeSeqRanges[i];
        if (isNaN(r.start) || isNaN(r.end) || r.start < 1 || r.end < r.start) {
            showToast(`Rango ${i + 1} inválido: inicio=${r.start}, fin=${r.end}`, 'warning');
            return;
        }
    }

    btn.disabled = true;
    btn.textContent = useRasterMode ? "Procesando como Imágenes..." : "Procesando...";
    resultArea.style.display = 'none';
    logs.textContent = "Cargando documento...";

    try {
        const file = input.files[0];
        const bytes = await readPdfBytes(file);

        // Validate bounds
        const loadingTask = pdfjsLib.getDocument({ data: bytes, password: password || undefined });
        const pdfJsDoc = await loadingTask.promise;
        const totalPages = pdfJsDoc.numPages;
        pdfJsDoc.destroy();

        for (let i = 0; i < mergeSeqRanges.length; i++) {
            const r = mergeSeqRanges[i];
            if (r.end > totalPages) {
                showToast(`Rango ${i + 1} excede el total de páginas (${totalPages}).`, 'warning');
                btn.disabled = false;
                btn.textContent = "Unificar Secuencia";
                return;
            }
        }

        logs.textContent = `Uniendo ${mergeSeqRanges.length} rango(s)...`;

        let pdfBytes;
        if (useRasterMode) {
            const loadingTask2 = pdfjsLib.getDocument({
                data: bytes,
                password: password || undefined
            });
            const pdfJsDoc2 = await loadingTask2.promise;

            const newPdf = await PDFLib.PDFDocument.create();
            const scale = 1.5;

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d', { willReadFrequently: false, alpha: false });

            for (const r of mergeSeqRanges) {
                for (let pageNum = r.start; pageNum <= r.end; pageNum++) {
                    const page = await pdfJsDoc2.getPage(pageNum);
                    const viewport = page.getViewport({ scale: scale });

                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    context.clearRect(0, 0, canvas.width, canvas.height);
                    await page.render({
                        canvasContext: context,
                        viewport: viewport
                    }).promise;

                    const imgDataUrl = canvas.toDataURL('image/jpeg', 0.92);
                    const response = await fetch(imgDataUrl);
                    const imgBytes = await response.arrayBuffer();
                    const jpegImage = await newPdf.embedJpg(imgBytes);

                    const newPage = newPdf.addPage([viewport.width / scale, viewport.height / scale]) // tamaño real; la imagen se renderiza a scalex para nitidez;
                    newPage.drawImage(jpegImage, {
                        x: 0,
                        y: 0,
                        width: viewport.width / scale,
                        height: viewport.height / scale,
                    });

                    page.cleanup();
                }
            }

            canvas.width = 0;
            canvas.height = 0;
            pdfJsDoc2.destroy();

            pdfBytes = await newPdf.save();
        } else {
            const pdfDoc = await loadPdfWithPasswordFallback(bytes, password);
            const newPdf = await PDFLib.PDFDocument.create();

            for (const r of mergeSeqRanges) {
                const pageIndices = [];
                for (let i = r.start - 1; i <= r.end - 1; i++) {
                    pageIndices.push(i);
                }
                const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
                copiedPages.forEach(p => newPdf.addPage(p));
            }

            pdfBytes = await newPdf.save();
        }

        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const link = document.getElementById('mergeSeqDownload');
        link.href = url;
        link.download = outputName;
        resultArea.style.display = 'block';

        logs.textContent = `¡Listo! Se unieron ${mergeSeqRanges.length} rango(s) en un solo PDF.`;

    } catch (error) {
        console.error(error);
        showToast('Error: ' + error.message, 'error');
        logs.textContent = "Error al procesar el PDF.";
    } finally {
        btn.disabled = false;
        btn.textContent = "Unificar Secuencia";
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initMergeSeqRanges();
});
