let chaptersData = null;

async function detectChapters() {
    const input = document.getElementById('chaptersFileInput');
    const patterns = document.getElementById('chapterPattern').value.trim();
    const useNumbers = document.getElementById('chapterUseNumbers').checked;
    const logs = document.getElementById('chaptersLogs');
    const previewArea = document.getElementById('chaptersPreview');
    const resultArea = document.getElementById('chaptersResult');
    const btn = document.getElementById('chaptersBtn');
    const password = document.getElementById('chaptersFilePass').value;

    if (!input.files.length) return;
    if (!patterns) {
        alert("Ingrese al menos un patrón de búsqueda.");
        return;
    }

    btn.disabled = true;
    btn.textContent = "Detectando...";
    previewArea.style.display = 'none';
    resultArea.style.display = 'none';
    logs.textContent = "Cargando documento...";

    try {
        const file = input.files[0];
        const bytes = await readPdfBytes(file);

        const patternList = patterns.split(',').map(p => p.trim()).filter(p => p);

        logs.textContent = "Analizando estructura del documento...";

        const loadingTask = pdfjsLib.getDocument({ data: bytes, password: password });
        const pdfJsDoc = await loadingTask.promise;
        const totalPages = pdfJsDoc.numPages;

        const chapters = [];
        logs.textContent = `Buscando capítulos en ${totalPages} páginas...`;

        const numberPatterns = useNumbers ?
            /(\d+|I{1,3}|IV|V|VI{0,3}|IX|X{1,3}|XI{0,3}|XIV|XV|XVI{0,3}|XIX|XX)/i : null;

        for (let i = 1; i <= totalPages; i++) {
            if (i % 10 === 0) logs.textContent = `Analizando página ${i}/${totalPages}...`;

            const page = await pdfJsDoc.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');

            for (const pattern of patternList) {
                const normalizedPattern = normalizeText(pattern);
                const normalizedText = normalizeText(pageText);

                let regex;
                if (useNumbers) {
                    regex = new RegExp(normalizedPattern + '\\s*' + numberPatterns.source, 'gi');
                } else {
                    regex = new RegExp(normalizedPattern, 'gi');
                }

                const matches = [...normalizedText.matchAll(regex)];

                if (matches.length > 0) {
                    const match = matches[0];
                    const matchIndex = match.index;

                    let titleStart = matchIndex;
                    let titleEnd = Math.min(pageText.length, matchIndex + 100);

                    const titleText = pageText.substring(titleStart, titleEnd);
                    const endMarkers = ['\n', '.', '   '];
                    let actualEnd = titleText.length;

                    for (const marker of endMarkers) {
                        const idx = titleText.indexOf(marker, pattern.length);
                        if (idx > 0 && idx < actualEnd) {
                            actualEnd = idx;
                        }
                    }

                    const chapterTitle = pageText.substring(titleStart, titleStart + actualEnd).trim();

                    if (!chapters.find(ch => ch.startPage === i)) {
                        chapters.push({
                            title: chapterTitle,
                            startPage: i,
                            endPage: null,
                            selected: true
                        });
                    }
                }
            }
        }

        pdfJsDoc.destroy();

        if (chapters.length === 0) {
            logs.textContent = "No se detectaron capítulos.";
            alert("No se encontraron capítulos con los patrones especificados.");
            return;
        }

        for (let i = 0; i < chapters.length; i++) {
            if (i < chapters.length - 1) {
                chapters[i].endPage = chapters[i + 1].startPage - 1;
            } else {
                chapters[i].endPage = totalPages;
            }
        }

        chaptersData = {
            bytes: bytes,
            password: password,
            chapters: chapters,
            totalPages: totalPages
        };

        displayChapters(chapters);
        logs.textContent = `Detectados ${chapters.length} capítulos. Revise y confirme la extracción.`;

    } catch (error) {
        console.error(error);
        alert("Error durante la detección: " + error.message);
        logs.textContent = "Error.";
    } finally {
        btn.disabled = false;
        btn.textContent = "Detectar Capítulos";
    }
}

function displayChapters(chapters) {
    const previewArea = document.getElementById('chaptersPreview');
    const chaptersList = document.getElementById('chaptersList');
    chaptersList.innerHTML = '';

    chapters.forEach((chapter, idx) => {
        const itemDiv = document.createElement('div');
        itemDiv.style.cssText = 'padding: 12px; margin-bottom: 10px; background: white; border: 1px solid var(--border); border-radius: 4px;';

        const pageCount = chapter.endPage - chapter.startPage + 1;

        itemDiv.innerHTML = `
            <label style="display: flex; align-items: start; cursor: pointer; gap: 10px;">
                <input type="checkbox" id="chapter${idx}" ${chapter.selected ? 'checked' : ''} onchange="toggleChapter(${idx})" style="margin-top: 3px;">
                <div style="flex: 1;">
                    <div style="font-weight: 600; margin-bottom: 4px;">
                        ${chapter.title || 'Capítulo ' + (idx + 1)}
                    </div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">
                        Páginas ${chapter.startPage} - ${chapter.endPage} (${pageCount} página${pageCount > 1 ? 's' : ''})
                    </div>
                </div>
                <button class="btn" onclick="event.stopPropagation(); extractSingleChapter(${idx})" style="padding: 6px 12px; font-size: 0.85rem; width: auto;">
                    Extraer
                </button>
            </label>
        `;

        chaptersList.appendChild(itemDiv);
    });

    previewArea.style.display = 'block';
}

function toggleChapter(idx) {
    if (chaptersData && chaptersData.chapters[idx]) {
        const checkbox = document.getElementById(`chapter${idx}`);
        chaptersData.chapters[idx].selected = checkbox.checked;
    }
}

function cancelChapters() {
    document.getElementById('chaptersPreview').style.display = 'none';
    chaptersData = null;
}

async function extractSingleChapter(idx) {
    if (!chaptersData) return;

    const chapter = chaptersData.chapters[idx];
    const logs = document.getElementById('chaptersLogs');

    try {
        logs.textContent = `Extrayendo "${chapter.title}"...`;

        const useRasterMode = document.getElementById('chapterRasterMode').checked;
        const fileName = sanitizeFilename(chapter.title || `Capitulo_${idx + 1}`) + '.pdf';

        await extractChapter(
            chaptersData.bytes,
            chaptersData.password,
            chapter,
            fileName,
            useRasterMode,
            logs
        );

        logs.textContent = `"${chapter.title}" extraído correctamente.`;

    } catch (error) {
        console.error(error);
        alert("Error extrayendo capítulo: " + error.message);
        logs.textContent = "Error.";
    }
}

async function extractAllChapters() {
    if (!chaptersData) return;

    const selectedChapters = chaptersData.chapters.filter(ch => ch.selected);

    if (selectedChapters.length === 0) {
        alert("Debe seleccionar al menos un capítulo.");
        return;
    }

    const logs = document.getElementById('chaptersLogs');
    const resultArea = document.getElementById('chaptersResult');
    const linksContainer = document.getElementById('chaptersDownloadLinks');
    const extractBtn = document.getElementById('extractAllChaptersBtn');

    extractBtn.disabled = true;
    extractBtn.textContent = "Extrayendo...";
    resultArea.style.display = 'none';
    linksContainer.innerHTML = '';

    const useRasterMode = document.getElementById('chapterRasterMode').checked;
    const downloadLinks = [];

    try {
        for (let i = 0; i < selectedChapters.length; i++) {
            const chapter = selectedChapters[i];
            logs.textContent = `Extrayendo capítulo ${i + 1}/${selectedChapters.length}: "${chapter.title}"...`;

            const fileName = sanitizeFilename(chapter.title || `Capitulo_${i + 1}`) + '.pdf';

            const url = await extractChapter(
                chaptersData.bytes,
                chaptersData.password,
                chapter,
                fileName,
                useRasterMode,
                logs,
                true
            );

            downloadLinks.push({ title: chapter.title, url: url, filename: fileName });

            await waitAndClearMemory(100);
        }

        linksContainer.innerHTML = '';
        downloadLinks.forEach(link => {
            const linkDiv = document.createElement('div');
            linkDiv.style.cssText = 'margin-bottom: 8px;';
            linkDiv.innerHTML = `
                <a href="${link.url}" download="${link.filename}" style="color: var(--primary); text-decoration: none; font-weight: 500;">
                    📄 ${link.title || link.filename}
                </a>
            `;
            linksContainer.appendChild(linkDiv);
        });

        resultArea.style.display = 'block';
        document.getElementById('chaptersResultText').textContent = `¡Éxito! Se han generado ${downloadLinks.length} capítulos. Haga clic en los enlaces para descargar:`;
        logs.textContent = "Todos los capítulos extraídos correctamente.";

        document.getElementById('chaptersPreview').style.display = 'none';

    } catch (error) {
        console.error(error);
        alert("Error durante la extracción: " + error.message);
        logs.textContent = "Error.";
    } finally {
        extractBtn.disabled = false;
        extractBtn.textContent = "📚 Extraer Todos los Capítulos";
    }
}

async function extractChapter(bytes, password, chapter, fileName, useRasterMode, logs, returnURL = false) {
    const startIdx = chapter.startPage - 1;
    const endIdx = chapter.endPage - 1;
    const pageIndices = [];

    for (let i = startIdx; i <= endIdx; i++) {
        pageIndices.push(i);
    }

    let pdfBytes;
    if (useRasterMode) {
        const loadingTask = pdfjsLib.getDocument({
            data: bytes,
            password: password || undefined
        });
        const pdfJsDoc = await loadingTask.promise;

        const newPdf = await PDFLib.PDFDocument.create();
        const scale = 1.5;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: false, alpha: false });

        for (let i = 0; i < pageIndices.length; i++) {
            const pageNum = pageIndices[i] + 1;
            const page = await pdfJsDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: scale });

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            context.clearRect(0, 0, canvas.width, canvas.height);
            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            const imgDataUrl = canvas.toDataURL('image/jpeg', 0.92);
            const response = await fetch(imgDataUrl);
            const imgBytes = await response.arrayBuffer();
            const jpegImage = await newPdf.embedJpg(imgBytes);

            const newPage = newPdf.addPage([viewport.width, viewport.height]);
            newPage.drawImage(jpegImage, {
                x: 0,
                y: 0,
                width: viewport.width,
                height: viewport.height,
            });

            page.cleanup();
        }

        canvas.width = 0;
        canvas.height = 0;
        pdfJsDoc.destroy();

        pdfBytes = await newPdf.save();
    } else {
        const pdfDoc = await loadPdfWithPasswordFallback(bytes, password);
        const newPdf = await PDFLib.PDFDocument.create();

        const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
        copiedPages.forEach(p => newPdf.addPage(p));

        pdfBytes = await newPdf.save();
    }

    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    if (returnURL) {
        return url;
    }

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    return url;
}
