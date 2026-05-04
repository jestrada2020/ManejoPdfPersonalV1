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

// Lista de proxies CORS alternativos (se intentan en orden)
const TTS_PROXIES = [
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

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
    showToast('Ubicación seleccionada. Ahora puedes guardar.', 'success');
    document.getElementById('btnSaveTTSPodcast').disabled = false;

    renderTTSPodcastPage(ttsState.currentPage);
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

async function tryFetchWithProxies(url) {
    const errors = [];
    for (const proxyFn of TTS_PROXIES) {
        const proxyUrl = proxyFn(url);
        try {
            const response = await fetch(proxyUrl, { method: 'GET' });
            if (response.ok) {
                const blob = await response.blob();
                if (blob.size > 1000) {
                    return blob;
                }
            }
        } catch (e) {
            errors.push(e.message);
        }
    }
    throw new Error('Todos los proxies fallaron: ' + errors.join('; '));
}

async function generateTTSAudio() {
    const text = document.getElementById('ttsInputText').value.trim();
    const lang = document.getElementById('ttsLang').value;

    if (!text) {
        showToast('Por favor escribe algún texto.', 'warning');
        return;
    }

    const btn = document.querySelector('[onclick="generateTTSAudio()"]');
    const originalText = btn.textContent;
    btn.disabled = true;

    // Primero intentar proxies de Google TTS
    try {
        const chunks = chunkText(text, 180);
        const audioBlobs = [];

        for (let i = 0; i < chunks.length; i++) {
            btn.textContent = `Generando ${i + 1}/${chunks.length}...`;
            const chunk = chunks[i];
            const googleUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${lang}&client=tw-ob`;
            const blob = await tryFetchWithProxies(googleUrl);
            audioBlobs.push(blob);
        }

        const finalBlob = new Blob(audioBlobs, { type: 'audio/mpeg' });
        ttsState.audioBlob = finalBlob;
        ttsState.audioUrl = URL.createObjectURL(finalBlob);

        const audio = document.getElementById('ttsAudioPreview');
        audio.src = ttsState.audioUrl;
        document.getElementById('ttsAudioPreviewContainer').style.display = 'block';
        document.getElementById('btnPlaceTTSPodcast').disabled = false;

        showToast('Audio generado correctamente. Escúchalo y luego colócalo en el PDF.', 'success');
    } catch (proxyError) {
        console.warn('Proxies TTS fallaron, usando fallback de speechSynthesis:', proxyError);

        // Fallback: usar speechSynthesis nativo para pre-escucha
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang === 'es' ? 'es-MX' : lang === 'en' ? 'en-US' : lang;
        utterance.rate = 0.95;

        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(v => v.lang.includes(lang) && (v.name.includes('Google') || v.name.includes('Natural'))) || voices.find(v => v.lang.includes(lang));
        if (preferred) utterance.voice = preferred;

        // Como no tenemos blob, no podemos adjuntar directamente
        // Pero permitimos pre-escucha y sugerimos alternativas
        window.speechSynthesis.speak(utterance);

        showToast('Servidor TTS externo no disponible. Usando voz del navegador. Sube un MP3 para adjuntarlo al PDF.', 'warning', 6000);

        // Ocultar el preview de audio nativo ya que no hay blob
        document.getElementById('ttsAudioPreviewContainer').style.display = 'none';
        document.getElementById('ttsFallbackMessage').style.display = 'block';

        // No habilitamos el botón de colocar porque no hay blob
        // El usuario puede subir un archivo de audio manualmente
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function handleTTSUploadAudio(input) {
    if (!input.files.length) return;
    const file = input.files[0];
    ttsState.audioBlob = file;
    ttsState.audioUrl = URL.createObjectURL(file);

    const audio = document.getElementById('ttsAudioPreview');
    audio.src = ttsState.audioUrl;
    document.getElementById('ttsAudioPreviewContainer').style.display = 'block';
    document.getElementById('ttsFallbackMessage').style.display = 'none';
    document.getElementById('btnPlaceTTSPodcast').disabled = false;
    showToast('Audio subido: ' + file.name, 'success');
}

function activateTTSPodcastPlacement() {
    if (!ttsState.pdfDoc) {
        showToast('Carga un PDF primero.', 'warning');
        return;
    }
    if (!ttsState.audioBlob) {
        showToast('Genera o sube un archivo de audio primero.', 'warning');
        return;
    }
    ttsState.placementMode = true;
    document.getElementById('ttsPodcastCanvas').style.cursor = 'crosshair';
    showToast('Haz clic en la página del PDF donde quieras el icono.', 'info');
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

        showToast('PDF guardado correctamente.', 'success');

    } catch (e) {
        console.error(e);
        showToast('Error guardando PDF: ' + e.message, 'error');
    } finally {
        btn.textContent = "💾 Guardar PDF";
        btn.disabled = false;
    }
}
