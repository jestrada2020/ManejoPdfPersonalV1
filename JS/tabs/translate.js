let translateState = {
    pdfDoc: null,
    currentPage: 1,
    totalPages: 0,
    scale: 1.0,
    autoFit: true,
    textLayer: null
};

async function handleTranslateFileBase(input) {
    if (!input.files.length) return;
    const file = input.files[0];
    try {
        const bytes = await readPdfBytes(file);
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        translateState.pdfDoc = await loadingTask.promise;
        translateState.totalPages = translateState.pdfDoc.numPages;
        translateState.currentPage = 1;

        document.getElementById('transPageLabel').textContent = `1 / ${translateState.totalPages}`;
        renderTranslatePage(1);
    } catch (e) {
        console.error(e);
        showToast('Error cargando PDF: ' + e.message, 'error');
    }
}

async function changeTranslatePage(delta) {
    if (!translateState.pdfDoc) return;
    const newPage = translateState.currentPage + delta;
    if (newPage >= 1 && newPage <= translateState.totalPages) {
        translateState.currentPage = newPage;
        document.getElementById('transPageLabel').textContent = `${newPage} / ${translateState.totalPages}`;
        renderTranslatePage(newPage);
    }
}

async function renderTranslatePage(pageNum) {
    const pdf = translateState.pdfDoc;
    const page = await pdf.getPage(pageNum);

    const container = document.getElementById('translateCanvas').parentElement.parentElement;
    const containerWidth = container.clientWidth - 40;

    let scale = translateState.scale;
    if (translateState.autoFit) {
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        scale = containerWidth / unscaledViewport.width;
        translateState.scale = scale;
    }

    const viewport = page.getViewport({ scale: scale });

    const canvas = document.getElementById('translateCanvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
        canvasContext: context,
        viewport: viewport
    };
    await page.render(renderContext).promise;

    const textLayerDiv = document.getElementById('textLayer');
    textLayerDiv.innerHTML = '';
    textLayerDiv.style.height = viewport.height + 'px';
    textLayerDiv.style.width = viewport.width + 'px';

    const textContent = await page.getTextContent();

    pdfjsLib.renderTextLayer({
        textContent: textContent,
        container: textLayerDiv,
        viewport: viewport,
        textDivs: []
    });
}

function setTranslateZoom(type) {
    if (type === 'fit') {
        translateState.autoFit = true;
    }
    renderTranslatePage(translateState.currentPage);
}

function changeTranslateZoom(delta) {
    translateState.autoFit = false;
    translateState.scale = Math.max(0.5, translateState.scale + delta);
    renderTranslatePage(translateState.currentPage);
}

function getSelectedText() {
    const sel = window.getSelection();
    return sel.toString().trim();
}

function translateSelection() {
    const text = getSelectedText();
    if (!text) {
        showToast('Por favor, selecciona texto del PDF primero.', 'warning');
        return;
    }
    const lang = document.getElementById('transLang').value;
    const url = `https://translate.google.com/?sl=auto&tl=${lang}&text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
}

let synth = window.speechSynthesis;
let voices = [];

// Nombre propio: vocab-reader.js también tenía un loadVoices() global que sobrescribía a este
function loadTranslateVoices() {
    voices = synth.getVoices();
    const select = document.getElementById('ttsVoice');
    if (!select || !voices.length) return;
    const previous = select.value;
    select.innerHTML = '';

    // Por defecto: la voz del narrador elegido (Jorge, México) o la más natural en español
    const preferred = pickBrowserVoice(getNarrator().lang);
    voices.forEach((voice, i) => {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `${voice.name} (${voice.lang})`;
        option.selected = previous ? String(i) === previous : voice === preferred;
        select.appendChild(option);
    });
}

speechSynthesis.addEventListener('voiceschanged', loadTranslateVoices);
loadTranslateVoices();

function previewVoice() {
    return;
}

function speakSelection() {
    const text = getSelectedText();
    if (!text) {
        showToast('Selecciona texto para leer.', 'warning');
        return;
    }
    stopSpeech();

    const utterance = new SpeechSynthesisUtterance(text);
    const voiceIndex = document.getElementById('ttsVoice').value;
    const voice = voiceIndex !== '' ? voices[voiceIndex] : pickBrowserVoice();
    if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
    }
    utterance.rate = parseFloat(document.getElementById('ttsRate').value);
    synth.speak(utterance);
}

function stopSpeech() {
    if (synth.speaking) {
        synth.cancel();
    }
}
