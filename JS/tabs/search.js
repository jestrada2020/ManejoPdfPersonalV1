let searchResultData = null;

async function searchAndExtract() {
    const input = document.getElementById('searchFileInput');
    const query = document.getElementById('searchQuery').value.trim();
    const logs = document.getElementById('searchLogs');
    const resultArea = document.getElementById('searchResult');
    const previewArea = document.getElementById('searchPreview');
    const btn = document.getElementById('searchBtn');
    const password = document.getElementById('searchFilePass').value;

    if (!input.files.length) return;
    if (!query) { alert("Introduce texto."); return; }

    btn.disabled = true;
    btn.textContent = "Buscando...";
    resultArea.style.display = 'none';
    previewArea.style.display = 'none';
    logs.textContent = "Cargando...";

    try {
        const file = input.files[0];
        const bytes = await readPdfBytes(file);
        const normalizedQuery = normalizeText(query);

        const loadingTask = pdfjsLib.getDocument({ data: bytes, password: password });
        const pdfJsDoc = await loadingTask.promise;
        const totalPages = pdfJsDoc.numPages;
        const matchingPages = [];

        logs.textContent = `Analizando ${totalPages} páginas...`;

        for (let i = 1; i <= totalPages; i++) {
            if (i % 5 === 0) logs.textContent = `Analizando ${i}/${totalPages}...`;

            const page = await pdfJsDoc.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            const normalizedPageText = normalizeText(pageText);

            if (normalizedPageText.includes(normalizedQuery)) {
                const index = normalizedPageText.indexOf(normalizedQuery);
                const contextStart = Math.max(0, index - 30);
                const contextEnd = Math.min(pageText.length, index + query.length + 30);
                const context = pageText.substring(contextStart, contextEnd).trim();

                matchingPages.push({
                    pageNum: i,
                    index: i - 1,
                    context: context,
                    selected: true
                });
            }
        }
        pdfJsDoc.destroy();

        if (matchingPages.length === 0) {
            logs.textContent = "No se encontraron coinciciencias.";
            alert("No encontrado.");
        } else {
            searchResultData = {
                bytes: bytes,
                password: password,
                matchingPages: matchingPages
            };
            displaySearchResults(matchingPages);
            logs.textContent = `Encontradas ${matchingPages.length} páginas.`;
        }

    } catch (error) {
        console.error(error);
        alert("Error: " + error.message);
        logs.textContent = "Error.";
    } finally {
        btn.disabled = false;
        btn.textContent = "Buscar Páginas";
    }
}

function displaySearchResults(matchingPages) {
    const previewArea = document.getElementById('searchPreview');
    const pagesList = document.getElementById('searchPagesList');
    pagesList.innerHTML = '';

    matchingPages.forEach((pageData, idx) => {
        const itemDiv = document.createElement('div');
        itemDiv.style.cssText = 'padding: 10px; margin-bottom: 8px; background: white; border: 1px solid var(--border); border-radius: 4px;';
        itemDiv.innerHTML = `
            <label style="display: flex; align-items: start; cursor: pointer; gap: 10px;">
                <input type="checkbox" id="searchPage${idx}" 
                    ${pageData.selected ? 'checked' : ''} 
                    onchange="toggleSearchPage(${idx})"
                    style="margin-top: 3px;">
                <div style="flex: 1;">
                    <strong>Página ${pageData.pageNum}</strong>
                    <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">
                        ...${pageData.context}...
                    </div>
                </div>
            </label>
        `;
        pagesList.appendChild(itemDiv);
    });
    previewArea.style.display = 'block';
}

function toggleSearchPage(idx) {
    if (searchResultData && searchResultData.matchingPages[idx]) {
        const checkbox = document.getElementById(`searchPage${idx}`);
        searchResultData.matchingPages[idx].selected = checkbox.checked;
    }
}

function cancelSearch() {
    document.getElementById('searchPreview').style.display = 'none';
    searchResultData = null;
}

async function extractFoundPages() {
    if (!searchResultData) return;

    const outputName = document.getElementById('searchOutputName').value || 'busqueda.pdf';
    const useRasterMode = document.getElementById('searchRasterMode').checked;
    const logs = document.getElementById('searchLogs');
    const resultArea = document.getElementById('searchResult');
    const extractBtn = document.getElementById('extractFoundBtn');

    const selectedPages = searchResultData.matchingPages.filter(p => p.selected);

    if (selectedPages.length === 0) {
        alert("Debe seleccionar al menos una página.");
        return;
    }

    extractBtn.disabled = true;
    extractBtn.textContent = "Extrayendo...";
    resultArea.style.display = 'none';

    try {
        const bytes = searchResultData.bytes;
        const password = searchResultData.password;
        const selectedIndices = selectedPages.map(p => p.index);

        logs.textContent = `Extrayendo ${selectedPages.length} páginas...`;

        if (useRasterMode) {
            await extractPagesAsImages(bytes, password, selectedIndices, outputName, logs, resultArea);
        } else {
            const pdfDoc = await loadPdfWithPasswordFallback(bytes, password);
            const newPdf = await PDFLib.PDFDocument.create();

            const copiedPages = await newPdf.copyPages(pdfDoc, selectedIndices);
            copiedPages.forEach(p => newPdf.addPage(p));

            const pdfBytes = await newPdf.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });

            const url = URL.createObjectURL(blob);
            const link = document.getElementById('searchDownload');
            link.href = url;
            link.download = outputName;

            resultArea.style.display = 'block';
            logs.textContent = "¡Proceso terminado exitosamente!";
        }

        document.getElementById('searchPreview').style.display = 'none';

    } catch (error) {
        console.error(error);
        alert("Error durante la extracción: " + error.message);
        logs.textContent = "Error en extracción.";
    } finally {
        extractBtn.disabled = false;
        extractBtn.textContent = "Extraer Páginas Seleccionadas";
    }
}

async function extractPagesAsImages(bytes, password, pageIndices, outputName, logs, resultArea) {
    logs.textContent = "Cargando PDF en modo compatibilidad...";

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
        logs.textContent = `Renderizando página ${pageNum} (${i + 1}/${pageIndices.length})...`;

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

        if ((i + 1) % 5 === 0) {
            await waitAndClearMemory(30);
        }
    }

    canvas.width = 0;
    canvas.height = 0;
    pdfJsDoc.destroy();

    logs.textContent = "Guardando PDF...";
    const pdfBytes = await newPdf.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    const link = document.getElementById('searchDownload');
    link.href = url;
    link.download = outputName;

    resultArea.style.display = 'block';
    logs.textContent = "¡Proceso terminado exitosamente!";
}
