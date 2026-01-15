let annotState = {
    pdfDoc: null,
    file: null,
    totalPages: 0,
    currentPage: 1,
    scale: 1.5,
    tool: 'cursor',
    color: '#ffeb3b',
    font: 'Helvetica',
    fontSize: 12,
    lineWidth: 2,
    mode: 'annotate',
    annotations: [],
    isDrawing: false,
    startX: 0,
    startY: 0,
    drawPoints: []
};

function setTool(tool) {
    annotState.tool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    const toolMap = {
        cursor: 'btnToolCursor',
        highlight: 'btnToolHighlight',
        underline: 'btnToolUnderline',
        strikethrough: 'btnToolStrike',
        text: 'btnToolText',
        note: 'btnToolNote',
        arrow: 'btnToolArrow',
        rectangle: 'btnToolRect',
        circle: 'btnToolCircle',
        draw: 'btnToolDraw',
        eraser: 'btnToolEraser',
        eraserMedia: 'btnToolEraserMedia',
        youtube: 'btnToolYouTube',
        audio: 'btnToolAudio',
        link: 'btnToolLink',
        cursorMedia: 'btnToolCursorMedia'
    };

    if (toolMap[tool]) {
        const btnId = toolMap[tool];
        if (tool === 'eraser') {
            if (annotState.mode === 'media') {
                document.getElementById('btnToolEraserMedia').classList.add('active');
            } else {
                document.getElementById('btnToolEraser').classList.add('active');
            }
        } else if (tool === 'cursor') {
            if (annotState.mode === 'media') {
                document.getElementById('btnToolCursorMedia').classList.add('active');
            } else {
                document.getElementById('btnToolCursor').classList.add('active');
            }
        } else {
            const el = document.getElementById(btnId);
            if (el) el.classList.add('active');
        }
    }

    const layer = document.getElementById('annotationLayer');
    layer.style.cursor = tool === 'cursor' ? 'default' : 'crosshair';
}

function updateToolbarVisibility() {
    const annotTools = document.getElementById('annotationTools');
    const mediaTools = document.getElementById('mediaTools');

    if (annotState.mode === 'media') {
        annotTools.style.display = 'none';
        mediaTools.style.display = 'flex';
    } else {
        annotTools.style.display = 'flex';
        mediaTools.style.display = 'none';
    }
}

function setQuickColor(color) {
    annotState.color = color;
    document.getElementById('toolColor').value = color;
}

function undoAnnotation() {
    const pageAnnotations = annotState.annotations.filter(a => a.page ===
        annotState.currentPage);
    if (pageAnnotations.length > 0) {
        const lastAnnotation = pageAnnotations[pageAnnotations.length - 1];
        const index = annotState.annotations.indexOf(lastAnnotation);
        annotState.annotations.splice(index, 1);
        redrawAnnotations();
    }
}

function clearPageAnnotations() {
    if (confirm('¿Limpiar todas las anotaciones de esta página?')) {
        annotState.annotations = annotState.annotations.filter(a => a.page !==
            annotState.currentPage);
        redrawAnnotations();
    }
}

document.getElementById('toolColor').addEventListener('input', (e) => {
    annotState.color = e.target.value;
});

document.getElementById('toolFont').addEventListener('change', (e) => {
    annotState.font = e.target.value;
});

document.getElementById('toolSize').addEventListener('change', (e) => {
    annotState.fontSize = parseInt(e.target.value);
});

document.getElementById('toolWidth').addEventListener('change', (e) => {
    annotState.lineWidth = parseInt(e.target.value);
});

async function startAnnotation(mode = 'annotate') {
    const inputId = mode === 'media' ? 'mediaFileInput' : 'annotateFileInput';
    const input = document.getElementById(inputId);

    if (!input.files.length) return;
    annotState.file = input.files[0];
    annotState.mode = mode;

    try {
        const bytes = await readPdfBytes(annotState.file);
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        annotState.pdfDoc = await loadingTask.promise;
        annotState.totalPages = annotState.pdfDoc.numPages;
        annotState.currentPage = 1;
        annotState.annotations = [];

        updateToolbarVisibility();
        setTool('cursor');

        document.getElementById('annotationModal').style.display = 'flex';
        renderPage(annotState.currentPage);
    } catch (e) {
        console.error(e);
        alert("Error al cargar PDF: " + e.message);
    }
    input.value = '';
}

function closeModal() {
    document.getElementById('annotationModal').style.display = 'none';
}

async function changePage(delta) {
    if (!annotState.pdfDoc) return;
    const newPage = annotState.currentPage + delta;
    if (newPage >= 1 && newPage <= annotState.totalPages) {
        annotState.currentPage = newPage;
        renderPage(newPage);
    }
}

async function jumpToPage(val) {
    const pageNum = parseInt(val);
    if (pageNum >= 1 && pageNum <= annotState.totalPages) {
        annotState.currentPage = pageNum;
        renderPage(pageNum);
    } else {
        document.getElementById('pageNumberInput').value = annotState.currentPage;
    }
}

async function renderPage(pageNum) {
    if (!annotState.pdfDoc) return;

    document.getElementById('pageNumberInput').value = pageNum;
    document.getElementById('pageTotalLabel').textContent = `/ ${annotState.totalPages}`;

    const page = await annotState.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: annotState.scale });

    const canvas = document.getElementById('pdfCanvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const layer = document.getElementById('annotationLayer');
    layer.height = viewport.height;
    layer.width = viewport.width;

    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;

    redrawAnnotations();
}

function handleMouseDown(e) {
    if (annotState.tool === 'cursor') return;
    const layer = document.getElementById('annotationLayer');
    const rect = layer.getBoundingClientRect();
    annotState.startX = e.clientX - rect.left;
    annotState.startY = e.clientY - rect.top;

    if (['highlight', 'underline', 'strikethrough', 'arrow', 'rectangle', 'circle'].includes(annotState.tool)) {
        annotState.isDrawing = true;
    } else if (annotState.tool === 'draw') {
        annotState.isDrawing = true;
        annotState.drawPoints = [{ x: annotState.startX, y: annotState.startY }];
    } else if (['youtube', 'audio', 'link'].includes(annotState.tool)) {
        const url = prompt(annotState.tool === 'youtube' ? "Ingrese URL del Video de YouTube:" :
            annotState.tool === 'audio' ? "Ingrese URL del Archivo de Audio:"
                : "Ingrese Enlace Web:");
        if (url) {
            const w = annotState.tool === 'youtube' ? 120 : 60;
            const h = annotState.tool === 'youtube' ? 90 : 60;
            annotState.annotations.push({
                type: annotState.tool,
                page: annotState.currentPage,
                x: annotState.startX - w / 2,
                y: annotState.startY - h / 2,
                width: w,
                height: h,
                url: url,
                color: annotState.tool === 'link' ? '#0000ff' : '#ff0000',
                vWidth: layer.width,
                vHeight: layer.height
            });
            redrawAnnotations();
            setTool('cursor');
        }
    } else if (annotState.tool === 'eraser' || annotState.tool === 'eraserMedia') {
        const x = annotState.startX;
        const y = annotState.startY;
        for (let i = annotState.annotations.length - 1; i >= 0; i--) {
            const ann = annotState.annotations[i];
            if (ann.page !== annotState.currentPage) continue;
            if (isPointInAnnotation(x, y, ann)) {
                annotState.annotations.splice(i, 1);
                redrawAnnotations();
                break;
            }
        }
    } else if (annotState.tool === 'text') {
        const text = prompt("Ingrese texto:");
        if (text) {
            annotState.annotations.push({
                type: 'text',
                page: annotState.currentPage,
                x: annotState.startX,
                y: annotState.startY,
                text: text,
                color: annotState.color,
                font: annotState.font,
                fontSize: annotState.fontSize,
                vWidth: layer.width,
                vHeight: layer.height
            });
            redrawAnnotations();
        }
    } else if (annotState.tool === 'note') {
        const text = prompt("Ingrese nota:");
        if (text) {
            annotState.annotations.push({
                type: 'note',
                page: annotState.currentPage,
                x: annotState.startX,
                y: annotState.startY,
                text: text,
                color: annotState.color,
                fontSize: annotState.fontSize,
                vWidth: layer.width,
                vHeight: layer.height
            });
            redrawAnnotations();
        }
    }
}

function handleMouseMove(e) {
    if (!annotState.isDrawing) return;
    const layer = document.getElementById('annotationLayer');
    const rect = layer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (annotState.tool === 'draw') {
        annotState.drawPoints.push({ x: mouseX, y: mouseY });
    }
    redrawAnnotations();
    drawPreview(mouseX, mouseY);
}

function handleMouseUp(e) {
    if (!annotState.isDrawing) return;
    annotState.isDrawing = false;

    const layer = document.getElementById('annotationLayer');
    const rect = layer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const width = mouseX - annotState.startX;
    const height = mouseY - annotState.startY;

    const annotation = {
        type: annotState.tool,
        page: annotState.currentPage,
        x: Math.min(annotState.startX, mouseX),
        y: Math.min(annotState.startY, mouseY),
        width: Math.abs(width),
        height: Math.abs(height),
        color: annotState.color,
        lineWidth: annotState.lineWidth,
        vWidth: layer.width,
        vHeight: layer.height
    };

    if (annotState.tool === 'arrow') {
        annotation.x1 = annotState.startX;
        annotation.y1 = annotState.startY;
        annotation.x2 = mouseX;
        annotation.y2 = mouseY;
    } else if (annotState.tool === 'draw') {
        annotation.points = annotState.drawPoints;
        annotState.drawPoints = [];
    }

    if (annotation.width > 2 || annotation.height > 2 ||
        annotState.tool === 'draw' || annotState.tool === 'arrow') {
        annotState.annotations.push(annotation);
    }

    redrawAnnotations();
}

function isPointInAnnotation(x, y, ann) {
    const buffer = 5;
    if (ann.type === 'draw') {
        if (!ann.points) return false;
        for (const pt of ann.points) {
            if (Math.hypot(pt.x - x, pt.y - y) < 10) return true;
        }
        return false;
    }
    if (['youtube', 'audio', 'link'].includes(ann.type)) {
        return (x >= ann.x && x <= ann.x + ann.width &&
            y >= ann.y && y <= ann.y + ann.height);
    }
    if (ann.width !== undefined && ann.height !== undefined) {
        return (x >= ann.x - buffer && x <= ann.x + ann.width + buffer &&
            y >= ann.y - buffer && y <= ann.y + ann.height + buffer);
    }
    if (ann.type === 'text' || ann.type === 'note') {
        return (x >= ann.x && x <= ann.x + 100 && y >= ann.y - 20 && y <= ann.y + 5);
    }
    return false;
}

function drawPreview(mouseX, mouseY) {
    const layer = document.getElementById('annotationLayer');
    const ctx = layer.getContext('2d');
    const width = mouseX - annotState.startX;
    const height = mouseY - annotState.startY;

    ctx.save();
    ctx.strokeStyle = annotState.color;
    ctx.fillStyle = annotState.color;
    ctx.lineWidth = annotState.lineWidth;

    if (annotState.tool === 'highlight') {
        ctx.globalAlpha = 0.3;
        ctx.fillRect(annotState.startX, annotState.startY, width, height);
    } else if (annotState.tool === 'underline') {
        ctx.beginPath();
        ctx.moveTo(annotState.startX, annotState.startY + height);
        ctx.lineTo(mouseX, annotState.startY + height);
        ctx.stroke();
    } else if (annotState.tool === 'strikethrough') {
        const midY = annotState.startY + height / 2;
        ctx.beginPath();
        ctx.moveTo(annotState.startX, midY);
        ctx.lineTo(mouseX, midY);
        ctx.stroke();
    } else if (annotState.tool === 'arrow') {
        drawArrow(ctx, annotState.startX, annotState.startY, mouseX, mouseY, annotState.color);
    } else if (annotState.tool === 'rectangle') {
        ctx.strokeRect(annotState.startX, annotState.startY, width, height);
    } else if (annotState.tool === 'circle') {
        const radiusX = Math.abs(width) / 2;
        const radiusY = Math.abs(height) / 2;
        const centerX = annotState.startX + width / 2;
        const centerY = annotState.startY + height / 2;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
        ctx.stroke();
    } else if (annotState.tool === 'draw') {
        ctx.beginPath();
        if (annotState.drawPoints && annotState.drawPoints.length > 0) {
            ctx.moveTo(annotState.drawPoints[0].x, annotState.drawPoints[0].y);
            for (let i = 1; i < annotState.drawPoints.length; i++) {
                ctx.lineTo(annotState.drawPoints[i].x, annotState.drawPoints[i].y);
            }
            ctx.stroke();
        }
    }
    ctx.restore();
}

function drawArrow(ctx, x1, y1, x2, y2, color) {
    const headLength = 15;
    const angle = Math.atan2(y2 - y1, x2 - x1);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
}

function redrawAnnotations() {
    const layer = document.getElementById('annotationLayer');
    const ctx = layer.getContext('2d');
    ctx.clearRect(0, 0, layer.width, layer.height);

    annotState.annotations.forEach(ann => {
        if (ann.page !== annotState.currentPage) return;

        ctx.save();
        ctx.strokeStyle = ann.color;
        ctx.fillStyle = ann.color;
        ctx.lineWidth = ann.lineWidth || 2;

        if (ann.type === 'highlight') {
            ctx.globalAlpha = 0.3;
            ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
        } else if (ann.type === 'underline') {
            ctx.beginPath();
            ctx.moveTo(ann.x, ann.y + ann.height);
            ctx.lineTo(ann.x + ann.width, ann.y + ann.height);
            ctx.stroke();
        } else if (ann.type === 'strikethrough') {
            const midY = ann.y + ann.height / 2;
            ctx.beginPath();
            ctx.moveTo(ann.x, midY);
            ctx.lineTo(ann.x + ann.width, midY);
            ctx.stroke();
        } else if (ann.type === 'arrow') {
            drawArrow(ctx, ann.x1, ann.y1, ann.x2, ann.y2, ann.color);
        } else if (ann.type === 'rectangle') {
            ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
        } else if (ann.type === 'circle') {
            const radiusX = ann.width / 2;
            const radiusY = ann.height / 2;
            const centerX = ann.x + radiusX;
            const centerY = ann.y + radiusY;
            ctx.beginPath();
            ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
            ctx.stroke();
        } else if (ann.type === 'draw') {
            if (ann.points && ann.points.length > 1) {
                ctx.beginPath();
                ctx.moveTo(ann.points[0].x, ann.points[0].y);
                for (let i = 1; i < ann.points.length; i++) {
                    ctx.lineTo(ann.points[i].x, ann.points[i].y);
                }
                ctx.stroke();
            }
        } else if (ann.type === 'text') {
            const fontSize = ann.fontSize || 12;
            ctx.font = `${fontSize}px ${ann.font || 'Arial'}`;
            ctx.fillText(ann.text, ann.x, ann.y);
        } else if (ann.type === 'note') {
            const fontSize = ann.fontSize || 12;
            ctx.font = `bold ${fontSize}px Arial`;
            ctx.fillText("📝 " + ann.text, ann.x, ann.y);
        } else if (['youtube', 'audio', 'link'].includes(ann.type)) {
            const centerX = ann.x + ann.width / 2;
            const centerY = ann.y + ann.height / 2;

            ctx.fillStyle = ann.type === 'youtube' ? '#FF0000' :
                ann.type === 'audio' ? '#4CAF50' : '#2196F3';
            ctx.fillRect(ann.x, ann.y, ann.width, ann.height);

            ctx.strokeStyle = 'white';
            ctx.lineWidth = 3;
            ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);

            ctx.fillStyle = 'white';
            ctx.font = `${Math.min(ann.width, ann.height) / 2}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const symbol = ann.type === 'youtube' ? '▶️' :
                ann.type === 'audio' ? '🔊' : '🔗';
            ctx.fillText(symbol, centerX, centerY);
        }
        ctx.restore();
    });
}

async function saveAnnotations() {
    const mode = annotState.mode;
    const resultDivId = mode === 'media' ? 'mediaResult' : 'annotateResult';
    const downloadLinkId = mode === 'media' ? 'mediaDownload' : 'annotateDownload';
    const btnSelector = mode === 'media' ? '#mediaBtn' : '#annotateBtn';

    const btn = document.querySelector(btnSelector);
    const originalText = btn.textContent;
    btn.textContent = " Procesando...";
    btn.disabled = true;

    try {
        const bytes = await readPdfBytes(annotState.file);
        const pdfDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
        const newPdf = await PDFLib.PDFDocument.create();

        const fontMap = {
            'Helvetica': await newPdf.embedFont(PDFLib.StandardFonts.Helvetica),
            'Helvetica-Bold': await newPdf.embedFont(PDFLib.StandardFonts.HelveticaBold),
            'Helvetica-Oblique': await newPdf.embedFont(PDFLib.StandardFonts.HelveticaOblique),
            'Helvetica-BoldOblique': await newPdf.embedFont(PDFLib.StandardFonts.HelveticaBoldOblique),
            'Times-Roman': await newPdf.embedFont(PDFLib.StandardFonts.TimesRoman),
            'Times-Bold': await newPdf.embedFont(PDFLib.StandardFonts.TimesRomanBold),
            'Times-Italic': await newPdf.embedFont(PDFLib.StandardFonts.TimesRomanItalic),
            'Times-BoldItalic': await newPdf.embedFont(PDFLib.StandardFonts.TimesRomanBoldItalic),
            'Courier': await newPdf.embedFont(PDFLib.StandardFonts.Courier),
            'Courier-Bold': await newPdf.embedFont(PDFLib.StandardFonts.CourierBold),
            'Courier-Oblique': await newPdf.embedFont(PDFLib.StandardFonts.CourierOblique),
            'Courier-BoldOblique': await newPdf.embedFont(PDFLib.StandardFonts.CourierBoldOblique)
        };

        const pageIndices = pdfDoc.getPageIndices();
        const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
        copiedPages.forEach(page => newPdf.addPage(page));
        const pages = newPdf.getPages();

        for (const ann of annotState.annotations) {
            const pageIndex = ann.page - 1;
            if (pageIndex < 0 || pageIndex >= pages.length) continue;

            const page = pages[pageIndex];
            const { width, height } = page.getSize();
            const rotation = page.getRotation().angle;

            const rgb = ann.color ? hexToRgb(ann.color) : { r: 0, g: 0, b: 0 };
            const color = PDFLib.rgb(rgb.r, rgb.g, rgb.b);

            const vX1 = ann.x;
            const vY1 = ann.y;
            const vX2 = ann.x + (ann.width || 0);
            const vY2 = ann.y + (ann.height || 0);

            const p1 = transformCoordinates(vX1, vY1, ann.vWidth, ann.vHeight, width, height, rotation);
            const p2 = transformCoordinates(vX2, vY2, ann.vWidth, ann.vHeight, width, height, rotation);

            const physX = Math.min(p1.x, p2.x);
            const physY = Math.min(p1.y, p2.y);
            const physW = Math.abs(p1.x - p2.x);
            const physH = Math.abs(p1.y - p2.y);

            if (['youtube', 'audio', 'link'].includes(ann.type)) {
                page.drawRectangle({
                    x: physX, y: physY, width: physW, height: physH,
                    color: ann.type === 'youtube' ? PDFLib.rgb(1, 0, 0) :
                        ann.type === 'audio' ? PDFLib.rgb(0.3, 0.7, 0.3) : PDFLib.rgb(0.1, 0.6, 1),
                    borderColor: PDFLib.rgb(1, 1, 1), borderWidth: 2
                });

                const label = ann.type === 'youtube' ? "VIDEO" : ann.type === 'audio' ? "AUDIO" : "LINK";
                page.drawText(label, {
                    x: physX + 5, y: physY + physH / 2 - 5, size: 10,
                    font: fontMap['Helvetica-Bold'], color: PDFLib.rgb(1, 1, 1)
                });

                const link = newPdf.context.register(
                    newPdf.context.obj({
                        Type: 'Annot', Subtype: 'Link',
                        Rect: [physX, physY, physX + physW, physY + physH],
                        Border: [0, 0, 0],
                        A: { Type: 'Action', S: 'URI', URI: ann.url }
                    })
                );

                let annots = page.node.Annots();
                if (!annots) {
                    annots = newPdf.context.obj([]);
                    page.node.set(PDFLib.PDFName.of('Annots'), annots);
                }
                annots.push(link);

            } else if (ann.type === 'highlight') {
                page.drawRectangle({
                    x: physX, y: physY, width: physW, height: physH,
                    color: color, opacity: 0.3
                });
            } else if (ann.type === 'rectangle') {
                page.drawRectangle({
                    x: physX, y: physY, width: physW, height: physH,
                    borderColor: color, borderWidth: ann.lineWidth || 2
                });
            } else if (ann.type === 'circle') {
                page.drawEllipse({
                    x: physX + physW / 2, y: physY + physH / 2,
                    xScale: physW / 2, yScale: physH / 2,
                    borderColor: color, borderWidth: ann.lineWidth || 2
                });
            } else if (ann.type === 'underline') {
                page.drawLine({
                    start: { x: physX, y: physY },
                    end: { x: physX + physW, y: physY },
                    thickness: ann.lineWidth || 2, color: color
                });
            } else if (ann.type === 'strikethrough') {
                page.drawLine({
                    start: { x: physX, y: physY + physH / 2 },
                    end: { x: physX + physW, y: physY + physH / 2 },
                    thickness: ann.lineWidth || 2, color: color
                });
            } else if (ann.type === 'arrow') {
                if (ann.x1 !== undefined) {
                    const start = transformCoordinates(ann.x1, ann.y1, ann.vWidth, ann.vHeight, width, height, rotation);
                    const end = transformCoordinates(ann.x2, ann.y2, ann.vWidth, ann.vHeight, width, height, rotation);
                    drawArrowOnPage(page, start, end, color, ann.lineWidth || 2);
                }
            } else if (ann.type === 'draw') {
                if (ann.points && ann.points.length > 1) {
                    for (let i = 0; i < ann.points.length - 1; i++) {
                        const pt1 = transformCoordinates(ann.points[i].x, ann.points[i].y, ann.vWidth, ann.vHeight, width, height, rotation);
                        const pt2 = transformCoordinates(ann.points[i + 1].x, ann.points[i + 1].y, ann.vWidth, ann.vHeight, width, height, rotation);
                        page.drawLine({ start: pt1, end: pt2, thickness: ann.lineWidth || 2, color: color });
                    }
                }
            } else if (ann.type === 'text' || ann.type === 'note') {
                const fontScale = (rotation === 0 || rotation === 180) ? height / ann.vHeight : width / ann.vHeight;
                const fontSize = (ann.fontSize || 12) * fontScale;
                const font = fontMap[ann.font] || fontMap['Helvetica'];
                const textContent = ann.type === 'note' ? "Nota: " + ann.text : ann.text;

                const textPos = transformCoordinates(ann.x, ann.y + (ann.fontSize || 12), ann.vWidth, ann.vHeight, width, height, rotation);
                const textRotation = PDFLib.degrees(-rotation);

                page.drawText(textContent, {
                    x: textPos.x, y: textPos.y, size: fontSize, font: font, color: color, rotate: textRotation
                });
            }
        }

        const pdfBytes = await newPdf.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const link = document.getElementById(downloadLinkId);
        link.href = url;
        link.download = "multimedia_" + annotState.file.name;

        document.getElementById(resultDivId).style.display = 'block';
        closeModal();

    } catch (e) {
        console.error(e);
        alert("Error guardando PDF: " + e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

function bindAnnotationLayerEvents() {
    const layer = document.getElementById('annotationLayer');
    if (!layer) return;

    layer.removeEventListener('mousedown', handleMouseDown);
    layer.removeEventListener('mousemove', handleMouseMove);
    layer.removeEventListener('mouseup', handleMouseUp);

    layer.addEventListener('mousedown', handleMouseDown);
    layer.addEventListener('mousemove', handleMouseMove);
    layer.addEventListener('mouseup', handleMouseUp);
}

bindAnnotationLayerEvents();
