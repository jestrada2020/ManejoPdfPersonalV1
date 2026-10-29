async function unlockPDF() {
    const input = document.getElementById('unlockFileInput');
    if (!input.files.length) return;

    const file = input.files[0];
    const password = document.getElementById('unlockFilePass').value || '';
    const outputName = document.getElementById('unlockOutputName').value || 'desbloqueado.pdf';
    const useRasterMode = document.getElementById('unlockRasterMode').checked;
    const useLowMemoryMode = document.getElementById('unlockLowMemoryMode').checked;

    const btn = document.getElementById('unlockBtn');
    const resultArea = document.getElementById('unlockResult');
    const logs = document.getElementById('unlockLogs');

    btn.disabled = true;
    btn.textContent = "Desbloqueando...";
    resultArea.style.display = 'none';
    logs.textContent = "Iniciando proceso de desbloqueo...";

    window.PDF_MEMORY_CONFIG = {
        lowMemoryMode: useLowMemoryMode,
        batchSize: useLowMemoryMode ? 3 : 5,
        copyBatchSize: useLowMemoryMode ? 5 : 10,
        scale: useLowMemoryMode ? 1.2 : 1.5,
        imageQuality: useLowMemoryMode ? 0.85 : 0.92,
        waitTime: useLowMemoryMode ? 100 : 50
    };

    try {
        const bytes = await readPdfBytes(file);

        if (useRasterMode) {
            logs.textContent = useLowMemoryMode ?
                "Usando modo avanzado con ahorro de memoria..." :
                "Usando modo avanzado (renderización)...";
            await unlockByRasterization(bytes, password, outputName, logs, resultArea);
        } else {
            logs.textContent = "Intentando desbloquear con método estándar...";
            await unlockByStandardMethod(bytes, password, outputName, logs, resultArea);
        }

    } catch (error) {
        console.error("Unlock error:", error);
        logs.textContent = "Error: " + error.message;

        if (!useRasterMode && !error.skipAdvancedRetry) {
            const useAdvanced = confirm(
                "Error en el modo estándar: " + error.message +
                "\n\n¿Desea intentar con el Modo Avanzado automáticamente?\n\n" +
                "El Modo Avanzado renderiza las páginas como imágenes y funciona con cualquier PDF protegido."
            );

            if (useAdvanced) {
                try {
                    logs.textContent = "Reintentando con Modo Avanzado...";
                    btn.textContent = "Procesando en Modo Avanzado...";
                    await unlockByRasterization(bytes, password, outputName, logs, resultArea);
                } catch (advError) {
                    console.error("Advanced mode error:", advError);
                    logs.textContent = "Error en Modo Avanzado: " + advError.message;
                    showToast('Error: ' + advError.message, 'error');
                }
            }
        } else {
            showToast('Error: ' + error.message, 'error');
        }
    } finally {
        btn.disabled = false;
        btn.textContent = "Desbloquear PDF";
    }
}

async function unlockByStandardMethod(bytes, password, outputName, logs, resultArea) {
    let pdfDoc = null;
    let strategy = '';
    let useSimpleSave = false;

    logs.textContent = "Abriendo PDF con método estándar...";
    try {
        pdfDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false });
        strategy = 'método estándar';
        useSimpleSave = true;
    } catch (e) {
        console.log("Método estándar falló:", e.message);
        if (/encrypted/i.test(e.message || '')) {
            // pdf-lib no descifra: cargarlo "ignorando el cifrado" produce páginas en blanco o dañadas.
            // pdf.js sí descifra (con la contraseña si la tiene), así que se usa el Modo Avanzado.
            logs.textContent = "El PDF está cifrado: usando Modo Avanzado (renderización) automáticamente...";
            showToast('PDF cifrado: se usará el Modo Avanzado', 'info', 4000);
            try {
                await unlockByRasterization(bytes, password, outputName, logs, resultArea);
            } catch (rasterError) {
                rasterError.skipAdvancedRetry = true; // ya se intentó el Modo Avanzado
                throw rasterError;
            }
            return;
        }
    }

    if (!pdfDoc) {
        throw new Error("No se pudo abrir el PDF. Intente con el 'Modo Avanzado' activado.");
    }

    logs.textContent = `PDF cargado exitosamente (${strategy}). Creando documento desbloqueado...`;

    let pdfBytes;

    const pageCount = pdfDoc.getPageCount();
    console.log(`PDF tiene ${pageCount} páginas`);

    if (useSimpleSave) {
        logs.textContent = "Guardando PDF sin restricciones (método directo)...";
        pdfBytes = await pdfDoc.save({
            useObjectStreams: false,
            addDefaultPage: false
        });
    } else {
        logs.textContent = "Creando nuevo PDF sin restricciones...";
        const newPdf = await PDFLib.PDFDocument.create();

        const title = pdfDoc.getTitle();
        const author = pdfDoc.getAuthor();
        const subject = pdfDoc.getSubject();
        const keywords = pdfDoc.getKeywords();

        if (title) newPdf.setTitle(title);
        if (author) newPdf.setAuthor(author);
        if (subject) newPdf.setSubject(subject);
        if (keywords) newPdf.setKeywords(keywords);

        const pageIndices = pdfDoc.getPageIndices();
        const totalPagesToCopy = pageIndices.length;
        const config = window.PDF_MEMORY_CONFIG || { copyBatchSize: 10, waitTime: 30 };
        const COPY_BATCH_SIZE = config.copyBatchSize;

        logs.textContent = `Copiando ${totalPagesToCopy} páginas (lotes de ${COPY_BATCH_SIZE})...`;

        for (let i = 0; i < totalPagesToCopy; i += COPY_BATCH_SIZE) {
            const endIndex = Math.min(i + COPY_BATCH_SIZE, totalPagesToCopy);
            const batchIndices = pageIndices.slice(i, endIndex);
            logs.textContent = `Copiando páginas ${i + 1}-${endIndex} de ${totalPagesToCopy}... (${Math.round(endIndex / totalPagesToCopy * 100)}%)`;
            const copiedPages = await newPdf.copyPages(pdfDoc, batchIndices);
            copiedPages.forEach(page => newPdf.addPage(page));

            if (endIndex < totalPagesToCopy) { await waitAndClearMemory(config.waitTime || 30); }
        }
        logs.textContent = "Guardando PDF sin restricciones...";
        await waitAndClearMemory(100);
        pdfBytes = await newPdf.save({ useObjectStreams: false, addDefaultPage: false });
    }

    if (!pdfBytes || pdfBytes.length === 0) {
        throw new Error("Error: El PDF generado está vacío. Use el 'Modo Avanzado'.");
    }

    console.log(`PDF desbloqueado generado: ${pdfBytes.length} bytes`);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.getElementById('unlockDownload');
    link.href = url;
    link.download = outputName;
    resultArea.style.display = 'block';
    logs.textContent = `¡Éxito! PDF desbloqueado (${pageCount} páginas) usando: ${strategy}`;
}

function forceGarbageCollection() {
    if (window.gc) { window.gc(); }
}

async function unlockByRasterization(bytes, password, outputName, logs, resultArea) {
    logs.textContent = "Cargando PDF para renderizar...";

    const loadingTask = pdfjsLib.getDocument({
        data: bytes,
        password: password || undefined,
        disableAutoFetch: true,
        disableStream: false,
        disableRange: false
    });

    let pdfJsDoc;
    try {
        pdfJsDoc = await loadingTask.promise;
    } catch (e) {
        if (e && e.name === 'PasswordException') {
            throw new Error(password
                ? 'Contraseña incorrecta. Verifíquela e intente de nuevo.'
                : 'Este PDF pide contraseña para abrirse. Escríbala en el campo «Contraseña».');
        }
        throw e;
    }
    const totalPages = pdfJsDoc.numPages;

    logs.textContent = `Renderizando ${totalPages} páginas como imágenes...`;

    const newPdf = await PDFLib.PDFDocument.create();

    const config = window.PDF_MEMORY_CONFIG || {
        batchSize: 5,
        scale: 1.5,
        imageQuality: 0.92,
        waitTime: 50,
        lowMemoryMode: false
    };

    const BATCH_SIZE = config.batchSize;
    const SCALE = config.scale;
    const QUALITY = config.imageQuality;
    const WAIT_TIME = config.waitTime;

    logs.textContent = `Renderizando ${totalPages} páginas (escala ${SCALE}, calidad ${Math.round(QUALITY *
        100)}%)...`;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', {
        willReadFrequently: false,
        alpha: false
    });

    for (let i = 1; i <= totalPages; i++) {
        try {
            const percentage = Math.round(i / totalPages * 100);
            logs.textContent = `Procesando página ${i}/${totalPages}... (${percentage}%)`;
            const page = await pdfJsDoc.getPage(i);
            const viewport = page.getViewport({ scale: SCALE });

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            context.clearRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: context, viewport: viewport }).promise;

            const imgDataUrl = canvas.toDataURL('image/jpeg', QUALITY);

            const response = await fetch(imgDataUrl);
            const imgBytes = await response.arrayBuffer();

            const jpegImage = await newPdf.embedJpg(imgBytes);
            const newPage = newPdf.addPage([viewport.width / SCALE, viewport.height / SCALE]) // tamaño real; la imagen se renderiza a SCALEx para nitidez;
            newPage.drawImage(jpegImage, {
                x: 0,
                y: 0,
                width: viewport.width / SCALE,
                height: viewport.height / SCALE,
            });

            page.cleanup();

            if (i % BATCH_SIZE === 0) {
                logs.textContent = `Liberando memoria... (${i}/${totalPages} - ${percentage}%)`;
                await waitAndClearMemory(WAIT_TIME);
            }
        } catch (pageError) {
            console.error(`Error procesando página ${i}:`, pageError);
            logs.textContent = `Advertencia: Error en página ${i}, continuando...`;
            await waitAndClearMemory(WAIT_TIME * 2);
        }
    }

    canvas.width = 0;
    canvas.height = 0;
    logs.textContent = "Guardando PDF desbloqueado...";

    await waitAndClearMemory(100);

    const pdfBytes = await newPdf.save({
        useObjectStreams: false,
        addDefaultPage: false
    });

    pdfJsDoc.destroy();
    logs.textContent = "Generando descarga...";

    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.getElementById('unlockDownload');
    link.href = url;
    link.download = outputName;
    resultArea.style.display = 'block';
    logs.textContent = `¡Éxito! PDF desbloqueado (${totalPages} páginas) mediante renderización.`;

    forceGarbageCollection();
}
