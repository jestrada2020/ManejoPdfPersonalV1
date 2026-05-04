# Herramientas PDF Avanzadas

Aplicación web completa para manipular archivos PDF directamente en el navegador, sin necesidad de servidor. Incluye herramientas de edición, traducción, OCR, TTS y una integración especial con **Manim** para crear videos educativos narrados.

## 🚀 Características

### Manipulación de PDF
- **Unir PDFs**: Combina múltiples archivos en uno solo, con soporte para contraseñas.
- **Extraer por Rango**: Extrae páginas específicas con modo de compatibilidad (rasterización).
- **Extraer por Búsqueda**: Busca texto en el PDF y extrae las páginas coincidentes.
- **Extracción de Capítulos**: Detecta capítulos automáticamente por patrones y extrae cada uno.
- **Desbloquear PDF**: Elimina protecciones y restricciones de archivos PDF.

### Visualización y Anotación
- **Anotar / Revisar**: Resalta, subraya, tacha, dibuja flechas, añade notas y texto.
- **Añadir Videos / Audio**: Inserta enlaces de YouTube, audio y enlaces web como anotaciones clickeables.

### Traducción y Lectura
- **Traductor / Lector**: Visualizador de PDF con traducción por selección y lectura TTS (Text-to-Speech) del navegador.
- **Inglés → Español**: Traductor con OCR de respaldo y audio en español.
- **Español → Inglés**: Traductor con OCR de respaldo y audio en inglés.

### Audio y Podcast
- **Podcast Studio**: Graba audio desde el micrófono y adhiérelo al PDF como archivo adjunto.
- **Texto a Podcast**: Convierte texto a voz con Google TTS y adhiérelo al PDF.

### 📖 Lector Bilingüe / Vocabulario Interactivo
- **Lectura en voz alta** de cualquier PDF resaltando automáticamente la palabra o frase actual.
- **Modo Karaoke**: Sombrea visualmente el texto a medida que se lee, ayudando a seguir la lectura.
- **Modo Palabra por Palabra** o **Frase por Frase**: adaptable al nivel del estudiante.
- **Traducción en tiempo real** con cache inteligente. Muestra la traducción de cada palabra/frase en un panel lateral.
- **Stop words inteligentes**: omite artículos y preposiciones comunes para enfocarse en vocabulario útil.
- **Navegación con teclado**: Espacio = Play/Pausa, Flechas = navegar.
- Soporta cualquier combinación de idiomas (Inglés, Español, Francés, Alemán, Italiano, Portugués).

### 🎬 Narración de Documentos (Manim)
Nueva funcionalidad que integra el pipeline de **[manim-narracion](skills/manim-narracion.md)**:
- Extrae texto de cualquier PDF y lo divide en **escenas narradas** de ~100-190 palabras.
- Genera automáticamente:
  - Archivos `_narracion.txt` listos para **edge-tts** (voz `es-MX-JorgeNeural`).
  - Templates `.py` con la **paleta de colores oficial** del skill (`#050a1a`, `#00e5ff`, etc.).
  - Script `merge_video.py` para sincronizar audio y video con `setpts`.
  - Scripts `.sh` para generar audio y renderizar escenas.
- Exporta todo como un **ZIP descargable** listo para renderizar con Manim.

## 🛠️ Tecnologías

- [PDF-Lib](https://pdf-lib.js.org/) — Creación y modificación de PDFs.
- [PDF.js](https://mozilla.github.io/pdf.js/) — Renderizado de PDFs en canvas.
- [Tesseract.js](https://tesseract.projectnaptha.com/) — OCR en el navegador.
- [JSZip](https://stuk.github.io/jszip/) — Compresión de proyectos Manim.
- [Manim](https://www.manim.community/) — Animaciones matemáticas y educativas.

## 📦 Uso

Abre `index.html` en cualquier navegador moderno. No requiere instalación ni servidor.

```bash
# Opcional: servir localmente
npx serve .
```

### Uso del pipeline Manim
1. Ve a la pestaña **"Narración de Documentos"**.
2. Carga un PDF y configura las opciones (palabras por escena, detección de capítulos).
3. Haz clic en **"Generar Proyecto Manim"**.
4. Descarga el ZIP y extráelo.
5. Ejecuta los scripts `.sh` o sigue las instrucciones del `README.txt` incluido.

## 🎨 Temas

La aplicación soporta **modo oscuro** (toggle en la esquina inferior derecha). La preferencia se guarda en `localStorage`.

## 📁 Estructura

```
.
├── index.html
├── CSS/styles.css
├── JS/
│   ├── common.js           # Utilidades, toast, drag-drop, dark mode
│   └── tabs/
│       ├── merge.js
│       ├── extract.js
│       ├── search.js
│       ├── chapters.js
│       ├── unlock.js
│       ├── annotate.js
│       ├── media.js
│       ├── translate.js
│       ├── translator-engine.js   # Motor reutilizable de traducción
│       ├── translate-en-es.js
│       ├── translate-es-en.js
│       ├── podcast.js
│       ├── tts-podcast.js
│       └── manim-narrator.js    # Generador de proyectos Manim
```

## 📄 Licencia

MIT
