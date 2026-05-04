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
            vocabState.allWordSpans.push(span);
            groupId++;
            return;
        }

        const tokens = text.split(/(\s+)/).filter(t => t.length > 0);
        if (tokens.length <= 1) {
            span.classList.add('vocab-word');
            span.dataset.vocabGroup = groupId;
            vocabState.allWordSpans.push(span);
            groupId++;
            return;
        }

        const parent = span.parentNode;
        const fragment = document.createDocumentFragment();

        tokens.forEach(token => {
            const subSpan = document.createElement('span');
            subSpan.textContent = token;
            subSpan.className = span.className;
            subSpan.classList.add('vocab-word');
            subSpan.style.cssText = span.style.cssText;
            subSpan.dataset.vocabGroup = groupId;
            fragment.appendChild(subSpan);
            vocabState.allWordSpans.push(subSpan);
        });

        parent.replaceChild(fragment, span);
        groupId++;
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
        let current = { originalText: '', wordSpans: [] };
        let lastGroup = null;

        spans.forEach(span => {
            const text = span.textContent || '';
            const group = span.dataset.vocabGroup;

            if (lastGroup !== null && group !== lastGroup && current.originalText.trim()) {
                units.push({
                    originalText: current.originalText.trim(),
                    translatedText: '',
                    wordSpans: current.wordSpans,
                    isStopWord: false
                });
                current = { originalText: '', wordSpans: [] };
            }

            current.originalText += text;
            current.wordSpans.push(span);
            lastGroup = group;
        });

        if (current.originalText.trim()) {
            units.push({
                originalText: current.originalText.trim(),
                translatedText: '',
                wordSpans: current.wordSpans,
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
function highlightUnit(unit) {
    clearVocabHighlight();
    if (!unit || !unit.wordSpans) return;

    unit.wordSpans.forEach(span => {
        if (span) span.classList.add('vocab-highlight');
    });

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

function clearVocabHighlight() {
    vocabState.allWordSpans.forEach(span => {
        if (span) span.classList.remove('vocab-highlight');
    });
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

    playFromCurrentUnit();
}

async function playFromCurrentUnit() {
    if (!vocabState.isPlaying || vocabState.isPaused) return;

    if (vocabState.currentUnitIndex >= vocabState.readingUnits.length) {
        if (vocabState.currentPage < vocabState.totalPages) {
            vocabState.currentPage++;
            vocabState.currentUnitIndex = 0;
            await renderVocabPage(vocabState.currentPage);
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
    // Briefly intensify the highlight to create a pulsing effect
    // that gives the illusion of word-by-word flow within a phrase
    unit.wordSpans.forEach(span => {
        if (span) {
            span.classList.add('vocab-highlight-pulse');
            setTimeout(() => {
                span.classList.remove('vocab-highlight-pulse');
            }, 300);
        }
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
