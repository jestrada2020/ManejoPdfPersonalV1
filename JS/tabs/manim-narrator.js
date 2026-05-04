let manimState = {
    pdfDoc: null,
    file: null,
    fileName: '',
    totalPages: 0,
    scenes: [],
    textByPage: {},
    zipBlob: null
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
// SCENE GENERATION
// ============================================================
function splitTextIntoScenes(text, wordsPerScene) {
    // Clean text: normalize whitespace
    text = text.replace(/\s+/g, ' ').trim();

    const words = text.split(/\s+/);
    const scenes = [];
    let current = [];

    for (const word of words) {
        current.push(word);
        if (current.length >= wordsPerScene) {
            // Try to end at a sentence boundary
            const lastWord = current[current.length - 1];
            if (/[.!?]$/.test(lastWord) || current.length >= wordsPerScene + 20) {
                scenes.push(current.join(' '));
                current = [];
            }
        }
    }

    if (current.length > 0) {
        scenes.push(current.join(' '));
    }

    return scenes;
}

function detectChaptersFromText(textByPage) {
    const patterns = [/cap[ií]tulo\s+\d+/i, /cap[ií]tulo\s+[IVX]+/i, /chapter\s+\d+/i, /secci[oó]n\s+\d+/i, /parte\s+\d+/i];
    const chapters = [];
    let currentChapterStart = 1;
    let currentChapterTitle = 'Introducción';

    for (let pageNum = 1; pageNum <= Object.keys(textByPage).length; pageNum++) {
        const text = textByPage[pageNum] || '';
        const normalized = normalizeText(text);

        for (const pattern of patterns) {
            const match = text.match(new RegExp(pattern.source, 'i'));
            if (match) {
                // End previous chapter
                if (chapters.length > 0) {
                    chapters[chapters.length - 1].endPage = pageNum - 1;
                } else if (pageNum > 1) {
                    chapters.push({ title: currentChapterTitle, startPage: currentChapterStart, endPage: pageNum - 1 });
                }

                currentChapterTitle = match[0];
                currentChapterStart = pageNum;
                chapters.push({ title: currentChapterTitle, startPage: pageNum, endPage: null });
                break;
            }
        }
    }

    if (chapters.length === 0) {
        return [{ title: 'Documento Completo', startPage: 1, endPage: Object.keys(textByPage).length }];
    }

    // Close last chapter
    chapters[chapters.length - 1].endPage = Object.keys(textByPage).length;
    return chapters;
}

function formatNarrationText(text) {
    // Apply skill rules: natural speech, pronounce numbers, etc.
    let formatted = text;

    // Replace numbers with spelled-out approximations for common small numbers
    const numberWords = {
        '0': 'cero', '1': 'uno', '2': 'dos', '3': 'tres', '4': 'cuatro',
        '5': 'cinco', '6': 'seis', '7': 'siete', '8': 'ocho', '9': 'nueve', '10': 'diez'
    };

    // Replace currency symbols with words
    formatted = formatted.replace(/\$\s*(\d[\d,.]*)/g, (match, num) => {
        return num + ' pesos';
    });
    formatted = formatted.replace(/€\s*(\d[\d,.]*)/g, (match, num) => {
        return num + ' euros';
    });
    formatted = formatted.replace(/£\s*(\d[\d,.]*)/g, (match, num) => {
        return num + ' libras';
    });

    // Replace percentages
    formatted = formatted.replace(/(\d+[.,]?\d*)\s*%/g, (match, num) => {
        return num + ' por ciento';
    });

    // Replace common abbreviations
    const abbreviations = {
        'p\. ej\.': 'por ejemplo',
        'p.ej.': 'por ejemplo',
        'etc\.': 'etcétera',
        'Dr\.': 'Doctor',
        'Dra\.': 'Doctora',
        'Prof\.': 'Profesor',
        'Sr\.': 'Señor',
        'Sra\.': 'Señora',
        'Srta\.': 'Señorita',
        'vs\.': 'versus',
        'a\.C\.': 'antes de Cristo',
        'd\.C\.': 'después de Cristo'
    };

    for (const [abbr, full] of Object.entries(abbreviations)) {
        const regex = new RegExp(abbr.replace(/\./g, '\\.'), 'gi');
        formatted = formatted.replace(regex, full);
    }

    // Clean up multiple spaces
    formatted = formatted.replace(/\s+/g, ' ').trim();

    return formatted;
}

function generateSceneName(index, titleHint) {
    const safe = (titleHint || 'Escena')
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

    return `import subprocess, json, os, sys

VENV = os.environ.get('VENV', '/home/john/EnjambreManim_Super1/venv/bin')

def dur(f):
    r = subprocess.run(['ffprobe','-v','quiet','-print_format','json',
                        '-show_streams', f], capture_output=True, text=True)
    return float(json.loads(r.stdout)['streams'][0]['duration'])

scenes = [
${sceneList}
]

os.makedirs('merged', exist_ok=True)

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
        print(f'  ⚠ WARNING: pts > 6.0. Alarga self.wait() final o acorta narración.')
    
    subprocess.run([
        'ffmpeg', '-y', '-i', vf, '-i', af,
        '-filter_complex', f'[0:v]setpts={pts:.6f}*PTS[v]',
        '-map', '[v]', '-map', '1:a',
        '-c:v', 'libx264', '-c:a', 'aac', '-shortest', out
    ], check=True)
    print(f'OK {s}')

# Concatenar video final
cd merged/
printf "file '%s'\\n" *_merged.mp4 > concat_list.txt
ffmpeg -y -f concat -safe 0 -i concat_list.txt -c copy ../video_final_con_voz.mp4
print("Video final generado: video_final_con_voz.mp4")
`;
}

function generateReadme(projectTitle, scenes) {
    return `PROYECTO MANIM + NARRACIÓN: ${projectTitle}
================================================

Generado automáticamente desde PDF.

ESTRUCTURA DEL PROYECTO
-----------------------
${scenes.map(s => `${s.name}.py\n${s.name}_narracion.txt`).join('\n')}
merge_video.py

INSTRUCCIONES
-------------
1. Instalar dependencias:
   pip install manim edge-tts

2. Generar audio TTS para cada escena:
   for scene in ${scenes.map(s => s.name).join(' ')}; do
       edge-tts --voice es-MX-JorgeNeural \\
           --file \${scene}_narracion.txt \\
           --write-media \${scene}_narracion.mp3
   done

3. Renderizar escenas Manim:
   for scene in ${scenes.map(s => s.name).join(' ')}; do
       manim -qm --fps 24 \${scene}.py \${scene}
   done

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
[ ] Audio .mp3 generado con es-MX-JorgeNeural
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
async function generateManimProject() {
    const btn = document.getElementById('manimGenerateBtn');
    const logs = document.getElementById('manimLogs');
    const preview = document.getElementById('manimPreview');
    const resultArea = document.getElementById('manimResult');
    const wordsPerScene = parseInt(document.getElementById('manimWordsPerScene').value) || 150;
    const projectTitle = document.getElementById('manimProjectTitle').value || 'ProyectoNarracion';
    const autoDetectChapters = document.getElementById('manimAutoDetectChapters').checked;
    const splitByPages = document.getElementById('manimSplitByPages').checked;

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
        let scenes = [];

        if (splitByPages) {
            // One scene per page
            for (let i = 1; i <= manimState.totalPages; i++) {
                const text = manimState.textByPage[i] || '';
                if (!text.trim()) continue;
                const formatted = formatNarrationText(text);
                const name = generateSceneName(scenes.length, `Pagina_${i}`);
                scenes.push({
                    name: name,
                    narration: formatted,
                    pageStart: i,
                    pageEnd: i,
                    wordCount: formatted.split(/\s+/).length
                });
            }
        } else if (autoDetectChapters && manimState.totalPages > 1) {
            const chapters = detectChaptersFromText(manimState.textByPage);
            for (const chapter of chapters) {
                let chapterText = '';
                for (let p = chapter.startPage; p <= chapter.endPage; p++) {
                    chapterText += ' ' + (manimState.textByPage[p] || '');
                }
                chapterText = chapterText.trim();
                if (!chapterText) continue;

                const chapterScenes = splitTextIntoScenes(chapterText, wordsPerScene);
                chapterScenes.forEach((sceneText, idx) => {
                    const formatted = formatNarrationText(sceneText);
                    const name = generateSceneName(scenes.length, idx === 0 ? chapter.title : `${chapter.title}_cont`);
                    scenes.push({
                        name: name,
                        narration: formatted,
                        pageStart: chapter.startPage,
                        pageEnd: chapter.endPage,
                        wordCount: formatted.split(/\s+/).length
                    });
                });
            }
        } else {
            // Flat: all text into scenes by word count
            let allText = '';
            for (let i = 1; i <= manimState.totalPages; i++) {
                allText += ' ' + (manimState.textByPage[i] || '');
            }
            const flatScenes = splitTextIntoScenes(allText.trim(), wordsPerScene);
            flatScenes.forEach((sceneText, idx) => {
                const formatted = formatNarrationText(sceneText);
                const name = generateSceneName(idx, `Escena_${idx + 1}`);
                scenes.push({
                    name: name,
                    narration: formatted,
                    pageStart: 1,
                    pageEnd: manimState.totalPages,
                    wordCount: formatted.split(/\s+/).length
                });
            });
        }

        if (scenes.length === 0) {
            logs.textContent = 'No se pudo extraer texto del documento.';
            showToast('No se encontró texto en el PDF', 'error');
            btn.disabled = false;
            btn.textContent = '🎬 Generar Proyecto Manim';
            return;
        }

        manimState.scenes = scenes;
        logs.textContent = `Generadas ${scenes.length} escenas. Creando archivos...`;

        // Build ZIP
        const zip = new JSZip();
        const projectFolder = zip.folder(projectTitle);
        const mergedFolder = projectFolder.folder('merged');

        scenes.forEach((scene, idx) => {
            const pyContent = generateScenePy(scene.name, scene.narration, idx === 0, idx === scenes.length - 1);
            projectFolder.file(`${scene.name}.py`, pyContent);
            projectFolder.file(`${scene.name}_narracion.txt`, scene.narration);
        });

        projectFolder.file('merge_video.py', generateMergeScript(scenes));
        projectFolder.file('README.txt', generateReadme(projectTitle, scenes));
        projectFolder.file('helpers.py', `# helpers.py - Funciones compartidas (opcional)
from manim import *

# Añade aquí utilidades reutilizables entre escenas
`);

        // Also add a batch script for convenience
        projectFolder.file('generar_audio.sh', `#!/bin/bash
# Generar audio TTS para todas las escenas
VENV=/home/john/EnjambreManim_Super1/venv/bin

export LD_PRELOAD=/lib/x86_64-linux-gnu/libglib-2.0.so.0:/lib/x86_64-linux-gnu/libgobject-2.0.so.0

for scene in ${scenes.map(s => s.name).join(' ')}; do
    echo "Generando audio para: \$scene"
    \$VENV/edge-tts --voice es-MX-JorgeNeural \\
        --file \${scene}_narracion.txt \\
        --write-media \${scene}_narracion.mp3
done

echo "Todos los audios generados."
`);

        projectFolder.file('renderizar.sh', `#!/bin/bash
# Renderizar todas las escenas Manim
export LD_PRELOAD=/lib/x86_64-linux-gnu/libglib-2.0.so.0:/lib/x86_64-linux-gnu/libgobject-2.0.so.0

for scene in ${scenes.map(s => s.name).join(' ')}; do
    echo "Renderizando: \$scene"
    manim -qm --fps 24 \${scene}.py \${scene}
done

echo "Renderizado completo. Ejecuta python merge_video.py para unir."
`);

        manimState.zipBlob = await zip.generateAsync({ type: 'blob' });

        displayManimScenes(scenes);
        preview.style.display = 'block';
        logs.textContent = `Proyecto listo: ${scenes.length} escenas, ${scenes.reduce((a, s) => a + s.wordCount, 0)} palabras totales.`;
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
        item.style.cssText = 'padding: 12px; margin-bottom: 10px; background: white; border: 1px solid var(--border); border-radius: 4px;';
        if (document.body.classList.contains('dark')) {
            item.style.background = '#0f172a';
        }

        const wordCount = scene.wordCount;
        const statusColor = wordCount >= 100 && wordCount <= 190 ? 'var(--success)' : 'var(--warning)';

        item.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 4px; display: flex; justify-content: space-between;">
                <span>${scene.name}</span>
                <span style="color: ${statusColor}; font-size: 0.85rem;">${wordCount} palabras</span>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 6px;">
                Páginas ${scene.pageStart}-${scene.pageEnd}
            </div>
            <details>
                <summary style="font-size: 0.8rem; color: var(--primary); cursor: pointer;">Ver narración</summary>
                <div style="margin-top: 6px; padding: 8px; background: #f8fafc; border-radius: 4px; font-size: 0.85rem; color: var(--text-main); max-height: 120px; overflow-y: auto;">
                    ${scene.narration.substring(0, 300)}${scene.narration.length > 300 ? '...' : ''}
                </div>
            </details>
        `;
        list.appendChild(item);
    });
}

function cancelManim() {
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

    const projectTitle = document.getElementById('manimProjectTitle').value || 'ProyectoNarracion';
    const url = URL.createObjectURL(manimState.zipBlob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectTitle}_manim.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    // Schedule revoke after download starts
    setTimeout(() => URL.revokeObjectURL(url), 30000);

    document.getElementById('manimResult').style.display = 'block';
    showToast('Descarga iniciada', 'success');
}
