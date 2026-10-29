let manimState = {
    pdfDoc: null,
    file: null,
    fileName: '',
    totalPages: 0,
    scenes: [],
    textByPage: {},
    linesByPage: [],   // líneas limpias por página (sin encabezados/pies repetidos)
    zipBlob: null,
    voice: null        // narrador usado al generar el proyecto
};

// ============================================================
// FILE HANDLING
// ============================================================
async function handleManimFile(input) {
    if (!input.files.length) return;
    const file = input.files[0];
    manimState.file = file;
    manimState.fileName = file.name.replace(/\.pdf$/i, '');

    const info = document.getElementById('manimFileInfo');
    const nameSpan = document.getElementById('manimFileName');
    const btn = document.getElementById('manimGenerateBtn');
    const logs = document.getElementById('manimLogs');

    info.style.display = 'block';
    nameSpan.textContent = file.name;
    btn.disabled = true;
    logs.textContent = 'Cargando y extrayendo texto...';

    try {
        const bytes = await readPdfBytes(file);
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        manimState.pdfDoc = await loadingTask.promise;
        manimState.totalPages = manimState.pdfDoc.numPages;

        await extractAllText();
        const pagesLines = [];
        for (let i = 1; i <= manimState.totalPages; i++) {
            pagesLines.push((manimState.textByPage[i] || '').split('\n'));
        }
        manimState.linesByPage = removeRepeatedHeadersFooters(pagesLines);

        btn.disabled = false;
        logs.textContent = `Documento cargado: ${manimState.totalPages} páginas, texto extraído.`;
        showToast('PDF cargado correctamente', 'success');
    } catch (e) {
        console.error(e);
        logs.textContent = 'Error cargando PDF: ' + e.message;
        showToast('Error cargando PDF', 'error');
    }
}

async function extractAllText() {
    manimState.textByPage = {};
    const pdf = manimState.pdfDoc;

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const items = textContent.items;

        // Reconstruct text preserving some layout
        let pageText = '';
        let lastY = null;

        for (const item of items) {
            const str = (item.str || '').trim();
            if (!str) continue;

            // Add newline when Y changes significantly (new line)
            if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
                pageText += '\n';
            } else if (pageText && !pageText.endsWith(' ') && !pageText.endsWith('\n')) {
                pageText += ' ';
            }

            pageText += str;
            lastY = item.transform[5];
        }

        manimState.textByPage[i] = pageText.trim();
    }
}

// ============================================================
// LIMPIEZA DEL TEXTO PARA UNA NARRACIÓN NATURAL
// (funciones puras: sin DOM, se prueban también en Node)
// ============================================================
const SPEECH_BULLET = /^\s*([•●▪◦■□➢►✓\-–—*]|\d{1,2}[.)]|[a-zA-Z][)])\s+/;
const SPEECH_UPPER_START = /^[¿¡"“«(]?[A-ZÁÉÍÓÚÑÜ0-9]/;

function speechKey(line) {
    return line.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

// Quita encabezados y pies de página que se repiten (título del libro, "Página 3 de 20"...)
function removeRepeatedHeadersFooters(pagesLines) {
    const n = pagesLines.length;
    const clean = pagesLines.map(lines => lines.map(l => l.trim()).filter(l => l));
    if (n < 3) return clean;

    const counts = new Map();
    clean.forEach(lines => {
        const edges = new Set([...lines.slice(0, 2), ...lines.slice(-2)].map(speechKey).filter(k => k));
        edges.forEach(k => counts.set(k, (counts.get(k) || 0) + 1));
    });
    const threshold = Math.max(3, Math.ceil(n * 0.4));

    return clean.map(lines => lines.filter((l, i) => {
        const isEdge = i < 2 || i >= lines.length - 2;
        return !(isEdge && (counts.get(speechKey(l)) || 0) >= threshold);
    }));
}

// Líneas que no deben leerse: números de página, índices con puntos, separadores
function isNoiseLine(line) {
    return /^(p[aá]g(ina)?\.?\s*)?\d{1,4}(\s*(de|\/|of)\s*\d{1,4})?$/i.test(line) ||
        /^[ivxlcdm]{1,6}$/i.test(line) ||
        /(\.\s?){4,}\s*\d+$/.test(line) ||
        /^[\W_]+$/.test(line);
}

function toSentenceCase(text) {
    const lower = text.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Une las líneas cortadas del PDF en párrafos reales (las pausas de la voz dependen de esto)
const PAGE_BREAK = '\f';

function linesToParagraphs(lines) {
    const useful = lines.map(l => (l === PAGE_BREAK ? l : l.trim())).filter(l => l === PAGE_BREAK || (l && !isNoiseLine(l)));
    const lengths = useful.map(l => l.length).filter(len => len > 20).sort((a, b) => a - b);
    const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 60;

    const paragraphs = [];
    let cur = '';
    const flush = () => { if (cur.trim()) paragraphs.push(cur.trim()); cur = ''; };

    useful.forEach((line, i) => {
        if (line === PAGE_BREAK) {
            // Cambio de página: si la frase ya terminó, también termina el párrafo
            if (/[.!?:…"”»]$/.test(cur)) flush();
            return;
        }
        const next = useful.slice(i + 1).find(l => l !== PAGE_BREAK);
        const midSentence = cur && !/[.!?:;…"”»]$/.test(cur);

        // Una viñeta termina cuando la línea siguiente empieza otra idea (mayúscula)
        if (cur && SPEECH_BULLET.test(cur) && SPEECH_UPPER_START.test(line)) flush();

        if (SPEECH_BULLET.test(line)) {
            flush();
            cur = line;
        } else if (!midSentence && next && line.length <= 80 && line.length < median * 0.8 &&
            line.split(/\s+/).length <= 12 && !/[.,;:!?\-]$/.test(line) &&
            SPEECH_UPPER_START.test(line) && SPEECH_UPPER_START.test(next)) {
            // Título o subtítulo: va solo y con punto, para que el narrador haga una pausa
            flush();
            const letters = line.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, '');
            const isCaps = letters.length > 3 && letters === letters.toUpperCase();
            paragraphs.push((isCaps ? toSentenceCase(line) : line) + '.');
            return;
        } else if (!cur) {
            cur = line;
        } else if (/[A-Za-zÁÉÍÓÚÑÜáéíóúñü]-$/.test(cur) && /^[a-záéíóúñü]/.test(line)) {
            cur = cur.slice(0, -1) + line;   // palabra partida con guion: "infor-" + "mación"
        } else {
            cur += ' ' + line;
        }

        // Fin de párrafo: la línea termina en punto y es claramente más corta que las demás
        if (/[.!?:…"”»]$/.test(line) && line.length < median * 0.7) flush();
    });
    flush();
    return paragraphs;
}

const SPEECH_ABBREVIATIONS = [
    [/\bp\.\s?ej\./gi, 'por ejemplo'],
    [/\betc\./gi, 'etcétera'],
    [/\bDra\./g, 'doctora'], [/\bDr\./g, 'doctor'],
    [/\bSrta\./g, 'señorita'], [/\bSra\./g, 'señora'], [/\bSr\./g, 'señor'],
    [/\bProf\./g, 'profesor'], [/\bLic\./g, 'licenciado'], [/\bIng\./g, 'ingeniero'],
    [/\bMtra\./g, 'maestra'], [/\bMtro\./g, 'maestro'],
    [/\bUds\./g, 'ustedes'], [/\bUd\./g, 'usted'],
    [/\bp[aá]gs?\.\s*(?=\d)/gi, 'página '],
    [/\bfigs?\.\s*(?=\d)/gi, 'figura '],
    [/\bcap\.\s*(?=\d)/gi, 'capítulo '],
    [/\bvol\.\s*(?=\d)/gi, 'volumen '],
    [/\bn[uú]m\.\s*(?=\d)/gi, 'número '],
    [/\b(N\.?\s?º|n\.?\s?º|No\.)\s*(?=\d)/g, 'número '],
    [/\baprox\./gi, 'aproximadamente'],
    [/\bEE\.\s?UU\.?/g, 'Estados Unidos'],
    [/\ba\.\s?C\./g, 'antes de Cristo'],
    [/\bd\.\s?C\./g, 'después de Cristo'],
    [/\bi\.\s?e\./gi, 'es decir'],
    [/\bvs\.?(?=\s)/gi, 'contra']
];

// Ajusta un párrafo para que la voz lo lea como una persona
function polishParagraph(paragraph) {
    let t = paragraph.replace(SPEECH_BULLET, '');

    // URLs: se oyen fatal letra por letra; también se quita la frase que solo las presenta
    t = t.replace(/\b(m[aá]s informaci[oó]n|v[eé]ase|ver|visite|consulte|disponible)\s+(en\s+)?(https?:\/\/|www\.)\S+/gi, '');
    t = t.replace(/\b(https?:\/\/|www\.)\S+/gi, '');
    t = t.replace(/\[\d+(?:\s*[-–,]\s*\d+)*\]/g, '');             // citas tipo [12] o [3-5]

    for (const [re, full] of SPEECH_ABBREVIATIONS) t = t.replace(re, full);

    t = t.replace(/US\$\s*(\d[\d,.]*)/g, '$1 dólares')
        .replace(/\$\s*(\d[\d,.]*)/g, '$1 pesos')
        .replace(/€\s*(\d[\d,.]*)/g, '$1 euros')
        .replace(/£\s*(\d[\d,.]*)/g, '$1 libras')
        .replace(/(\d+[.,]?\d*)\s*%/g, '$1 por ciento');

    t = t.replace(/\s*&\s*/g, ' y ')
        .replace(/\s*≥\s*/g, ' mayor o igual que ')
        .replace(/\s*≤\s*/g, ' menor o igual que ')
        .replace(/\s*≠\s*/g, ' distinto de ')
        .replace(/\s*±\s*/g, ' más menos ')
        .replace(/(\d)\s*°\s*C\b/g, '$1 grados Celsius')
        .replace(/(\d)\s*°/g, '$1 grados')
        .replace(/\s*[→⇒➔]\s*/g, ', ')
        .replace(/§\s*/g, 'sección ')
        .replace(/[•●▪◦■□➢►✓]/g, ',');

    // Palabras en MAYÚSCULAS (no siglas cortas): la voz las lee con énfasis raro o deletreadas
    const letters = t.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, '');
    if (letters.length > 12 && letters === letters.toUpperCase()) {
        t = toSentenceCase(t);
    } else {
        t = t.replace(/\b[A-ZÁÉÍÓÚÑÜ]{5,}\b/g, w => w.toLowerCase());
    }

    t = t.replace(/\s+/g, ' ')
        .replace(/\(\s*\)/g, '')
        .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
        .replace(/\s+([,.;:!?…])/g, '$1')
        .replace(/([,;])(?=[^\s\d])/g, '$1 ')
        .replace(/,\s*,/g, ',')
        .replace(/^[,;:\s]+/, '')
        .trim();

    if (!t) return '';
    // Mayúscula inicial (también tras ¿ ¡ o comillas) y punto final para que la voz cierre la frase
    t = t.replace(/^([¿¡"“«(]*)([a-záéíóúñü])/, (m, p, c) => p + c.toUpperCase());
    if (!/[.!?…:]["”»)]?$/.test(t)) t = t.replace(/[,;]$/, '') + '.';
    return t;
}

function cleanTextForSpeech(lines) {
    return linesToParagraphs(lines).map(polishParagraph).filter(p => p && /[A-Za-zÁÉÍÓÚÑÜáéíóúñü]/.test(p));
}

// Mantener por compatibilidad: limpia un texto suelto
function formatNarrationText(text) {
    return cleanTextForSpeech(String(text).split('\n')).join('\n\n');
}

function countWords(text) {
    return (String(text).match(/\S+/g) || []).length;
}

function splitSentences(paragraph) {
    return paragraph.split(/(?<=[.!?…]["”»)]?)\s+(?=[¿¡"“«(]?[A-ZÁÉÍÓÚÑÜ0-9])/).filter(s => s.trim());
}

// Divide en escenas cortando SOLO entre frases (y preferiblemente entre párrafos)
function splitParagraphsIntoScenes(paragraphs, wordsPerScene) {
    const target = Math.max(20, wordsPerScene);
    const scenes = [];
    let paras = [];
    let curPar = [];
    let count = 0;

    const closeScene = () => {
        if (curPar.length) { paras.push(curPar.join(' ')); curPar = []; }
        if (paras.length) scenes.push(paras.join('\n\n'));
        paras = [];
        count = 0;
    };

    for (const par of paragraphs) {
        for (const sentence of splitSentences(par)) {
            const w = countWords(sentence);
            if (count > 0 && (count >= target || (count + w > target * 1.3 && count >= target * 0.6))) {
                closeScene();
            }
            curPar.push(sentence);
            count += w;
        }
        if (curPar.length) { paras.push(curPar.join(' ')); curPar = []; }
        // No cortar justo después de "Las partes son:" (la lista va en la misma escena)
        if (count >= target * 0.85 && !/:$/.test(par)) closeScene();
    }
    closeScene();

    // Una última escena diminuta se une a la anterior
    if (scenes.length > 1 && countWords(scenes[scenes.length - 1]) < target * 0.3) {
        const last = scenes.pop();
        scenes[scenes.length - 1] += '\n\n' + last;
    }
    return scenes;
}

// Capítulos: solo cuenta si "Capítulo 3", "Tema 2", "Unidad IV"... empieza una línea
function detectChaptersFromText(textByPage) {
    const totalPages = Object.keys(textByPage).length;
    const re = /^\s*((cap[ií]tulo|chapter|secci[oó]n|parte|tema|unidad|lecci[oó]n)\s+(\d+|[IVXLC]+)\b.{0,60})/im;
    const chapters = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const match = (textByPage[pageNum] || '').match(re);
        if (!match) continue;
        if (chapters.length === 0 && pageNum > 1) {
            chapters.push({ title: 'Introducción', startPage: 1, endPage: pageNum - 1 });
        }
        if (chapters.length > 0) chapters[chapters.length - 1].endPage = pageNum - 1;
        chapters.push({ title: match[1].trim(), startPage: pageNum, endPage: null });
    }

    if (chapters.length === 0) {
        return [{ title: 'Documento Completo', startPage: 1, endPage: totalPages }];
    }
    chapters[chapters.length - 1].endPage = totalPages;
    return chapters.filter(ch => ch.endPage >= ch.startPage);
}

if (typeof module !== 'undefined') {
    module.exports = {
        removeRepeatedHeadersFooters, linesToParagraphs, polishParagraph, cleanTextForSpeech,
        splitParagraphsIntoScenes, splitSentences, detectChaptersFromText, countWords
    };
}

// ============================================================
// NARRADOR (selector, velocidad, tono y vista previa)
// ============================================================
function getManimVoiceSettings() {
    const rate = parseInt(document.getElementById('manimRate').value, 10) || 0;
    const pitch = parseInt(document.getElementById('manimPitch').value, 10) || 0;
    return {
        narrator: getNarrator(),
        rate: `${rate >= 0 ? '+' : ''}${rate}%`,
        pitch: `${pitch >= 0 ? '+' : ''}${pitch}Hz`,
        browserRate: Math.min(1.5, Math.max(0.6, 1 + rate / 100))
    };
}

function updateManimVoiceLabels() {
    const s = getManimVoiceSettings();
    document.getElementById('manimRateLabel').textContent = s.rate;
    document.getElementById('manimPitchLabel').textContent = s.pitch;
}

function onManimVoiceChange() {
    setNarrator(document.getElementById('manimVoice').value);
    updateManimVoiceLabels();
    describeManimPreviewVoice();
}

function describeManimPreviewVoice() {
    const el = document.getElementById('manimVoiceInfo');
    if (!el) return;
    const narrator = getNarrator();
    const v = pickBrowserVoice(narrator.lang);
    if (!v) {
        el.textContent = `El archivo de audio usará la voz neuronal ${narrator.id}. Este navegador no tiene voces para la vista previa.`;
    } else if (v.name.toLowerCase().includes(narrator.hint.toLowerCase())) {
        el.textContent = `Vista previa con «${v.name}», la misma voz que tendrá el audio final.`;
    } else {
        el.textContent = `Vista previa aproximada con «${v.name}». El audio final (MP3) usará la voz neuronal ${narrator.id}, mucho más natural.`;
    }
}

function previewManimNarrator() {
    const narrator = getNarrator();
    const name = narrator.label.split(' ')[0];
    const sample = narrator.lang.startsWith('en')
        ? `Hi, I'm ${name}. This is how your document narration will sound.`
        : `Hola, soy ${name}. Así sonará la narración de tu documento: con pausas naturales entre frases, y un ritmo tranquilo para que se entienda bien.`;
    speakNaturally(sample, { lang: narrator.lang, rate: getManimVoiceSettings().browserRate });
    describeManimPreviewVoice();
}

function playManimScene(idx) {
    const scene = manimState.scenes[idx];
    if (!scene) return;
    speakNaturally(scene.narration, { lang: getNarrator().lang, rate: getManimVoiceSettings().browserRate });
}

function stopManimPreview() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
}

function generateSceneName(index, titleHint) {
    const safe = (titleHint || 'Escena')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 30);
    return `Escena_${String(index + 1).padStart(3, '0')}_${safe || 'Contenido'}`;
}

function generateScenePy(sceneName, narrationText, isFirst = false, isLast = false) {
    const titleLine = isFirst
        ? `enc = Text("${sceneName.replace(/_/g, ' ')}", font_size=28, color=WHITE, weight=BOLD).to_edge(UP, buff=0.34)`
        : `enc = Text("${sceneName.replace(/_/g, ' ')}", font_size=24, color=WHITE, weight=BOLD).to_edge(UP, buff=0.34)`;

    // Create visual content hints based on text content
    const hasList = /[•\-\*]/.test(narrationText);
    const hasNumbers = /\d/.test(narrationText);

    let contentCode = '';
    if (hasList) {
        contentCode = `
        # Contenido tipo lista
        items = VGroup(
            Text("• Punto uno", font_size=20, color="#94a3b8"),
            Text("• Punto dos", font_size=20, color="#94a3b8"),
            Text("• Punto tres", font_size=20, color="#94a3b8"),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.3).move_to([0, -0.5, 0])
        self.play(FadeIn(items), run_time=0.8)
        self.wait(2.00)`;
    } else if (hasNumbers) {
        contentCode = `
        # Contenido con datos
        data = MathTex("x = 42", color="#00e5ff").move_to([0, 0, 0])
        self.play(Write(data), run_time=0.6)
        self.wait(2.00)`;
    } else {
        contentCode = `
        # Contenido principal (adaptar según tema)
        body = Text("Contenido visual aquí", font_size=18, color="#94a3b8").move_to([0, -0.5, 0])
        self.play(FadeIn(body), run_time=0.6)
        self.wait(2.00)`;
    }

    return `from manim import *

class ${sceneName}(Scene):
    def construct(self):
        self.camera.background_color = "#050a1a"

        # 1. Cabecera (badge + título)
        ${titleLine}
        self.play(FadeIn(enc), run_time=0.50)
        self.wait(0.30)

        # 2. Enunciado / contenido
        ${contentCode}

        # 3. FadeOut antes del contenido principal (si hay más de 5 objetos)
        # self.play(FadeOut(VGroup(enc, body)), run_time=0.50)

        # 4. Contenido principal (tabla, fórmulas, diagrama)
        # Adaptar según el tema del documento

        # 5. Espera FINAL mínima — nunca menos de 7 s
        self.wait(8.00)
`;
}

function generateMergeScript(scenes) {
    const sceneList = scenes.map(s => `    '${s.name}'`).join(',\n');

    return `import subprocess, json, os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

def dur(f):
    r = subprocess.run(['ffprobe', '-v', 'quiet', '-print_format', 'json',
                        '-show_streams', f], capture_output=True, text=True)
    return float(json.loads(r.stdout)['streams'][0]['duration'])

scenes = [
${sceneList}
]

os.makedirs('merged', exist_ok=True)
hechos = []

for s in scenes:
    vf  = f'media/videos/{s}/720p24/{s}.mp4'
    af  = f'{s}_narracion.mp3'
    out = f'merged/{s}_merged.mp4'

    if not os.path.exists(vf):
        print(f'⚠ Video no encontrado: {vf}')
        continue
    if not os.path.exists(af):
        print(f'⚠ Audio no encontrado: {af}')
        continue

    pts = dur(af) / dur(vf)
    print(f'{s}  pts={pts:.3f}')

    if pts > 6.0:
        print('  ⚠ WARNING: pts > 6.0. Alarga self.wait() final o acorta narración.')

    subprocess.run([
        'ffmpeg', '-y', '-i', vf, '-i', af,
        '-filter_complex', f'[0:v]setpts={pts:.6f}*PTS[v]',
        '-map', '[v]', '-map', '1:a',
        '-c:v', 'libx264', '-c:a', 'aac', '-shortest', out
    ], check=True)
    hechos.append(f'{s}_merged.mp4')
    print(f'OK {s}')

# Concatenar video final (en el orden de las escenas)
if hechos:
    with open('merged/concat_list.txt', 'w', encoding='utf-8') as f:
        for name in hechos:
            f.write(f"file '{name}'\\n")
    subprocess.run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0',
                    '-i', 'merged/concat_list.txt', '-c', 'copy',
                    'video_final_con_voz.mp4'], check=True)
    print('Video final generado: video_final_con_voz.mp4')
else:
    print('No se unió ninguna escena: revisa que existan los videos y los audios.')
`;
}

function generateAudioScript(scenes, voice) {
    return `#!/bin/bash
# Generar la narración (MP3 + subtítulos SRT) de todas las escenas con edge-tts
# Narrador: ${voice.narrator.label} — ${voice.narrator.region} (${voice.narrator.id})
# Puede cambiarlo sin regenerar el proyecto, por ejemplo:
#   VOZ=es-MX-DaliaNeural VELOCIDAD=-10% ./generar_audio.sh
cd "$(dirname "$0")"

VOZ="\${VOZ:-${voice.narrator.id}}"
VELOCIDAD="\${VELOCIDAD:-${voice.rate}}"
TONO="\${TONO:-${voice.pitch}}"
EDGE_TTS="\${EDGE_TTS:-$(command -v edge-tts || echo "$HOME/.local/bin/edge-tts")}"

if [ ! -x "$EDGE_TTS" ]; then
    echo "No se encontró edge-tts. Instálelo con: pip install edge-tts"
    exit 1
fi

for scene in ${scenes.map(s => s.name).join(' ')}; do
    echo "Generando audio para: $scene  (voz $VOZ, velocidad $VELOCIDAD, tono $TONO)"
    "$EDGE_TTS" --voice "$VOZ" --rate="$VELOCIDAD" --pitch="$TONO" \\
        --file "\${scene}_narracion.txt" \\
        --write-media "\${scene}_narracion.mp3" \\
        --write-subtitles "\${scene}_narracion.srt" || {
            echo "Falló edge-tts. Si el error dice 403, su edge-tts está desactualizado: pip install -U edge-tts"
            exit 1
        }
done

echo "Todos los audios generados."
`;
}

function generateReadme(projectTitle, scenes, voice) {
    return `PROYECTO MANIM + NARRACIÓN: ${projectTitle}
================================================

Generado automáticamente desde PDF.

NARRADOR
--------
Voz:       ${voice.narrator.label} — ${voice.narrator.region} (${voice.narrator.id})
Velocidad: ${voice.rate}
Tono:      ${voice.pitch}

El texto de cada *_narracion.txt ya está preparado para sonar natural:
párrafos reales (la voz hace pausa entre ellos), sin números de página ni
encabezados repetidos, abreviaturas expandidas y escenas cortadas entre frases.
Puede editarlo a mano antes de generar el audio.

ESTRUCTURA DEL PROYECTO
-----------------------
${scenes.map(s => `${s.name}.py\n${s.name}_narracion.txt`).join('\n')}
generar_audio.sh
renderizar.sh
merge_video.py

INSTRUCCIONES
-------------
1. Instalar dependencias:
   pip install manim edge-tts

2. Generar la narración (MP3 + subtítulos .srt):
   bash generar_audio.sh

   Para usar otro narrador sin regenerar el proyecto:
   VOZ=es-MX-DaliaNeural bash generar_audio.sh
   (lista completa: edge-tts --list-voices | grep es-)

3. Renderizar escenas Manim:
   bash renderizar.sh

4. Sincronizar y concatenar:
   python merge_video.py

REGLAS DEL SKILL (CHECKLIST)
----------------------------
[ ] Nombre archivo == nombre clase == prefijo narración
[ ] background_color = "#050a1a"
[ ] ≤ 5-6 objetos simultáneos en pantalla
[ ] FadeOut antes del contenido principal
[ ] self.wait() final ≥ 7.00 s
[ ] Narración .txt tiene 100-190 palabras
[ ] Audio .mp3 generado con ${voice.narrator.id}
[ ] Video renderizó sin errores
[ ] Factor setpts entre 1.5 y 4.5 (ideal)
[ ] Archivo merged tiene audio + video

PALETA DE COLORES
-----------------
Fondo:           #050a1a
Código / Col A:  #00e5ff
Proporción / B:  #00ff9d
Inversa / Alerta:#fb7185
Incógnita:       #ffb800
Decorativo:      #a78bfa
Etiquetas:       #94a3b8
Separadores:     #334155
`;
}

// ============================================================
// MAIN GENERATION
// ============================================================
function linesForPages(start, end) {
    const lines = [];
    for (let p = start; p <= end; p++) lines.push(...(manimState.linesByPage[p - 1] || []), PAGE_BREAK);
    return lines;
}

async function generateManimProject() {
    const btn = document.getElementById('manimGenerateBtn');
    const logs = document.getElementById('manimLogs');
    const preview = document.getElementById('manimPreview');
    const resultArea = document.getElementById('manimResult');
    const wordsPerScene = parseInt(document.getElementById('manimWordsPerScene').value) || 150;
    const projectTitle = sanitizeFilename(document.getElementById('manimProjectTitle').value || 'ProyectoNarracion');
    const autoDetectChapters = document.getElementById('manimAutoDetectChapters').checked;
    const splitByPages = document.getElementById('manimSplitByPages').checked;
    const voice = getManimVoiceSettings();

    if (!manimState.pdfDoc) {
        showToast('Carga un PDF primero', 'warning');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Analizando documento...';
    preview.style.display = 'none';
    resultArea.style.display = 'none';
    logs.textContent = 'Extrayendo y organizando contenido...';

    try {
        const scenes = [];
        const addScene = (text, hint, pageStart, pageEnd) => {
            scenes.push({
                name: generateSceneName(scenes.length, hint),
                narration: text,
                pageStart, pageEnd,
                wordCount: countWords(text)
            });
        };

        if (splitByPages) {
            for (let i = 1; i <= manimState.totalPages; i++) {
                const text = cleanTextForSpeech(linesForPages(i, i)).join('\n\n');
                if (text.trim()) addScene(text, `Pagina_${i}`, i, i);
            }
        } else if (autoDetectChapters && manimState.totalPages > 1) {
            const chapters = detectChaptersFromText(manimState.textByPage);
            for (const chapter of chapters) {
                const paragraphs = cleanTextForSpeech(linesForPages(chapter.startPage, chapter.endPage));
                splitParagraphsIntoScenes(paragraphs, wordsPerScene).forEach((text, idx) => {
                    addScene(text, idx === 0 ? chapter.title : `${chapter.title}_cont`, chapter.startPage, chapter.endPage);
                });
            }
        } else {
            const paragraphs = cleanTextForSpeech(linesForPages(1, manimState.totalPages));
            splitParagraphsIntoScenes(paragraphs, wordsPerScene).forEach((text, idx) => {
                addScene(text, `Escena_${idx + 1}`, 1, manimState.totalPages);
            });
        }

        if (scenes.length === 0) {
            logs.textContent = 'No se pudo extraer texto del documento (¿es un PDF escaneado?).';
            showToast('No se encontró texto en el PDF', 'error');
            return;
        }

        manimState.scenes = scenes;
        manimState.voice = voice;
        logs.textContent = `Generadas ${scenes.length} escenas. Creando archivos...`;

        const zip = new JSZip();
        const projectFolder = zip.folder(projectTitle);
        projectFolder.folder('merged');

        scenes.forEach((scene, idx) => {
            projectFolder.file(`${scene.name}.py`, generateScenePy(scene.name, scene.narration, idx === 0, idx === scenes.length - 1));
            projectFolder.file(`${scene.name}_narracion.txt`, scene.narration + '\n');
        });

        projectFolder.file('merge_video.py', generateMergeScript(scenes));
        projectFolder.file('README.txt', generateReadme(projectTitle, scenes, voice));
        projectFolder.file('helpers.py', `# helpers.py - Funciones compartidas (opcional)
from manim import *

# Añade aquí utilidades reutilizables entre escenas
`);
        projectFolder.file('generar_audio.sh', generateAudioScript(scenes, voice), { unixPermissions: '755' });
        projectFolder.file('renderizar.sh', `#!/bin/bash
# Renderizar todas las escenas Manim
cd "$(dirname "$0")"
export LD_PRELOAD=/lib/x86_64-linux-gnu/libglib-2.0.so.0:/lib/x86_64-linux-gnu/libgobject-2.0.so.0

for scene in ${scenes.map(s => s.name).join(' ')}; do
    echo "Renderizando: $scene"
    manim -qm --fps 24 \${scene}.py \${scene}
done

echo "Renderizado completo. Ejecuta python merge_video.py para unir."
`, { unixPermissions: '755' });

        manimState.zipBlob = await zip.generateAsync({ type: 'blob', platform: 'UNIX' });

        displayManimScenes(scenes);
        preview.style.display = 'block';
        logs.textContent = `Proyecto listo: ${scenes.length} escenas, ${scenes.reduce((a, s) => a + s.wordCount, 0)} palabras. ` +
            `Narrador: ${voice.narrator.label} (${voice.narrator.region}).`;
        showToast('Proyecto Manim generado correctamente', 'success');

    } catch (e) {
        console.error(e);
        logs.textContent = 'Error generando proyecto: ' + e.message;
        showToast('Error generando proyecto', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '🎬 Generar Proyecto Manim';
    }
}

function displayManimScenes(scenes) {
    const list = document.getElementById('manimScenesList');
    list.innerHTML = '';

    scenes.forEach((scene, idx) => {
        const item = document.createElement('div');
        item.style.cssText = 'padding: 12px; margin-bottom: 10px; background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border); border-radius: 4px;';

        const wordCount = scene.wordCount;
        const statusColor = wordCount >= 100 && wordCount <= 190 ? 'var(--success)' : 'var(--warning)';

        item.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 4px; display: flex; justify-content: space-between; gap: 8px; align-items: center;">
                <span>${escapeHtml(scene.name)}</span>
                <span style="display:flex; gap:6px; align-items:center;">
                    <span style="color: ${statusColor}; font-size: 0.85rem;">${wordCount} palabras</span>
                    <button class="btn" onclick="playManimScene(${idx})" title="Escuchar esta escena" style="width:auto; padding: 4px 8px; font-size: 0.8rem;">▶️</button>
                    <button class="btn" onclick="stopManimPreview()" title="Detener" style="width:auto; padding: 4px 8px; font-size: 0.8rem; background:#6b7280;">⏹️</button>
                </span>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 6px;">
                Páginas ${scene.pageStart}-${scene.pageEnd}
            </div>
            <details>
                <summary style="font-size: 0.8rem; color: var(--primary); cursor: pointer;">Ver narración</summary>
                <div style="margin-top: 6px; padding: 8px; background: var(--bg-body); border-radius: 4px; font-size: 0.85rem; color: var(--text-main); max-height: 200px; overflow-y: auto; white-space: pre-wrap;">${escapeHtml(scene.narration)}</div>
            </details>
        `;
        list.appendChild(item);
    });
}

function cancelManim() {
    stopManimPreview();
    document.getElementById('manimPreview').style.display = 'none';
    manimState.scenes = [];
    manimState.zipBlob = null;
    document.getElementById('manimLogs').textContent = '';
}

function downloadManimZip() {
    if (!manimState.zipBlob) {
        showToast('Genera el proyecto primero', 'warning');
        return;
    }

    const projectTitle = sanitizeFilename(document.getElementById('manimProjectTitle').value || 'ProyectoNarracion');
    const url = URL.createObjectURL(manimState.zipBlob);

    const link = document.getElementById('manimDownload');
    link.href = url;
    link.download = `${projectTitle}_manim.zip`;

    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectTitle}_manim.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    document.getElementById('manimResult').style.display = 'block';
    showToast('Descarga iniciada', 'success');
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        const select = document.getElementById('manimVoice');
        if (!select) return;
        fillNarratorSelect(select);
        updateManimVoiceLabels();
        describeManimPreviewVoice();
        if (window.speechSynthesis) {
            window.speechSynthesis.addEventListener('voiceschanged', describeManimPreviewVoice);
        }
    });
}
