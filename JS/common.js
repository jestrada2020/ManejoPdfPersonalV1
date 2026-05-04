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

    // All other tabs handle single file
    if (pdfFiles.length > 1) {
        showToast('Esta pestaña solo acepta un archivo. Usando el primero.', 'warning');
    }
    const file = pdfFiles[0];

    const inputMap = {
        'extract': 'extractFileInput',
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

async function loadPdfWithPasswordFallback(bytes, password) {
    try {
        if (password) {
            return await PDFLib.PDFDocument.load(bytes, { password, ignoreEncryption: false });
        }
        return await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false });
    } catch (e) {
        console.error("Error loading PDF:", e);
        if (e.message && (e.message.includes('password') || e.message.includes('encrypted') ||
            e.message.includes('PasswordException'))) {
            if (!password) {
                throw new Error("Este PDF está protegido con contraseña. Por favor, ingrese la contraseña.");
            }
            throw new Error("Contraseña incorrecta. Por favor, verifique e intente nuevamente.");
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
