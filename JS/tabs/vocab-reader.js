// ============================================================
// Lector Bilingüe / Vocabulario Interactivo v3
// FLUJO CORREGIDO:
// 1. Usuario elige idioma de narración (targetLang)
// 2. App traduce texto original → idioma de narración
// 3. App NARRA la TRADUCCIÓN con voz
// 4. App RESALTA la palabra/frase ORIGINAL en el PDF
// ============================================================

let vocabState = {
    pdfDoc: null,
    currentPage: 1,
    totalPages: 0,
    scale: 1.0,
    autoFit: true,
    isPlaying: false,
    isPaused: false,
    currentUnitIndex: 0,
    readingUnits: [],      // [{ originalText, translatedText, wordSpans: [HTMLElement], isStopWord }]
    allWordSpans: [],
    utterance: null,
    sourceLang: 'en',      // idioma del PDF (detectado o elegido)
    targetLang: 'es',      // idioma de NARRACIÓN
    rate: 0.9,
    mode: 'phrase',        // 'phrase' | 'word'
    translationsCache: {},
    voicesLoaded: false
};

const STOP_WORDS = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','as','is','was','are','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','must','shall','can','need','dare','ought','used','won','wouldn','couldn','shouldn','don','doesn','didn','hasn','haven','hadn','isn','aren','wasn','weren',
    'el','la','los','las','un','una','unos','unas','y','o','pero','en','de','a','por','para','con','sin','sobre','entre','hacia','desde','hasta','durante','mediante','según','ante','bajo','contra','tras','excepto','salvo','más','menos','tan','tanto','tal','tales','cual','cuales','cuya','cuyas','cuyo','cuyos','donde','cuando','como','que','quien','quienes','cuanto','cuanta','cuantos','cuantas',
    'yo','tú','él','ella','ello','nosotros','nosotras','vosotros','vosotras','ellos','ellas','me','te','se','nos','os','le','les','lo','la','los','las','mío','mía','míos','mías','tuyo','tuya','tuyos','tuyas','suyo','suya','suyos','suyas','nuestro','nuestra','nuestros','nuestras','vuestro','vuestra','vuestros','vuestras',
    'este','esta','esto','estos','estas','ese','esa','eso','esos','esas','aquel','aquella','aquello','aquellos','aquellas','mí','ti','sí','conmigo','contigo','consigo',
    'algo','nada','alguien','nadie','alguno','alguna','algunos','algunas','ninguno','ninguna','ningunos','ningunas','mucho','mucha','muchos','muchas','poco','poca','pocos','pocas','demasiado','demasiada','demasiados','demasiadas','todo','toda','todos','todas','varios','varias','otro','otra','otros','otras','mismo','misma','mismos','mismas'
]);

function isStopWord(word) {
    const clean = word.toLowerCase().replace(/[^a-záéíóúüñ]/gi, '');
    return clean.length < 2 || STOP_WORDS.has(clean);
}

// ============================================================
// VOICES
// ============================================================
function loadVoices() {
    vocabState.voicesLoaded = window.speechSynthesis.getVoices().length > 0;
}
if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = loadVoices;
}
loadVoices();

function getPreferredVoice(lang) {
    if (!vocabState.voicesLoaded) loadVoices();
    const voices = window.speechSynthesis.getVoices();
    const langLower = lang.toLowerCase();
    return voices.find(v =>
        v.lang.toLowerCase().startsWith(langLower) &&
        (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Neural'))
    ) || voices.find(v => v.lang.toLowerCase().startsWith(langLower));
}

// ============================================================
// FILE HANDLING
// ============================================================
async function handleVocabFile(input) {
    if (!input.files.length) return;
    const file = input.files[0];
    const status = document.getElementById('vocabStatus');

    try {
        status.textContent = 'Cargando PDF...';
        const bytes = await readPdfBytes(file);
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        vocabState.pdfDoc = await loadingTask.promise;
        vocabState.totalPages = vocabState.pdfDoc.numPages;
        vocabState.currentPage = 1;
        vocabState.currentUnitIndex = 0;
        vocabState.readingUnits = [];
        vocabState.translationsCache = {};

        await renderVocabPage(1);
        status.textContent = 'Listo. Presiona ▶️ Leer para escuchar la traducción narrada.';
        showToast('PDF cargado. La voz narrará en: ' + langName(vocabState.targetLang), 'success');
    } catch (e) {
        console.error(e);
        status.textContent = 'Error cargando PDF.';
        showToast('Error cargando PDF: ' + e.message, 'error');
    }
}

function langName(code) {
    const names = { es: 'Español', en: 'Inglés', fr: 'Francés', de: 'Alemán', it: 'Italiano', pt: 'Portugués' };
    return names[code] || code;
}

// ============================================================
// PAGE RENDERING + TEXTLAYER SPLITTING
// ============================================================
async function renderVocabPage(pageNum) {
    if (!vocabState.pdfDoc) return;

    const page = await vocabState.pdfDoc.getPage(pageNum);
    const container = document.getElementById('vocabCanvas').parentElement.parentElement;
    const containerWidth = container.clientWidth - 40;

    let scale = vocabState.scale;
    if (vocabState.autoFit) {
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        scale = containerWidth / unscaledViewport.width;
        vocabState.scale = scale;
    }

    const viewport = page.getViewport({ scale: scale });

    const canvas = document.getElementById('vocabCanvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;

    const textLayerDiv = document.getElementById('vocabTextLayer');
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

    splitTextLayerIntoWords(textLayerDiv);

    vocabState.currentPage = pageNum;
    document.getElementById('vocabPageLabel').textContent = `${pageNum} / ${vocabState.totalPages}`;
    document.getElementById('vocabPageLabelFloating').textContent = `${pageNum} / ${vocabState.totalPages}`;

    buildReadingUnits();
    clearVocabHighlight();
    updateVocabPanel(null);
}

function splitTextLayerIntoWords(textLayerDiv) {
    vocabState.allWordSpans = [];
    const originalSpans = Array.from(textLayerDiv.querySelectorAll('span'));
    let groupId = 0;

    originalSpans.forEach(span => {
        const text = span.textContent;
        if (!text || text.trim().length === 0) {
            span.dataset.vocabGroup = groupId;
            span.dataset.spanIndex  = vocabState.allWordSpans.length;
            vocabState.allWordSpans.push(span);
            groupId++;
            return;
        }

        const tokens = text.split(/(\s+)/).filter(t => t.length > 0);
        if (tokens.length <= 1) {
            span.classList.add('vocab-word');
            span.dataset.vocabGroup = groupId;
            span.dataset.spanIndex  = vocabState.allWordSpans.length;
            vocabState.allWordSpans.push(span);
            groupId++;
            return;
        }

        const parent = span.parentNode;
        const fragment = document.createDocumentFragment();

        tokens.forEach(token => {
            const subSpan = document.createElement('span');
            subSpan.textContent = token;
            subSpan.className   = span.className;
            subSpan.classList.add('vocab-word');
            subSpan.style.cssText    = span.style.cssText;
            subSpan.dataset.vocabGroup = groupId;
            subSpan.dataset.spanIndex  = vocabState.allWordSpans.length;
            fragment.appendChild(subSpan);
            vocabState.allWordSpans.push(subSpan);
        });

        parent.replaceChild(fragment, span);
        groupId++;
    });
}

// Mirror split for the modal text layer — produces vocabModal.allSpans in the
// exact same order as vocabState.allWordSpans so indices match 1-to-1.
function splitTextLayerForModal(textLayerDiv) {
    vocabModal.allSpans = [];
    const originalSpans = Array.from(textLayerDiv.querySelectorAll('span'));

    originalSpans.forEach(span => {
        const text = span.textContent;
        if (!text || text.trim().length === 0) {
            vocabModal.allSpans.push(span);
            return;
        }

        const tokens = text.split(/(\s+)/).filter(t => t.length > 0);
        if (tokens.length <= 1) {
            vocabModal.allSpans.push(span);
            return;
        }

        const parent = span.parentNode;
        const fragment = document.createDocumentFragment();
        tokens.forEach(token => {
            const subSpan = document.createElement('span');
            subSpan.textContent   = token;
            subSpan.className     = span.className;
            subSpan.style.cssText = span.style.cssText;
            fragment.appendChild(subSpan);
            vocabModal.allSpans.push(subSpan);
        });
        parent.replaceChild(fragment, span);
    });
}

// ============================================================
// READING UNITS BUILDER
// ============================================================
function buildReadingUnits() {
    const units = [];
    const spans = vocabState.allWordSpans;
    const mode = vocabState.mode;

    if (mode === 'phrase') {
        // Group consecutive word-spans into natural sentences/phrases.
        // Spans come from different PDF.js text elements so each has its own
        // absolute position — this gives `highlightUnit` enough distinct rects
        // to draw elongated overlays across the full width of each line.
        const PHRASE_END = /[.!?;][\s"'»)\]]*$/;
        const MAX_SPANS  = 25;            // hard cap to avoid very long phrases
        let current = { originalText: '', wordSpans: [] };

        spans.forEach(span => {
            const text = span.textContent || '';
            if (!text.trim()) return;

            if (current.wordSpans.length > 0) current.originalText += ' ';
            current.originalText += text.trim();
            current.wordSpans.push(span);

            if (PHRASE_END.test(current.originalText) || current.wordSpans.length >= MAX_SPANS) {
                units.push({
                    originalText: current.originalText.trim(),
                    translatedText: '',
                    wordSpans: [...current.wordSpans],
                    isStopWord: false
                });
                current = { originalText: '', wordSpans: [] };
            }
        });

        if (current.originalText.trim() && current.wordSpans.length > 0) {
            units.push({
                originalText: current.originalText.trim(),
                translatedText: '',
                wordSpans: [...current.wordSpans],
                isStopWord: false
            });
        }
    } else {
        spans.forEach(span => {
            const text = span.textContent || '';
            if (!text.trim()) return;
            const clean = text.replace(/[^a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/g, '');
            units.push({
                originalText: text,
                translatedText: '',
                wordSpans: [span],
                isStopWord: clean.length < 2 || isStopWord(clean)
            });
        });
    }

    vocabState.readingUnits = units;
    vocabState.currentUnitIndex = 0;

    // Pre-translate first batch so narration can start immediately
    prefetchTranslations(units.slice(0, 30));
}

// ============================================================
// TRANSLATION (source → target/narration language)
// ============================================================
async function prefetchTranslations(units) {
    const toTranslate = [...new Set(
        units
            .filter(u => !u.isStopWord && !u.translatedText && !vocabState.translationsCache[u.originalText])
            .map(u => u.originalText)
    )].slice(0, 25);

    if (toTranslate.length === 0) return;

    const CONCURRENCY = 5;

    async function doTranslate(text) {
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${vocabState.sourceLang}&tl=${vocabState.targetLang}&dt=t&q=${encodeURIComponent(text)}`;
            const response = await fetch(url);
            const data = await response.json();
            return data[0].map(item => item[0]).join('');
        } catch (e) {
            return '';
        }
    }

    for (let i = 0; i < toTranslate.length; i += CONCURRENCY) {
        const batch = toTranslate.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(doTranslate));
        results.forEach((t, idx) => {
            if (t) vocabState.translationsCache[batch[idx]] = t;
        });
    }

    units.forEach(u => {
        if (vocabState.translationsCache[u.originalText]) {
            u.translatedText = vocabState.translationsCache[u.originalText];
        }
    });
}

async function translateUnit(unit) {
    if (unit.translatedText) return unit.translatedText;
    if (unit.isStopWord) {
        // For stop words, we still translate them for narration flow
        const stopTranslations = {
            'the': 'el', 'a': 'un', 'an': 'un', 'and': 'y', 'or': 'o', 'but': 'pero',
            'in': 'en', 'on': 'en', 'at': 'en', 'to': 'a', 'for': 'para', 'of': 'de',
            'with': 'con', 'by': 'por', 'from': 'desde', 'as': 'como', 'is': 'es',
            'el': 'the', 'la': 'the', 'los': 'the', 'las': 'the', 'un': 'a', 'una': 'a',
            'y': 'and', 'o': 'or', 'pero': 'but', 'en': 'in', 'de': 'of', 'a': 'to',
            'por': 'by', 'para': 'for', 'con': 'with', 'sin': 'without'
        };
        const lower = unit.originalText.toLowerCase().trim();
        if (stopTranslations[lower]) {
            unit.translatedText = stopTranslations[lower];
            return unit.translatedText;
        }
    }
    if (vocabState.translationsCache[unit.originalText]) {
        unit.translatedText = vocabState.translationsCache[unit.originalText];
        return unit.translatedText;
    }

    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${vocabState.sourceLang}&tl=${vocabState.targetLang}&dt=t&q=${encodeURIComponent(unit.originalText)}`;
        const response = await fetch(url);
        const data = await response.json();
        const translated = data[0].map(item => item[0]).join('');
        unit.translatedText = translated;
        vocabState.translationsCache[unit.originalText] = translated;
        return translated;
    } catch (e) {
        console.error(e);
        return unit.originalText;
    }
}

// ============================================================
// HIGHLIGHTING (always on ORIGINAL text)
// ============================================================

function clearVocabHighlight() {
    document.querySelectorAll('.vocab-highlight-overlay').forEach(el => el.remove());
}

// Groups rects by visual line and draws one elongated overlay per line
// inside `targetEl` (must have position:relative).
// All rects must already be in targetEl's coordinate space.
function drawHighlightOverlays(spanRects, targetEl) {
    const LINE_TOLERANCE = 10;
    const lines = [];

    spanRects.forEach(r => {
        const midY = (r.top + r.bottom) / 2;
        const existing = lines.find(l => Math.abs(l.midY - midY) < LINE_TOLERANCE);
        if (existing) {
            existing.rects.push(r);
        } else {
            lines.push({ midY, rects: [r] });
        }
    });

    lines.forEach(line => {
        const left   = Math.min(...line.rects.map(r => r.left));
        const top    = Math.min(...line.rects.map(r => r.top));
        const right  = Math.max(...line.rects.map(r => r.right));
        const bottom = Math.max(...line.rects.map(r => r.bottom));
        if (right <= left || bottom <= top) return;

        const el = document.createElement('div');
        el.className     = 'vocab-highlight-overlay';
        el.style.left    = left            + 'px';
        el.style.top     = top             + 'px';
        el.style.width   = (right - left)  + 'px';
        el.style.height  = (bottom - top)  + 'px';
        targetEl.appendChild(el);
    });
}

// Convert a NodeList of spans to rects relative to a reference element
function spansToRects(spans, referenceEl) {
    const refRect = referenceEl.getBoundingClientRect();
    return spans
        .map(s => {
            const r = s.getBoundingClientRect();
            return { left:   r.left   - refRect.left,
                     top:    r.top    - refRect.top,
                     right:  r.right  - refRect.left,
                     bottom: r.bottom - refRect.top };
        })
        .filter(r => (r.right - r.left) > 0 || (r.bottom - r.top) > 0);
}

function highlightUnit(unit) {
    clearVocabHighlight();
    if (!unit || !unit.wordSpans) return;

    const modalEl   = document.getElementById('vocabPdfModal');
    const modalOpen = modalEl && modalEl.style.display !== 'none';

    if (modalOpen) {
        // --- Modal highlighting: use the modal's own text-layer spans ---
        const canvasWrap = document.getElementById('vocabModalCanvasWrap');
        if (!canvasWrap) return;

        // Map main-layer span indices to modal-layer spans
        const modalSpans = unit.wordSpans
            .map(s => {
                const idx = parseInt(s.dataset.spanIndex, 10);
                return (!isNaN(idx) && vocabModal.allSpans) ? vocabModal.allSpans[idx] : null;
            })
            .filter(Boolean);

        if (modalSpans.length === 0) return;

        const spanRects = spansToRects(modalSpans, canvasWrap);
        if (spanRects.length === 0) return;

        drawHighlightOverlays(spanRects, canvasWrap);

        // Auto-scroll modal so the highlighted line is visible
        const scrollEl  = document.getElementById('vocabModalScroll');
        const scrollRect = scrollEl.getBoundingClientRect();
        const firstSpanRect = modalSpans[0].getBoundingClientRect();
        if (firstSpanRect.top < scrollRect.top + 60 ||
            firstSpanRect.bottom > scrollRect.bottom - 60) {
            const targetScroll = scrollEl.scrollTop +
                (firstSpanRect.top - scrollRect.top) - scrollEl.clientHeight / 3;
            scrollEl.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
        }

    } else {
        // --- Main-view highlighting ---
        const mainWrapper = document.getElementById('vocabWrapper');
        const spanRects   = spansToRects(unit.wordSpans, mainWrapper);
        if (spanRects.length === 0) return;

        drawHighlightOverlays(spanRects, mainWrapper);

        const firstSpan = unit.wordSpans[0];
        if (firstSpan) {
            const rect = firstSpan.getBoundingClientRect();
            const container = document.getElementById('vocabCanvas').parentElement.parentElement;
            const cRect = container.getBoundingClientRect();
            if (rect.top < cRect.top || rect.bottom > cRect.bottom) {
                firstSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }
}

// ============================================================
// VOCABULARY PANEL
// ============================================================
async function updateVocabPanel(unit) {
    const originalEl = document.getElementById('vocabOriginal');
    const translationEl = document.getElementById('vocabTranslation');
    const progressEl = document.getElementById('vocabProgress');

    if (!unit) {
        originalEl.textContent = '—';
        translationEl.textContent = '—';
        progressEl.textContent = `0 / ${vocabState.readingUnits.length}`;
        return;
    }

    originalEl.textContent = unit.originalText;

    if (unit.translatedText) {
        translationEl.textContent = unit.translatedText;
        translationEl.style.color = 'var(--primary)';
    } else {
        translationEl.textContent = 'Traduciendo...';
        translationEl.style.color = '#94a3b8';
        const t = await translateUnit(unit);
        if (vocabState.readingUnits[vocabState.currentUnitIndex] === unit) {
            translationEl.textContent = t || unit.originalText;
            translationEl.style.color = t ? 'var(--primary)' : '#94a3b8';
        }
    }

    progressEl.textContent = `${vocabState.currentUnitIndex + 1} / ${vocabState.readingUnits.length}`;
}

// ============================================================
// PLAYBACK: narrates TRANSLATION, highlights ORIGINAL
// ============================================================
function vocabPlay() {
    if (vocabState.isPlaying) return;
    if (!vocabState.pdfDoc) {
        showToast('Carga un PDF primero.', 'warning');
        return;
    }
    if (vocabState.readingUnits.length === 0) {
        showToast('No hay texto para leer en esta página.', 'warning');
        return;
    }
    if (vocabState.sourceLang === vocabState.targetLang) {
        showToast('El idioma del PDF y el idioma de narración deben ser diferentes.', 'warning');
        return;
    }

    vocabState.isPlaying = true;
    vocabState.isPaused = false;
    updatePlayButtons();

    openVocabModal();       // abre pantalla completa al iniciar lectura
    playFromCurrentUnit();
}

async function playFromCurrentUnit() {
    if (!vocabState.isPlaying || vocabState.isPaused) return;

    if (vocabState.currentUnitIndex >= vocabState.readingUnits.length) {
        if (vocabState.currentPage < vocabState.totalPages) {
            vocabState.currentPage++;
            vocabState.currentUnitIndex = 0;
            await renderVocabPage(vocabState.currentPage);
            // Sync modal page if open
            const modalEl = document.getElementById('vocabPdfModal');
            if (modalEl && modalEl.style.display !== 'none') {
                vocabModal.currentPage = vocabState.currentPage;
                await renderVocabModal(vocabState.currentPage);
            }
            if (vocabState.isPlaying && !vocabState.isPaused) {
                playFromCurrentUnit();
            }
        } else {
            showToast('Lectura completada.', 'success');
            vocabStop();
        }
        return;
    }

    const unit = vocabState.readingUnits[vocabState.currentUnitIndex];

    // Ensure translation is ready before speaking
    if (!unit.translatedText) {
        await translateUnit(unit);
    }

    // Highlight the ORIGINAL text in the PDF
    highlightUnit(unit);
    updateVocabPanel(unit);

    // Speak the TRANSLATION
    const textToSpeak = unit.translatedText || unit.originalText;
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = vocabState.targetLang;  // NARRATION language
    utterance.rate = vocabState.rate;
    utterance.pitch = 1;

    const voice = getPreferredVoice(vocabState.targetLang);
    if (voice) utterance.voice = voice;

    // For phrase mode, use boundary events to create a "flowing" highlight effect
    // by briefly intensifying the highlight as each word is spoken
    if (vocabState.mode === 'phrase' && unit.wordSpans.length > 1) {
        utterance.onboundary = (e) => {
            if (e.name === 'word' && vocabState.isPlaying && !vocabState.isPaused) {
                pulseHighlight(unit);
            }
        };
    }

    utterance.onend = () => {
        if (vocabState.isPlaying && !vocabState.isPaused) {
            vocabState.currentUnitIndex++;
            playFromCurrentUnit();
        }
    };

    utterance.onerror = (e) => {
        console.warn('TTS error:', e.error);
        if (vocabState.isPlaying && !vocabState.isPaused) {
            vocabState.currentUnitIndex++;
            playFromCurrentUnit();
        }
    };

    window.speechSynthesis.speak(utterance);
    vocabState.utterance = utterance;
}

function pulseHighlight(unit) {
    document.querySelectorAll('.vocab-highlight-overlay').forEach(overlay => {
        overlay.classList.add('vocab-highlight-pulse');
        setTimeout(() => overlay.classList.remove('vocab-highlight-pulse'), 300);
    });
}

function vocabPause() {
    if (!vocabState.isPlaying) return;
    vocabState.isPaused = true;
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
    }
    updatePlayButtons();
    showToast('Lectura pausada.', 'info');
}

function vocabResume() {
    if (!vocabState.isPaused) return;
    vocabState.isPaused = false;
    updatePlayButtons();
    playFromCurrentUnit();
}

function vocabStop() {
    vocabState.isPlaying = false;
    vocabState.isPaused = false;
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
    }
    vocabState.currentUnitIndex = 0;
    clearVocabHighlight();
    updateVocabPanel(null);
    updatePlayButtons();
}

function vocabTogglePlay() {
    if (vocabState.isPlaying && !vocabState.isPaused) {
        vocabPause();
    } else if (vocabState.isPaused) {
        vocabResume();
    } else {
        vocabPlay();
    }
}

function vocabNext() {
    if (vocabState.currentUnitIndex < vocabState.readingUnits.length - 1) {
        vocabState.currentUnitIndex++;
        const unit = vocabState.readingUnits[vocabState.currentUnitIndex];
        highlightUnit(unit);
        updateVocabPanel(unit);
    }
}

function vocabPrev() {
    if (vocabState.currentUnitIndex > 0) {
        vocabState.currentUnitIndex--;
        const unit = vocabState.readingUnits[vocabState.currentUnitIndex];
        highlightUnit(unit);
        updateVocabPanel(unit);
    }
}

function updatePlayButtons() {
    const btn = document.getElementById('vocabPlayBtn');
    if (!btn) return;
    if (vocabState.isPlaying && !vocabState.isPaused) {
        btn.textContent = '⏸️ Pausar';
    } else if (vocabState.isPaused) {
        btn.textContent = '▶️ Reanudar';
    } else {
        btn.textContent = '▶️ Leer';
    }
}

// ============================================================
// SETTINGS
// ============================================================
function vocabSetZoom(type) {
    if (type === 'fit') {
        vocabState.autoFit = true;
    }
    renderVocabPage(vocabState.currentPage);
}

function vocabChangeZoom(delta) {
    vocabState.autoFit = false;
    vocabState.scale = Math.max(0.5, vocabState.scale + delta);
    renderVocabPage(vocabState.currentPage);
}

function vocabChangePage(delta) {
    if (!vocabState.pdfDoc) return;
    const newPage = vocabState.currentPage + delta;
    if (newPage >= 1 && newPage <= vocabState.totalPages) {
        vocabStop();
        renderVocabPage(newPage);
    }
}

function onVocabLangChange() {
    const src = document.getElementById('vocabSourceLang').value;
    const tgt = document.getElementById('vocabTargetLang').value;

    if (src === tgt) {
        showToast('El idioma del PDF y el idioma de narración deben ser diferentes.', 'warning');
        const options = Array.from(document.getElementById('vocabTargetLang').options);
        const different = options.find(o => o.value !== src);
        if (different) {
            document.getElementById('vocabTargetLang').value = different.value;
        }
    }

    vocabState.sourceLang = document.getElementById('vocabSourceLang').value;
    vocabState.targetLang = document.getElementById('vocabTargetLang').value;
    vocabState.translationsCache = {};
    if (vocabState.pdfDoc) {
        renderVocabPage(vocabState.currentPage);
    }
}

function onVocabModeChange() {
    vocabState.mode = document.getElementById('vocabMode').value;
    vocabStop();
    if (vocabState.pdfDoc) {
        renderVocabPage(vocabState.currentPage);
    }
}

function onVocabRateChange() {
    vocabState.rate = parseFloat(document.getElementById('vocabRate').value);
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
        closeVocabModal();
        return;
    }

    const vocabTab = document.getElementById('vocab-reader');
    if (!vocabTab || !vocabTab.classList.contains('active')) return;

    if (e.code === 'Space') {
        e.preventDefault();
        vocabTogglePlay();
    } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        vocabNext();
    } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        vocabPrev();
    }
});

// ============================================================
// PDF MODAL VIEWER
// ============================================================
const vocabModal = {
    currentPage: 1,
    scale: 1.5,
    autoFit: true,
    allSpans: []       // mirrors vocabState.allWordSpans, same indices
};

function openVocabModal() {
    if (!vocabState.pdfDoc) {
        showToast('Carga un PDF primero.', 'warning');
        return Promise.resolve();
    }
    vocabModal.currentPage = vocabState.currentPage;
    vocabModal.autoFit = true;
    document.getElementById('vocabPdfModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    return renderVocabModal(vocabModal.currentPage);
}

function closeVocabModal() {
    const modal = document.getElementById('vocabPdfModal');
    if (!modal || modal.style.display === 'none') return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
    clearVocabHighlight();
}

async function renderVocabModal(pageNum) {
    if (!vocabState.pdfDoc) return;
    clearVocabHighlight();

    const page      = await vocabState.pdfDoc.getPage(pageNum);
    const scrollEl  = document.getElementById('vocabModalScroll');
    const canvas    = document.getElementById('vocabModalCanvas');
    const textLayer = document.getElementById('vocabModalTextLayer');
    const unscaled  = page.getViewport({ scale: 1.0 });

    if (vocabModal.autoFit) {
        const availW = (scrollEl.clientWidth  || window.innerWidth)  - 40;
        const availH = (scrollEl.clientHeight || (window.innerHeight - 60)) - 40;
        vocabModal.scale = Math.min(availW / unscaled.width, availH / unscaled.height, 3.0);
    }

    const viewport = page.getViewport({ scale: vocabModal.scale });

    // Render canvas
    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    // Render text layer at the same scale so spans have correct positions for highlighting
    textLayer.innerHTML = '';
    textLayer.style.width  = viewport.width  + 'px';
    textLayer.style.height = viewport.height + 'px';
    const textContent = await page.getTextContent();
    await pdfjsLib.renderTextLayer({
        textContent, container: textLayer, viewport, textDivs: []
    }).promise;

    // Build parallel span array (same order as main allWordSpans)
    splitTextLayerForModal(textLayer);

    vocabModal.currentPage = pageNum;
    document.getElementById('vocabModalPageLabel').textContent =
        `${pageNum} / ${vocabState.totalPages}`;
    document.getElementById('vocabModalZoomLabel').textContent =
        Math.round(vocabModal.scale * 100) + '%';

    // Redraw highlight if reading is in progress
    if (vocabState.isPlaying || vocabState.isPaused) {
        const unit = vocabState.readingUnits[vocabState.currentUnitIndex];
        if (unit) highlightUnit(unit);
    }
}

function vocabModalChangePage(delta) {
    const next = vocabModal.currentPage + delta;
    if (next >= 1 && next <= vocabState.totalPages) {
        renderVocabModal(next);
    }
}

function vocabModalChangeZoom(delta) {
    vocabModal.autoFit = false;
    vocabModal.scale = Math.max(0.4, Math.min(4.0, vocabModal.scale + delta));
    renderVocabModal(vocabModal.currentPage);
}

function vocabModalFit() {
    vocabModal.autoFit = true;
    renderVocabModal(vocabModal.currentPage);
}
