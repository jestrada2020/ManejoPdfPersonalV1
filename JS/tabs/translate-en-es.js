// English → Spanish translator using shared engine
const enEsEngine = createTranslatorEngine({
    sourceLang: 'en',
    targetLang: 'es',
    ocrLang: 'eng',
    highlightClass: 'text-highlight-en',
    ocrFill: 'rgba(255, 235, 59, 0.4)',
    ocrStroke: 'rgba(202, 138, 4, 0.9)',
    ids: {
        status: 'enEsStatus',
        canvas: 'enEsCanvas',
        textLayer: 'enEsTextLayer',
        ocrLayer: 'enEsOcrLayer',
        pageLabel: 'enEsPageLabel',
        paraList: 'enEsParaList',
        sourceText: 'enEsSourceText',
        translationText: 'enEsTranslationText',
        audio: 'enEsAudio'
    }
});

async function handleEnEsFileBase(input) { await enEsEngine.handleFile(input); }
function changeEnEsPage(delta) { enEsEngine.changePage(delta); }
function setEnEsZoom(type) { enEsEngine.setZoom(type); }
function changeEnEsZoom(delta) { enEsEngine.changeZoom(delta); }
async function runEnEsOcrCurrentPage() { await enEsEngine.runOcrCurrentPage(); }
function prevEnEsParagraph() { enEsEngine.prevParagraph(); }
function nextEnEsParagraph() { enEsEngine.nextParagraph(); }
async function playEnEsAudio() { await enEsEngine.playAudio(); }
function stopEnEsAudio() { enEsEngine.stopAudio(); }
