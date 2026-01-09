import { state, els } from './state.js';
import { log, showLoading, hideLoading, buildForm } from './ui-manager.js';
import { INJECTED_SYSTEM_CODE } from './system-injection.js';

export function initPreviewManager() {
    els.playBtn.addEventListener('click', togglePlay);
    els.timeline.addEventListener('input', (e) => seek(parseInt(e.target.value, 10)));
    document.getElementById('run-code-btn').addEventListener('click', updatePreview);
    document.getElementById('export-btn').addEventListener('click', () => renderWebM(15, 30));

    window.addEventListener('message', (e) => {
        if (e.source !== els.frame.contentWindow) return;
        const d = e.data;
        switch (d.type) {
            case 'P5_READY': log("p5.js", "Preview ready and initialized."); break;
            case 'DURATION_UPDATE':
                state.totalFrames = d.totalFrames;
                els.timeline.max = d.totalFrames;
                els.frameDisplay.innerText = `${state.currentFrame} / ${state.totalFrames}`;
                break;
            case 'P5_ERROR': log("p5.js Error", d.payload, "error"); break;
            case 'LOG': log(d.payload.src, d.payload.msg, d.payload.type || 'info'); break;
            case 'REQUEST_ASSET_BY_NAME':
                const asset = state.projectAssets.find(a => a.name === d.payload.name);
                if (asset) {
                    els.frame.contentWindow.postMessage({
                        type: 'ASSET_DATA_RESPONSE',
                        payload: { name: asset.name, type: asset.type, dataUrl: asset.dataUrl }
                    }, '*');
                } else {
                    log("System", `Asset requested but not found: ${d.payload.name}`, "warn");
                }
                break;
        }
    });
}

function parseUserConfig(code) {
    const config = [];
    const lines = code.split('\n');
    let pendingData = {};
    lines.forEach((line) => {
        const cleanLine = line.trim();
        const descMatch = cleanLine.match(/\/\/\s*@description\s+(.+)/);
        if (descMatch) { pendingData.description = descMatch[1].trim(); }
        const labelMatch = cleanLine.match(/\/\/\s*@label\s+(.+?)\s+@type\s+(\w+)/);
        if (labelMatch) {
            pendingData.label = labelMatch[1].trim();
            pendingData.type = labelMatch[2].trim();
        }
        const varMatch = cleanLine.match(/(?:let|var)\s+(\w+)\s*=\s*(["'].*?["]|[^;/\n]+)/);
        if (varMatch && pendingData.label) {
            const varName = varMatch[1];
            const rawVal = varMatch[2].trim();
            let finalVal = rawVal;
            if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
                try { finalVal = new Function('return ' + rawVal)(); } catch (e) { finalVal = rawVal.slice(1, -1); }
            }
            config.push({ id: varName, label: pendingData.label, type: pendingData.type, description: pendingData.description || "", defaultValue: finalVal });
            pendingData = {};
        }
    });
    state.currentConfig = config;
    return config;
}

export function updatePreview() {
    log("System", "Compiling and reloading preview...");
    let userCode = state.editorCM.getValue();
    let config = parseUserConfig(userCode);
    if (config.length > 0) buildForm(config);

    const assetMeta = state.projectAssets.map(a => ({ name: a.name, type: a.type }));
    const systemCodeWithAssets = INJECTED_SYSTEM_CODE.replace(
        'let _availableAssets = [];', `let _availableAssets = ${JSON.stringify(assetMeta)};`
    );

    // ========================================================================
    // THIS IS THE NEW, SIMPLE, AND CORRECT LOGIC.
    // We find the user's 'createCanvas' call and simply append our .parent() command to it.
    // No more deleting or complex injection.
    const canvasRegex = /(createCanvas\s*\([^)]*\))/;
    if (canvasRegex.test(userCode)) {
        userCode = userCode.replace(canvasRegex, "$1.parent('sketch-holder');");
    } else {
        // Fallback ONLY if the user completely deleted createCanvas, which is unlikely.
        userCode = "function setup() { createCanvas(1080, 1920).parent('sketch-holder'); }\\n" + userCode;
    }
    // ========================================================================

    const html = `
    <html>
      <head>
        <style>
          body { margin: 0; overflow: hidden; }
          #sketch-holder { width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; }
          canvas { max-width: 100%; max-height: 100%; object-fit: contain; }
        </style>
      </head>
      <body>
        <div id="sketch-holder"></div>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/addons/p5.sound.min.js"><\/script>
        <script src="https://cdn.jsdelivr.net/gh/IDMNYU/p5.js-speech@0.0.3/lib/p5.speech.js"><\/script>
        ${systemCodeWithAssets}
        <script>${userCode}<\/script>
      </body>
    </html>`;

    if (state.currentBlobUrl) URL.revokeObjectURL(state.currentBlobUrl);
    const blob = new Blob([html], { type: 'text/html' });
    state.currentBlobUrl = URL.createObjectURL(blob);
    els.frame.src = state.currentBlobUrl;
}

export function saveVariablesToCode() {
    const values = {};
    let code = state.editorCM.getValue();
    let hasChanged = false;
    els.form.querySelectorAll('input, textarea').forEach(inp => {
        const id = inp.dataset.id;
        if (!id) return;
        values[id] = inp.value;
        const typeCheckRegex = new RegExp(`((?:let|var)\\s+${id}\\s*=\\s*)(["']?)`);
        const typeMatch = code.match(typeCheckRegex);
        if (typeMatch) {
            const quote = typeMatch[2];
            let newValFormatted;
            let replaceRegex;
            if (quote === "'" || quote === '"') {
                const escapedVal = inp.value.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`).replace(/\n/g, '\\n');
                newValFormatted = `${quote}${escapedVal}${quote}`;
                replaceRegex = new RegExp(`((?:let|var)\\s+${id}\\s*=\\s*)${quote}(.*?)${quote}`);
            } else {
                newValFormatted = inp.value;
                replaceRegex = new RegExp(`((?:let|var)\\s+${id}\\s*=\\s*)([^;\\/\\n]+)`);
            }
            if (code.match(replaceRegex)) {
                code = code.replace(replaceRegex, `$1${newValFormatted}`);
                hasChanged = true;
            }
        }
    });
    if (hasChanged) {
        const cursor = state.editorCM.getCursor();
        state.editorCM.setValue(code);
        state.editorCM.setCursor(cursor);
        state.editorCM.getInputField().blur();
    }
    if (els.frame.contentWindow) {
        els.frame.contentWindow.postMessage({ type: 'UPDATE_STATE', payload: values }, '*');
    }
}

function togglePlay() {
    state.isPlaying = !state.isPlaying;
    els.playBtn.innerHTML = state.isPlaying ? '<span class="material-symbols-outlined">pause</span>' : '<span class="material-symbols-outlined">play_arrow</span>';
    if (state.isPlaying) {
        els.frame.contentWindow.postMessage({ type: 'INITIALIZE_AUDIO' }, '*');
        animate();
    } else {
        cancelAnimationFrame(state.animationId);
        els.frame.contentWindow.postMessage({ type: 'SEEK_FRAME', frame: state.currentFrame, isPlaying: false }, '*');
    }
}

function animate() {
    if (!state.isPlaying) return;
    state.currentFrame++;
    if (state.currentFrame >= state.totalFrames) state.currentFrame = 0;
    seek(state.currentFrame, true);
    state.animationId = requestAnimationFrame(animate);
}

function seek(frame, isPlaying = false) {
    state.currentFrame = frame;
    els.timeline.value = frame;
    els.frameDisplay.innerText = `${frame} / ${state.totalFrames}`;
    if (els.frame.contentWindow) {
        els.frame.contentWindow.postMessage({ type: 'SEEK_FRAME', frame, isPlaying }, '*');
    }
}

async function renderWebM(sampleFps, playbackFps) {
    if (state.isRecording) return;
    state.isRecording = true;
    if (state.isPlaying) togglePlay();
    const capturer = new CCapture({ format: 'webm', framerate: playbackFps, verbose: false });
    const captureFrame = (frame) => new Promise((resolve) => {
        const listener = (e) => {
            if (e.source === els.frame.contentWindow && e.data.type === 'P5_FRAME_RENDERED') {
                const canvas = els.frame.contentWindow.document.querySelector('canvas');
                if (canvas) capturer.capture(canvas);
                window.removeEventListener('message', listener);
                resolve();
            }
        };
        window.addEventListener('message', listener);
        seek(frame);
    });
    capturer.start();
    const step = 30 / sampleFps;
    const totalFramesToCapture = Math.floor(state.totalFrames / step);
    for (let i = 0; i < totalFramesToCapture; i++) {
        const frameToRender = Math.floor(i * step);
        showLoading("Rendering Video...", `${i + 1} / ${totalFramesToCapture}`);
        await captureFrame(frameToRender);
    }
    showLoading("Finalizing Video...", "This may take a moment.");
    capturer.stop();
    capturer.save();
    state.isRecording = false;
    hideLoading();
    seek(0);
}