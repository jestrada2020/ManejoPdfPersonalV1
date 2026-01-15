let esEnState = {
    pdfDoc: null,
    currentPage: 1,
    totalPages: 0,
    scale: 1.0,
    autoFit: true,
    paragraphsByPage: {},
    ocrByPage: {},
    ocrTriedByPage: {},
    currentParagraphIndex: -1,
    textSpans: [],
    currentTranslation: '',
    currentAudioUrl: '',
    currentAudioText: ''
};

async function handleEsEnFileBase(input) {
    if (!input.files.length) return;
    const file = input.files[0];
    const status = document.getElementById('esEnStatus');

    try {
        status.textContent = 'Cargando PDF...';
        const bytes = await readPdfBytes(file);
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        esEnState.pdfDoc = await loadingTask.promise;
        esEnState.totalPages = esEnState.pdfDoc.numPages;
        esEnState.currentPage = 1;
        esEnState.paragraphsByPage = {};
        esEnState.ocrByPage = {};
        esEnState.ocrTriedByPage = {};
        esEnState.currentParagraphIndex = -1;

        await renderEsEnPage(1);
        status.textContent = 'Listo para traducir.';
    } catch (e) {
        console.error(e);
        status.textContent = 'Error cargando el PDF.';
        alert('Error cargando PDF: ' + e.message);
    }
}

function buildEsEnParagraphs(items) {
    const paragraphs = [];
    let currentText = '';
    let currentIndices = [];

    items.forEach((item, index) => {
        const piece = (item.str || '').replace(/\s+/g, ' ').trim();
        if (piece) {
            currentText += (currentText ? ' ' : '') + piece;
            currentIndices.push(index);
        }

        if (item.hasEOL) {
            const endsSentence = /[.!?]$/.test(piece);
            if (endsSentence || currentText.length > 200 || piece === '') {
                if (currentText.trim()) {
                    paragraphs.push({ text: currentText.trim(), indices: currentIndices });
                }
                currentText = '';
                currentIndices = [];
            }
        }
    });

    if (currentText.trim()) {
        paragraphs.push({ text: currentText.trim(), indices: currentIndices });
    }

    return paragraphs;
}

async function ensureEsEnParagraphsForPage(pageNum) {
    if (esEnState.paragraphsByPage[pageNum]) return;

    const status = document.getElementById('esEnStatus');
    status.textContent = `Leyendo texto de la pagina ${pageNum}...`;

    const page = await esEnState.pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const paragraphs = buildEsEnParagraphs(textContent.items);
    esEnState.paragraphsByPage[pageNum] = paragraphs;

    status.textContent = paragraphs.length
        ? `Parrafos en pagina ${pageNum}: ${paragraphs.length}.`
        : `Sin parrafos detectados en esta pagina.`;
}

async function renderEsEnPage(pageNum) {
    if (!esEnState.pdfDoc) return;

    const page = await esEnState.pdfDoc.getPage(pageNum);
    const container = document.getElementById('esEnCanvas').parentElement.parentElement;
    const containerWidth = container.clientWidth - 40;

    let scale = esEnState.scale;
    if (esEnState.autoFit) {
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        scale = containerWidth / unscaledViewport.width;
        esEnState.scale = scale;
    }

    const viewport = page.getViewport({ scale: scale });

    const canvas = document.getElementById('esEnCanvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;

    const textLayerDiv = document.getElementById('esEnTextLayer');
    textLayerDiv.innerHTML = '';
    textLayerDiv.style.height = viewport.height + 'px';
    textLayerDiv.style.width = viewport.width + 'px';

    const textContent = await page.getTextContent();
    const textLayerTask = pdfjsLib.renderTextLayer({
        textContent: textContent,
        container: textLayerDiv,
        viewport: viewport,
        textDivs: []
    });
    await textLayerTask.promise;

    esEnState.textSpans = Array.from(textLayerDiv.querySelectorAll('span'));
    esEnState.currentPage = pageNum;
    document.getElementById('esEnPageLabel').textContent = `${pageNum} / ${esEnState.totalPages}`;

    const ocrLayer = document.getElementById('esEnOcrLayer');
    ocrLayer.width = canvas.width;
    ocrLayer.height = canvas.height;
    clearEsEnOcrLayer();

    await ensureEsEnParagraphsForPage(pageNum);
    const currentParagraphs = getEsEnCurrentPageParagraphs();
    if (currentParagraphs.length === 0 && !esEnState.ocrTriedByPage[pageNum]) {
        await runEsEnOcrCurrentPage();
    } else {
        renderEsEnParagraphList();
    }

    if (esEnState.currentParagraphIndex === -1) {
        if (getEsEnCurrentPageParagraphs().length > 0) {
            await selectEsEnParagraph(0);
        }
    } else {
        applyEsEnHighlight();
    }
}

function getEsEnCurrentPageParagraphs() {
    const base = esEnState.paragraphsByPage[esEnState.currentPage] || [];
    if (base.length > 0) return base;
    return esEnState.ocrByPage[esEnState.currentPage] || [];
}

function renderEsEnParagraphList() {
    const list = document.getElementById('esEnParaList');
    list.innerHTML = '';
    const paragraphs = getEsEnCurrentPageParagraphs();

    if (paragraphs.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'para-item';
        empty.textContent = 'Sin parrafos detectados en esta pagina.';
        list.appendChild(empty);
        return;
    }

    paragraphs.forEach((para, idx) => {
        const item = document.createElement('div');
        item.className = 'para-item';
        item.textContent = `P${esEnState.currentPage}: ${para.text.slice(0, 80)}${para.text.length > 80 ? '...' : ''}`;
        item.onclick = () => selectEsEnParagraph(idx);
        list.appendChild(item);
    });
}

async function selectEsEnParagraph(index) {
    const paragraphs = getEsEnCurrentPageParagraphs();
    if (index < 0 || index >= paragraphs.length) return;
    esEnState.currentParagraphIndex = index;

    const listItems = document.querySelectorAll('#esEnParaList .para-item');
    listItems.forEach((el, idx) => {
        el.classList.toggle('active', idx === index);
    });

    const para = paragraphs[index];
    document.getElementById('esEnSourceText').textContent = para.text;

    applyEsEnHighlight();
    await translateEsEnText(para.text);
}

function applyEsEnHighlight() {
    esEnState.textSpans.forEach(span => {
        span.classList.remove('text-highlight-es');
    });

    clearEsEnOcrLayer();

    const paragraphs = getEsEnCurrentPageParagraphs();
    const para = paragraphs[esEnState.currentParagraphIndex];
    if (!para) return;

    if (para.indices) {
        para.indices.forEach(idx => {
            const span = esEnState.textSpans[idx];
            if (span) span.classList.add('text-highlight-es');
        });
        return;
    }

    if (para.bbox) {
        drawEsEnOcrHighlight(para.bbox);
    }
}

function clearEsEnOcrLayer() {
    const layer = document.getElementById('esEnOcrLayer');
    const ctx = layer.getContext('2d');
    ctx.clearRect(0, 0, layer.width, layer.height);
}

function drawEsEnOcrHighlight(bbox) {
    const layer = document.getElementById('esEnOcrLayer');
    const ctx = layer.getContext('2d');
    ctx.save();
    ctx.fillStyle = 'rgba(34, 197, 94, 0.35)';
    ctx.strokeStyle = 'rgba(22, 163, 74, 0.9)';
    ctx.lineWidth = 2;
    ctx.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);
    ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
    ctx.restore();
}

function nextEsEnParagraph() {
    const paragraphs = getEsEnCurrentPageParagraphs();
    const next = esEnState.currentParagraphIndex + 1;
    if (next < paragraphs.length) {
        selectEsEnParagraph(next);
    }
}

function prevEsEnParagraph() {
    const prev = esEnState.currentParagraphIndex - 1;
    if (prev >= 0) {
        selectEsEnParagraph(prev);
    }
}

function setEsEnZoom(type) {
    if (type === 'fit') {
        esEnState.autoFit = true;
    }
    renderEsEnPage(esEnState.currentPage);
}

function changeEsEnZoom(delta) {
    esEnState.autoFit = false;
    esEnState.scale = Math.max(0.5, esEnState.scale + delta);
    renderEsEnPage(esEnState.currentPage);
}

function changeEsEnPage(delta) {
    if (!esEnState.pdfDoc) return;
    const newPage = esEnState.currentPage + delta;
    if (newPage >= 1 && newPage <= esEnState.totalPages) {
        esEnState.currentParagraphIndex = -1;
        renderEsEnPage(newPage);
    }
}

function chunkEsEnText(text, maxLength) {
    const words = text.split(' ');
    const chunks = [];
    let current = '';
    words.forEach(word => {
        if ((current + word).length < maxLength) {
            current += (current ? ' ' : '') + word;
        } else {
            if (current) chunks.push(current);
            current = word;
        }
    });
    if (current) chunks.push(current);
    return chunks;
}

async function translateEsEnText(text) {
    const status = document.getElementById('esEnStatus');
    const output = document.getElementById('esEnTranslationText');
    status.textContent = 'Traduciendo...';
    output.textContent = '';

    try {
        const chunks = chunkEsEnText(text, 500);
        let translated = '';
        for (let i = 0; i < chunks.length; i++) {
            const query = chunks[i];
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=es&tl=en&dt=t&q=${encodeURIComponent(query)}`;
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            const response = await fetch(proxyUrl);
            const data = await response.json();
            const piece = data[0].map(item => item[0]).join('');
            translated += (translated ? ' ' : '') + piece;
            status.textContent = `Traduciendo ${i + 1}/${chunks.length}...`;
        }

        esEnState.currentTranslation = translated;
        output.textContent = translated;
        esEnState.currentAudioText = '';
        esEnState.currentAudioUrl = '';
        status.textContent = 'Traduccion lista.';
    } catch (e) {
        console.error(e);
        status.textContent = 'Error en traduccion.';
        output.textContent = 'No se pudo traducir.';
    }
}

async function playEsEnAudio() {
    const audio = document.getElementById('esEnAudio');
    const status = document.getElementById('esEnStatus');
    const text = esEnState.currentTranslation;
    if (!text) return;

    try {
        if (esEnState.currentAudioText !== text) {
            status.textContent = 'Generando audio...';
            const chunks = chunkEsEnText(text, 180);
            const audioBlobs = [];
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const googleUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=en&client=tw-ob`;
                const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(googleUrl)}`;
                const response = await fetch(proxyUrl);
                const blob = await response.blob();
                audioBlobs.push(blob);
                status.textContent = `Generando audio ${i + 1}/${chunks.length}...`;
            }
            const finalBlob = new Blob(audioBlobs, { type: 'audio/mpeg' });
            esEnState.currentAudioUrl = URL.createObjectURL(finalBlob);
            esEnState.currentAudioText = text;
            audio.src = esEnState.currentAudioUrl;
        }
        audio.style.display = 'block';
        await audio.play();
        status.textContent = 'Reproduciendo...';
    } catch (e) {
        console.error(e);
        status.textContent = 'Error en audio.';
    }
}

function stopEsEnAudio() {
    const audio = document.getElementById('esEnAudio');
    audio.pause();
    audio.currentTime = 0;
}

async function runEsEnOcrCurrentPage() {
    if (!esEnState.pdfDoc) return;
    const status = document.getElementById('esEnStatus');
    const canvas = document.getElementById('esEnCanvas');

    status.textContent = 'OCR en progreso...';
    esEnState.ocrTriedByPage[esEnState.currentPage] = true;

    try {
        const result = await Tesseract.recognize(canvas, 'spa', {
            logger: msg => {
                if (msg.status === 'recognizing text') {
                    status.textContent = `OCR ${(msg.progress * 100).toFixed(0)}%`;
                }
            }
        });

        const paragraphs = [];
        if (result.data.paragraphs && result.data.paragraphs.length) {
            result.data.paragraphs.forEach(p => {
                const text = (p.text || '').trim();
                if (!text) return;
                paragraphs.push({
                    text: text,
                    bbox: {
                        x: p.bbox.x0,
                        y: p.bbox.y0,
                        width: p.bbox.x1 - p.bbox.x0,
                        height: p.bbox.y1 - p.bbox.y0
                    }
                });
            });
        } else if (result.data.lines && result.data.lines.length) {
            result.data.lines.forEach(line => {
                const text = (line.text || '').trim();
                if (!text) return;
                paragraphs.push({
                    text: text,
                    bbox: {
                        x: line.bbox.x0,
                        y: line.bbox.y0,
                        width: line.bbox.x1 - line.bbox.x0,
                        height: line.bbox.y1 - line.bbox.y0
                    }
                });
            });
        }

        esEnState.ocrByPage[esEnState.currentPage] = paragraphs;
        esEnState.currentParagraphIndex = -1;
        renderEsEnParagraphList();

        if (paragraphs.length > 0) {
            await selectEsEnParagraph(0);
            status.textContent = `OCR listo. Parrafos: ${paragraphs.length}.`;
        } else {
            status.textContent = 'OCR sin resultados en esta pagina.';
        }
    } catch (e) {
        console.error(e);
        status.textContent = 'Error en OCR.';
    }
}
