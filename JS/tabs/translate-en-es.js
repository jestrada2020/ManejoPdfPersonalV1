let enEsState = {
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

async function handleEnEsFileBase(input) {
    if (!input.files.length) return;
    const file = input.files[0];
    const status = document.getElementById('enEsStatus');

    try {
        status.textContent = 'Cargando PDF...';
        const bytes = await readPdfBytes(file);
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        enEsState.pdfDoc = await loadingTask.promise;
        enEsState.totalPages = enEsState.pdfDoc.numPages;
        enEsState.currentPage = 1;
        enEsState.paragraphsByPage = {};
        enEsState.ocrByPage = {};
        enEsState.ocrTriedByPage = {};
        enEsState.currentParagraphIndex = -1;

        await renderEnEsPage(1);
        status.textContent = 'Listo para traducir.';
    } catch (e) {
        console.error(e);
        status.textContent = 'Error cargando el PDF.';
        alert('Error cargando PDF: ' + e.message);
    }
}

function buildEnEsParagraphs(items) {
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

async function ensureEnEsParagraphsForPage(pageNum) {
    if (enEsState.paragraphsByPage[pageNum]) return;

    const status = document.getElementById('enEsStatus');
    status.textContent = `Leyendo texto de la pagina ${pageNum}...`;

    const page = await enEsState.pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const paragraphs = buildEnEsParagraphs(textContent.items);
    enEsState.paragraphsByPage[pageNum] = paragraphs;

    status.textContent = paragraphs.length
        ? `Parrafos en pagina ${pageNum}: ${paragraphs.length}.`
        : `Sin parrafos detectados en esta pagina.`;
}

async function renderEnEsPage(pageNum) {
    if (!enEsState.pdfDoc) return;

    const page = await enEsState.pdfDoc.getPage(pageNum);
    const container = document.getElementById('enEsCanvas').parentElement.parentElement;
    const containerWidth = container.clientWidth - 40;

    let scale = enEsState.scale;
    if (enEsState.autoFit) {
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        scale = containerWidth / unscaledViewport.width;
        enEsState.scale = scale;
    }

    const viewport = page.getViewport({ scale: scale });

    const canvas = document.getElementById('enEsCanvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;

    const textLayerDiv = document.getElementById('enEsTextLayer');
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

    enEsState.textSpans = Array.from(textLayerDiv.querySelectorAll('span'));
    enEsState.currentPage = pageNum;
    document.getElementById('enEsPageLabel').textContent = `${pageNum} / ${enEsState.totalPages}`;

    const ocrLayer = document.getElementById('enEsOcrLayer');
    ocrLayer.width = canvas.width;
    ocrLayer.height = canvas.height;
    clearEnEsOcrLayer();

    await ensureEnEsParagraphsForPage(pageNum);
    const currentParagraphs = getEnEsCurrentPageParagraphs();
    if (currentParagraphs.length === 0 && !enEsState.ocrTriedByPage[pageNum]) {
        await runEnEsOcrCurrentPage();
    } else {
        renderEnEsParagraphList();
    }

    if (enEsState.currentParagraphIndex === -1) {
        if (getEnEsCurrentPageParagraphs().length > 0) {
            await selectEnEsParagraph(0);
        }
    } else {
        applyEnEsHighlight();
    }
}

function getEnEsCurrentPageParagraphs() {
    const base = enEsState.paragraphsByPage[enEsState.currentPage] || [];
    if (base.length > 0) return base;
    return enEsState.ocrByPage[enEsState.currentPage] || [];
}

function renderEnEsParagraphList() {
    const list = document.getElementById('enEsParaList');
    list.innerHTML = '';
    const paragraphs = getEnEsCurrentPageParagraphs();

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
        item.textContent = `P${enEsState.currentPage}: ${para.text.slice(0, 80)}${para.text.length > 80 ? '...' : ''}`;
        item.onclick = () => selectEnEsParagraph(idx);
        list.appendChild(item);
    });
}

async function selectEnEsParagraph(index) {
    const paragraphs = getEnEsCurrentPageParagraphs();
    if (index < 0 || index >= paragraphs.length) return;
    enEsState.currentParagraphIndex = index;

    const listItems = document.querySelectorAll('#enEsParaList .para-item');
    listItems.forEach((el, idx) => {
        el.classList.toggle('active', idx === index);
    });

    const para = paragraphs[index];
    document.getElementById('enEsSourceText').textContent = para.text;

    applyEnEsHighlight();
    await translateEnEsText(para.text);
}

function applyEnEsHighlight() {
    enEsState.textSpans.forEach(span => {
        span.classList.remove('text-highlight-en');
    });

    clearEnEsOcrLayer();

    const paragraphs = getEnEsCurrentPageParagraphs();
    const para = paragraphs[enEsState.currentParagraphIndex];
    if (!para) return;

    if (para.indices) {
        para.indices.forEach(idx => {
            const span = enEsState.textSpans[idx];
            if (span) span.classList.add('text-highlight-en');
        });
        return;
    }

    if (para.bbox) {
        drawEnEsOcrHighlight(para.bbox);
    }
}

function clearEnEsOcrLayer() {
    const layer = document.getElementById('enEsOcrLayer');
    const ctx = layer.getContext('2d');
    ctx.clearRect(0, 0, layer.width, layer.height);
}

function drawEnEsOcrHighlight(bbox) {
    const layer = document.getElementById('enEsOcrLayer');
    const ctx = layer.getContext('2d');
    ctx.save();
    ctx.fillStyle = 'rgba(255, 235, 59, 0.4)';
    ctx.strokeStyle = 'rgba(202, 138, 4, 0.9)';
    ctx.lineWidth = 2;
    ctx.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);
    ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
    ctx.restore();
}

function nextEnEsParagraph() {
    const paragraphs = getEnEsCurrentPageParagraphs();
    const next = enEsState.currentParagraphIndex + 1;
    if (next < paragraphs.length) {
        selectEnEsParagraph(next);
    }
}

function prevEnEsParagraph() {
    const prev = enEsState.currentParagraphIndex - 1;
    if (prev >= 0) {
        selectEnEsParagraph(prev);
    }
}

function setEnEsZoom(type) {
    if (type === 'fit') {
        enEsState.autoFit = true;
    }
    renderEnEsPage(enEsState.currentPage);
}

function changeEnEsZoom(delta) {
    enEsState.autoFit = false;
    enEsState.scale = Math.max(0.5, enEsState.scale + delta);
    renderEnEsPage(enEsState.currentPage);
}

function changeEnEsPage(delta) {
    if (!enEsState.pdfDoc) return;
    const newPage = enEsState.currentPage + delta;
    if (newPage >= 1 && newPage <= enEsState.totalPages) {
        enEsState.currentParagraphIndex = -1;
        renderEnEsPage(newPage);
    }
}

function chunkEnEsText(text, maxLength) {
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

async function translateEnEsText(text) {
    const status = document.getElementById('enEsStatus');
    const output = document.getElementById('enEsTranslationText');
    status.textContent = 'Traduciendo...';
    output.textContent = '';

    try {
        const chunks = chunkEnEsText(text, 500);
        let translated = '';
        for (let i = 0; i < chunks.length; i++) {
            const query = chunks[i];
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(query)}`;
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            const response = await fetch(proxyUrl);
            const data = await response.json();
            const piece = data[0].map(item => item[0]).join('');
            translated += (translated ? ' ' : '') + piece;
            status.textContent = `Traduciendo ${i + 1}/${chunks.length}...`;
        }

        enEsState.currentTranslation = translated;
        output.textContent = translated;
        enEsState.currentAudioText = '';
        enEsState.currentAudioUrl = '';
        status.textContent = 'Traduccion lista.';
    } catch (e) {
        console.error(e);
        status.textContent = 'Error en traduccion.';
        output.textContent = 'No se pudo traducir.';
    }
}

async function playEnEsAudio() {
    const audio = document.getElementById('enEsAudio');
    const status = document.getElementById('enEsStatus');
    const text = enEsState.currentTranslation;
    if (!text) return;

    try {
        if (enEsState.currentAudioText !== text) {
            status.textContent = 'Generando audio...';
            const chunks = chunkEnEsText(text, 180);
            const audioBlobs = [];
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const googleUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=es&client=tw-ob`;
                const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(googleUrl)}`;
                const response = await fetch(proxyUrl);
                const blob = await response.blob();
                audioBlobs.push(blob);
                status.textContent = `Generando audio ${i + 1}/${chunks.length}...`;
            }
            const finalBlob = new Blob(audioBlobs, { type: 'audio/mpeg' });
            enEsState.currentAudioUrl = URL.createObjectURL(finalBlob);
            enEsState.currentAudioText = text;
            audio.src = enEsState.currentAudioUrl;
        }
        audio.style.display = 'block';
        await audio.play();
        status.textContent = 'Reproduciendo...';
    } catch (e) {
        console.error(e);
        status.textContent = 'Error en audio.';
    }
}

function stopEnEsAudio() {
    const audio = document.getElementById('enEsAudio');
    audio.pause();
    audio.currentTime = 0;
}

async function runEnEsOcrCurrentPage() {
    if (!enEsState.pdfDoc) return;
    const status = document.getElementById('enEsStatus');
    const canvas = document.getElementById('enEsCanvas');

    status.textContent = 'OCR en progreso...';
    enEsState.ocrTriedByPage[enEsState.currentPage] = true;

    try {
        const result = await Tesseract.recognize(canvas, 'eng', {
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

        enEsState.ocrByPage[enEsState.currentPage] = paragraphs;
        enEsState.currentParagraphIndex = -1;
        renderEnEsParagraphList();

        if (paragraphs.length > 0) {
            await selectEnEsParagraph(0);
            status.textContent = `OCR listo. Parrafos: ${paragraphs.length}.`;
        } else {
            status.textContent = 'OCR sin resultados en esta pagina.';
        }
    } catch (e) {
        console.error(e);
        status.textContent = 'Error en OCR.';
    }
}
