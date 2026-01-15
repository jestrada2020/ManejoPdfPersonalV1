// Global config
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

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
