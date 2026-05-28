let extractSeqRanges = [];
let extractSeqData = null;

function initExtractSeqRanges() {
    const container = document.getElementById('extractSeqRangesContainer');
    if (!container) return;
    container.innerHTML = '';
    extractSeqRanges = [];
    addExtractSeqRange();
}

function addExtractSeqRange() {
    const container = document.getElementById('extractSeqRangesContainer');
    if (!container) return;

    const idx = extractSeqRanges.length;
    extractSeqRanges.push({ start: 1, end: 1, name: '' });

    const row = document.createElement('div');
    row.className = 'extract-seq-row';
    row.style.cssText = 'display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px; background: var(--bg-body); border: 1px solid var(--border); border-radius: var(--radius);';
    row.dataset.index = idx;

    row.innerHTML = `
        <div style="display: flex; gap: 8px; flex: 1; min-width: 200px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 80px;">
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Inicio</label>
                <input type="number" id="esStart${idx}" min="1" value="1" style="width: 100%;" onchange="updateExtractSeqRange(${idx})">
            </div>
            <div style="flex: 1; min-width: 80px;">
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Fin</label>
                <input type="number" id="esEnd${idx}" min="1" value="1" style="width: 100%;" onchange="updateExtractSeqRange(${idx})">
            </div>
            <div style="flex: 2; min-width: 140px;">
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Nombre del archivo</label>
                <input type="text" id="esName${idx}" placeholder="Ej: Capitulo_1" value="" style="width: 100%;" onchange="updateExtractSeqRange(${idx})">
            </div>
        </div>
        <button class="btn" onclick="removeExtractSeqRange(${idx})" title="Eliminar rango" style="background: #ef4444; color: white; padding: 6px 10px; font-size: 0.85rem; width: auto; align-self: flex-end;">
            🗑️
        </button>
    `;

    container.appendChild(row);
}

function updateExtractSeqRange(idx) {
    const startEl = document.getElementById(`esStart${idx}`);
    const endEl = document.getElementById(`esEnd${idx}`);
    const nameEl = document.getElementById(`esName${idx}`);

    if (extractSeqRanges[idx]) {
        extractSeqRanges[idx].start = parseInt(startEl?.value || '1');
        extractSeqRanges[idx].end = parseInt(endEl?.value || '1');
        extractSeqRanges[idx].name = (nameEl?.value || '').trim();
    }
}

function removeExtractSeqRange(idx) {
    const container = document.getElementById('extractSeqRangesContainer');
    if (!container) return;

    const row = container.querySelector(`[data-index="${idx}"]`);
    if (row) row.remove();

    // Re-index remaining rows
    const rows = container.querySelectorAll('.extract-seq-row');
    const newRanges = [];
    rows.forEach((r, i) => {
        r.dataset.index = i;
        const oldIdx = parseInt(r.dataset.index);
        const startInput = r.querySelector('input[type="number"]:first-of-type');
        const endInput = r.querySelector('input[type="number"]:nth-of-type(2)');
        const nameInput = r.querySelector('input[type="text"]');
        const removeBtn = r.querySelector('button');

        if (startInput) {
            startInput.id = `esStart${i}`;
            startInput.setAttribute('onchange', `updateExtractSeqRange(${i})`);
        }
        if (endInput) {
            endInput.id = `esEnd${i}`;
            endInput.setAttribute('onchange', `updateExtractSeqRange(${i})`);
        }
        if (nameInput) {
            nameInput.id = `esName${i}`;
            nameInput.setAttribute('onchange', `updateExtractSeqRange(${i})`);
        }
        if (removeBtn) {
            removeBtn.setAttribute('onclick', `removeExtractSeqRange(${i})`);
        }

        newRanges.push({
            start: parseInt(startInput?.value || '1'),
            end: parseInt(endInput?.value || '1'),
            name: (nameInput?.value || '').trim()
        });
    });

    extractSeqRanges = newRanges;

    if (extractSeqRanges.length === 0) {
        addExtractSeqRange();
    }
}

async function extractSequencePages() {
    const input = document.getElementById('extract-sequenceFileInput');
    const logs = document.getElementById('extractSeqLogs');
    const previewArea = document.getElementById('extractSeqPreview');
    const resultArea = document.getElementById('extractSeqResult');
    const btn = document.getElementById('extract-sequenceBtn');
    const password = document.getElementById('extract-sequenceFilePass').value;

    if (!input.files.length) return;

    // Sync latest values
    const rows = document.querySelectorAll('#extractSeqRangesContainer .extract-seq-row');
    extractSeqRanges = [];
    rows.forEach((r, i) => {
        const start = parseInt(r.querySelector(`#esStart${i}`)?.value || '1');
        const end = parseInt(r.querySelector(`#esEnd${i}`)?.value || '1');
        const name = (r.querySelector(`#esName${i}`)?.value || '').trim();
        extractSeqRanges.push({ start, end, name });
    });

    // Validate ranges
    for (let i = 0; i < extractSeqRanges.length; i++) {
        const r = extractSeqRanges[i];
        if (isNaN(r.start) || isNaN(r.end) || r.start < 1 || r.end < r.start) {
            showToast(`Rango ${i + 1} inválido: inicio=${r.start}, fin=${r.end}`, 'warning');
            return;
        }
    }

    btn.disabled = true;
    btn.textContent = "Analizando...";
    previewArea.style.display = 'none';
    resultArea.style.display = 'none';
    logs.textContent = "Cargando documento...";

    try {
        const file = input.files[0];
        const bytes = await readPdfBytes(file);

        const loadingTask = pdfjsLib.getDocument({ data: bytes, password: password || undefined });
        const pdfJsDoc = await loadingTask.promise;
        const totalPages = pdfJsDoc.numPages;
        pdfJsDoc.destroy();

        // Check bounds
        for (let i = 0; i < extractSeqRanges.length; i++) {
            const r = extractSeqRanges[i];
            if (r.end > totalPages) {
                showToast(`Rango ${i + 1} excede el total de páginas (${totalPages}).`, 'warning');
                btn.disabled = false;
                btn.textContent = "Extraer Secuencia";
                return;
            }
        }

        extractSeqData = {
            bytes: bytes,
            password: password,
            totalPages: totalPages,
            ranges: [...extractSeqRanges]
        };

        displayExtractSeqRanges(totalPages);
        logs.textContent = `Documento listo. ${extractSeqRanges.length} rango(s) configurado(s).`;

    } catch (error) {
        console.error(error);
        showToast('Error: ' + error.message, 'error');
        logs.textContent = "Error al cargar el PDF.";
    } finally {
        btn.disabled = false;
        btn.textContent = "Extraer Secuencia";
    }
}

function displayExtractSeqRanges(totalPages) {
    const previewArea = document.getElementById('extractSeqPreview');
    const list = document.getElementById('extractSeqRangesList');
    list.innerHTML = '';

    extractSeqData.ranges.forEach((r, idx) => {
        const pageCount = r.end - r.start + 1;
        const defaultName = `Rango_${r.start}-${r.end}.pdf`;
        const displayName = r.name ? r.name + '.pdf' : defaultName;

        const itemDiv = document.createElement('div');
        itemDiv.style.cssText = 'padding: 12px; margin-bottom: 10px; background: white; border: 1px solid var(--border); border-radius: 4px;';

        itemDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="flex: 1;">
                    <div style="font-weight: 600; margin-bottom: 4px;">
                        ${displayName}
                    </div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">
                        Páginas ${r.start} - ${r.end} (${pageCount} página${pageCount > 1 ? 's' : ''})
                    </div>
                </div>
                <button class="btn" onclick="extractSeqSingle(${idx})" style="padding: 6px 12px; font-size: 0.85rem; width: auto;">
                    Extraer
                </button>
            </div>
        `;

        list.appendChild(itemDiv);
    });

    previewArea.style.display = 'block';
}

function cancelExtractSeq() {
    document.getElementById('extractSeqPreview').style.display = 'none';
    extractSeqData = null;
}

async function extractSeqSingle(idx) {
    if (!extractSeqData) return;

    const r = extractSeqData.ranges[idx];
    const logs = document.getElementById('extractSeqLogs');
    const useRasterMode = document.getElementById('extractSeqRasterMode').checked;

    const defaultName = `Rango_${r.start}-${r.end}.pdf`;
    const fileName = sanitizeFilename(r.name || `Rango_${r.start}-${r.end}`) + '.pdf';

    try {
        logs.textContent = `Extrayendo ${fileName}...`;

        await extractSeqRange(
            extractSeqData.bytes,
            extractSeqData.password,
            r.start,
            r.end,
            fileName,
            useRasterMode,
            logs
        );

        logs.textContent = `"${fileName}" extraído correctamente.`;

    } catch (error) {
        console.error(error);
        showToast('Error extrayendo rango: ' + error.message, 'error');
        logs.textContent = "Error.";
    }
}

async function extractSeqConfirmAll() {
    if (!extractSeqData) return;

    const logs = document.getElementById('extractSeqLogs');
    const resultArea = document.getElementById('extractSeqResult');
    const linksContainer = document.getElementById('extractSeqDownloadLinks');
    const extractBtn = document.getElementById('extractSeqAllBtn');

    const useRasterMode = document.getElementById('extractSeqRasterMode').checked;

    extractBtn.disabled = true;
    extractBtn.textContent = "Extrayendo...";
    resultArea.style.display = 'none';
    linksContainer.innerHTML = '';

    const downloadLinks = [];

    try {
        for (let i = 0; i < extractSeqData.ranges.length; i++) {
            const r = extractSeqData.ranges[i];
            const fileName = sanitizeFilename(r.name || `Rango_${r.start}-${r.end}`) + '.pdf';

            logs.textContent = `Extrayendo ${i + 1}/${extractSeqData.ranges.length}: ${fileName}...`;

            const url = await extractSeqRange(
                extractSeqData.bytes,
                extractSeqData.password,
                r.start,
                r.end,
                fileName,
                useRasterMode,
                logs,
                true
            );

            downloadLinks.push({
                title: fileName,
                url: url,
                filename: fileName
            });

            await waitAndClearMemory(100);
        }

        linksContainer.innerHTML = '';
        downloadLinks.forEach(link => {
            const linkDiv = document.createElement('div');
            linkDiv.style.cssText = 'margin-bottom: 8px;';
            linkDiv.innerHTML = `
                <a href="${link.url}" download="${link.filename}" style="color: var(--primary); text-decoration: none; font-weight: 500;">
                    📄 ${link.title}
                </a>
            `;
            linksContainer.appendChild(linkDiv);
        });

        resultArea.style.display = 'block';
        document.getElementById('extractSeqResultText').textContent = `¡Éxito! Se han generado ${downloadLinks.length} archivo(s). Haga clic en los enlaces para descargar:`;
        logs.textContent = "Todos los rangos extraídos correctamente.";

        document.getElementById('extractSeqPreview').style.display = 'none';

    } catch (error) {
        console.error(error);
        showToast('Error durante la extracción: ' + error.message, 'error');
        logs.textContent = "Error.";
    } finally {
        extractBtn.disabled = false;
        extractBtn.textContent = "📦 Extraer Todos los Rangos";
    }
}

async function extractSeqRange(bytes, password, start, end, fileName, useRasterMode, logs, returnURL = false) {
    const startIdx = start - 1;
    const endIdx = end - 1;
    const pageIndices = [];

    for (let i = startIdx; i <= endIdx; i++) {
        pageIndices.push(i);
    }

    let pdfBytes;
    if (useRasterMode) {
        const loadingTask = pdfjsLib.getDocument({
            data: bytes,
            password: password || undefined
        });
        const pdfJsDoc = await loadingTask.promise;

        const newPdf = await PDFLib.PDFDocument.create();
        const scale = 1.5;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: false, alpha: false });

        for (let i = 0; i < pageIndices.length; i++) {
            const pageNum = pageIndices[i] + 1;
            const page = await pdfJsDoc.getPage(pageNum);
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

            const newPage = newPdf.addPage([viewport.width, viewport.height]);
            newPage.drawImage(jpegImage, {
                x: 0,
                y: 0,
                width: viewport.width,
                height: viewport.height,
            });

            page.cleanup();
        }

        canvas.width = 0;
        canvas.height = 0;
        pdfJsDoc.destroy();

        pdfBytes = await newPdf.save();
    } else {
        const pdfDoc = await loadPdfWithPasswordFallback(bytes, password);
        const newPdf = await PDFLib.PDFDocument.create();

        const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
        copiedPages.forEach(p => newPdf.addPage(p));

        pdfBytes = await newPdf.save();
    }

    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    if (returnURL) {
        return url;
    }

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    return url;
}

document.addEventListener('DOMContentLoaded', () => {
    initExtractSeqRanges();
});
