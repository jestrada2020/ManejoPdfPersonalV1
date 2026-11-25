// ==========================================
// Guía del usuario: buscador de herramientas, explicación de cada pestaña
// (panel de ayuda), flujos de trabajo, solución de problemas y enlaces
// directos (#id-de-pestaña) a cada herramienta.
// ==========================================

const GUIDE_CATEGORIES = [
    { id: 'organizar', icon: '🗂️', name: 'Organizar páginas',
      desc: 'Para armar, dividir y reordenar documentos: unir archivos, sacar páginas, separar por capítulos o insertar hojas entre otras.' },
    { id: 'proteger', icon: '🔐', name: 'Archivos protegidos',
      desc: 'Para PDF con contraseña o restricciones que no dejan copiar, imprimir o extraer páginas. Desbloquee primero y luego use las demás herramientas.' },
    { id: 'editar', icon: '✏️', name: 'Editar y anotar',
      desc: 'Para corregir, marcar y firmar: resaltar y comentar un documento, o cambiar textos y fechas conservando el formato original.' },
    { id: 'idiomas', icon: '🌐', name: 'Traducir y leer',
      desc: 'Para entender y estudiar textos en otro idioma: traducción por selección o por párrafo, lectura en voz alta y práctica de vocabulario.' },
    { id: 'audio', icon: '🎧', name: 'Audio y video',
      desc: 'Para enriquecer el PDF con enlaces a videos, audios grabados o generados por voz, y para convertir un documento en un video narrado.' }
];

// is: qué es · what: qué hace · steps: cómo usarla · best: cómo sacarle provecho
// tip: consejo corto de la tarjeta · related: pestañas que combinan bien
const GUIDE_TOOLS = [
    {
        id: 'merge', cat: 'organizar', icon: '➕', name: 'Unir PDFs',
        is: 'Un unificador de archivos PDF.',
        what: 'Combina varios PDF en uno solo, en el orden de la lista.',
        steps: ['Seleccione o arrastre varios PDF.', 'Revise el orden de la lista.', 'Escriba el nombre del archivo y pulse «Unir PDFs Seleccionados».'],
        best: ['Nombre los archivos con números (01_, 02_…) antes de seleccionarlos para que queden en orden.', 'Arrastre todos los archivos a la vez sobre la ventana: se agregan juntos.', 'Si alguno está protegido, desbloquéelo antes en «Desbloquear PDF».'],
        tip: 'Puede arrastrar varios archivos a la vez sobre la ventana.',
        related: ['unlock', 'interleave', 'merge-sequence'],
        keys: 'juntar combinar concatenar varios archivos uno solo'
    },
    {
        id: 'extract', cat: 'organizar', icon: '✂️', name: 'Extraer por Rango',
        is: 'Un recortador de páginas consecutivas.',
        what: 'Saca un bloque continuo de páginas (por ejemplo, de la 5 a la 12) a un PDF nuevo.',
        steps: ['Cargue el PDF.', 'Indique página de inicio y final.', 'Pulse «Extraer Páginas» y descargue.'],
        best: ['Use el número de página del visor de PDF, no el impreso en la hoja (pueden diferir).', 'Úsela antes que las demás herramientas con PDF muy grandes: trabajar con menos páginas es más rápido.', '«Modo Compatibilidad» convierte las páginas en imagen: úselo solo si hay error, porque el texto deja de ser seleccionable.'],
        tip: 'Si sale un error de contraseña, active «Modo Compatibilidad».',
        related: ['extract-sequence', 'search', 'unlock'],
        keys: 'sacar recortar separar paginas rango dividir'
    },
    {
        id: 'extract-sequence', cat: 'organizar', icon: '📚', name: 'Extraer por Secuencia',
        is: 'Un divisor de PDF en varios archivos a la vez.',
        what: 'Divide un PDF en varios archivos de una sola vez: cada rango genera su propio PDF con el nombre que usted elija.',
        steps: ['Cargue el PDF.', 'Pulse «+ Agregar Rango» por cada archivo que quiera (inicio, fin y nombre).', 'Pulse «Extraer Secuencia» y luego «Extraer Todos los Rangos».'],
        best: ['Dé un nombre claro a cada rango (Unidad_1, Grupo_A…): así queda listo para enviar.', 'Ideal para separar un libro en unidades o un examen por estudiante.', 'Si las divisiones son capítulos con título, pruebe «Extracción de Capítulos», que las detecta sola.'],
        tip: 'Ideal para separar un libro en unidades o un examen por estudiante.',
        related: ['chapters', 'extract', 'merge-sequence'],
        keys: 'dividir separar varios archivos partes unidades lote'
    },
    {
        id: 'merge-sequence', cat: 'organizar', icon: '🧩', name: 'Unir Secuencia',
        is: 'Un reordenador de páginas de un mismo PDF.',
        what: 'Toma varios rangos de un mismo PDF y los junta, en el orden que usted indique, en un único archivo.',
        steps: ['Cargue el PDF.', 'Agregue los rangos en el orden final deseado (por ejemplo 10–12, luego 1–3).', 'Pulse «Unificar Secuencia».'],
        best: ['Sirve para reordenar páginas o armar un resumen con partes sueltas.', 'Puede repetir un rango (por ejemplo, la portada al inicio y al final).', 'Para juntar archivos distintos use «Unir PDFs».'],
        tip: 'Sirve para reordenar páginas o armar un resumen con partes sueltas.',
        related: ['merge', 'extract-sequence'],
        keys: 'reordenar ordenar seleccionar paginas sueltas resumen'
    },
    {
        id: 'interleave', cat: 'organizar', icon: '📑', name: 'Intercalar PDF',
        is: 'Un insertador de hojas entre las páginas de otro PDF.',
        what: 'Inserta otro PDF (completo o un rango) cada N hojas del PDF de origen, o después de páginas concretas.',
        steps: ['Cargue el PDF de origen y el PDF a intercalar (también con Ctrl+V).', 'Elija «cada cierto número de hojas» o «después de páginas específicas» (0 = antes de la página 1).', 'Pulse «Vista previa del orden» y luego «Intercalar PDF».'],
        best: ['Revise siempre la «Vista previa del orden» antes de generar el archivo.', 'Ejemplos: una hoja de respuestas cada 2 páginas, un separador por unidad o una portada al inicio (página 0).', 'Active «Ajustar las hojas…» si un PDF es carta y el otro A4.'],
        tip: 'Active «Ajustar las hojas…» si un PDF es carta y el otro A4.',
        related: ['merge', 'merge-sequence'],
        keys: 'insertar hoja separador portada respuestas cada n paginas mezclar'
    },
    {
        id: 'search', cat: 'organizar', icon: '🔎', name: 'Extraer por Búsqueda',
        is: 'Un buscador que extrae páginas por su contenido.',
        what: 'Busca una palabra o frase y extrae solo las páginas donde aparece.',
        steps: ['Cargue el PDF.', 'Escriba el texto (no distingue mayúsculas ni acentos).', 'Pulse «Buscar Páginas», marque las que quiera y «Extraer Páginas Seleccionadas».'],
        best: ['Busque términos poco comunes (un nombre, un código) para obtener menos páginas y más precisas.', 'Revise la lista y desmarque las páginas que no le sirvan antes de extraer.', 'Si el PDF es escaneado (imagen), la búsqueda no encuentra texto.'],
        tip: 'Si el PDF es escaneado (imagen), la búsqueda no encuentra texto.',
        related: ['extract', 'chapters'],
        keys: 'buscar palabra texto encontrar filtrar'
    },
    {
        id: 'chapters', cat: 'organizar', icon: '📖', name: 'Extracción de Capítulos',
        is: 'Un detector automático de capítulos.',
        what: 'Detecta automáticamente dónde empieza cada capítulo y genera un PDF por capítulo.',
        steps: ['Cargue el PDF.', 'Ajuste las palabras clave (Capítulo, Chapter, Unidad…).', 'Pulse «Detectar Capítulos» y luego «Extraer Todos los Capítulos».'],
        best: ['Escriba las palabras exactamente como aparecen en el libro (Unidad, Tema, Lección…).', 'Deje marcado «solo capítulos numerados» para que el índice no cuente como capítulo.', 'Si la detección falla, use «Extraer por Secuencia» con los rangos a mano.'],
        tip: 'Deje marcado «solo capítulos numerados» para evitar falsos positivos.',
        related: ['extract-sequence', 'unlock'],
        keys: 'capitulos libro unidades temas dividir automatico'
    },
    {
        id: 'unlock', cat: 'proteger', icon: '🔓', name: 'Desbloquear PDF',
        is: 'Un removedor de restricciones de PDF.',
        what: 'Quita restricciones (impresión, copia, edición) de un PDF para poder trabajarlo en las demás pestañas.',
        steps: ['Cargue el PDF protegido.', 'Escriba la contraseña si la tiene.', 'Pulse «Desbloquear PDF» y descargue.'],
        best: ['Úselo como primer paso cuando otra pestaña diga «Este PDF está cifrado/protegido».', 'Si el modo normal no basta, active «Modo Avanzado»: el archivo queda más pesado y como imagen.', 'Para más de 100 páginas active «Modo Ahorro de Memoria».'],
        tip: 'Si no funciona, active «Modo Avanzado»; para más de 100 páginas, «Modo Ahorro de Memoria».',
        related: ['extract', 'chapters', 'merge'],
        keys: 'contraseña protegido cifrado restriccion clave quitar seguridad'
    },
    {
        id: 'annotate', cat: 'editar', icon: '🖍️', name: 'Anotar / Revisar',
        is: 'Un marcador y corrector de documentos.',
        what: 'Resalta, subraya, tacha, escribe texto, añade notas, flechas, rectángulos, círculos o dibujo libre.',
        steps: ['Cargue el PDF y pulse «Comenzar Revisión».', 'Elija herramienta, color, fuente y grosor en la barra superior.', 'Pulse «Guardar PDF» en la misma barra.'],
        best: ['Use un color por tipo de comentario (rojo = error, amarillo = importante, verde = bien).', '↶ deshace, 🗑️ limpia la página y 🧹 borra una anotación con un clic.', 'Para cambiar el texto original (no solo marcarlo) use «Recuperar formato».'],
        tip: '↶ deshace, 🗑️ limpia la página y 🧹 borra una anotación con un clic.',
        related: ['recuperar-formato', 'media'],
        keys: 'resaltar subrayar marcar corregir revisar comentar dibujar'
    },
    {
        id: 'recuperar-formato', cat: 'editar', icon: '🖋️', name: 'Recuperar formato (editar y firmar)',
        is: 'Un editor de texto de PDF que conserva el formato, con firma digital.',
        what: 'Cambia título, fecha y enunciados conservando la fuente y el formato; agrega notas, cubre zonas e inserta o dibuja firmas.',
        steps: ['Cargue el PDF.', 'Use «Editar texto», «Agregar nota», «Cubrir zona», «Imagen / firma» o «Dibujar firma» y haga clic en la página.', 'Revise la lista «Cambios» y pulse «Guardar PDF».'],
        best: ['Use los campos «Título» y «Fecha» del panel para cambiarlos en un paso.', 'La pestaña avisa si el texto nuevo pisa otro contenido: revíselo antes de guardar.', 'La firma se coloca sola sobre «Firma: ____» o sobre la línea de firma (______); si no hay, queda abajo al centro. Arrástrela a su sitio y cambie el tamaño desde la esquina.', 'Para ponerla en un punto exacto (u otra página), pulse «Colocar otra vez» y haga clic donde la quiera.', 'Pegue una firma copiada con Ctrl+V.', 'Los PDF con credenciales de contenido (C2PA, frecuentes en documentos hechos con IA) se normalizan al abrirlos; las credenciales no se conservan.', 'En PDF hechos con LaTeX las tildes se reconocen bien al editar («Triángulos»).'],
        tip: 'La firma se coloca sola sobre la línea de firma; con «Colocar otra vez» y un clic la pone donde usted quiera.',
        related: ['annotate', 'extract-sequence'],
        keys: 'editar cambiar texto fecha titulo firma firmar firma digital imagen tapar cubrir formato linea de firma colocar c2pa latex tildes'
    },
    {
        id: 'media', cat: 'audio', icon: '🎬', name: 'Añadir Videos / Audio',
        is: 'Un insertador de enlaces multimedia en el PDF.',
        what: 'Coloca enlaces clicables a videos de YouTube, audios y páginas web dentro del PDF.',
        steps: ['Cargue el PDF y pulse «Añadir Multimedia».', 'Elija 📺 Video, 🔊 Audio o 🔗 Enlace y haga clic en la página.', 'Pegue la dirección y pulse «Guardar PDF».'],
        best: ['Ponga el enlace junto al tema que explica, para que el estudiante lo encuentre en contexto.', 'Pruebe los enlaces abriendo el PDF guardado antes de compartirlo.', 'Para que el audio quede dentro del archivo (sin internet), use «Podcast» o «Texto a Podcast».'],
        tip: 'Los enlaces se abren al hacer clic en el lector de PDF del estudiante.',
        related: ['podcast', 'tts-podcast', 'annotate'],
        keys: 'youtube video enlace link url multimedia clase'
    },
    {
        id: 'podcast', cat: 'audio', icon: '🎙️', name: 'Podcast (grabar voz)',
        is: 'Una grabadora de voz que adjunta el audio al PDF.',
        what: 'Graba su voz con el micrófono (o sube un audio) y lo adjunta al PDF con un icono en la página.',
        steps: ['Cargue el PDF.', 'Pulse «Grabar», luego «Parar» y «Usar Audio» (o suba un archivo).', 'Pulse «Colocar en PDF», haga clic en la página y «Guardar PDF».'],
        best: ['Escuche la pre-escucha antes de pulsar «Usar Audio».', 'Grabe explicaciones cortas (1–3 minutos) por tema: pesan menos y se escuchan más.', 'El navegador pedirá permiso para usar el micrófono: acéptelo.'],
        tip: 'El navegador pedirá permiso para usar el micrófono.',
        related: ['tts-podcast', 'media'],
        keys: 'grabar microfono voz audio explicacion adjuntar'
    },
    {
        id: 'tts-podcast', cat: 'audio', icon: '🔊', name: 'Texto a Podcast',
        is: 'Un conversor de texto a voz que adjunta el audio al PDF.',
        what: 'Convierte un texto escrito en audio y lo adjunta al PDF.',
        steps: ['Cargue el PDF y escriba el texto.', 'Elija el idioma y pulse «Generar Audio».', 'Pulse «Colocar en PDF», haga clic en la página y «Guardar PDF».'],
        best: ['Escriba frases cortas y con puntuación: la voz suena más natural.', 'Elija el idioma del texto, no el del estudiante.', 'Si el servidor de voz falla, suba su propio MP3 en el paso 2.'],
        tip: 'Si el servidor de voz falla, suba su propio MP3 en el paso 2.',
        related: ['podcast', 'media'],
        keys: 'texto a voz tts audio narrar leer convertir'
    },
    {
        id: 'manim-narrator', cat: 'audio', icon: '🎥', name: 'Narración de Documentos (Manim)',
        is: 'Un generador de proyectos de video narrado.',
        what: 'Divide el texto de un PDF en escenas narradas y descarga un proyecto ZIP listo para hacer un video con Manim y edge-tts.',
        steps: ['Cargue el PDF.', 'Ajuste palabras por escena (100–190), narrador, velocidad y tono; pruebe con «Probar narrador».', 'Pulse «Generar Proyecto Manim» y «Descargar ZIP del Proyecto».'],
        best: ['Extraiga antes solo las páginas del tema: menos texto = video más corto y enfocado.', 'Una velocidad de -5 % a -10 % suena más natural para explicar.', 'El narrador elegido se usa también en el Lector, el Traductor y el Lector Vocabulario.'],
        tip: 'En el equipo necesita Manim, edge-tts (≥ 7.3) y ffmpeg para renderizar.',
        related: ['search', 'extract'],
        keys: 'video manim narracion escenas animacion edge-tts zip'
    },
    {
        id: 'translate', cat: 'idiomas', icon: '🌍', name: 'Traductor / Lector',
        is: 'Un visor de PDF con traductor y lectura en voz alta.',
        what: 'Visor de PDF donde selecciona texto para traducirlo a 8 idiomas o escucharlo en voz alta.',
        steps: ['Cargue el PDF.', 'Seleccione texto con el mouse en la página.', 'Pulse «Traducir Selección» o «▶️ Leer».'],
        best: ['Seleccione frases completas, no palabras sueltas: la traducción es más precisa.', 'Use «Ajustar Ancho» y + / − para leer cómodo.', 'Para leer todo el documento párrafo por párrafo use «Inglés → Español» o «Español → Inglés».'],
        tip: 'Cambie de página con ⏮️ ⏭️ en la parte inferior.',
        related: ['translate-en-es', 'vocab-reader'],
        keys: 'traducir seleccion leer voz idiomas frances aleman chino japones'
    },
    {
        id: 'translate-en-es', cat: 'idiomas', icon: '🇪🇸', name: 'Inglés → Español',
        is: 'Un traductor de PDF del inglés al español, párrafo por párrafo.',
        what: 'Traduce el PDF párrafo por párrafo del inglés al español y lo pronuncia.',
        steps: ['Cargue el PDF en inglés.', 'Elija un párrafo de la lista (o use ⬆️ ⬇️).', 'Lea la traducción y pulse «🔊 Pronunciar».'],
        best: ['Avance con ⬆️ ⬇️ para leer el texto en orden, comparando original y traducción.', 'Si la página es escaneada, pulse «🔎 OCR esta página».', 'Después practique la pronunciación con el «Lector Vocabulario».'],
        tip: 'Si la página es escaneada, pulse «🔎 OCR esta página».',
        related: ['vocab-reader', 'translate-es-en'],
        keys: 'ingles español traduccion parrafo ocr escaneado'
    },
    {
        id: 'translate-es-en', cat: 'idiomas', icon: '🇬🇧', name: 'Español → Inglés',
        is: 'Un traductor de PDF del español al inglés, párrafo por párrafo.',
        what: 'Traduce el PDF párrafo por párrafo del español al inglés y lo pronuncia.',
        steps: ['Cargue el PDF en español.', 'Elija un párrafo de la lista (o use ⬆️ ⬇️).', 'Lea la traducción y pulse «🔊 Pronunciar».'],
        best: ['Útil para preparar resúmenes o abstracts en inglés: copie la traducción párrafo por párrafo.', 'Si la página es escaneada, pulse «🔎 OCR esta página».', 'Escuche la pronunciación con «🔊 Pronunciar» para practicar.'],
        tip: 'Si la página es escaneada, pulse «🔎 OCR esta página».',
        related: ['translate-en-es', 'vocab-reader'],
        keys: 'español ingles traduccion parrafo ocr escaneado'
    },
    {
        id: 'vocab-reader', cat: 'idiomas', icon: '📖', name: 'Lector Vocabulario',
        is: 'Un lector bilingüe tipo karaoke para aprender idiomas.',
        what: 'Lee el PDF en voz alta resaltando cada frase o palabra (modo karaoke) y muestra su traducción al lado.',
        steps: ['Cargue el PDF.', 'Elija idioma del PDF, idioma de narración y modo (frase o palabra).', 'Pulse «▶️ Leer»; use «🔍 Visor» para ver la página ampliada.'],
        best: ['Empiece en «Frase por frase» y pase a «Palabra por palabra» para el vocabulario difícil.', 'Baje la velocidad (0.7x–0.8x) al principio.', 'Atajos: Espacio = reproducir/pausar, ← → = anterior/siguiente, Esc = cerrar visor.'],
        tip: 'Atajos: Espacio = reproducir/pausar, ← → = anterior/siguiente, Esc = cerrar visor.',
        related: ['translate-en-es', 'translate'],
        keys: 'vocabulario karaoke aprender idioma leer palabra frase estudiante'
    }
];

// Flujos de trabajo: combinaciones de pestañas para tareas frecuentes.
const GUIDE_FLOWS = [
    { icon: '🔐', title: 'PDF protegido que no deja extraer', steps: ['unlock', 'extract'], note: 'Primero quite la protección y luego trabaje el archivo desbloqueado.' },
    { icon: '👩‍🏫', title: 'Preparar material de clase', steps: ['extract', 'annotate', 'media', 'podcast'], note: 'Saque el tema, márquelo, agregue el video y una explicación con su voz.' },
    { icon: '📝', title: 'Actualizar un taller o examen del año pasado', steps: ['recuperar-formato', 'extract-sequence'], note: 'Cambie fecha y enunciados sin perder el formato y luego sepárelo por grupos.' },
    { icon: '📗', title: 'Dividir un libro por capítulos', steps: ['unlock', 'chapters'], note: 'Si el libro está protegido, desbloquéelo antes de detectar capítulos.' },
    { icon: '🗣️', title: 'Estudiar un texto en otro idioma', steps: ['translate-en-es', 'vocab-reader'], note: 'Entienda el texto párrafo por párrafo y luego practique la lectura en voz alta.' },
    { icon: '🎞️', title: 'Convertir un documento en video narrado', steps: ['search', 'manim-narrator'], note: 'Extraiga las páginas del tema y genere el proyecto de video.' }
];

// Problemas frecuentes y la pestaña que los resuelve.
const GUIDE_FAQ = [
    { q: 'Sale «Este PDF está cifrado/protegido».', a: 'Active «Modo Compatibilidad» en la pestaña que esté usando, o desbloquee el archivo primero.', link: 'unlock' },
    { q: 'La búsqueda, la traducción o la edición no encuentran texto.', a: 'El PDF es probablemente escaneado (imágenes). En Inglés → Español y Español → Inglés use «OCR esta página»; en Recuperar formato puede agregar notas y cubrir zonas.', link: 'translate-en-es' },
    { q: 'El navegador se pone lento con un PDF muy grande.', a: 'Extraiga primero solo las páginas que necesita, o use «Modo Ahorro de Memoria» al desbloquear.', link: 'extract' },
    { q: '«Generar Audio» no funciona en Texto a Podcast.', a: 'El servidor de voz externo puede estar caído: la app usa la voz del navegador. Para adjuntar el audio, suba un MP3 propio.', link: 'tts-podcast' },
    { q: 'La voz suena robótica.', a: 'Elija otro narrador en Narración de Documentos («Probar narrador»). La elección se guarda y la usan también el Lector, el Traductor y el Lector Vocabulario. En Edge suenan más naturales.', link: 'manim-narrator' },
    { q: 'Los dos PDF que intercalo tienen tamaños distintos.', a: 'Marque «Ajustar las hojas insertadas al tamaño de las páginas del origen».', link: 'interleave' },
    { q: 'La firma no aparece o los cambios no se ven en Recuperar formato.', a: 'Mire el mensaje en la barra superior del visor. Si la pestaña se comporta como una versión anterior, recargue con Ctrl+Shift+R. Los PDF con credenciales de contenido (C2PA) ya se normalizan solos al abrirlos.', link: 'recuperar-formato' },
    { q: 'La firma quedó en un lugar equivocado.', a: 'Arrástrela a su sitio (la esquina cambia el tamaño), o pulse «Colocar otra vez» y haga clic donde la quiera; luego quite la anterior en «Cambios».', link: 'recuperar-formato' },
    { q: 'Al editar un PDF hecho con LaTeX salen «?» en lugar de tildes.', a: 'Ya está corregido: las tildes se unen a su letra. Si aún lo ve, recargue la página con Ctrl+Shift+R.', link: 'recuperar-formato' }
];

function guideToolById(id) {
    return GUIDE_TOOLS.find(t => t.id === id);
}

function guideCategoryById(id) {
    return GUIDE_CATEGORIES.find(c => c.id === id);
}

// Abre una pestaña y sube al inicio de la página.
function goToTool(tabId) {
    if (!document.getElementById(tabId)) return;
    closeToolHelp();
    if (location.hash !== '#' + tabId) {
        history.pushState(null, '', '#' + tabId);
    }
    switchTab(tabId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openGuide(focusSearch = true) {
    goToTool('guia-usuario');
    if (focusSearch) setTimeout(() => document.getElementById('guideSearch')?.focus(), 50);
}

// Botón «píldora» que abre la explicación de una herramienta (data-help).
function guideLink(id) {
    const t = guideToolById(id) || { icon: '❓', name: id };
    return `<a href="#${id}" class="guide-chip" data-help="${id}" title="Ver qué es y cómo se usa">${t.icon} ${escapeHtml(t.name)}</a>`;
}

// ==========================================
// Panel de ayuda de una herramienta (qué es, qué hace, cómo usarla)
// ==========================================
let guideHelpReturnFocus = null;

function showToolHelp(id) {
    const t = guideToolById(id);
    const panel = document.getElementById('guideHelp');
    if (!t || !panel) return;
    const cat = guideCategoryById(t.cat);
    const onThisTab = document.getElementById(id)?.classList.contains('active');

    document.getElementById('guideHelpBody').innerHTML = `
        <div class="guide-help-head">
            <span class="guide-help-icon">${t.icon}</span>
            <div>
                <small class="guide-help-cat">${cat.icon} ${escapeHtml(cat.name)}</small>
                <h3 id="guideHelpTitle">${escapeHtml(t.name)}</h3>
            </div>
        </div>
        <div class="guide-help-block">
            <h4>¿Qué es?</h4>
            <p>${escapeHtml(t.is)}</p>
        </div>
        <div class="guide-help-block">
            <h4>¿Qué hace?</h4>
            <p>${escapeHtml(t.what)}</p>
        </div>
        <div class="guide-help-block">
            <h4>¿Cómo se usa?</h4>
            <ol class="guide-steps">${t.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
        </div>
        <div class="guide-help-block guide-help-best">
            <h4>💡 Para sacarle el mejor provecho</h4>
            <ul>${t.best.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
        </div>
        ${t.related && t.related.length ? `
        <div class="guide-help-block">
            <h4>🔗 Combina bien con</h4>
            <div class="guide-help-related">${t.related.map(r => guideLink(r)).join('')}</div>
        </div>` : ''}
        <div class="guide-help-actions">
            ${onThisTab
                ? `<button type="button" class="btn" data-help-close>✅ Entendido, empezar</button>`
                : `<button type="button" class="btn" data-goto="${t.id}">Abrir ${escapeHtml(t.name)} →</button>`}
            <button type="button" class="btn guide-btn-secondary" data-open-guide>📘 Ver guía completa</button>
        </div>`;

    guideHelpReturnFocus = document.activeElement;
    panel.style.display = 'flex';
    panel.querySelector('.guide-help-box').scrollTop = 0;
    panel.querySelector('.guide-help-close')?.focus();
}

function closeToolHelp() {
    const panel = document.getElementById('guideHelp');
    if (!panel || panel.style.display === 'none') return;
    panel.style.display = 'none';
    if (guideHelpReturnFocus && document.contains(guideHelpReturnFocus)) guideHelpReturnFocus.focus();
    guideHelpReturnFocus = null;
}

// Barra «¿Qué es esta pestaña?» al inicio de cada herramienta.
function insertTabHelpBars() {
    GUIDE_TOOLS.forEach(t => {
        const tab = document.getElementById(t.id);
        if (!tab || tab.querySelector('.tab-help-bar')) return;
        const bar = document.createElement('div');
        bar.className = 'tab-help-bar';
        bar.innerHTML = `
            <span class="tab-help-text"><b>${t.icon} ${escapeHtml(t.name)}:</b> ${escapeHtml(t.what)}</span>
            <button type="button" class="tab-help-btn" data-help="${t.id}">ℹ️ Cómo usarla</button>`;

        // Pestañas con visor a pantalla completa: la barra va en el panel izquierdo.
        const side = tab.querySelector('.sidebar-controls');
        if (side) {
            bar.classList.add('tab-help-compact');
            const h3 = side.querySelector('h3');
            h3 ? h3.after(bar) : side.prepend(bar);
        } else if (t.id === 'recuperar-formato') {
            document.getElementById('rfStart')?.prepend(bar);
            // Con el PDF cargado: botón compacto en el panel lateral
            const panel = tab.querySelector('.rf-panel');
            if (panel) {
                const mini = bar.cloneNode(true);
                mini.classList.add('tab-help-compact');
                panel.prepend(mini);
            }
        } else {
            tab.prepend(bar);
        }
    });
}

// ==========================================
// Contenido de la guía
// ==========================================
function renderGuideCategoryNav() {
    const nav = document.getElementById('guideCatNav');
    if (!nav) return;
    nav.innerHTML = `<button type="button" class="guide-cat active" data-cat="all">Todas</button>` +
        GUIDE_CATEGORIES.map(c => `<button type="button" class="guide-cat" data-cat="${c.id}">${c.icon} ${escapeHtml(c.name)}</button>`).join('');
}

// Explicación de la categoría elegida, justo debajo de los botones.
function renderGuideCategoryInfo() {
    const box = document.getElementById('guideCatInfo');
    if (!box) return;
    const c = guideCategoryById(guideActiveCat);
    if (!c) {
        box.style.display = 'none';
        box.innerHTML = '';
        return;
    }
    const tools = GUIDE_TOOLS.filter(t => t.cat === c.id);
    box.innerHTML = `
        <div class="guide-cat-info-head">
            <b>${c.icon} ${escapeHtml(c.name)}</b>
            <span>${tools.length} herramienta${tools.length === 1 ? '' : 's'}</span>
        </div>
        <p>${escapeHtml(c.desc)}</p>
        <div class="guide-cat-info-tools">
            ${tools.map(t => `
                <button type="button" class="guide-cat-tool" data-help="${t.id}">
                    <span class="guide-cat-tool-name">${t.icon} ${escapeHtml(t.name)}</span>
                    <span class="guide-cat-tool-what">${escapeHtml(t.what)}</span>
                    <span class="guide-cat-tool-more">Ver qué es y cómo se usa →</span>
                </button>`).join('')}
        </div>`;
    box.style.display = 'block';
}

function renderGuideTools() {
    const box = document.getElementById('guideTools');
    if (!box) return;
    box.innerHTML = GUIDE_CATEGORIES.map(c => {
        const tools = GUIDE_TOOLS.filter(t => t.cat === c.id);
        return `
            <section class="guide-group" data-cat="${c.id}">
                <h3 class="guide-group-title">${c.icon} ${escapeHtml(c.name)}</h3>
                <div class="guide-cards">
                    ${tools.map(t => `
                        <article class="guide-card" data-cat="${t.cat}"
                            data-search="${escapeHtml(normalizeText([t.name, t.is, t.what, t.tip, t.keys, t.steps.join(' '), t.best.join(' ')].join(' ')))}">
                            <div class="guide-card-head">
                                <span class="guide-card-icon">${t.icon}</span>
                                <h4>${escapeHtml(t.name)}</h4>
                            </div>
                            <p class="guide-what">${escapeHtml(t.what)}</p>
                            <ol class="guide-steps">${t.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
                            <p class="guide-tip">💡 ${escapeHtml(t.tip)}</p>
                            <div class="guide-card-actions">
                                <button type="button" class="btn guide-btn-secondary" data-help="${t.id}">ℹ️ Más detalles</button>
                                <a href="#${t.id}" class="btn guide-go" data-goto="${t.id}">Abrir →</a>
                            </div>
                        </article>`).join('')}
                </div>
            </section>`;
    }).join('');
}

function renderGuideFlows() {
    const box = document.getElementById('guideFlows');
    if (!box) return;
    box.innerHTML = GUIDE_FLOWS.map(f => `
        <div class="guide-flow">
            <div class="guide-flow-title">${f.icon} ${escapeHtml(f.title)}</div>
            <div class="guide-flow-steps">
                ${f.steps.map((id, i) => `<span class="guide-flow-n">${i + 1}</span>${guideLink(id)}`).join('<span class="guide-arrow">→</span>')}
            </div>
            <small class="guide-flow-note">${escapeHtml(f.note)}</small>
        </div>`).join('');
}

function renderGuideFaq() {
    const box = document.getElementById('guideFaq');
    if (!box) return;
    box.innerHTML = GUIDE_FAQ.map(f => `
        <details class="guide-faq-item">
            <summary>${escapeHtml(f.q)}</summary>
            <p>${escapeHtml(f.a)}</p>
            ${guideLink(f.link)}
        </details>`).join('');
}

function renderGuideIndex() {
    const box = document.getElementById('guideIndex');
    if (!box) return;
    box.innerHTML = GUIDE_TOOLS.map(t => guideLink(t.id)).join('');
}

let guideActiveCat = 'all';

function filterGuide() {
    const input = document.getElementById('guideSearch');
    const q = normalizeText((input && input.value || '').trim());
    const words = q.split(/\s+/).filter(Boolean);
    let shown = 0;

    document.querySelectorAll('#guideTools .guide-card').forEach(card => {
        const catOk = guideActiveCat === 'all' || card.dataset.cat === guideActiveCat;
        const textOk = words.every(w => card.dataset.search.includes(w));
        const visible = catOk && textOk;
        card.style.display = visible ? '' : 'none';
        if (visible) shown++;
    });
    document.querySelectorAll('#guideTools .guide-group').forEach(g => {
        const any = Array.from(g.querySelectorAll('.guide-card')).some(c => c.style.display !== 'none');
        g.style.display = any ? '' : 'none';
    });

    const empty = document.getElementById('guideEmpty');
    if (empty) empty.style.display = shown ? 'none' : 'block';
    const count = document.getElementById('guideCount');
    if (count) {
        count.innerHTML = words.length
            ? `${shown} herramienta${shown === 1 ? '' : 's'} encontrada${shown === 1 ? '' : 's'} · <a href="#guideToolsSection" data-scroll-tools>ver resultados ↓</a>`
            : '';
    }
}

function scrollToGuideTools() {
    document.getElementById('guideToolsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initUserGuide() {
    if (!document.getElementById('guia-usuario')) return;
    renderGuideCategoryNav();
    renderGuideTools();
    renderGuideFlows();
    renderGuideFaq();
    renderGuideIndex();
    insertTabHelpBars();

    const search = document.getElementById('guideSearch');
    if (search) {
        search.addEventListener('input', filterGuide);
        search.addEventListener('keydown', (e) => {
            // Enter muestra la explicación de la primera herramienta encontrada
            if (e.key !== 'Enter') return;
            // Sin esto, el mismo Enter «pulsa» el botón ✕ que recibe el foco y cierra el panel
            e.preventDefault();
            const first = Array.from(document.querySelectorAll('#guideTools .guide-card'))
                .find(c => c.style.display !== 'none');
            if (first) showToolHelp(first.querySelector('[data-goto]').dataset.goto);
        });
    }

    document.getElementById('guideCatNav')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.guide-cat');
        if (!btn) return;
        guideActiveCat = btn.dataset.cat;
        document.querySelectorAll('#guideCatNav .guide-cat').forEach(b => b.classList.toggle('active', b === btn));
        renderGuideCategoryInfo();
        filterGuide();
    });

    // Delegación de clics para toda la app: explicación, abrir pestaña, abrir guía
    document.addEventListener('click', (e) => {
        const help = e.target.closest('[data-help]');
        if (help) {
            e.preventDefault();
            showToolHelp(help.dataset.help);
            return;
        }
        const go = e.target.closest('#guia-usuario [data-goto], #guideHelp [data-goto]');
        if (go) {
            e.preventDefault();
            goToTool(go.dataset.goto);
            return;
        }
        if (e.target.closest('[data-open-guide]')) {
            e.preventDefault();
            openGuide();
            return;
        }
        if (e.target.closest('[data-help-close]') || e.target.id === 'guideHelp') {
            closeToolHelp();
            return;
        }
        if (e.target.closest('[data-scroll-tools]')) {
            e.preventDefault();
            scrollToGuideTools();
        }
    });

    // Botón flotante ❓: en una herramienta explica esa pestaña; en la guía enfoca el buscador
    document.getElementById('guideFab')?.addEventListener('click', () => {
        const active = document.querySelector('.tab-content.active');
        if (active && guideToolById(active.id)) showToolHelp(active.id);
        else openGuide();
    });

    // Enlaces directos: index.html#interleave abre esa pestaña (sirve para marcadores)
    const openFromHash = () => {
        const id = decodeURIComponent(location.hash.slice(1));
        if (id && document.getElementById(id)?.classList.contains('tab-content')) {
            closeToolHelp();
            switchTab(id);
        }
    };
    window.addEventListener('popstate', openFromHash);
    window.addEventListener('hashchange', openFromHash);
    openFromHash();

    document.addEventListener('keydown', (e) => {
        // Esc cierra el panel de ayuda
        if (e.key === 'Escape' && document.getElementById('guideHelp')?.style.display === 'flex') {
            closeToolHelp();
            return;
        }
        // F1: explicación de la pestaña abierta; en la guía, enfoca el buscador
        if (e.key === 'F1') {
            e.preventDefault();
            const active = document.querySelector('.tab-content.active');
            if (active && guideToolById(active.id)) showToolHelp(active.id);
            else openGuide();
        }
    });
}

document.addEventListener('DOMContentLoaded', initUserGuide);
