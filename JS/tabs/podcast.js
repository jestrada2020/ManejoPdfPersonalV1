let podcastState = {
    pdfDoc: null,
    currentPage: 1,
    totalPages: 0,
    scale: 1.2,
    audioBlob: null,
    audioUrl: null,
    placementMode: false,
    marker: null,
    recorder: null,
    chunks: [],
    timerInterval: null
};

async function handlePodcastFileBase(input) {
    if (!input.files.length) return;
    const file = input.files[0];
    try {
        const bytes = await readPdfBytes(file);
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        podcastState.pdfDoc = await loadingTask.promise;
        podcastState.totalPages = podcastState.pdfDoc.numPages;
        podcastState.currentPage = 1;
        podcastState.marker = null;

        document.getElementById('podcastPageLabel').textContent = `1 / ${podcastState.totalPages}`;
        renderPodcastPage(1);
    } catch (e) {
        console.error(e);
        alert("Error cargando PDF: " + e.message);
    }
}

async function changePodcastPage(delta) {
    if (!podcastState.pdfDoc) return;
    const newPage = podcastState.currentPage + delta;
    if (newPage >= 1 && newPage <= podcastState.totalPages) {
        podcastState.currentPage = newPage;
        document.getElementById('podcastPageLabel').textContent = `${newPage} / ${podcastState.totalPages}`;
        renderPodcastPage(newPage);
    }
}

async function renderPodcastPage(pageNum) {
    const pdf = podcastState.pdfDoc;
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: podcastState.scale });

    const canvas = document.getElementById('podcastCanvas');
    const ctx = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
        canvasContext: ctx,
        viewport: viewport
    };
    await page.render(renderContext).promise;

    if (podcastState.marker && podcastState.marker.page === pageNum) {
        const x = podcastState.marker.x;
        const y = podcastState.marker.y;

        ctx.font = "30px Arial";
        ctx.textAlign = "center";
        ctx.fillText("🎙️", x, y);

        ctx.font = "12px Arial";
        ctx.fillStyle = "red";
        ctx.fillText("Podcast", x, y + 15);
    }

    canvas.onclick = handlePodcastCanvasClick;
}

function handlePodcastCanvasClick(e) {
    if (!podcastState.placementMode) return;

    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    podcastState.marker = {
        page: podcastState.currentPage,
        x: x,
        y: y
    };

    podcastState.placementMode = false;
    document.getElementById('podcastCanvas').style.cursor = 'default';
    renderPodcastPage(podcastState.currentPage);

    document.getElementById('btnSavePodcast').disabled = false;
    alert("Ubicación marcada. Ahora puedes guardar el PDF.");
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        podcastState.recorder = new MediaRecorder(stream);
        podcastState.chunks = [];

        podcastState.recorder.ondataavailable = e => podcastState.chunks.push(e.data);
        podcastState.recorder.onstop = e => {
            const blob = new Blob(podcastState.chunks, { type: 'audio/webm' });
            podcastState.audioBlob = blob;
            podcastState.audioUrl = URL.createObjectURL(blob);

            const audio = document.getElementById('audioPreview');
            audio.src = podcastState.audioUrl;
            document.getElementById('audioPreviewContainer').style.display = 'block';
        };

        podcastState.recorder.start();
        startVisualizer(stream);
        startTimer();

        document.getElementById('btnRecordStart').disabled = true;
        document.getElementById('btnRecordStop').disabled = false;
        document.getElementById('btnRecordStart').classList.add('recording-active');

    } catch (e) {
        alert("No se pudo acceder al micrófono: " + e.message + "\nIntenta usar 'Subir archivo' si estás en local.");
    }
}

function stopRecording() {
    if (podcastState.recorder) {
        podcastState.recorder.stop();
        stopTimer();
        stopVisualizer();

        document.getElementById('btnRecordStart').disabled = false;
        document.getElementById('btnRecordStop').disabled = true;
        document.getElementById('btnRecordStart').classList.remove('recording-active');
    }
}

let audioContext;
let analyser;
let dataArray;
let visualizerId;

function startVisualizer(stream) {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    source.connect(analyser);
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    const canvas = document.getElementById('audioVisualizer');
    const ctx = canvas.getContext('2d');

    function draw() {
        visualizerId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 2;
            ctx.fillStyle = 'rgb(' + (barHeight + 100) + ',50,50)';
            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }
    draw();
}

function stopVisualizer() {
    cancelAnimationFrame(visualizerId);
}

let startTime;

function startTimer() {
    startTime = Date.now();
    podcastState.timerInterval = setInterval(() => {
        const diff = Math.floor((Date.now() - startTime) / 1000);
        const m = Math.floor(diff / 60).toString().padStart(2, '0');
        const s = (diff % 60).toString().padStart(2, '0');
        document.getElementById('recordTimer').textContent = `${m}:${s}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(podcastState.timerInterval);
}

function useRecordedAudio() {
    document.getElementById('btnPlacePodcast').disabled = false;
    alert("Audio grabado seleccionado. Ahora haz clic en 'Colocar en PDF'.");
}

function handleAudioUpload(input) {
    if (!input.files.length) return;
    const file = input.files[0];
    podcastState.audioBlob = file;
    document.getElementById('btnPlacePodcast').disabled = false;
    alert("Audio subido seleccionado. Ahora haz clic en 'Colocar en PDF'.");
}

function activatePodcastPlacement() {
    if (!podcastState.pdfDoc) {
        alert("Carga un PDF primero");
        return;
    }
    podcastState.placementMode = true;
    document.getElementById('podcastCanvas').style.cursor = 'crosshair';
    alert("Haz clic en la página donde quieras poner el icono del Podcast.");
}

async function savePodcastPDF() {
    if (!podcastState.audioBlob || !podcastState.marker) return;

    const btn = document.getElementById('btnSavePodcast');
    btn.textContent = "Guardando...";
    btn.disabled = true;

    try {
        const input = document.getElementById('podcastFileInput');
        const bytes = await readPdfBytes(input.files[0]);
        const pdfDoc = await PDFLib.PDFDocument.load(bytes);

        const audioBytes = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(new Uint8Array(reader.result));
            reader.readAsArrayBuffer(podcastState.audioBlob);
        });

        const audioRef = pdfDoc.context.register(
            pdfDoc.context.flateStream(audioBytes, {
                Type: 'EmbeddedFile',
                Subtype: 'audio/webm',
                Params: {
                    Size: audioBytes.length,
                    CreationDate: new Date(),
                },
            })
        );

        const fileSpecDict = pdfDoc.context.obj({
            Type: 'Filespec',
            F: 'podcast_recording.webm',
            EF: { F: audioRef },
        });

        const page = pdfDoc.getPages()[podcastState.marker.page - 1];
        const { width, height } = page.getSize();

        const pdfX = podcastState.marker.x / podcastState.scale;
        const pdfY = height - (podcastState.marker.y / podcastState.scale);

        const annotInfo = pdfDoc.context.obj({
            Type: 'Annot',
            Subtype: 'FileAttachment',
            Rect: [pdfX, pdfY - 20, pdfX + 20, pdfY],
            FS: fileSpecDict,
            Name: 'PushPin',
            T: 'Podcast Grabado',
            Contents: 'Haz clic para escuchar el podcast grabado.',
            C: [1, 0, 0]
        });

        const annotRef = pdfDoc.context.register(annotInfo);
        page.node.set(PDFLib.PDFName.of('Annots'), pdfDoc.context.obj([annotRef]));

        page.drawCircle({
            x: pdfX + 10,
            y: pdfY - 10,
            size: 15,
            color: PDFLib.rgb(1, 0, 0),
            opacity: 0.3,
        });
        page.drawText('PODCAST', {
            x: pdfX - 10,
            y: pdfY - 25,
            size: 9,
            color: PDFLib.rgb(1, 0, 0)
        });

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = "podcast_doc.pdf";
        a.click();

    } catch (e) {
        console.error(e);
        alert("Error guardando: " + e.message);
    } finally {
        btn.textContent = "💾 Guardar PDF";
        btn.disabled = false;
    }
}
