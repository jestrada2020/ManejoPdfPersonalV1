let mergeFiles = [];

document.getElementById('mergeFilesInput').addEventListener('change', (e) => {
    const newFiles = Array.from(e.target.files).map(f => ({
        file: f,
        password: ''
    }));
    mergeFiles = [...mergeFiles, ...newFiles];
    renderMergeList();
    updateMergeBtnState();
    e.target.value = '';
});

function renderMergeList() {
    const list = document.getElementById('mergeList');
    list.innerHTML = '';
    mergeFiles.forEach((item, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="file-info">
                <span class="file-name"></span>
                <div class="file-password">
                    <input type="password" placeholder="Contraseña (opcional)">
                </div>
            </div>
            <button class="btn-remove">Eliminar</button>
        `;
        // Nombre y contraseña como texto (no HTML): un nombre con < o " no rompe la lista
        li.querySelector('.file-name').textContent = item.file.name;
        const pass = li.querySelector('input');
        pass.value = item.password;
        pass.addEventListener('input', () => updateMergePassword(index, pass.value));
        li.querySelector('.btn-remove').addEventListener('click', () => removeMergeFile(index));
        list.appendChild(li);
    });
}

function updateMergePassword(index, val) {
    mergeFiles[index].password = val;
}

function removeMergeFile(index) {
    mergeFiles.splice(index, 1);
    renderMergeList();
    updateMergeBtnState();
}

function updateMergeBtnState() {
    document.getElementById('mergeBtn').disabled = mergeFiles.length < 2;
    const msg = mergeFiles.length === 0 ? "Añade archivos para comenzar." : `${mergeFiles.length} archivos listos.`;
    document.getElementById('mergeLogs').textContent = msg;
}

async function mergePDFs() {
    const btn = document.getElementById('mergeBtn');
    const logs = document.getElementById('mergeLogs');
    const resultArea = document.getElementById('mergeResult');

    btn.disabled = true;
    btn.textContent = "Procesando...";
    resultArea.style.display = 'none';
    logs.textContent = "Iniciando unión...";

    try {
        const newPdf = await PDFLib.PDFDocument.create();

        for (let i = 0; i < mergeFiles.length; i++) {
            const item = mergeFiles[i];
            logs.textContent = `Procesando archivo ${i + 1}/${mergeFiles.length}: ${item.file.name}...`;

            const bytes = await readPdfBytes(item.file);
            let pdfDoc;

            try {
                pdfDoc = await loadPdfWithPasswordFallback(bytes, item.password);
            } catch (e) {
                throw new Error(`Fallo al abrir ${item.file.name}: ${e.message}`);
            }

            const copiedPages = await newPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
            copiedPages.forEach(p => newPdf.addPage(p));
        }

        logs.textContent = "Generando archivo final...";
        const pdfBytes = await newPdf.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const link = document.getElementById('mergeDownload');
        link.href = url;
        link.download = document.getElementById('mergeOutputName').value || 'unido.pdf';

        resultArea.style.display = 'block';
        logs.textContent = "¡Completado!";

    } catch (error) {
        showToast(error.message, 'error');
        logs.textContent = "Error: " + error.message;
    } finally {
        btn.disabled = false;
        btn.textContent = "Unir PDFs Seleccionados";
    }
}
