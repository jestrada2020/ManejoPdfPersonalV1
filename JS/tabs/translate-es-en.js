// Spanish → English translator using shared engine
const esEnEngine = createTranslatorEngine({
    sourceLang: 'es',
    targetLang: 'en',
    ocrLang: 'spa',
    highlightClass: 'text-highlight-es',
    ocrFill: 'rgba(34, 197, 94, 0.35)',
    ocrStroke: 'rgba(22, 163, 74, 0.9)',
    ids: {
        status: 'esEnStatus',
        canvas: 'esEnCanvas',
        textLayer: 'esEnTextLayer',
        ocrLayer: 'esEnOcrLayer',
        pageLabel: 'esEnPageLabel',
        paraList: 'esEnParaList',
        sourceText: 'esEnSourceText',
        translationText: 'esEnTranslationText',
        audio: 'esEnAudio'
    }
});

async function handleEsEnFileBase(input) { await esEnEngine.handleFile(input); }
function changeEsEnPage(delta) { esEnEngine.changePage(delta); }
function setEsEnZoom(type) { esEnEngine.setZoom(type); }
function changeEsEnZoom(delta) { esEnEngine.changeZoom(delta); }
async function runEsEnOcrCurrentPage() { await esEnEngine.runOcrCurrentPage(); }
function prevEsEnParagraph() { esEnEngine.prevParagraph(); }
function nextEsEnParagraph() { esEnEngine.nextParagraph(); }
async function playEsEnAudio() { await esEnEngine.playAudio(); }
function stopEsEnAudio() { esEnEngine.stopAudio(); }
