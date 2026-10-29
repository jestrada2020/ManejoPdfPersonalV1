let singleFile = null;

async function extractPages() {
    const input = document.getElementById('extractFileInput');
    if (!input.files.length) return;

    const file = input.files[0];
    const password = document.getElementById('extractFilePass').value;
    const start = parseInt(document.getElementById('startPage').value);
    const end = parseInt(document.getElementById('endPage').value);
    const outputName = document.getElementById('extractOutputName').value || 'extracto.pdf';
    const useRasterize = document.getElementById('rasterizeMode').checked;

    const btn = document.getElementById('extractBtn');
    const resultArea = document.getElementById('extractResult');

    if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
        showToast('Rango de páginas inválido.', 'warning');
        return;
    }

    btn.disabled = true;
    btn.textContent = useRasterize ? "Procesando como Imágenes..." : "Procesando...";
    resultArea.style.display = 'none';

    try {
        const bytes = await readPdfBytes(file);

        if (useRasterize) {
            const loadingTask = pdfjsLib.getDocument({ data: bytes, password: password || undefined });
            const pdfJsDoc = await loadingTask.promise;
            const totalPages = pdfJsDoc.numPages;

            if (end > totalPages) throw new Error(`El PDF solo tiene ${totalPages} páginas.`);

            const newPdf = await PDFLib.PDFDocument.create();

            const scale = 2;
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d', { alpha: false });

            for (let i = start; i <= end; i++) {
                const page = await pdfJsDoc.getPage(i);
                const viewport = page.getViewport({ scale: scale });

                canvas.height = viewport.height;
                canvas.width = viewport.width;
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, canvas.width, canvas.height);

                await page.render({ canvasContext: context, viewport: viewport }).promise;

                // JPEG pesa mucho menos que PNG; la página conserva su tamaño real (se renderiza a 2x para nitidez)
                const imgDataUrl = canvas.toDataURL('image/jpeg', 0.92);
                const imgBytes = await fetch(imgDataUrl).then(res => res.arrayBuffer());
                const jpgImage = await newPdf.embedJpg(imgBytes);

                const pageW = viewport.width / scale;
                const pageH = viewport.height / scale;
                const newPage = newPdf.addPage([pageW, pageH]);
                newPage.drawImage(jpgImage, { x: 0, y: 0, width: pageW, height: pageH });
                page.cleanup();
            }

            canvas.width = 0;
            canvas.height = 0;
            pdfJsDoc.destroy();

            const pdfBytes = await newPdf.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);

            const link = document.getElementById('extractDownload');
            link.href = url;
            link.download = outputName;
            resultArea.style.display = 'block';

        } else {
            const pdfDoc = await loadPdfWithPasswordFallback(bytes, password);
            const totalPages = pdfDoc.getPageCount();

            if (end > totalPages) {
                showToast(`El PDF solo tiene ${totalPages} páginas.`, 'warning');
                return;
            }

            const newPdf = await PDFLib.PDFDocument.create();
            const rangeIndices = [];
            for (let i = start; i <= end; i++) rangeIndices.push(i - 1);

            const copiedPages = await newPdf.copyPages(pdfDoc, rangeIndices);
            copiedPages.forEach(p => newPdf.addPage(p));

            const pdfBytes = await newPdf.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);

            const link = document.getElementById('extractDownload');
            link.href = url;
            link.download = outputName;
            resultArea.style.display = 'block';
        }

    } catch (error) {
        showToast('Error: ' + error.message, 'error');
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.textContent = "Extraer Páginas";
    }
}
