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
        alert("Rango de páginas inválido.");
        return;
    }

    btn.disabled = true;
    btn.textContent = useRasterize ? "Procesando como Imágenes..." : "Procesando...";
    resultArea.style.display = 'none';

    try {
        const bytes = await readPdfBytes(file);

        if (useRasterize) {
            const loadingTask = pdfjsLib.getDocument({ data: bytes, password: password });
            const pdfJsDoc = await loadingTask.promise;
            const totalPages = pdfJsDoc.numPages;

            if (end > totalPages) throw new Error(`El PDF solo tiene ${totalPages} páginas.`);

            const newPdf = await PDFLib.PDFDocument.create();

            for (let i = start; i <= end; i++) {
                const page = await pdfJsDoc.getPage(i);
                const scale = 2;
                const viewport = page.getViewport({ scale: scale });

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await page.render({ canvasContext: context, viewport: viewport }).promise;

                const imgDataUrl = canvas.toDataURL('image/png');
                const imgBytes = await fetch(imgDataUrl).then(res => res.arrayBuffer());
                const pngImage = await newPdf.embedPng(imgBytes);

                const newPage = newPdf.addPage([viewport.width / scale * 72 / 72, viewport.height / scale * 72 / 72]);
                newPage.setSize(viewport.width, viewport.height);
                newPage.drawImage(pngImage, { x: 0, y: 0, width: viewport.width, height: viewport.height });
            }

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
                alert(`El PDF solo tiene ${totalPages} páginas.`);
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
        alert("Error: " + error.message);
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.textContent = "Extraer Páginas";
    }
}
