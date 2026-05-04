// ============================================================
// Reusable Translation Engine (used by translate-en-es and translate-es-en)
// ============================================================

function buildParagraphs(items) {
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

function createTranslatorEngine(config) {
    const state = {
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

    const ids = config.ids;

    async function handleFile(input) {
        if (!input.files.length) return;
        const file = input.files[0];
        const status = document.getElementById(ids.status);

        try {
            status.textContent = 'Cargando PDF...';
            const bytes = await readPdfBytes(file);
            const loadingTask = pdfjsLib.getDocument({ data: bytes });
            state.pdfDoc = await loadingTask.promise;
            state.totalPages = state.pdfDoc.numPages;
            state.currentPage = 1;
            state.paragraphsByPage = {};
            state.ocrByPage = {};
            state.ocrTriedByPage = {};
            state.currentParagraphIndex = -1;

            await renderPage(1);
            status.textContent = 'Listo para traducir.';
        } catch (e) {
            console.error(e);
            status.textContent = 'Error cargando el PDF.';
            showToast('Error cargando PDF: ' + e.message, 'error');
        }
    }

    async function ensureParagraphsForPage(pageNum) {
        if (state.paragraphsByPage[pageNum]) return;

        const status = document.getElementById(ids.status);
        status.textContent = `Leyendo texto de la página ${pageNum}...`;

        const page = await state.pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const paragraphs = buildParagraphs(textContent.items);
        state.paragraphsByPage[pageNum] = paragraphs;

        status.textContent = paragraphs.length
            ? `Párrafos en página ${pageNum}: ${paragraphs.length}.`
            : `Sin párrafos detectados en esta página.`;
    }

    async function renderPage(pageNum) {
        if (!state.pdfDoc) return;

        const page = await state.pdfDoc.getPage(pageNum);
        const container = document.getElementById(ids.canvas).parentElement.parentElement;
        const containerWidth = container.clientWidth - 40;

        let scale = state.scale;
        if (state.autoFit) {
            const unscaledViewport = page.getViewport({ scale: 1.0 });
            scale = containerWidth / unscaledViewport.width;
            state.scale = scale;
        }

        const viewport = page.getViewport({ scale: scale });

        const canvas = document.getElementById(ids.canvas);
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;

        const textLayerDiv = document.getElementById(ids.textLayer);
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

        state.textSpans = Array.from(textLayerDiv.querySelectorAll('span'));
        state.currentPage = pageNum;
        document.getElementById(ids.pageLabel).textContent = `${pageNum} / ${state.totalPages}`;

        const ocrLayer = document.getElementById(ids.ocrLayer);
        ocrLayer.width = canvas.width;
        ocrLayer.height = canvas.height;
        clearOcrLayer();

        await ensureParagraphsForPage(pageNum);
        const currentParagraphs = getCurrentPageParagraphs();
        if (currentParagraphs.length === 0 && !state.ocrTriedByPage[pageNum]) {
            await runOcrCurrentPage();
        } else {
            renderParagraphList();
        }

        if (state.currentParagraphIndex === -1) {
            if (getCurrentPageParagraphs().length > 0) {
                await selectParagraph(0);
            }
        } else {
            applyHighlight();
        }
    }

    function getCurrentPageParagraphs() {
        const base = state.paragraphsByPage[state.currentPage] || [];
        if (base.length > 0) return base;
        return state.ocrByPage[state.currentPage] || [];
    }

    function renderParagraphList() {
        const list = document.getElementById(ids.paraList);
        list.innerHTML = '';
        const paragraphs = getCurrentPageParagraphs();

        if (paragraphs.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'para-item';
            empty.textContent = 'Sin párrafos detectados en esta página.';
            list.appendChild(empty);
            return;
        }

        paragraphs.forEach((para, idx) => {
            const item = document.createElement('div');
            item.className = 'para-item';
            item.textContent = `P${state.currentPage}: ${para.text.slice(0, 80)}${para.text.length > 80 ? '...' : ''}`;
            item.onclick = () => selectParagraph(idx);
            list.appendChild(item);
        });
    }

    async function selectParagraph(index) {
        const paragraphs = getCurrentPageParagraphs();
        if (index < 0 || index >= paragraphs.length) return;
        state.currentParagraphIndex = index;

        const listItems = document.querySelectorAll(`#${ids.paraList} .para-item`);
        listItems.forEach((el, idx) => {
            el.classList.toggle('active', idx === index);
        });

        const para = paragraphs[index];
        document.getElementById(ids.sourceText).textContent = para.text;

        applyHighlight();
        await translateText(para.text);
    }

    function applyHighlight() {
        state.textSpans.forEach(span => {
            span.classList.remove(config.highlightClass);
        });

        clearOcrLayer();

        const paragraphs = getCurrentPageParagraphs();
        const para = paragraphs[state.currentParagraphIndex];
        if (!para) return;

        if (para.indices) {
            para.indices.forEach(idx => {
                const span = state.textSpans[idx];
                if (span) span.classList.add(config.highlightClass);
            });
            return;
        }

        if (para.bbox) {
            drawOcrHighlight(para.bbox);
        }
    }

    function clearOcrLayer() {
        const layer = document.getElementById(ids.ocrLayer);
        const ctx = layer.getContext('2d');
        ctx.clearRect(0, 0, layer.width, layer.height);
    }

    function drawOcrHighlight(bbox) {
        const layer = document.getElementById(ids.ocrLayer);
        const ctx = layer.getContext('2d');
        ctx.save();
        ctx.fillStyle = config.ocrFill;
        ctx.strokeStyle = config.ocrStroke;
        ctx.lineWidth = 2;
        ctx.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);
        ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
        ctx.restore();
    }

    function nextParagraph() {
        const paragraphs = getCurrentPageParagraphs();
        const next = state.currentParagraphIndex + 1;
        if (next < paragraphs.length) {
            selectParagraph(next);
        }
    }

    function prevParagraph() {
        const prev = state.currentParagraphIndex - 1;
        if (prev >= 0) {
            selectParagraph(prev);
        }
    }

    function setZoom(type) {
        if (type === 'fit') {
            state.autoFit = true;
        }
        renderPage(state.currentPage);
    }

    function changeZoom(delta) {
        state.autoFit = false;
        state.scale = Math.max(0.5, state.scale + delta);
        renderPage(state.currentPage);
    }

    function changePage(delta) {
        if (!state.pdfDoc) return;
        const newPage = state.currentPage + delta;
        if (newPage >= 1 && newPage <= state.totalPages) {
            state.currentParagraphIndex = -1;
            renderPage(newPage);
        }
    }

    function chunkText(text, maxLength) {
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

    async function translateText(text) {
        const status = document.getElementById(ids.status);
        const output = document.getElementById(ids.translationText);
        status.textContent = 'Traduciendo...';
        output.textContent = '';

        try {
            const chunks = chunkText(text, 500);
            let translated = '';
            for (let i = 0; i < chunks.length; i++) {
                const query = chunks[i];
                const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${config.sourceLang}&tl=${config.targetLang}&dt=t&q=${encodeURIComponent(query)}`;
                const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
                const response = await fetch(proxyUrl);
                const data = await response.json();
                const piece = data[0].map(item => item[0]).join('');
                translated += (translated ? ' ' : '') + piece;
                status.textContent = `Traduciendo ${i + 1}/${chunks.length}...`;
            }

            state.currentTranslation = translated;
            output.textContent = translated;
            state.currentAudioText = '';
            state.currentAudioUrl = '';
            status.textContent = 'Traducción lista.';
        } catch (e) {
            console.error(e);
            status.textContent = 'Error en traducción.';
            output.textContent = 'No se pudo traducir.';
            showToast('Error en traducción. Intenta de nuevo.', 'error');
        }
    }

    function playAudio() {
        const status = document.getElementById(ids.status);
        const text = state.currentTranslation;
        if (!text) {
            showToast('No hay traducción para reproducir.', 'warning');
            return;
        }

        stopAudio();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = config.targetLang === 'es' ? 'es-MX' : 'en-US';
        utterance.rate = 0.95;

        // Try to find a good voice
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(v =>
            v.lang.includes(config.targetLang) &&
            (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Neural'))
        ) || voices.find(v => v.lang.includes(config.targetLang));
        if (preferred) utterance.voice = preferred;

        utterance.onstart = () => {
            status.textContent = 'Reproduciendo...';
        };
        utterance.onend = () => {
            status.textContent = 'Reproducción finalizada.';
        };
        utterance.onerror = (e) => {
            console.error(e);
            status.textContent = 'Error en audio.';
            showToast('Error al reproducir audio', 'error');
        };

        window.speechSynthesis.speak(utterance);
    }

    function stopAudio() {
        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
        }
    }

    async function runOcrCurrentPage() {
        if (!state.pdfDoc) return;
        const status = document.getElementById(ids.status);
        const canvas = document.getElementById(ids.canvas);

        status.textContent = 'OCR en progreso...';
        state.ocrTriedByPage[state.currentPage] = true;

        try {
            const result = await Tesseract.recognize(canvas, config.ocrLang, {
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

            state.ocrByPage[state.currentPage] = paragraphs;
            state.currentParagraphIndex = -1;
            renderParagraphList();

            if (paragraphs.length > 0) {
                await selectParagraph(0);
                status.textContent = `OCR listo. Párrafos: ${paragraphs.length}.`;
            } else {
                status.textContent = 'OCR sin resultados en esta página.';
            }
        } catch (e) {
            console.error(e);
            status.textContent = 'Error en OCR.';
            showToast('Error en OCR', 'error');
        }
    }

    return {
        state,
        handleFile,
        renderPage,
        nextParagraph,
        prevParagraph,
        setZoom,
        changeZoom,
        changePage,
        translateText,
        playAudio,
        stopAudio,
        runOcrCurrentPage
    };
}
