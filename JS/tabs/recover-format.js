// ==========================================
// Recupear_Formato: edita título, fecha y enunciados de un PDF conservando su
// formato, y añade notas u observaciones. Las páginas que no se tocan quedan intactas.
//
// Coordenadas: todo se maneja en "puntos de vista" (origen arriba-izquierda, y hacia
// abajo, escala 1) y se convierte a coordenadas PDF solo al dibujar. Así funciona
// también con páginas giradas o con CropBox desplazado.
//
// Al editar un bloque se quita su texto del flujo de contenido, de modo que el texto
// viejo no queda oculto. Si no se puede quitar con seguridad, esa página usa un
// parche del color del fondo y se avisa al usuario.
// ==========================================
(function () {
    const CSS_FAMILY = {
        calibri: "'RF Carlito', Calibri, sans-serif",
        times: "'Times New Roman', 'Liberation Serif', Tinos, serif",
        helvetica: "Helvetica, Arial, 'Liberation Sans', sans-serif",
        courier: "'Courier New', 'Liberation Mono', monospace"
    };
    const SUB_SCALE = 0.65;
    const MESES = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';
    const DATE_RE = new RegExp(
        `\\d{1,2}\\s+de\\s+(?:${MESES})(?:\\s+(?:de|del)\\s+\\d{2,4})?` +
        `|(?:${MESES})\\s+\\d{1,2}(?:,|\\s+de)?\\s+\\d{4}` +
        `|\\b\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b`, 'i');
    const DATE_BLANK_RE = /(fecha\s*:?\s*)(_{2,})/i;

    // Codificación de la fuente Symbol hacia Unicode (lo que usa Word para Δ, α, ≤...)
    const SYMBOL_MAP = (() => {
        const map = {};
        const latin = 'ABGDEZHQIKLMNXOPRSTUFCYWJ';
        const greekU = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩϑ';
        latin.split('').forEach((c, i) => { map[c] = greekU[i]; });
        const lower = 'abgdezhqiklmnxoprstufcywjv';
        const greekL = 'αβγδεζηθικλμνξοπρστυφχψωϕϖ';
        lower.split('').forEach((c, i) => { map[c] = greekL[i]; });
        Object.assign(map, { '\xB0': '°', '\xB1': '±', '\xA3': '≤', '\xB3': '≥', '\xB9': '≠', '\xBB': '≈', '\xAE': '→', '\xAC': '←', '\xB4': '×', '\xB8': '÷', '\xD6': '√', '\xA5': '∞', '\xE5': '∑', '\xB6': '∂' });
        Object.keys(map).forEach(k => { map[String.fromCharCode(0xF000 + k.charCodeAt(0))] = map[k]; });
        return map;
    })();

    const S = {
        file: null, bytes: null, src: null, pages: [], elems: [], nextId: 1,
        current: 1, zoom: 1.3, tool: 'edit',
        preview: null, previewBytes: null,
        building: false, rebuild: false, idle: Promise.resolve(),
        renderTask: null, editor: null, stripCache: new Map(), warnings: new Map(),
        titleBlock: null, dateRef: null, depsReady: null
    };
    const $ = id => document.getElementById(id);

    // ---------- utilidades ----------
    const bytesToLatin1 = (bytes) => {
        const parts = [];
        for (let i = 0; i < bytes.length; i += 32768) parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)));
        return parts.join('');
    };
    const latin1ToBytes = (s) => {
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
    };
    const base64ToBytes = (b64) => latin1ToBytes(atob(b64));
    const mul = (m, n) => [
        m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
        m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
        m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]
    ];
    const rgbToHex = (c) => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
    const hexToRgb01 = (h) => {
        const v = parseInt(h.replace('#', ''), 16);
        return PDFLib.rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
    };
    const round2 = (n) => Math.round(n * 100) / 100;
    const runsText = (runs) => runs.map(r => r.text).join('');
    const overlap = (a, b) => a.x0 < b.x1 - 1 && a.x1 > b.x0 + 1 && a.y0 < b.y1 - 1 && a.y1 > b.y0 + 1;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = () => reject(new Error('No se pudo cargar ' + src));
            document.head.appendChild(s);
        });
    }

    function ensureDeps() {
        if (!S.depsReady) {
            S.depsReady = (async () => {
                if (!window.RF_CARLITO) await loadScript('JS/fonts/carlito-data.js');
                const faces = [['regular', 'normal', 'normal'], ['bold', 'bold', 'normal'], ['italic', 'normal', 'italic'], ['bolditalic', 'bold', 'italic']];
                await Promise.all(faces.map(async ([k, weight, style]) => {
                    const face = new FontFace('RF Carlito', base64ToBytes(window.RF_CARLITO[k]).buffer, { weight, style });
                    await face.load();
                    document.fonts.add(face);
                }));
            })();
            S.depsReady.catch(() => { S.depsReady = null; });
        }
        return S.depsReady;
    }

    // ---------- lectura del flujo de contenido ----------
    // Devuelve la posición de cada operador de texto y de cada línea fina (subrayados).
    function parseContent(src) {
        const n = src.length;
        const isWs = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
        const isDelim = (ch) => '()<>[]{}/%'.includes(ch);
        let i = 0;
        let ctm = [1, 0, 0, 1, 0, 0], color = '#000000', font = null, stack = [];
        let tm = [1, 0, 0, 1, 0, 0], tlm = tm, leading = 0, fresh = true;
        let operands = [], path = [], pathStart = -1;
        const texts = [], rects = [];

        const skipString = () => {
            let depth = 0;
            do {
                const ch = src[i];
                if (ch === '\\') i++;
                else if (ch === '(') depth++;
                else if (ch === ')') depth--;
                i++;
            } while (depth > 0 && i < n);
        };
        const skipBalanced = (open, close) => {
            let depth = 0;
            do {
                if (src[i] === '(') { skipString(); continue; }
                if (src.startsWith(open, i)) { depth++; i += open.length; continue; }
                if (src.startsWith(close, i)) { depth--; i += close.length; continue; }
                i++;
            } while (depth > 0 && i < n);
        };
        const nums = () => operands.map(o => parseFloat(o.v)).filter(v => !isNaN(v));
        const nextLine = (tx, ty) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm; fresh = true; };
        const setColor = (a) => {
            if (a.length === 1) color = rgbToHex([a[0], a[0], a[0]]);
            else if (a.length === 3) color = rgbToHex(a);
            else if (a.length === 4) color = rgbToHex([(1 - a[0]) * (1 - a[3]), (1 - a[1]) * (1 - a[3]), (1 - a[2]) * (1 - a[3])]);
        };

        while (i < n) {
            const c = src.charCodeAt(i);
            if (isWs(c)) { i++; continue; }
            const ch = src[i], start = i;
            if (ch === '%') { while (i < n && src[i] !== '\n' && src[i] !== '\r') i++; continue; }
            if (ch === '(') { skipString(); operands.push({ start, v: null }); continue; }
            if (src.startsWith('<<', i)) { skipBalanced('<<', '>>'); operands.push({ start, v: null }); continue; }
            if (ch === '<') { while (i < n && src[i] !== '>') i++; i++; operands.push({ start, v: null }); continue; }
            if (ch === '[') { skipBalanced('[', ']'); operands.push({ start, v: null }); continue; }
            if (ch === '/') {
                i++;
                while (i < n && !isWs(src.charCodeAt(i)) && !isDelim(src[i])) i++;
                operands.push({ start, v: null, name: src.slice(start + 1, i) });
                continue;
            }
            if (isDelim(ch)) { i++; continue; }
            while (i < n && !isWs(src.charCodeAt(i)) && !isDelim(src[i])) i++;
            const tok = src.slice(start, i);
            if (/^[-+.\d]/.test(tok) && !isNaN(parseFloat(tok))) { operands.push({ start, v: tok }); continue; }

            const opStart = operands.length ? operands[0].start : start;
            const a = nums();
            switch (tok) {
                case 'q': stack.push({ ctm, color, font }); break;
                case 'Q': { const s = stack.pop(); if (s) { ctm = s.ctm; color = s.color; font = s.font; } break; }
                case 'Tf': if (operands[0] && operands[0].name) font = operands[0].name; break;
                case 'cm': if (a.length === 6) ctm = mul(a, ctm); break;
                case 'g': case 'rg': case 'k': case 'sc': case 'scn': setColor(a); break;
                case 'cs': color = '#000000'; break;
                case 'BT': tm = tlm = [1, 0, 0, 1, 0, 0]; fresh = true; break;
                case 'Tm': if (a.length === 6) { tm = tlm = a; fresh = true; } break;
                case 'Td': nextLine(a[0], a[1]); break;
                case 'TD': leading = -a[1]; nextLine(a[0], a[1]); break;
                case 'TL': leading = a[0]; break;
                case 'T*': nextLine(0, -leading); break;
                case 'Tj': case 'TJ': case "'": case '"': {
                    if (tok === "'" || tok === '"') nextLine(0, -leading);
                    const m = mul(tm, ctm);
                    texts.push({ start: opStart, end: i, x: m[4], y: m[5], chained: !fresh, color, font, op: tok, a });
                    fresh = false;
                    break;
                }
                case 're':
                    if (!path.length) pathStart = opStart;
                    path.push({ t: 're', a });
                    break;
                case 'm': case 'l':
                    if (!path.length) pathStart = opStart;
                    path.push({ t: tok, a });
                    break;
                case 'c': case 'v': case 'y': case 'h':
                    path.push({ t: 'x' });
                    break;
                case 'f': case 'F': case 'f*': case 'S': case 's': case 'B': case 'B*': case 'b': case 'b*': case 'n': {
                    let box = null;
                    if (path.length === 1 && path[0].t === 're' && /^[fF]/.test(tok)) {
                        const [x, y, w, h] = path[0].a;
                        box = [x, y, x + w, y + h];
                    } else if (path.length === 2 && path[0].t === 'm' && path[1].t === 'l' && tok === 'S') {
                        box = [path[0].a[0], path[0].a[1], path[1].a[0], path[1].a[1]];
                    }
                    if (box) {
                        const p = mul([1, 0, 0, 1, box[0], box[1]], ctm), q = mul([1, 0, 0, 1, box[2], box[3]], ctm);
                        rects.push({ start: pathStart, end: i, x0: p[4], y0: p[5], x1: q[4], y1: q[5], color });
                    }
                    path = [];
                    break;
                }
                case 'BI': {
                    const id = src.indexOf('ID', i);
                    if (id < 0) { i = n; break; }
                    const re = /\sEI(?=[\s]|$)/g;
                    re.lastIndex = id + 2;
                    const m = re.exec(src);
                    i = m ? m.index + m[0].length : n;
                    break;
                }
                default: break;
            }
            operands = [];
        }
        return { texts, rects };
    }

    function contentStreams(doc, pageNode) {
        const contents = pageNode.Contents();
        if (!contents) return [];
        const list = contents instanceof PDFLib.PDFArray
            ? Array.from({ length: contents.size() }, (_, i) => contents.lookup(i)) : [contents];
        return list.filter(Boolean);
    }

    function readPageContent(doc, pageNode) {
        const chunks = contentStreams(doc, pageNode).map(s => (
            s instanceof PDFLib.PDFRawStream ? PDFLib.decodePDFRawStream(s).decode() : s.getContents()
        ));
        return chunks.map(bytesToLatin1).join('\n');
    }

    // ---------- análisis de páginas ----------
    function baseFontName(pageNode, resourceName) {
        if (!resourceName) return null;
        try {
            const fonts = pageNode.Resources().lookup(PDFLib.PDFName.of('Font'));
            const font = fonts.lookup(PDFLib.PDFName.of(resourceName));
            return font.lookup(PDFLib.PDFName.of('BaseFont')).decodeText();
        } catch (e) {
            return null;
        }
    }

    function parseFontName(name) {
        const clean = String(name || '').replace(/^[A-Z]{6}\+/, '');
        const low = clean.toLowerCase();
        let family = 'helvetica', exact = /arial|helvetica|liberationsans|arimo/.test(low);
        if (/symbol/.test(low)) { family = 'symbol'; exact = true; }
        else if (/calibri|carlito/.test(low)) { family = 'calibri'; exact = true; }
        else if (/times|liberationserif|tinos/.test(low)) { family = 'times'; exact = true; }
        else if (/courier|liberationmono|cousine/.test(low)) { family = 'courier'; exact = true; }
        else if (/serif|georgia|garamond|cambria|book|minion|palatino|roman/.test(low) && !/sans/.test(low)) family = 'times';
        else if (/mono|consol/.test(low)) family = 'courier';
        return { family, exact, name: clean, bold: /bold|black|heavy|demi/.test(low), italic: /italic|oblique/.test(low) };
    }

    function collectImages(opList, vp) {
        const O = pdfjsLib.OPS, out = [], stack = [];
        let ctm = vp.transform.slice();
        const paint = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintJpegXObject].filter(v => v !== undefined));
        opList.fnArray.forEach((fn, i) => {
            const args = opList.argsArray[i];
            if (fn === O.save) stack.push(ctm);
            else if (fn === O.restore) ctm = stack.pop() || ctm;
            else if (fn === O.transform) ctm = pdfjsLib.Util.transform(ctm, args);
            else if (fn === O.paintFormXObjectBegin) { stack.push(ctm); if (args[0]) ctm = pdfjsLib.Util.transform(ctm, args[0]); }
            else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
            else if (paint.has(fn)) {
                const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(p => pdfjsLib.Util.applyTransform(p, ctm));
                const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
                out.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
            }
        });
        return out;
    }

    const measureCtx = document.createElement('canvas').getContext('2d');
    function naturalWidth(run) {
        const fam = CSS_FAMILY[run.family] || CSS_FAMILY.calibri;
        measureCtx.font = `${run.i ? 'italic ' : ''}${run.b ? 'bold ' : ''}100px ${fam}`;
        return measureCtx.measureText(run.text).width * run.size / 100;
    }

    function pushRun(runs, run) {
        const last = runs[runs.length - 1];
        if (last && ['b', 'i', 'u', 'color', 'size', 'family', 'sub', 'sup'].every(k => last[k] === run[k])) last.text += run.text;
        else runs.push(run);
    }

    function buildLineRuns(line) {
        const runs = [];
        let prevEnd = null, prevText = '';
        line.items.forEach(it => {
            const gap = prevEnd === null ? 0 : it.x - prevEnd;
            const needsSpace = prevEnd !== null && gap > 0.18 * line.size && !/\s$/.test(prevText) && !/^\s/.test(it.text);
            const offset = it.y - line.y;
            const small = it.size < line.size * 0.85;
            const sub = small && offset > 0.08 * line.size;
            const sup = small && offset < -0.08 * line.size;
            const base = {
                b: it.font.bold, i: it.font.italic, u: !!it.underline, color: it.color,
                size: round2(sub || sup ? line.size : it.size),
                family: it.font.family === 'symbol' ? null : it.font.family, sub, sup
            };
            if (needsSpace) pushRun(runs, { ...base, u: base.u && prevEnd !== null && !!line.lastUnderline, sub: false, sup: false, text: ' ' });
            pushRun(runs, { ...base, text: it.text });
            line.lastUnderline = base.u;
            prevEnd = Math.max(prevEnd === null ? -Infinity : prevEnd, it.x + it.width);
            prevText = it.text;
        });
        return runs;
    }

    async function analyzePage(num, doc) {
        const page = await S.src.getPage(num);
        const vp = page.getViewport({ scale: 1 });
        const opList = await page.getOperatorList();
        const tc = await page.getTextContent();
        const pdfPage = doc.getPage(num - 1);
        let parsed = { texts: [], rects: [] }, content = null;
        try {
            content = readPageContent(doc, pdfPage.node);
            parsed = parseContent(content);
        } catch (e) {
            console.warn('Recupear_Formato: no se pudo leer el contenido de la página', num, e);
            content = null;
        }
        const toView = (x, y) => vp.convertToViewportPoint(x, y);
        parsed.texts.forEach(t => { [t.vx, t.vy] = toView(t.x, t.y); });
        parsed.rects.forEach(r => {
            const [ax, ay] = toView(r.x0, r.y0), [bx, by] = toView(r.x1, r.y1);
            r.vx0 = Math.min(ax, bx); r.vx1 = Math.max(ax, bx);
            r.vy0 = Math.min(ay, by); r.vy1 = Math.max(ay, by);
        });
        const thin = parsed.rects.filter(r => r.vy1 - r.vy0 <= 2 && r.vx1 - r.vx0 > 2);
        // Recuadros de color: sirven para avisar si un texto editado se les monta encima
        const shapes = parsed.rects
            .filter(r => r.vy1 - r.vy0 > 2 && r.vx1 - r.vx0 > 2 && r.color !== '#ffffff')
            .map(r => ({ x0: r.vx0, x1: r.vx1, y0: r.vy0, y1: r.vy1 }));

        const fontCache = {};
        const fontOf = (id) => {
            if (fontCache[id]) return fontCache[id];
            let name = null;
            // En fuentes estándar sin embeber, pdf.js solo da un nombre genérico como «Times»
            try { const f = page.commonObjs.get(id); if (f && f.name) name = f.name; } catch (e) { /* sin datos */ }
            return (fontCache[id] = name ? parseFontName(name) : null);
        };

        const items = [];
        tc.items.forEach(raw => {
            if (raw.str === undefined || raw.str === '') return;
            const t = pdfjsLib.Util.transform(vp.transform, raw.transform);
            if (Math.abs(t[1]) > 0.01 * Math.abs(t[0]) || t[0] <= 0) return;
            items.push({
                raw: raw.str, text: raw.str, font: fontOf(raw.fontName), fallbackFont: raw.fontName, x: t[4], y: t[5], width: raw.width,
                size: round2(Math.hypot(t[2], t[3])), color: '#000000', underline: false
            });
        });
        // Color y subrayado de cada fragmento
        items.forEach(it => {
            let best = null;
            parsed.texts.forEach(t => {
                if (Math.abs(t.vy - it.y) < 0.3 * it.size && t.vx <= it.x + 1 && (!best || t.vx > best.vx)) best = t;
            });
            if (best) it.color = best.color;
            if (!it.font) it.font = parseFontName(baseFontName(pdfPage.node, best && best.font) || it.fallbackFont);
            if (it.font.family === 'symbol') it.text = Array.from(it.raw).map(c => SYMBOL_MAP[c] || c).join('');
            const mid = it.x + it.width / 2;
            it.underline = /\S/.test(it.text) && thin.some(r =>
                r.vx0 <= mid && r.vx1 >= mid && r.vy0 >= it.y - 0.5 && r.vy1 <= it.y + 0.35 * it.size);
        });

        // Líneas: mismos renglones, separadas si hay un hueco tipo columna
        const rows = [];
        items.slice().sort((a, b) => a.y - b.y || a.x - b.x).forEach(it => {
            const row = rows.find(r => Math.abs(r.y - it.y) < 0.45 * Math.max(r.size, it.size));
            if (row) {
                row.items.push(it);
                if (it.size > row.size && /\S/.test(it.text)) { row.size = it.size; row.y = it.y; }
            } else rows.push({ y: it.y, size: it.size, items: [it] });
        });
        const lines = [];
        rows.forEach(row => {
            row.items.sort((a, b) => a.x - b.x);
            const solid = row.items.filter(it => /\S/.test(it.text));
            if (!solid.length) return;
            let cur = null, end = 0;
            row.items.forEach(it => {
                const blank = !/\S/.test(it.text);
                if (!cur || (!blank && it.x - end > 2.5 * row.size)) {
                    if (blank) return;
                    cur = { y: row.y, items: [] };
                    lines.push(cur);
                }
                cur.items.push(it);
                if (!blank) end = Math.max(end, it.x + it.width);
            });
        });
        lines.forEach(l => {
            while (l.items.length && !/\S/.test(l.items[l.items.length - 1].text)) l.items.pop();
            const counts = {};
            l.items.forEach(it => { counts[it.size] = (counts[it.size] || 0) + it.text.length; });
            l.size = parseFloat(Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]);
            l.base = l.items.find(it => it.size === l.size);
            l.y = l.base ? l.base.y : l.y;
            l.x0 = Math.min(...l.items.map(it => it.x));
            l.x1 = Math.max(...l.items.map(it => it.x + it.width));
            l.runs = buildLineRuns(l);
            l.text = runsText(l.runs);
        });
        lines.sort((a, b) => a.y - b.y || a.x0 - b.x0);

        const minX = lines.length ? Math.min(...lines.map(l => l.x0)) : 72;
        const maxX = lines.length ? Math.max(...lines.map(l => l.x1)) : vp.width - 72;
        const rightEdge = Math.max(maxX, vp.width - minX);

        // Párrafos
        const blocks = [];
        lines.forEach(line => {
            const center = (line.x0 + line.x1) / 2;
            const prev = blocks.slice(-6).reverse().find(b => {
                const last = b.lines[b.lines.length - 1];
                const gap = line.y - last.y;
                if (gap <= 0 || gap > 1.6 * Math.max(line.size, last.size)) return false;
                if (Math.abs(line.size - last.size) > 0.15 * last.size) return false;
                const lastCenter = (last.x0 + last.x1) / 2;
                const sameLeft = Math.abs(line.x0 - last.x0) < 3;
                const indent = b.lines.length === 1 && Math.abs(line.x0 - last.x0) < 40;
                const centered = Math.abs(center - lastCenter) < 3 && !sameLeft && line.x0 > minX + 10;
                if (centered) return true;
                if (!sameLeft && !indent) return false;
                // Si la primera palabra cabía en el renglón anterior, es otro párrafo
                const firstWord = line.text.trim().split(/\s/)[0] || '';
                const wordW = firstWord.length * line.size * 0.42;
                return rightEdge - last.x1 < wordW + line.size * 0.3;
            });
            if (prev) prev.lines.push(line);
            else blocks.push({ lines: [line] });
        });

        blocks.forEach((b, idx) => finishBlock(b, idx, num, { minX, rightEdge, width: vp.width }));
        const images = collectImages(opList, vp);
        return { num, page, vp, width: vp.width, height: vp.height, rotate: vp.rotation, blocks, images, shapes, content, parsed, thin, rawText: tc.items.map(t => t.str || '').join(''), minX, rightEdge, bg: null };
    }

    function finishBlock(b, idx, num, geo) {
        b.id = `${num}-${idx}`;
        b.page = num;
        const L = b.lines;
        b.x0 = Math.min(...L.map(l => l.x0));
        b.x1 = Math.max(...L.map(l => l.x1));
        b.size = L[0].size;
        b.y0 = L[0].y - L[0].size * 0.85;
        b.y1 = L[L.length - 1].y + L[L.length - 1].size * 0.3;
        const steps = L.slice(1).map((l, i) => l.y - L[i].y).sort((x, y) => x - y);
        b.lineStep = steps.length ? steps[Math.floor(steps.length / 2)] : b.size * 1.22;

        const runs = [];
        L.forEach((l, i) => {
            l.runs.forEach(r => pushRun(runs, { ...r }));
            if (i < L.length - 1) {
                const last = runs[runs.length - 1];
                const nextStart = L[i + 1].text[0] || '';
                if (/[a-záéíóúñ]-$/.test(last.text) && /[a-záéíóúñ]/.test(nextStart)) last.text = last.text.slice(0, -1);
                else if (!/\s$/.test(last.text)) last.text += ' ';
            }
        });
        const dominant = {};
        runs.forEach(r => { if (r.family) dominant[r.family] = (dominant[r.family] || 0) + r.text.length; });
        const family = Object.keys(dominant).sort((x, y) => dominant[y] - dominant[x])[0] || 'calibri';
        runs.forEach(r => { if (!r.family) r.family = family; });
        b.family = family;
        b.runs = runs;
        b.text = runsText(runs).trim();
        b.fontNames = [...new Set(L.flatMap(l => l.items.filter(it => !it.font.exact).map(it => it.font.name)))];

        // Alineación
        const center = (b.x0 + b.x1) / 2, width = b.x1 - b.x0;
        const lineW = (l) => l.runs.reduce((sum, r) => sum + naturalWidth(r), 0);
        const stretched = L.slice(0, -1).some(l => Math.abs(l.x1 - b.x1) < 2 && (l.x1 - l.x0) > lineW(l) * 1.012);
        const leftEqual = L.every(l => Math.abs(l.x0 - b.x0) < 3);
        const pageCenter = geo.width / 2;
        if (L.length > 1 && stretched) b.align = 'justify';
        else if (L.length > 1 && !leftEqual && L.every(l => Math.abs((l.x0 + l.x1) / 2 - center) < 3)) b.align = 'center';
        else if (L.length === 1 && Math.abs(center - pageCenter) < 4 && b.x0 > geo.minX + 15) b.align = 'center';
        else if (L.length === 1 && Math.abs(b.x1 - geo.rightEdge) < 3 && b.x0 > pageCenter) b.align = 'right';
        else b.align = 'left';

        // Marco donde se reacomoda el texto
        let frameX = b.x0, frameW;
        if (L.length > 1) frameW = width + 0.5;
        else if (b.align === 'center') {
            frameW = Math.max(width, 2 * Math.min(center - geo.minX, geo.rightEdge - center));
            frameX = center - frameW / 2;
        } else if (b.align === 'right') {
            frameW = Math.max(width, b.x1 - geo.minX);
            frameX = b.x1 - frameW;
        } else frameW = Math.max(width, geo.rightEdge - b.x0);
        b.frame = { x: frameX, w: frameW };
        b.firstIndent = b.align === 'center' ? 0 : L[0].x0 - b.x0;
        b.restIndent = L.length > 1 && b.align !== 'center' ? L[1].x0 - b.x0 : 0;

        // Etiqueta para la lista
        if (DATE_RE.test(b.text) || DATE_BLANK_RE.test(b.text)) b.kind = 'Fecha';
        else if (/_{3,}/.test(b.text)) b.kind = 'Encabezado';
        else if (/^\s*(\(\s*\d+(?:[.,]\d+)?\s*%\s*\)|\d+\s*[.)]|[a-z]\)|pregunta\s+\d+|punto\s+\d+)/i.test(b.text)) b.kind = 'Enunciado';
        else b.kind = 'Texto';
    }

    function detectSpecial() {
        const first = S.pages[0];
        S.titleBlock = null;
        if (first && first.blocks.length) {
            const top = first.blocks.filter(b => b.y0 < first.height / 2 && b.text.length > 1);
            if (top.length) {
                const maxSize = Math.max(...top.map(b => b.size));
                const sized = top.filter(b => b.size >= maxSize - 0.5).sort((a, b) => a.y0 - b.y0);
                S.titleBlock = sized[0];
                S.titleBlock.kind = 'Título';
            }
        }
        S.dateRef = null;
        for (const p of S.pages) {
            const b = p.blocks.find(x => x.kind === 'Fecha');
            if (b) { S.dateRef = b; break; }
        }
        $('rfTitleInput').value = S.titleBlock ? S.titleBlock.text : '';
        $('rfTitleInput').disabled = !S.titleBlock;
        $('rfDateInput').value = S.dateRef ? dateMatch(S.dateRef.text).value : '';
        $('rfDateHint').textContent = S.dateRef
            ? 'Se reemplazará la fecha encontrada en la página ' + S.dateRef.page + '.'
            : 'No se detectó fecha: se agregará arriba a la derecha de la primera página (puede arrastrarla).';
    }

    function dateMatch(text) {
        const blank = DATE_BLANK_RE.exec(text);
        if (blank) return { index: blank.index + blank[1].length, value: '', length: blank[2].length };
        const m = DATE_RE.exec(text);
        return m ? { index: m.index, value: m[0], length: m[0].length } : null;
    }

    function replaceInRuns(runs, start, length, value) {
        const out = [];
        let pos = 0, placed = false;
        runs.forEach(r => {
            const a = pos, b = pos + r.text.length;
            pos = b;
            const cutA = Math.max(start, a), cutB = Math.min(start + length, b);
            if (cutA >= cutB && !(a === start && length === 0)) { pushRun(out, { ...r }); return; }
            if (cutA > a) pushRun(out, { ...r, text: r.text.slice(0, cutA - a) });
            if (!placed) { pushRun(out, { ...r, text: value }); placed = true; }
            if (cutB < b) pushRun(out, { ...r, text: r.text.slice(cutB - a) });
        });
        return out;
    }

    // ---------- carga ----------
    async function load(file) {
        if (!file) return;
        setStatus('Abriendo PDF…');
        $('rfLoadBtn').disabled = true;
        try {
            await ensureDeps();
            const buf = await readPdfBytes(file);
            const bytes = new Uint8Array(buf);
            let doc;
            try {
                doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
            } catch (e) {
                if (/encrypt|password/i.test(e.message || '')) throw new Error('El PDF está protegido. Desbloquéelo primero en la pestaña «Desbloquear PDF».');
                throw e;
            }
            if (S.src) S.src.destroy();
            if (S.preview) { S.preview.destroy(); S.preview = null; }
            closeEditor(false);
            Object.assign(S, { file, bytes, elems: [], pages: [], current: 1, previewBytes: null, tool: 'edit' });
            S.stripCache.clear();
            S.warnings.clear();
            S.src = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
            for (let i = 1; i <= S.src.numPages; i++) {
                setStatus(`Analizando página ${i} de ${S.src.numPages}…`);
                S.pages.push(await analyzePage(i, doc));
            }
            detectSpecial();
            $('rfFileName').textContent = file.name;
            $('rfOutputName').value = file.name.replace(/\.pdf$/i, '') + '_editado.pdf';
            $('rfStart').style.display = 'none';
            $('rfWorkspace').style.display = 'flex';
            const blocks = S.pages.reduce((n, p) => n + p.blocks.length, 0);
            $('rfNoText').style.display = blocks ? 'none' : 'block';
            setTool('edit');
            refreshLists();
            // Ajustar la página al ancho del visor
            const room = document.querySelector('.rf-scroll').clientWidth - 32;
            S.zoom = Math.max(0.6, Math.min(1.5, room / S.pages[0].width));
            await render();
            setStatus(`${S.pages.length} página(s). Haga clic en un texto para editarlo.`);
        } catch (e) {
            console.error(e);
            showToast('Error al abrir el PDF: ' + e.message, 'error', 6000);
            setStatus('');
        } finally {
            $('rfLoadBtn').disabled = false;
            $('rfFileInput').value = '';
        }
    }

    function reset() {
        if (S.elems.length && !confirm('Se perderán los cambios que no haya guardado. ¿Cambiar de PDF?')) return;
        closeEditor(false);
        $('rfWorkspace').style.display = 'none';
        $('rfStart').style.display = 'block';
    }

    function setStatus(msg) { const el = $('rfStatus'); if (el) el.textContent = msg; }

    // ---------- elementos ----------
    const pageOf = (n) => S.pages[n - 1];
    const blockById = (id) => { const p = pageOf(parseInt(id, 10)); return p && p.blocks.find(b => b.id === id); };
    const elemForBlock = (id) => S.elems.find(e => e.type === 'edit' && e.blockId === id);
    const newElem = (data) => { const e = { id: S.nextId++, dx: 0, dy: 0, ...data }; S.elems.push(e); return e; };

    function normRuns(runs) {
        const out = [];
        runs.forEach(r => { if (r.text) pushRun(out, { ...r, text: r.text.replace(/[ \t ]+/g, ' ') }); });
        return out;
    }
    const runsKey = (runs) => JSON.stringify(normRuns(runs).map(r => [r.text.trim() ? r.text : ' ', r.b, r.i, r.u, r.color, round2(r.size), r.family, r.sub, r.sup]));

    function editIsNoop(e) {
        const b = blockById(e.blockId);
        const same = runsKey(e.runs) === runsKey(b.runs);
        const tidy = (s) => s.replace(/\s+/g, ' ').trim();
        return (same || tidy(runsText(e.runs)) === tidy(runsText(b.runs)) && styleSig(e.runs) === styleSig(b.runs))
            && !e.dx && !e.dy && e.align === b.align;
    }
    const styleSig = (runs) => JSON.stringify(normRuns(runs).filter(r => r.text.trim()).reduce((acc, r) => {
        const k = [r.b, r.i, r.u, r.color, round2(r.size), r.family, r.sub, r.sup].join('|');
        if (acc[acc.length - 1] !== k) acc.push(k);
        return acc;
    }, []));

    function upsertEdit(block, patch) {
        let e = elemForBlock(block.id);
        if (!e) e = newElem({ type: 'edit', page: block.page, blockId: block.id, runs: block.runs.map(r => ({ ...r })), align: block.align });
        Object.assign(e, patch);
        if (editIsNoop(e)) S.elems = S.elems.filter(x => x !== e);
        return e;
    }

    function removeElem(id) {
        closeEditor(false);
        S.elems = S.elems.filter(e => e.id !== id);
        refreshLists();
        schedule();
    }

    function frameOf(e) {
        if (e.type === 'note') {
            const pad = e.box ? 6 : 0;
            return { x: e.x + pad, w: e.w - 2 * pad, firstY: e.y + pad + e.size * 0.95, step: e.lineStep || e.size * 1.25, firstIndent: 0, restIndent: 0 };
        }
        const b = blockById(e.blockId);
        return { x: b.frame.x + e.dx, w: b.frame.w, firstY: b.lines[0].y + e.dy, step: b.lineStep, firstIndent: b.firstIndent, restIndent: b.restIndent };
    }

    // ---------- composición del texto ----------
    function fontLoader(doc) {
        const cache = new Map();
        const STD = {
            times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
            helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
            courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique']
        };
        return async function get(family, b, i) {
            const key = `${family}|${b ? 1 : 0}|${i ? 1 : 0}`;
            if (cache.has(key)) return cache.get(key);
            const idx = (b ? 1 : 0) + (i ? 2 : 0);
            let font;
            if (STD[family]) font = await doc.embedFont(PDFLib.StandardFonts[STD[family][idx]]);
            else {
                const key64 = ['regular', 'bold', 'italic', 'bolditalic'][idx];
                font = await doc.embedFont(base64ToBytes(window.RF_CARLITO[key64]), { subset: false, features: { liga: false, kern: false, clig: false } });
            }
            const entry = { font, chars: new Set(font.getCharacterSet()) };
            cache.set(key, entry);
            return entry;
        };
    }

    // Divide un run en piezas según la fuente que tiene cada carácter.
    async function runPieces(run, getFont, missing) {
        const main = await getFont(run.family, run.b, run.i);
        const size = (run.sub || run.sup) ? run.size * SUB_SCALE : run.size;
        const pieces = [];
        let cur = null;
        for (const raw of Array.from(run.text)) {
            let ch = raw, entry = main;
            if (!main.chars.has(ch.codePointAt(0))) {
                const alt = await getFont('calibri', run.b, run.i);
                if (alt.chars.has(ch.codePointAt(0))) entry = alt;
                else { missing.add(ch); ch = '?'; }
            }
            if (cur && cur.entry === entry) cur.text += ch;
            else { cur = { text: ch, entry, run, size }; pieces.push(cur); }
        }
        return pieces;
    }

    async function layout(e, getFont, warnings) {
        const f = frameOf(e);
        const missing = new Set();
        const paragraphs = [[]];
        for (const run of e.runs) {
            const parts = run.text.replace(/\t/g, ' ').replace(/[\u0000-\u0009\u000B-\u001F]/g, '').split('\n');
            for (let idx = 0; idx < parts.length; idx++) {
                if (idx > 0) paragraphs.push([]);
                if (parts[idx]) paragraphs[paragraphs.length - 1].push({ ...run, text: parts[idx] });
            }
        }
        const out = [];
        let lineNo = 0;
        const widthOf = (p) => p.entry.font.widthOfTextAtSize(p.text, p.size);

        for (let pi = 0; pi < paragraphs.length; pi++) {
            // Palabras: listas de piezas (una palabra puede mezclar estilos, p. ej. CH₃)
            const words = [];
            let word = [];
            const flush = () => { if (word.length) { words.push(word); word = []; } };
            for (const run of paragraphs[pi]) {
                const tokens = run.text.split(/( +)/);
                for (const tok of tokens) {
                    if (!tok) continue;
                    if (/^ +$/.test(tok)) { flush(); continue; }
                    word.push(...await runPieces({ ...run, text: tok }, getFont, missing));
                }
            }
            flush();

            const lines = [];
            let cur = [], curW = 0;
            const spaceOf = (w) => w[w.length - 1].entry.font.widthOfTextAtSize(' ', w[w.length - 1].size);
            const avail = () => f.w - (lineNo + lines.length === 0 ? f.firstIndent : f.restIndent);
            const push = (w, ww) => { curW += (cur.length ? spaceOf(cur[cur.length - 1]) : 0) + ww; cur.push(w); };
            for (let w of words) {
                let ww = w.reduce((s, p) => s + widthOf(p), 0);
                if (cur.length && curW + spaceOf(cur[cur.length - 1]) + ww > avail() + 0.01) {
                    lines.push(cur); cur = []; curW = 0;
                }
                // Palabra más ancha que el marco (p. ej. una línea de _____): se corta
                while (ww > avail() && w.length === 1 && w[0].text.length > 1) {
                    const p = w[0];
                    let k = Math.max(1, Math.floor(p.text.length * avail() / ww));
                    while (k > 1 && p.entry.font.widthOfTextAtSize(p.text.slice(0, k), p.size) > avail()) k--;
                    lines.push([[{ ...p, text: p.text.slice(0, k) }]]);
                    w = [{ ...p, text: p.text.slice(k) }];
                    ww = widthOf(w[0]);
                }
                push(w, ww);
            }
            lines.push(cur);

            lines.forEach((ln, li) => {
                const first = lineNo === 0;
                const indent = first ? f.firstIndent : f.restIndent;
                const words2 = ln;
                const natural = words2.reduce((s, w, i) => s + w.reduce((a, p) => a + widthOf(p), 0) + (i ? spaceOf(words2[i - 1]) : 0), 0);
                const room = f.w - indent;
                let x = f.x + indent, extra = 0;
                if (e.align === 'center') x = f.x + (f.w - natural) / 2;
                else if (e.align === 'right') x = f.x + f.w - natural;
                else if (e.align === 'justify' && li < lines.length - 1 && words2.length > 1) extra = (room - natural) / (words2.length - 1);
                const y = f.firstY + lineNo * f.step;
                const frags = [];
                words2.forEach((w, i) => {
                    if (i) {
                        const sp = spaceOf(words2[i - 1]) + extra;
                        const prev = words2[i - 1][words2[i - 1].length - 1], next = w[0];
                        if (prev.run.u && next.run.u) frags.push({ under: true, x, w: sp, y, size: prev.run.size, color: prev.run.color });
                        x += sp;
                    }
                    w.forEach(p => {
                        const pw = widthOf(p);
                        const dy = p.run.sub ? p.run.size * 0.18 : p.run.sup ? -p.run.size * 0.33 : 0;
                        frags.push({ text: p.text, x, y: y + dy, font: p.entry.font, size: p.size, color: p.run.color });
                        if (p.run.u) frags.push({ under: true, x, w: pw, y, size: p.run.size, color: p.run.color });
                        x += pw;
                    });
                });
                out.push({ frags, y, x0: frags.length ? Math.min(...frags.map(fr => fr.x)) : f.x, x1: x, size: Math.max(0, ...words2.flat().map(p => p.run.size)) || e.size || 12 });
                lineNo++;
            });
        }
        if (missing.size) warnings.push(`Caracteres no disponibles en la fuente, cambiados por «?»: ${[...missing].join(' ')}`);
        const ink = out.filter(l => l.frags.length);
        const sizeRef = e.type === 'note' ? e.size : blockById(e.blockId).size;
        const box = {
            x0: ink.length ? Math.min(...ink.map(l => l.x0)) : f.x,
            x1: ink.length ? Math.max(...ink.map(l => l.x1)) : f.x + Math.min(f.w, 60),
            y0: f.firstY - sizeRef * 0.85,
            y1: (out.length ? out[out.length - 1].y : f.firstY) + sizeRef * 0.3
        };
        return { lines: out, box };
    }

    // ---------- quitar el texto viejo ----------
    function stripPage(pageInfo, editedBlocks) {
        const { parsed, content } = pageInfo;
        if (content === null || !parsed.texts.length) return null;
        const inBlock = (t) => editedBlocks.some(b => b.lines.some(l =>
            Math.abs(t.vy - l.y) < 0.45 * l.size && t.vx >= l.x0 - 2 && t.vx <= l.x1 + 2));
        const cuts = [];
        let prevRemoved = false;
        for (const t of parsed.texts) {
            let remove = inBlock(t);
            // Un Tj encadenado depende del avance del anterior: mezclarlos movería el texto
            if (t.chained && remove !== prevRemoved) return null;
            if (remove) cuts.push({ start: t.start, end: t.end, text: t.op === "'" ? ' T* ' : t.op === '"' ? ` ${t.a[0]} Tw ${t.a[1]} Tc T* ` : ' ' });
            prevRemoved = remove;
        }
        pageInfo.thin.forEach(r => {
            const hit = editedBlocks.some(b => b.lines.some(l =>
                r.vy0 >= l.y - 0.5 && r.vy1 <= l.y + 0.4 * l.size && r.vx0 >= l.x0 - 2 && r.vx1 <= l.x1 + 2));
            if (hit) cuts.push({ start: r.start, end: r.end, text: ' n ' });
        });
        cuts.sort((a, b) => a.start - b.start);
        const out = [];
        let pos = 0;
        cuts.forEach(c => { out.push(content.slice(pos, c.start), c.text); pos = c.end; });
        out.push(content.slice(pos));
        return out.join('');
    }

    function charBag(s) { return Array.from(s.replace(/\s/g, '')).sort().join(''); }

    async function verifyStripped(doc, stripped) {
        const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
        const check = await pdfjsLib.getDocument({ data: bytes }).promise;
        const failed = [];
        for (const [num, blocks] of stripped) {
            const info = pageOf(num);
            const removed = new Set(blocks.flatMap(b => b.lines.flatMap(l => l.items)));
            let expected = info.rawText;
            // Texto esperado: todo lo original menos los fragmentos de los bloques editados
            const removedText = [...removed].map(it => it.raw).join('');
            const bag = (s) => Array.from(s.replace(/\s/g, ''));
            const counts = {};
            bag(expected).forEach(c => { counts[c] = (counts[c] || 0) + 1; });
            bag(removedText).forEach(c => { counts[c] = (counts[c] || 0) - 1; });
            expected = Object.keys(counts).flatMap(c => Array(Math.max(0, counts[c])).fill(c)).sort().join('');
            const tc = await (await check.getPage(num)).getTextContent();
            const got = charBag(tc.items.map(t => t.str || '').join(''));
            if (got !== expected) failed.push(num);
        }
        check.destroy();
        return failed;
    }

    async function sampleBackground(info, rect) {
        if (!info.bg) {
            const canvas = document.createElement('canvas');
            const vp = info.page.getViewport({ scale: 1.5 });
            canvas.width = vp.width;
            canvas.height = vp.height;
            const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await info.page.render({ canvasContext: ctx, viewport: vp }).promise;
            info.bg = ctx;
        }
        const k = 1.5, ctx = info.bg, freq = {};
        const add = (x, y) => {
            const d = ctx.getImageData(Math.max(0, Math.round(x * k)), Math.max(0, Math.round(y * k)), 1, 1).data;
            const key = rgbToHex([d[0] / 255, d[1] / 255, d[2] / 255]);
            freq[key] = (freq[key] || 0) + 1;
        };
        for (let x = rect.x0; x <= rect.x1; x += Math.max(2, (rect.x1 - rect.x0) / 40)) { add(x, rect.y0 - 1); add(x, rect.y1 + 1); }
        for (let y = rect.y0; y <= rect.y1; y += Math.max(2, (rect.y1 - rect.y0) / 10)) { add(rect.x0 - 1, y); add(rect.x1 + 1, y); }
        return Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] || '#ffffff';
    }

    // ---------- construcción del PDF ----------
    async function build() {
        const doc = await PDFLib.PDFDocument.load(S.bytes, { updateMetadata: false });
        doc.registerFontkit(window.fontkit);
        const getFont = fontLoader(doc);
        const warnings = new Map();

        const byPage = new Map();
        S.elems.forEach(e => {
            if (!byPage.has(e.page)) byPage.set(e.page, []);
            byPage.get(e.page).push(e);
        });

        // 1. Quitar el texto viejo de las páginas con bloques editados
        const stripped = new Map(), originals = new Map();
        const pending = [];
        for (const [num, elems] of byPage) {
            const blocks = elems.filter(e => e.type === 'edit').map(e => blockById(e.blockId));
            if (!blocks.length) continue;
            const key = blocks.map(b => b.id).sort().join(',');
            const cached = S.stripCache.get(num);
            if (cached && cached.key === key && !cached.ok) continue;
            const info = pageOf(num);
            const newContent = stripPage(info, blocks);
            if (newContent === null) { S.stripCache.set(num, { key, ok: false }); continue; }
            const node = doc.getPage(num - 1).node;
            originals.set(num, node.get(PDFLib.PDFName.of('Contents')));
            const ref = doc.context.register(doc.context.flateStream(latin1ToBytes(newContent)));
            node.set(PDFLib.PDFName.of('Contents'), ref);
            stripped.set(num, blocks);
            if (!(cached && cached.key === key)) pending.push(num);
        }
        // Comprobación: debe faltar exactamente el texto de los bloques editados
        if (pending.length) {
            const toCheck = new Map(pending.map(n => [n, stripped.get(n)]));
            const failed = await verifyStripped(doc, toCheck);
            pending.forEach(num => {
                const blocks = stripped.get(num);
                const key = blocks.map(b => b.id).sort().join(',');
                S.stripCache.set(num, { key, ok: !failed.includes(num) });
            });
            failed.forEach(num => {
                doc.getPage(num - 1).node.set(PDFLib.PDFName.of('Contents'), originals.get(num));
                stripped.delete(num);
            });
        }

        // 2. Dibujar
        const allBoxes = new Map();
        for (const [num, elems] of byPage) {
            const info = pageOf(num);
            const page = doc.getPage(num - 1);
            const vp = info.vp;
            const angle = PDFLib.degrees(vp.rotation);
            const at = (x, y) => { const [px, py] = vp.convertToPdfPoint(x, y); return { x: px, y: py }; };
            const rect = (x0, y0, x1, y1, opts) => page.drawRectangle({ ...at(x0, y1), width: x1 - x0, height: y1 - y0, rotate: angle, ...opts });

            for (const e of elems.filter(x => x.type === 'cover')) {
                const color = e.color || await sampleBackground(info, { x0: e.x, y0: e.y, x1: e.x + e.w, y1: e.y + e.h });
                rect(e.x, e.y, e.x + e.w, e.y + e.h, { color: hexToRgb01(color) });
            }
            for (const e of elems.filter(x => x.type === 'edit')) {
                if (stripped.has(num)) continue;
                const b = blockById(e.blockId);
                for (const l of b.lines) {
                    const r = { x0: l.x0 - 1, y0: l.y - l.size * 0.85, x1: l.x1 + 1, y1: l.y + l.size * 0.32 };
                    rect(r.x0, r.y0, r.x1, r.y1, { color: hexToRgb01(await sampleBackground(info, r)) });
                }
                warnings.set(e.id, ['En esta página no se pudo borrar el texto anterior: quedó tapado, pero aún se puede copiar o buscar.']);
            }
            for (const e of elems.filter(x => x.type !== 'cover')) {
                const w = warnings.get(e.id) || [];
                const original = e.type === 'edit' ? blockById(e.blockId).fontNames : [];
                if (original.length) w.push(`La fuente original (${original.join(', ')}) se reemplazó por una parecida.`);
                const res = await layout(e, getFont, w);
                if (e.type === 'note' && e.box) {
                    const yEnd = res.box.y1 + 6;
                    rect(e.x, e.y, e.x + e.w, yEnd, { color: hexToRgb01(e.boxColor || '#fff9c4'), borderColor: hexToRgb01('#b59f3b'), borderWidth: 0.75 });
                    res.box = { x0: e.x, x1: e.x + e.w, y0: e.y, y1: yEnd };
                }
                for (const l of res.lines) {
                    for (const fr of l.frags) {
                        if (fr.under) {
                            const t = Math.max(0.5, fr.size * 0.06);
                            rect(fr.x, fr.y + fr.size * 0.1, fr.x + fr.w, fr.y + fr.size * 0.1 + t, { color: hexToRgb01(fr.color) });
                        } else {
                            page.drawText(fr.text, { ...at(fr.x, fr.y), font: fr.font, size: fr.size, color: hexToRgb01(fr.color), rotate: angle });
                        }
                    }
                }
                e.bbox = res.box;
                allBoxes.set(e.id, res.box);
                if (w.length) warnings.set(e.id, w);
            }
            // 3. Avisar si el texto nuevo pisa otra cosa o se sale de la hoja
            const editedIds = new Set(elems.filter(x => x.type === 'edit').map(x => x.blockId));
            for (const e of elems.filter(x => x.type !== 'cover')) {
                const box = e.bbox, w = warnings.get(e.id) || [];
                const hitsText = info.blocks.some(b => !editedIds.has(b.id) && overlap(box, b));
                const hitsNew = elems.some(o => o !== e && o.type !== 'cover' && o.bbox && overlap(box, o.bbox));
                const hitsImage = info.images.some(im => overlap(box, im));
                if (hitsText || hitsNew) w.push('El texto se cruza con otro texto de la página.');
                if (hitsImage) w.push('El texto se cruza con una imagen de la página.');
                if (e.type === 'edit' && info.shapes.some(sh => overlap(box, sh) && !overlap(blockById(e.blockId), sh))) w.push('El texto se monta sobre un recuadro de la página.');
                if (box.y1 > info.height || box.x1 > info.width + 0.5 || box.y0 < 0) w.push('El texto se sale de la hoja.');
                if (w.length) warnings.set(e.id, w);
            }
        }

        const titleEdit = S.titleBlock && elemForBlock(S.titleBlock.id);
        if (titleEdit && doc.getTitle()) doc.setTitle(runsText(titleEdit.runs).replace(/\s+/g, ' ').trim());
        const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
        return { bytes, warnings };
    }

    function schedule() {
        S.rebuild = true;
        if (S.building) return S.idle;
        S.building = true;
        S.idle = (async () => {
            while (S.rebuild) {
                S.rebuild = false;
                setStatus('Actualizando vista previa…');
                try {
                    if (!S.elems.length) {
                        if (S.preview) S.preview.destroy();
                        S.preview = null;
                        S.previewBytes = null;
                        S.warnings = new Map();
                    } else {
                        const { bytes, warnings } = await build();
                        const next = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
                        if (S.preview) S.preview.destroy();
                        S.preview = next;
                        S.previewBytes = bytes;
                        S.warnings = warnings;
                    }
                    if (!S.rebuild) {
                        await render();
                        refreshLists();
                        setStatus(S.elems.length ? 'Vista previa actualizada: así quedará el PDF.' : 'Sin cambios.');
                    }
                } catch (e) {
                    console.error(e);
                    showToast('No se pudo aplicar el cambio: ' + e.message, 'error', 6000);
                    setStatus('Error al aplicar el último cambio.');
                }
            }
            S.building = false;
        })();
        return S.idle;
    }

    async function save() {
        closeEditor(true);
        schedule();
        await S.idle;
        const bytes = S.previewBytes || S.bytes;
        let name = sanitizeFilename($('rfOutputName').value.trim() || 'editado.pdf');
        if (!/\.pdf$/i.test(name)) name += '.pdf';
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        showToast(S.elems.length ? 'PDF guardado con los cambios' : 'No hay cambios: se guardó una copia del original', 'success');
    }

    // ---------- vista ----------
    async function render() {
        const info = pageOf(S.current);
        if (!info) return;
        const doc = S.preview || S.src;
        const page = await doc.getPage(S.current);
        const dpr = window.devicePixelRatio || 1;
        const vp = page.getViewport({ scale: S.zoom * dpr });
        const canvas = $('rfCanvas');
        if (S.renderTask) { S.renderTask.cancel(); S.renderTask = null; }
        const off = document.createElement('canvas');
        off.width = vp.width;
        off.height = vp.height;
        const task = page.render({ canvasContext: off.getContext('2d', { alpha: false }), viewport: vp });
        S.renderTask = task;
        try {
            await task.promise;
        } catch (e) {
            if (e && e.name === 'RenderingCancelledException') return;
            throw e;
        }
        if (S.renderTask !== task) return;
        S.renderTask = null;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext('2d').drawImage(off, 0, 0);
        const css = { w: info.width * S.zoom, h: info.height * S.zoom };
        canvas.style.width = css.w + 'px';
        canvas.style.height = css.h + 'px';
        const stage = $('rfStage');
        stage.style.width = css.w + 'px';
        stage.style.height = css.h + 'px';
        $('rfPageInfo').textContent = `Página ${S.current} de ${S.pages.length}`;
        $('rfZoomInfo').textContent = Math.round(S.zoom * 100) + '%';
        $('rfPrev').disabled = S.current <= 1;
        $('rfNext').disabled = S.current >= S.pages.length;
        drawOverlay();
    }

    function drawOverlay() {
        const ov = $('rfOverlay');
        const editor = S.editor && S.editor.el;
        // El editor abierto se conserva para no perder el foco ni la selección
        Array.from(ov.children).forEach(c => { if (c !== editor) c.remove(); });
        ov.dataset.tool = S.tool;
        const info = pageOf(S.current);
        if (!info) return;
        const z = S.zoom;
        const place = (el, box) => {
            el.style.left = box.x0 * z + 'px';
            el.style.top = box.y0 * z + 'px';
            el.style.width = (box.x1 - box.x0) * z + 'px';
            el.style.height = (box.y1 - box.y0) * z + 'px';
        };
        info.blocks.forEach(b => {
            const e = elemForBlock(b.id);
            const hit = document.createElement('div');
            hit.className = 'rf-hit' + (e ? ' rf-edited' : '');
            hit.title = `${b.kind}: clic para editar, arrastre para mover`;
            hit.dataset.block = b.id;
            place(hit, e && e.bbox ? e.bbox : { x0: b.x0 - 2, y0: b.y0, x1: b.x1 + 2, y1: b.y1 });
            ov.appendChild(hit);
        });
        S.elems.filter(e => e.page === S.current).forEach(e => {
            if (e.type === 'note' && e.bbox) {
                const hit = document.createElement('div');
                hit.className = 'rf-hit rf-note';
                hit.title = 'Nota: clic para editar, arrastre para mover';
                hit.dataset.elem = e.id;
                place(hit, { ...e.bbox, x0: e.x, x1: e.x + e.w });
                const grip = document.createElement('span');
                grip.className = 'rf-grip';
                grip.title = 'Arrastre para cambiar el ancho';
                hit.appendChild(grip);
                ov.appendChild(hit);
            } else if (e.type === 'cover') {
                const hit = document.createElement('div');
                hit.className = 'rf-cover';
                place(hit, { x0: e.x, y0: e.y, x1: e.x + e.w, y1: e.y + e.h });
                ov.appendChild(hit);
            }
        });
        if (editor) positionEditor();
    }

    function refreshLists() {
        const list = $('rfBlockList');
        list.innerHTML = '';
        S.pages.forEach(p => p.blocks.forEach(b => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'rf-block-item' + (elemForBlock(b.id) ? ' rf-edited' : '');
            const meta = document.createElement('small');
            meta.textContent = `Pág. ${p.num} · ${b.kind}${elemForBlock(b.id) ? ' · editado' : ''}`;
            const txt = document.createElement('span');
            const e = elemForBlock(b.id);
            txt.textContent = (e ? runsText(e.runs) : b.text).trim().slice(0, 90) || '(vacío)';
            btn.append(meta, txt);
            btn.onclick = async () => { await goTo(p.num); openBlock(b); };
            list.appendChild(btn);
        }));

        const ch = $('rfChanges');
        ch.innerHTML = '';
        $('rfChangesEmpty').style.display = S.elems.length ? 'none' : 'block';
        S.elems.forEach(e => {
            const row = document.createElement('div');
            row.className = 'rf-change';
            const label = document.createElement('div');
            const name = e.type === 'note' ? 'Nota' : e.type === 'cover' ? 'Zona cubierta' : blockById(e.blockId).kind;
            const text = e.type === 'cover' ? '' : ': ' + runsText(e.runs).trim().slice(0, 50);
            label.textContent = `Pág. ${e.page} · ${name}${text}`;
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'btn-remove';
            x.textContent = e.type === 'edit' ? 'Revertir' : 'Quitar';
            x.onclick = () => removeElem(e.id);
            row.append(label, x);
            (S.warnings.get(e.id) || []).forEach(w => {
                const warn = document.createElement('div');
                warn.className = 'rf-warn';
                warn.textContent = '⚠️ ' + w;
                row.appendChild(warn);
            });
            ch.appendChild(row);
        });
    }

    async function goTo(n) {
        if (n === S.current || n < 1 || n > S.pages.length) return;
        closeEditor(true);
        S.current = n;
        await render();
    }

    function setZoom(factor) {
        S.zoom = Math.max(0.6, Math.min(3, S.zoom * factor));
        render();
    }

    function setTool(tool) {
        closeEditor(true);
        S.tool = tool;
        ['edit', 'note', 'cover'].forEach(t => $('rfTool-' + t).classList.toggle('active', t === tool));
        const hints = {
            edit: 'Haga clic en un texto de la página para editarlo.',
            note: 'Haga clic en el lugar de la página donde quiere la nota.',
            cover: 'Arrastre sobre la zona que quiere cubrir (por ejemplo, texto dentro de una imagen). Solo la tapa: no la borra del archivo.'
        };
        $('rfToolHint').textContent = hints[tool];
        const ov = $('rfOverlay');
        if (ov) ov.dataset.tool = tool;
    }

    // ---------- editor en la página ----------
    function runsToHtml(runs, z) {
        return runs.map(r => {
            const safe = escapeText(r.text).replace(/\n/g, '<br>');
            let inner = safe;
            if (r.sub) inner = `<sub>${inner}</sub>`;
            if (r.sup) inner = `<sup>${inner}</sup>`;
            if (r.u) inner = `<u>${inner}</u>`;
            if (r.i) inner = `<i>${inner}</i>`;
            if (r.b) inner = `<b>${inner}</b>`;
            return `<span data-s="${r.size}" data-f="${r.family}" style="color:${r.color};font-size:${r.size * z}px;font-family:${CSS_FAMILY[r.family].replace(/"/g, '')}">${inner}</span>`;
        }).join('');
    }
    function escapeText(t) {
        const d = document.createElement('div');
        d.textContent = t;
        return d.innerHTML;
    }

    function htmlToRuns(root, base) {
        const runs = [];
        const emit = (text, st) => pushRun(runs, { text, b: st.b, i: st.i, u: st.u, color: st.color, size: st.size, family: st.family, sub: st.sub, sup: st.sup });
        const newline = (st) => {
            if (runs.length && !runsText(runs).endsWith('\n')) emit('\n', st);
        };
        const walk = (node, st) => {
            node.childNodes.forEach(ch => {
                if (ch.nodeType === 3) {
                    const text = ch.nodeValue.replace(/ /g, ' ').replace(/[\r\n]+/g, ' ');
                    if (text) emit(text, st);
                    return;
                }
                if (ch.nodeType !== 1) return;
                const tag = ch.tagName, next = { ...st };
                if (tag === 'BR') { emit('\n', st); return; }
                if (tag === 'B' || tag === 'STRONG') next.b = true;
                if (tag === 'I' || tag === 'EM') next.i = true;
                if (tag === 'U') next.u = true;
                if (tag === 'SUB') { next.sub = true; next.sup = false; }
                if (tag === 'SUP') { next.sup = true; next.sub = false; }
                if (tag === 'FONT' && ch.getAttribute('color')) next.color = ch.getAttribute('color');
                const fw = ch.style && ch.style.fontWeight;
                if (fw) next.b = fw === 'bold' || parseInt(fw, 10) >= 600;
                const fs = ch.style && ch.style.fontStyle;
                if (fs) next.i = fs === 'italic' || fs === 'oblique';
                if (ch.dataset && ch.dataset.s) next.size = parseFloat(ch.dataset.s);
                if (ch.dataset && ch.dataset.f) next.family = ch.dataset.f;
                if (ch.style && ch.style.color && tag === 'SPAN') {
                    const m = ch.style.color.match(/rgb\((\d+), (\d+), (\d+)\)/);
                    if (m) next.color = rgbToHex([m[1] / 255, m[2] / 255, m[3] / 255]);
                }
                const isBlock = tag === 'DIV' || tag === 'P';
                if (isBlock) newline(st);
                walk(ch, next);
                if (isBlock) newline(st);
            });
        };
        walk(root, base);
        while (runs.length && /^\n*$/.test(runs[runs.length - 1].text)) runs.pop();
        if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\n+$/, '');
        return runs;
    }

    function positionEditor() {
        const ed = S.editor;
        if (!ed) return;
        const z = S.zoom, f = ed.frame;
        const el = ed.el;
        const size = ed.base.size;
        el.style.left = f.x * z + 'px';
        el.style.top = (f.firstY - size * 0.95 - (f.step - size * 1.22) / 2) * z + 'px';
        el.style.width = f.w * z + 'px';
        el.style.fontSize = size * z + 'px';
        el.style.lineHeight = f.step * z + 'px';
        el.style.textAlign = ed.align;
        el.style.textIndent = (ed.align === 'center' || ed.align === 'right' ? 0 : f.firstIndent * z) + 'px';
        el.querySelectorAll('[data-s]').forEach(s => { s.style.fontSize = parseFloat(s.dataset.s) * z + 'px'; });
    }

    function startEditor(opts) {
        closeEditor(true);
        const el = document.createElement('div');
        el.className = 'rf-editor';
        el.contentEditable = 'true';
        el.spellcheck = true;
        el.lang = 'es';
        const base = opts.runs[0] ? { ...opts.runs[0] } : opts.base;
        S.editor = { ...opts, el, base: { ...base, text: '', b: false, i: false, u: false, sub: false, sup: false }, align: opts.align };
        el.innerHTML = runsToHtml(opts.runs, S.zoom) || `<span data-s="${base.size}" data-f="${base.family}" style="color:${base.color};font-size:${base.size * S.zoom}px;font-family:${CSS_FAMILY[base.family].replace(/"/g, '')}"><br></span>`;
        el.style.background = opts.background || '#ffffff';
        el.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { ev.preventDefault(); closeEditor(false); }
            if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); closeEditor(true); }
        });
        el.addEventListener('paste', (ev) => {
            ev.preventDefault();
            const text = (ev.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, text);
        });
        ['pointerdown', 'click'].forEach(t => el.addEventListener(t, ev => ev.stopPropagation()));
        $('rfOverlay').appendChild(el);
        positionEditor();
        syncEditBar();
        $('rfEditBar').style.display = 'flex';
        document.execCommand('styleWithCSS', false, false);
        el.focus();
        const sel = window.getSelection();
        sel.selectAllChildren(el);
        if (opts.collapse !== false) sel.collapseToEnd();
    }

    function syncEditBar() {
        const ed = S.editor;
        if (!ed) return;
        $('rfEdAlign').value = ed.align;
        $('rfEdFont').value = ed.base.family;
        $('rfEdSize').value = round2(ed.base.size);
        $('rfEdColor').value = ed.base.color;
        const isNote = ed.kind === 'note';
        $('rfEdBoxWrap').style.display = isNote ? 'inline-flex' : 'none';
        if (isNote) $('rfEdBox').checked = !!ed.elem.box;
        $('rfEdDelete').textContent = isNote ? 'Eliminar nota' : 'Restaurar original';
        $('rfEdDelete').style.display = ed.elem ? 'inline-flex' : 'none';
    }

    function closeEditor(commit) {
        const ed = S.editor;
        if (!ed) return;
        S.editor = null;
        const runs = commit ? normalizeEditorRuns(htmlToRuns(ed.el, ed.base)) : null;
        ed.el.remove();
        $('rfEditBar').style.display = 'none';
        if (!commit) {
            if (ed.isNew) S.elems = S.elems.filter(e => e !== ed.elem);
            refreshLists();
            drawOverlay();
            return;
        }
        if (ed.kind === 'note') {
            if (!runsText(runs).trim()) S.elems = S.elems.filter(e => e !== ed.elem);
            else Object.assign(ed.elem, { runs, align: ed.align, size: ed.base.size, lineStep: ed.base.size * 1.25 });
        } else {
            upsertEdit(ed.block, { runs, align: ed.align });
        }
        refreshLists();
        schedule();
    }

    function normalizeEditorRuns(runs) {
        return runs.map(r => ({ ...r, size: round2(r.size) }));
    }

    function openBlock(block) {
        const e = elemForBlock(block.id);
        const runs = e ? e.runs : block.runs;
        const info = pageOf(block.page);
        const proxy = e || { type: 'edit', blockId: block.id, dx: 0, dy: 0 };
        const frame = frameOf(proxy);
        sampleBackground(info, { x0: block.x0 - 1, y0: block.y0, x1: block.x1 + 1, y1: block.y1 }).then(bg => {
            if (S.editor && S.editor.block === block) S.editor.el.style.background = bg;
        });
        startEditor({ kind: 'edit', block, elem: e, runs, align: e ? e.align : block.align, frame, base: block.runs[0] });
    }

    function openNote(e, isNew) {
        const f = frameOf(e);
        startEditor({ kind: 'note', elem: e, isNew, runs: e.runs, align: e.align, frame: f, base: e.defaults, background: e.box ? (e.boxColor || '#fff9c4') : '#ffffffcc' });
    }

    function defaultStyle(info) {
        const counts = {};
        info.blocks.forEach(b => b.runs.forEach(r => {
            const k = `${r.family}|${r.size}|${r.color}`;
            counts[k] = (counts[k] || 0) + r.text.length;
        }));
        const key = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        const [family, size, color] = key ? key.split('|') : ['calibri', '12', '#000000'];
        return { text: '', b: false, i: false, u: false, sub: false, sup: false, family, size: parseFloat(size), color };
    }

    function addNoteAt(x, y) {
        const info = pageOf(S.current);
        const style = defaultStyle(info);
        const w = Math.min(Math.max(120, info.rightEdge - x), info.width - x - 10);
        const e = newElem({
            type: 'note', page: S.current, x, y, w: Math.max(w, 80), size: style.size, runs: [],
            align: 'left', box: false, defaults: style, lineStep: style.size * 1.25
        });
        openNote(e, true);
    }

    function applyTitle() {
        const b = S.titleBlock;
        const text = $('rfTitleInput').value.trim();
        if (!b || !text) { showToast('Escriba el título', 'warning'); return; }
        closeEditor(true);
        const first = b.runs.find(r => r.text.trim()) || b.runs[0];
        upsertEdit(b, { runs: [{ ...first, text }] });
        refreshLists();
        schedule();
        goTo(b.page);
    }

    function applyDate() {
        const value = $('rfDateInput').value.trim();
        if (!value) { showToast('Escriba la fecha', 'warning'); return; }
        closeEditor(true);
        if (S.dateRef) {
            const b = S.dateRef, m = dateMatch(runsText(b.runs));
            upsertEdit(b, { runs: replaceInRuns(b.runs, m.index, m.length, value) });
            goTo(b.page);
        } else {
            const info = S.pages[0];
            let note = S.elems.find(e => e.isDate);
            const style = defaultStyle(info);
            const text = /^fecha/i.test(value) ? value : 'Fecha: ' + value;
            if (note) note.runs = [{ ...note.runs[0], text }];
            else {
                const top = info.blocks.length ? Math.min(...info.blocks.map(b => b.y0)) : 72;
                const w = 220;
                note = newElem({
                    type: 'note', isDate: true, page: 1, x: info.rightEdge - w, y: Math.max(24, top - style.size * 1.6), w,
                    size: style.size, align: 'right', box: false, defaults: style, lineStep: style.size * 1.25,
                    runs: [{ ...style, text }]
                });
            }
            goTo(1);
        }
        refreshLists();
        schedule();
    }

    // ---------- interacción ----------
    function pointerPos(ev) {
        const r = $('rfOverlay').getBoundingClientRect();
        return { x: (ev.clientX - r.left) / S.zoom, y: (ev.clientY - r.top) / S.zoom };
    }

    function onPointerDown(ev) {
        if (ev.button !== 0) return;
        const pos = pointerPos(ev);
        const ov = $('rfOverlay');
        if (S.tool === 'note') {
            ev.preventDefault();
            setTool('edit');
            addNoteAt(pos.x, pos.y);
            return;
        }
        if (S.tool === 'cover') {
            ev.preventDefault();
            closeEditor(true);
            const box = document.createElement('div');
            box.className = 'rf-cover';
            ov.appendChild(box);
            const move = (m) => {
                const p = pointerPos(m);
                box.style.left = Math.min(pos.x, p.x) * S.zoom + 'px';
                box.style.top = Math.min(pos.y, p.y) * S.zoom + 'px';
                box.style.width = Math.abs(p.x - pos.x) * S.zoom + 'px';
                box.style.height = Math.abs(p.y - pos.y) * S.zoom + 'px';
            };
            const up = (u) => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                const p = pointerPos(u);
                const w = Math.abs(p.x - pos.x), h = Math.abs(p.y - pos.y);
                box.remove();
                if (w > 3 && h > 3) {
                    newElem({ type: 'cover', page: S.current, x: Math.min(pos.x, p.x), y: Math.min(pos.y, p.y), w, h });
                    refreshLists();
                    schedule();
                }
                setTool('edit');
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
            return;
        }
        const target = ev.target;
        const hit = target.closest && target.closest('.rf-hit');
        if (!hit) { closeEditor(true); return; }
        ev.preventDefault();
        closeEditor(true);
        const isGrip = target.classList.contains('rf-grip');
        const startRect = { left: hit.offsetLeft, top: hit.offsetTop, width: hit.offsetWidth };
        let moved = false;
        const move = (m) => {
            const dx = (m.clientX - ev.clientX), dy = (m.clientY - ev.clientY);
            if (!moved && Math.hypot(dx, dy) < 4) return;
            moved = true;
            if (isGrip) hit.style.width = Math.max(60, startRect.width + dx) + 'px';
            else { hit.style.left = startRect.left + dx + 'px'; hit.style.top = startRect.top + dy + 'px'; }
        };
        const up = (u) => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            const dx = (u.clientX - ev.clientX) / S.zoom, dy = (u.clientY - ev.clientY) / S.zoom;
            const elem = hit.dataset.elem ? S.elems.find(e => e.id === parseInt(hit.dataset.elem, 10)) : null;
            const block = hit.dataset.block ? blockById(hit.dataset.block) : null;
            if (!moved) {
                if (elem) openNote(elem, false);
                else if (block) openBlock(block);
                return;
            }
            if (elem && isGrip) elem.w = Math.max(60 / S.zoom, elem.w + dx);
            else if (elem) { elem.x += dx; elem.y += dy; }
            else if (block) {
                const e = elemForBlock(block.id);
                upsertEdit(block, { dx: (e ? e.dx : 0) + dx, dy: (e ? e.dy : 0) + dy });
            }
            refreshLists();
            schedule();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }

    function edCommand(cmd) {
        if (!S.editor) return;
        S.editor.el.focus();
        document.execCommand(cmd, false, null);
    }

    function edStyle(prop, value) {
        const ed = S.editor;
        if (!ed) return;
        if (prop === 'align') {
            ed.align = value;
            positionEditor();
            return;
        }
        const spans = ed.el.querySelectorAll('[data-s]');
        if (prop === 'size') {
            const v = parseFloat(value);
            if (!(v >= 4 && v <= 96)) return;
            ed.base.size = v;
            spans.forEach(s => { s.dataset.s = v; });
            positionEditor();
        } else if (prop === 'font') {
            ed.base.family = value;
            spans.forEach(s => { s.dataset.f = value; s.style.fontFamily = CSS_FAMILY[value].replace(/"/g, ''); });
        } else if (prop === 'color') {
            ed.base.color = value;
            spans.forEach(s => { s.style.color = value; });
            ed.el.querySelectorAll('font[color]').forEach(f => f.removeAttribute('color'));
        }
    }

    function edBox(checked) {
        const ed = S.editor;
        if (!ed || ed.kind !== 'note') return;
        ed.elem.box = checked;
        ed.frame = frameOf(ed.elem);
        ed.el.style.background = checked ? (ed.elem.boxColor || '#fff9c4') : '#ffffffcc';
        positionEditor();
    }

    function edDelete() {
        const ed = S.editor;
        if (!ed || !ed.elem) return;
        const id = ed.elem.id;
        removeElem(id);
    }

    document.addEventListener('DOMContentLoaded', () => {
        const ov = $('rfOverlay');
        if (!ov) return;
        ov.addEventListener('pointerdown', onPointerDown);
    });

    window.RecuperarFormato = {
        load, reset, save, goTo: (delta) => goTo(S.current + delta), setZoom, setTool,
        applyTitle, applyDate, edCommand, edStyle, edBox, edDelete,
        closeEditor,
        _state: S
    };
})();
