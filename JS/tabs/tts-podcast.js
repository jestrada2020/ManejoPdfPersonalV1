let ttsState = {
    pdfDoc: null,
    file: null,
    totalPages: 0,
    currentPage: 1,
    scale: 1.2,
    audioBlob: null,
    audioUrl: null,
    placementMode: false,
    marker: null
};

async function handleTTSPodcastFileBase(input) {
    if (!input.files.length) return;
    ttsState.file = input.files[0];
    const bytes = await readPdfBytes(ttsState.file);
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    ttsState.pdfDoc = await loadingTask.promise;
    ttsState.totalPages = ttsState.pdfDoc.numPages;
    ttsState.currentPage = 1;
    renderTTSPodcastPage(1);

    const canvas = document.getElementById('ttsPodcastCanvas');
    canvas.addEventListener('click', handleTTSPodcastCanvasClick);
}

async function changeTTSPodcastPage(delta) {
    if (!ttsState.pdfDoc) return;
    const newPage = ttsState.currentPage + delta;
    if (newPage >= 1 && newPage <= ttsState.totalPages) {
        ttsState.currentPage = newPage;
        renderTTSPodcastPage(newPage);
    }
}

async function renderTTSPodcastPage(pageNum) {
    if (!ttsState.pdfDoc) return;
    document.getElementById('ttsPodcastPageLabel').textContent = `${pageNum} / ${ttsState.totalPages}`;

    const page = await ttsState.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: ttsState.scale });
    const canvas = document.getElementById('ttsPodcastCanvas');
    const context = canvas.getContext('2d');

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;

    if (ttsState.marker && ttsState.marker.page === pageNum) {
        context.font = "30px Arial";
        context.fillText("🎙️", ttsState.marker.x - 15, ttsState.marker.y);
    }
}

function handleTTSPodcastCanvasClick(e) {
    if (!ttsState.placementMode) return;

    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ttsState.marker = {
        page: ttsState.currentPage,
        x: x,
        y: y
    };

    ttsState.placementMode = false;
    e.target.style.cursor = 'default';
    alert("Ubicación seleccionada. Ahora puedes guardar.");
    document.getElementById('btnSaveTTSPodcast').disabled = false;

    renderTTSPodcastPage(ttsState.currentPage);
}

async function generateTTSAudio() {
    const text = document.getElementById('ttsInputText').value.trim();
    const lang = document.getElementById('ttsLang').value;

    if (!text) {
        alert("Por favor escribe algún texto.");
        return;
    }

    function chunkText(str, maxLength) {
        const words = str.split(' ');
        const chunks = [];
        let currentChunk = '';

        words.forEach(word => {
            if ((currentChunk + word).length < maxLength) {
                currentChunk += (currentChunk ? ' ' : '') + word;
            } else {
                chunks.push(currentChunk);
                currentChunk = word;
            }
        });
        if (currentChunk) chunks.push(currentChunk);
        return chunks;
    }

    const chunks = chunkText(text, 180);
    const audioBlobs = [];
    const btn = document.querySelector('[onclick="generateTTSAudio()"]');
    const originalText = btn.textContent;

    btn.disabled = true;

    try {
        for (let i = 0; i < chunks.length; i++) {
            btn.textContent = `Generando ${i + 1}/${chunks.length}...`;
            const chunk = chunks[i];
            const googleUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${lang}&client=tw-ob`;
            const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(googleUrl)}`;

            const response = await fetch(url);
            if (!response.ok) throw new Error(`Error en el segmento ${i + 1}`);
            const blob = await response.blob();
            audioBlobs.push(blob);
        }

        const finalBlob = new Blob(audioBlobs, { type: 'audio/mpeg' });

        ttsState.audioBlob = finalBlob;
        ttsState.audioUrl = URL.createObjectURL(finalBlob);

        const audio = document.getElementById('ttsAudioPreview');
        audio.src = ttsState.audioUrl;
        document.getElementById('ttsAudioPreviewContainer').style.display = 'block';

        document.getElementById('btnPlaceTTSPodcast').disabled = false;
        alert("Audio generado correctamente. Escúchalo y luego colócalo en el PDF.");

    } catch (e) {
        console.error(e);
        alert("Error generando audio: " + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function activateTTSPodcastPlacement() {
    if (!ttsState.pdfDoc) {
        alert("Carga un PDF primero.");
        return;
    }
    ttsState.placementMode = true;
    document.getElementById('ttsPodcastCanvas').style.cursor = 'crosshair';
    alert("Haz clic en la página del PDF donde quieras el icono.");
}

async function saveTTSPodcastPDF() {
    if (!ttsState.audioBlob || !ttsState.marker) return;
    const btn = document.getElementById('btnSaveTTSPodcast');
    btn.textContent = "Procesando...";
    btn.disabled = true;

    try {
        const input = document.getElementById('ttsPodcastFileInput');
        const bytes = await readPdfBytes(input.files[0]);
        const pdfDoc = await PDFLib.PDFDocument.load(bytes);

        const audioBytes = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(new Uint8Array(reader.result));
            reader.readAsArrayBuffer(ttsState.audioBlob);
        });

        const audioRef = pdfDoc.context.register(
            pdfDoc.context.flateStream(audioBytes, {
                Type: 'EmbeddedFile',
                Subtype: 'audio/mpeg',
                Params: {
                    Size: audioBytes.length,
                    CreationDate: new Date(),
                },
            })
        );

        const fileSpecDict = pdfDoc.context.obj({
            Type: 'Filespec',
            F: 'podcast_tts.mp3',
            EF: { F: audioRef },
        });

        const page = pdfDoc.getPages()[ttsState.marker.page - 1];
        const { width, height } = page.getSize();

        const pdfX = ttsState.marker.x / ttsState.scale;
        const pdfY = height - (ttsState.marker.y / ttsState.scale);

        const annotInfo = pdfDoc.context.obj({
            Type: 'Annot',
            Subtype: 'FileAttachment',
            Rect: [pdfX, pdfY - 20, pdfX + 20, pdfY],
            FS: fileSpecDict,
            Name: 'PushPin',
            T: 'Podcast TTS',
            Contents: 'Haz clic para escuchar el podcast generado.',
            C: [0, 0, 1]
        });

        const annotRef = pdfDoc.context.register(annotInfo);
        page.node.set(PDFLib.PDFName.of('Annots'), pdfDoc.context.obj([annotRef]));

        page.drawCircle({
            x: pdfX + 10,
            y: pdfY - 10,
            size: 15,
            color: PDFLib.rgb(0, 0, 1),
            opacity: 0.3,
        });
        page.drawText('PODCAST TTS', {
            x: pdfX - 20,
            y: pdfY - 25,
            size: 9,
            color: PDFLib.rgb(0, 0, 1)
        });

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = "podcast_tts_doc.pdf";
        a.click();

        alert("PDF guardado correctamente.");

    } catch (e) {
        console.error(e);
        alert("Error guardando PDF: " + e.message);
    } finally {
        btn.textContent = "💾 Guardar PDF";
        btn.disabled = false;
    }
}
