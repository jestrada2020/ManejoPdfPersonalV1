// ==========================================
// Monkey-patch URL.createObjectURL for automatic memory tracking
// ==========================================
const _originalCreateObjectURL = URL.createObjectURL.bind(URL);
const _originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
const _trackedURLs = new Set();

URL.createObjectURL = function(blob) {
    const url = _originalCreateObjectURL(blob);
    _trackedURLs.add(url);
    return url;
};

URL.revokeObjectURL = function(url) {
    _originalRevokeObjectURL(url);
    _trackedURLs.delete(url);
};

function cleanupOldURLs(maxAgeMs = 60000) {
    // This is a safety net: revoke URLs older than maxAgeMs
    // In practice, each tab should revoke its own URLs when done
    // This function can be called periodically if needed
}

// Global config
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// ==========================================
// Toast Notification System
// ==========================================
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ==========================================
// Memory Management Helpers
// ==========================================
const _activeObjectURLs = new Set();

function createObjectURL(blob) {
    const url = URL.createObjectURL(blob);
    _activeObjectURLs.add(url);
    return url;
}

function revokeObjectURL(url) {
    if (url && _activeObjectURLs.has(url)) {
        URL.revokeObjectURL(url);
        _activeObjectURLs.delete(url);
    }
}

function revokeAllObjectURLs() {
    _activeObjectURLs.forEach(url => URL.revokeObjectURL(url));
    _activeObjectURLs.clear();
}

// ==========================================
// Drag & Drop System
// ==========================================
function initDragDrop() {
    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        const overlay = document.getElementById('dragOverlay');
        if (overlay) overlay.classList.add('active');
    });

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            const overlay = document.getElementById('dragOverlay');
            if (overlay) overlay.classList.remove('active');
        }
    });

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    document.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        const overlay = document.getElementById('dragOverlay');
        if (overlay) overlay.classList.remove('active');

        const files = e.dataTransfer.files;
        if (!files.length) return;

        const pdfFiles = Array.from(files).filter(f => f.type === 'application/pdf');
        if (!pdfFiles.length) {
            showToast('Solo se permiten archivos PDF', 'error');
            return;
        }

        routeFilesToActiveTab(pdfFiles);
    });
}

function routeFilesToActiveTab(pdfFiles) {
    const activeTab = document.querySelector('.tab-content.active');
    if (!activeTab) return;

    const tabId = activeTab.id;

    // Merge tab handles multiple files
    if (tabId === 'merge') {
        const input = document.getElementById('mergeFilesInput');
        const dt = new DataTransfer();
        pdfFiles.forEach(f => dt.items.add(f));
        input.files = dt.files;
        input.dispatchEvent(new Event('change'));
        showToast(`${pdfFiles.length} archivo(s) añadidos para unir`, 'success');
        return;
    }

    // Interleave tab has two slots (origen / a intercalar)
    if (tabId === 'interleave') {
        routeFilesToInterleave(pdfFiles);
        showToast(`${Math.min(pdfFiles.length, 2)} archivo(s) cargados para intercalar`, 'success');
        return;
    }

    // All other tabs handle single file
    if (pdfFiles.length > 1) {
        showToast('Esta pestaña solo acepta un archivo. Usando el primero.', 'warning');
    }
    const file = pdfFiles[0];

    const inputMap = {
        'extract': 'extractFileInput',
        'extract-sequence': 'extract-sequenceFileInput',
        'merge-sequence': 'merge-sequenceFileInput',
        'search': 'searchFileInput',
        'chapters': 'chaptersFileInput',
        'unlock': 'unlockFileInput',
        'annotate': 'annotateFileInput',
        'media': 'mediaFileInput',
        'translate': 'translateFileInput',
        'translate-en-es': 'enEsFileInput',
        'translate-es-en': 'esEnFileInput',
        'podcast': 'podcastFileInput',
        'tts-podcast': 'ttsPodcastFileInput',
        'manim-narrator': 'manimFileInput',
        'vocab-reader': 'vocabFileInput'
    };

    const inputId = inputMap[tabId];
    if (inputId) {
        const input = document.getElementById(inputId);
        if (input) {
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change'));
            showToast(`Archivo cargado: ${file.name}`, 'success');
        }
    }
}

// ==========================================
// Dark Mode
// ==========================================
function initDarkMode() {
    const btn = document.getElementById('darkModeToggle');
    if (!btn) return;

    const saved = localStorage.getItem('darkMode');
    if (saved === 'true') {
        document.body.classList.add('dark');
        btn.textContent = '☀️';
    }

    btn.addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark');
        localStorage.setItem('darkMode', isDark);
        btn.textContent = isDark ? '☀️' : '🌙';
    });
}

// Tab logic
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    const content = document.getElementById(tabId);
    if (content) {
        content.classList.add('active');
    }

    const button = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (button) {
        button.classList.add('active');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const first = document.querySelector('.tab-btn.active') || document.querySelector('.tab-btn');
    if (first && first.dataset.tab) {
        switchTab(first.dataset.tab);
    }
});

// Shared helpers
async function readPdfBytes(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

// pdf-lib 1.17 no puede descifrar PDFs (ni siquiera con la contraseña correcta).
// La contraseña solo se aprovecha en los modos que usan pdf.js (Modo Compatibilidad / Desbloquear).
async function loadPdfWithPasswordFallback(bytes, password) {
    try {
        return await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false });
    } catch (e) {
        console.error("Error loading PDF:", e);
        if (e.message && /encrypted|password/i.test(e.message)) {
            throw new Error("Este PDF está cifrado/protegido. Active «Modo Compatibilidad» (e ingrese la contraseña si tiene) " +
                "o desbloquéelo primero en la pestaña «Desbloquear PDF».");
        }
        throw new Error("Error al cargar el PDF: " + (e.message || "Archivo corrupto o no válido"));
    }
}

function triggerDownload(pdfBytes, filename, linkId, resultArea) {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.getElementById(linkId);
    link.href = url;
    link.download = filename;
    resultArea.style.display = 'block';
}

function handleSingleFileSelect(tab) {
    const input = document.getElementById(tab + 'FileInput');
    const info = document.getElementById(tab + 'FileInfo');
    const nameSpan = document.getElementById(tab + 'FileName');
    const btn = document.getElementById(tab + 'Btn');

    if (input.files.length > 0) {
        info.style.display = 'block';
        nameSpan.textContent = input.files[0].name;
        btn.disabled = false;
    } else {
        info.style.display = 'none';
        btn.disabled = true;
    }
}

// Escapa texto para insertarlo con innerHTML (texto extraído del PDF, nombres de archivo...)
function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function normalizeText(text) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function waitAndClearMemory(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeFilename(filename) {
    return filename.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').substring(0, 100);
}

function transformCoordinates(vx, vy, vW, vH, pW, pH, rotation) {
    const nX = vx / vW;
    const nY = vy / vH;
    let px;
    let py;

    if (rotation === 0) {
        px = nX * pW;
        py = (1 - nY) * pH;
    } else if (rotation === 90) {
        px = nY * pW;
        py = (1 - nX) * pH;
    } else if (rotation === 180) {
        px = (1 - nX) * pW;
        py = nY * pH;
    } else if (rotation === 270 || rotation === -90) {
        px = (1 - nY) * pW;
        py = nX * pH;
    } else {
        px = nX * pW;
        py = (1 - nY) * pH;
    }
    return { x: px, y: py };
}

function drawArrowOnPage(page, start, end, color, thickness) {
    page.drawLine({ start: start, end: end, thickness: thickness, color: color });
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255
    } : { r: 0, g: 0, b: 0 };
}

document.addEventListener('DOMContentLoaded', () => {
    initDragDrop();
    initDarkMode();
});

// ==========================================
// Narrador (voces neuronales de edge-tts + voz del navegador equivalente)
// ==========================================
const DEFAULT_NARRATOR = 'es-MX-JorgeNeural';

// hint: parte del nombre con que el navegador suele exponer la misma voz (p. ej. Edge: "Microsoft Jorge Online (Natural)")
const NARRATOR_VOICES = [
    { id: 'es-MX-JorgeNeural', label: 'Jorge (hombre)', region: 'México', lang: 'es-MX', hint: 'Jorge' },
    { id: 'es-MX-DaliaNeural', label: 'Dalia (mujer)', region: 'México', lang: 'es-MX', hint: 'Dalia' },
    { id: 'es-US-AlonsoNeural', label: 'Alonso (hombre)', region: 'Estados Unidos (español)', lang: 'es-US', hint: 'Alonso' },
    { id: 'es-US-PalomaNeural', label: 'Paloma (mujer)', region: 'Estados Unidos (español)', lang: 'es-US', hint: 'Paloma' },
    { id: 'es-CO-GonzaloNeural', label: 'Gonzalo (hombre)', region: 'Colombia', lang: 'es-CO', hint: 'Gonzalo' },
    { id: 'es-CO-SalomeNeural', label: 'Salomé (mujer)', region: 'Colombia', lang: 'es-CO', hint: 'Salome' },
    { id: 'es-AR-TomasNeural', label: 'Tomás (hombre)', region: 'Argentina', lang: 'es-AR', hint: 'Tomas' },
    { id: 'es-AR-ElenaNeural', label: 'Elena (mujer)', region: 'Argentina', lang: 'es-AR', hint: 'Elena' },
    { id: 'es-CL-LorenzoNeural', label: 'Lorenzo (hombre)', region: 'Chile', lang: 'es-CL', hint: 'Lorenzo' },
    { id: 'es-CL-CatalinaNeural', label: 'Catalina (mujer)', region: 'Chile', lang: 'es-CL', hint: 'Catalina' },
    { id: 'es-PE-AlexNeural', label: 'Alex (hombre)', region: 'Perú', lang: 'es-PE', hint: 'Alex' },
    { id: 'es-PE-CamilaNeural', label: 'Camila (mujer)', region: 'Perú', lang: 'es-PE', hint: 'Camila' },
    { id: 'es-ES-AlvaroNeural', label: 'Álvaro (hombre)', region: 'España', lang: 'es-ES', hint: 'Alvaro' },
    { id: 'es-ES-ElviraNeural', label: 'Elvira (mujer)', region: 'España', lang: 'es-ES', hint: 'Elvira' },
    { id: 'es-ES-XimenaNeural', label: 'Ximena (mujer)', region: 'España', lang: 'es-ES', hint: 'Ximena' },
    { id: 'en-US-AndrewMultilingualNeural', label: 'Andrew multilingüe (hombre)', region: 'Inglés', lang: 'en-US', hint: 'Andrew' },
    { id: 'en-US-AvaMultilingualNeural', label: 'Ava multilingüe (mujer)', region: 'Inglés', lang: 'en-US', hint: 'Ava' },
    { id: 'en-US-EmmaMultilingualNeural', label: 'Emma multilingüe (mujer)', region: 'Inglés', lang: 'en-US', hint: 'Emma' },
    { id: 'en-US-BrianMultilingualNeural', label: 'Brian multilingüe (hombre)', region: 'Inglés', lang: 'en-US', hint: 'Brian' }
];

function getNarrator() {
    let id = DEFAULT_NARRATOR;
    try { id = localStorage.getItem('narratorVoice') || DEFAULT_NARRATOR; } catch (e) { /* sin localStorage */ }
    return NARRATOR_VOICES.find(v => v.id === id) || NARRATOR_VOICES[0];
}

function setNarrator(id) {
    if (!NARRATOR_VOICES.some(v => v.id === id)) return;
    try { localStorage.setItem('narratorVoice', id); } catch (e) { /* sin localStorage */ }
}

// Rellena un <select> con los narradores agrupados por país y deja elegido el guardado (Jorge por defecto)
function fillNarratorSelect(select) {
    select.innerHTML = '';
    const current = getNarrator().id;
    const groups = {};
    NARRATOR_VOICES.forEach(v => {
        if (!groups[v.region]) {
            groups[v.region] = document.createElement('optgroup');
            groups[v.region].label = v.region;
            select.appendChild(groups[v.region]);
        }
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.label + (v.id === DEFAULT_NARRATOR ? ' — predeterminado' : '');
        opt.selected = v.id === current;
        groups[v.region].appendChild(opt);
    });
}

// Elige la voz del navegador más natural para un idioma, prefiriendo la del narrador elegido.
// lang puede ser 'es', 'es-MX', 'en'...; si coincide con el idioma del narrador se usa su variante (es-MX).
function pickBrowserVoice(lang) {
    if (!window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    const narrator = getNarrator();
    let target = (lang || narrator.lang).toLowerCase().replace('_', '-');
    const base = target.split('-')[0];
    const narratorBase = narrator.lang.toLowerCase().split('-')[0];
    if (!target.includes('-') && base === narratorBase) target = narrator.lang.toLowerCase();

    let best = null;
    let bestScore = -1;
    for (const v of voices) {
        const vl = v.lang.toLowerCase().replace('_', '-');
        if (!vl.startsWith(base)) continue;
        let score = 0;
        if (base === narratorBase && v.name.toLowerCase().includes(narrator.hint.toLowerCase())) score += 100;
        if (vl === target) score += 10;
        if (/natural|online|neural/i.test(v.name)) score += 6;      // voces neuronales (Edge, Windows)
        else if (/google/i.test(v.name)) score += 3;               // voces de Google (Chrome)
        if (/espeak/i.test(v.name)) score -= 5;                    // voz robótica de Linux
        if (score > bestScore) { bestScore = score; best = v; }
    }
    return best;
}

// Lee un texto largo frase por frase (Chrome corta los textos largos a los ~15 s)
function speakNaturally(text, { lang, rate = 0.95, onend } = {}) {
    if (!window.speechSynthesis) {
        showToast('Este navegador no permite leer en voz alta.', 'warning');
        return null;
    }
    window.speechSynthesis.cancel();
    const voice = pickBrowserVoice(lang);
    const sentences = String(text).replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]*["”»)]*\s*/g) || [String(text)];
    sentences.forEach((s, i) => {
        const u = new SpeechSynthesisUtterance(s.trim());
        if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = lang || getNarrator().lang; }
        u.rate = rate;
        if (i === sentences.length - 1 && onend) u.onend = onend;
        window.speechSynthesis.speak(u);
    });
    return voice;
}
