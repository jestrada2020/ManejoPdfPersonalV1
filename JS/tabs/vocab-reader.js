// ============================================================
// Lector Bilingüe / Vocabulario Interactivo
// Lee PDF en voz alta resaltando palabra/frase actual + traducción
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
    readingUnits: [],      // [{ text, spans: [indices], translation, isStopWord }]
    textSpans: [],         // spans del textLayer
    utterance: null,
    sourceLang: 'en',
    targetLang: 'es',
    rate: 0.9,
    mode: 'phrase',        // 'phrase' | 'word'
    translationsCache: {}, // palabra -> traducción
    translationPromise: null
};

// Stop words comunes en varios idiomas (para omitir en modo vocabulario)
const STOP_WORDS = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','as','is','was','are','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','must','shall','can','need','dare','ought','used','won','wouldn','couldn','shouldn','can','don','doesn','didn','hasn','haven','hadn','isn','aren','wasn','weren','ll','re','ve','s','d','m',
    'el','la','los','las','un','una','unos','unas','y','o','pero','en','de','a','por','para','con','sin','sobre','entre','hacia','desde','hasta','durante','mediante','según','ante','bajo','contra','hasta','según','tras','durante','mediante','excepto','salvo','más','menos','tan','tanto','tal','tales','cual','cuales','cuya','cuyas','cuyo','cuyos','donde','cuando','como','que','quien','quienes','cuyo','cuyos','cuya','cuyas','cuanto','cuanta','cuantos','cuantas','cual','cuales','cuya','cuyas','yo','tú','él','ella','ello','nosotros','nosotras','vosotros','vosotras','ellos','ellas','me','te','se','nos','os','le','les','lo','la','los','las','mío','mía','míos','mías','tuyo','tuya','tuyos','tuyas','suyo','suya','suyos','suyas','nuestro','nuestra','nuestros','nuestras','vuestro','vuestra','vuestros','vuestras','este','esta','esto','estos','estas','ese','esa','eso','esos','esas','aquel','aquella','aquello','aquellos','aquellas','mí','ti','sí','conmigo','contigo','consigo','algo','nada','alguien','nadie','alguno','alguna','algunos','algunas','ninguno','ninguna','ningunos','ningunas','mucho','mucha','muchos','muchas','poco','poca','pocos','pocas','demasiado','demasiada','demasiados','demasiadas','todo','toda','todos','todas','varios','varias','otro','otra','otros','otras','mismo','misma','mismos','mismas','tal','tales','cual','cuales','cuyo','cuyos','cuya','cuyas','quien','quienes','cual','cuales','cuanto','cuanta','cuantos','cuantas'
]);

function isStopWord(word) {
    return STOP_WORDS.has(word.toLowerCase().replace(/[^a-záéíóúüñ]/gi, ''));
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

        document.getElementById('vocabPageLabel').textContent = `1 / ${vocabState.totalPages}`;
    document.getElementById('vocabPageLabelFloating').textContent = `1 / ${vocabState.totalPages}`;
        await renderVocabPage(1);
        status.textContent = 'Listo. Presiona ▶️ para comenzar la lectura.';
        showToast('PDF cargado. Presiona Play para empezar.', 'success');
    } catch (e) {
        console.error(e);
        status.textContent = 'Error cargando PDF.';
        showToast('Error cargando PDF: ' + e.message, 'error');
    }
}

// ============================================================
// PAGE RENDERING
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

    vocabState.textSpans = Array.from(textLayerDiv.querySelectorAll('span'));
    vocabState.currentPage = pageNum;
    document.getElementById('vocabPageLabel').textContent = `${pageNum} / ${vocabState.totalPages}`;
    document.getElementById('vocabPageLabelFloating').textContent = `${pageNum} / ${vocabState.totalPages}`;

    buildReadingUnits(textContent.items);
    clearVocabHighlight();
    updateVocabPanel(null);
}

// ============================================================
// READING UNITS BUILDER
// ============================================================
function buildReadingUnits(items) {
    const units = [];
    const mode = vocabState.mode;

    if (mode === 'phrase') {
        // Agrupar por línea (Y similar) en frases
        let current = { text: '', spanIndices: [] };
        let lastY = null;

        items.forEach((item, idx) => {
            const str = (item.str || '').trim();
            if (!str) return;

            const y = item.transform ? item.transform[5] : 0;
            if (lastY !== null && Math.abs(y - lastY) > 5) {
                if (current.text) {
                    units.push({ ...current, translation: '', isStopWord: false });
                }
                current = { text: '', spanIndices: [] };
            }

            current.text += (current.text ? ' ' : '') + str;
            current.spanIndices.push(idx);
            lastY = y;
        });

        if (current.text) {
            units.push({ ...current, translation: '', isStopWord: false });
        }
    } else {
        // Modo palabra por palabra
        items.forEach((item, idx) => {
            const str = item.str || '';
            const words = str.split(/\s+/).filter(w => w.length > 0);
            words.forEach(word => {
                const clean = word.replace(/[^a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/g, '');
                units.push({
                    text: word,
                    spanIndices: [idx],
                    translation: '',
                    isStopWord: clean.length < 2 || isStopWord(clean)
                });
            });
        });
    }

    vocabState.readingUnits = units;
    vocabState.currentUnitIndex = 0;

    // Precargar traducciones de la primera tanda
    prefetchTranslations(units.slice(0, 30));
}

// ============================================================
// TRANSLATION WITH CACHE
// ============================================================
async function prefetchTranslations(units) {
    const toTranslate = [...new Set(
        units
            .filter(u => !u.isStopWord && !u.translation && !vocabState.translationsCache[u.text])
            .map(u => u.text)
    )].slice(0, 25); // max 25 palabras por página

    if (toTranslate.length === 0) return;

    // Traducir con concurrencia limitada (máx 5 en paralelo)
    const CONCURRENCY = 5;
    const results = new Map();

    async function translateWord(word) {
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${vocabState.sourceLang}&tl=${vocabState.targetLang}&dt=t&q=${encodeURIComponent(word)}`;
            const response = await fetch(url);
            const data = await response.json();
            return data[0].map(item => item[0]).join('');
        } catch (e) {
            return '';
        }
    }

    for (let i = 0; i < toTranslate.length; i += CONCURRENCY) {
        const batch = toTranslate.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(batch.map(async (word) => {
            const t = await translateWord(word);
            return { word, t };
        }));
        batchResults.forEach(({ word, t }) => {
            if (t) vocabState.translationsCache[word] = t;
        });
    }

    // Aplicar cache a units
    units.forEach(u => {
        if (vocabState.translationsCache[u.text]) {
            u.translation = vocabState.translationsCache[u.text];
        }
    });
}

async function translateUnit(unit) {
    if (unit.translation) return unit.translation;
    if (unit.isStopWord) return '(palabra común)';
    if (vocabState.translationsCache[unit.text]) {
        unit.translation = vocabState.translationsCache[unit.text];
        return unit.translation;
    }

    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${vocabState.sourceLang}&tl=${vocabState.targetLang}&dt=t&q=${encodeURIComponent(unit.text)}`;
        const response = await fetch(url);
        const data = await response.json();
        const translated = data[0].map(item => item[0]).join('');
        unit.translation = translated;
        vocabState.translationsCache[unit.text] = translated;
        return translated;
    } catch (e) {
        console.error(e);
        return '';
    }
}

// ============================================================
// HIGHLIGHTING
// ============================================================
function highlightUnit(unit) {
    clearVocabHighlight();
    if (!unit) return;

    unit.spanIndices.forEach(idx => {
        const span = vocabState.textSpans[idx];
        if (span) span.classList.add('vocab-highlight');
    });

    // Scroll into view if needed
    const firstSpan = vocabState.textSpans[unit.spanIndices[0]];
    if (firstSpan) {
        firstSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function clearVocabHighlight() {
    vocabState.textSpans.forEach(span => span.classList.remove('vocab-highlight'));
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

    originalEl.textContent = unit.text;

    if (unit.isStopWord) {
        translationEl.textContent = '(palabra común / stop word)';
    } else if (unit.translation) {
        translationEl.textContent = unit.translation;
    } else {
        translationEl.textContent = 'Traduciendo...';
        const t = await translateUnit(unit);
        if (vocabState.readingUnits[vocabState.currentUnitIndex] === unit) {
            translationEl.textContent = t || '(sin traducción)';
        }
    }

    progressEl.textContent = `${vocabState.currentUnitIndex + 1} / ${vocabState.readingUnits.length}`;
}

// ============================================================
// PLAYBACK CONTROLS
// ============================================================
async function vocabPlay() {
    if (vocabState.isPlaying) return;
    if (!vocabState.pdfDoc) {
        showToast('Carga un PDF primero.', 'warning');
        return;
    }
    if (vocabState.readingUnits.length === 0) {
        showToast('No hay texto para leer en esta página.', 'warning');
        return;
    }

    vocabState.isPlaying = true;
    vocabState.isPaused = false;
    updatePlayButtons();

    while (vocabState.isPlaying && !vocabState.isPaused) {
        if (vocabState.currentUnitIndex >= vocabState.readingUnits.length) {
            // Next page
            if (vocabState.currentPage < vocabState.totalPages) {
                vocabState.currentPage++;
                vocabState.currentUnitIndex = 0;
                await renderVocabPage(vocabState.currentPage);
                continue;
            } else {
                showToast('Lectura completada.', 'success');
                vocabStop();
                return;
            }
        }

        const unit = vocabState.readingUnits[vocabState.currentUnitIndex];
        await vocabPlayUnit(unit);

        if (vocabState.isPaused || !vocabState.isPlaying) break;
        vocabState.currentUnitIndex++;
    }
}

function vocabPlayUnit(unit) {
    return new Promise((resolve) => {
        if (!vocabState.isPlaying || vocabState.isPaused) {
            resolve();
            return;
        }

        highlightUnit(unit);
        updateVocabPanel(unit);

        const utterance = new SpeechSynthesisUtterance(unit.text);
        utterance.lang = vocabState.sourceLang;
        utterance.rate = vocabState.rate;
        utterance.pitch = 1;

        const preferred = getPreferredVoice(vocabState.sourceLang);
        if (preferred) utterance.voice = preferred;

        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();

        window.speechSynthesis.speak(utterance);
        vocabState.utterance = utterance;
    });
}

function getPreferredVoice(lang) {
    const voices = window.speechSynthesis.getVoices();
    return voices.find(v =>
        v.lang.toLowerCase().startsWith(lang.toLowerCase()) &&
        (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Neural'))
    ) || voices.find(v => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
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
    vocabPlay();
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
    vocabState.sourceLang = document.getElementById('vocabSourceLang').value;
    vocabState.targetLang = document.getElementById('vocabTargetLang').value;
    vocabState.translationsCache = {};
    // Rebuild units to re-evaluate stop words
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
    // Only when vocab tab is active
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
