import { state, els } from './state.js';
import { log, showLoading, hideLoading, buildForm } from './ui-manager.js';
import { INJECTED_SYSTEM_CODE } from './system-injection.js';

export function initPreviewManager() {
    els.playBtn.addEventListener('click', togglePlay);
    els.timeline.addEventListener('input', (e) => seek(parseInt(e.target.value, 10)));
    document.getElementById('run-code-btn').addEventListener('click', updatePreview);
    document.getElementById('export-btn').addEventListener('click', () => renderWebM(30));

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
                try { finalVal = JSON.parse(rawVal); } catch (e) { finalVal = rawVal.slice(1, -1); }
            } else if (pendingData.type === 'number') {
                finalVal = parseFloat(rawVal);
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
    console.log("updatePreview: Reloading preview and clearing render cache.");
    state.renderCache = [];
    console.log("updatePreview: Render cache has been cleared.");
    log("System", "Render cache has been cleared.", "info");

    let userCode = state.editorCM.getValue();
    let config = parseUserConfig(userCode);
    if (config.length > 0) buildForm(config);

    const assetMeta = state.projectAssets.map(a => ({ name: a.name, type: a.type }));
    const systemCodeWithAssets = INJECTED_SYSTEM_CODE.replace(
        'let _availableAssets = [];', `let _availableAssets = ${JSON.stringify(assetMeta)};`
    );

    const canvasRegex = /(createCanvas\s*\([^)]*\))/;
    if (canvasRegex.test(userCode)) {
        userCode = userCode.replace(canvasRegex, "$1.parent('sketch-holder');");
    } else {
        userCode = "function setup() { createCanvas(1080, 1920).parent('sketch-holder'); }\n" + userCode;
    }

    // --- FINAL FIX: REMOVED p5.sound.min.js SCRIPT TAG ---
    const html = `
    <html>
      <head>
        <style> body { margin: 0; overflow: hidden; } #sketch-holder { width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; } canvas { max-width: 100%; max-height: 100%; object-fit: contain; } </style>
      </head>
      <body>
        <div id="sketch-holder"></div>
        <script defer src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.js"><\/script>
        ${systemCodeWithAssets}
        <script>${userCode}<\/script>
      </body>
    </html>`;

    if (state.currentBlobUrl) URL.revokeObjectURL(state.currentBlobUrl);
    const blob = new Blob([html], { type: 'text/html' });
    state.currentBlobUrl = URL.createObjectURL(blob);
    els.frame.src = state.currentBlobUrl;
}

// ... the rest of the file is unchanged ...
export function saveVariablesToCode() {
    const values = {};
    let code = state.editorCM.getValue();
    let hasChanged = false;
    els.form.querySelectorAll('input, textarea').forEach(inp => {
        const id = inp.dataset.id;
        if (!id) return;
        values[id] = inp.value;
        const assignmentPrefixRegex = new RegExp(`((?:let|var)\\s+${id}\\s*=\\s*)`);
        if (!code.match(assignmentPrefixRegex)) return;
        let newValFormatted;
        const rawValue = inp.value;
        if (inp.type === 'number' || inp.type === 'range') {
            newValFormatted = rawValue.trim() === '' ? '0' : rawValue;
        } else if (inp.type === 'checkbox') {
            newValFormatted = inp.checked.toString();
        } else {
            const sanitized = rawValue.replace(/"/g, '');
            const escaped = sanitized.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
            newValFormatted = `"${escaped}"`;
        }
        const replaceRegex = new RegExp(`((?:let|var)\\s+${id}\\s*=\\s*)([^;\\n]+)`, 'g');
        if (replaceRegex.test(code)) {
            code = code.replace(replaceRegex, `$1${newValFormatted}`);
            hasChanged = true;
        }
    });
    if (hasChanged) {
        const cursor = state.editorCM.getCursor();
        state.editorCM.setValue(code);
        state.editorCM.setCursor(cursor);
        state.editorCM.getInputField().blur();
        updatePreview();
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
async function renderWebM(playbackFps) {
    log("System", "Starting real-time render with MediaRecorder...");
    if (state.isRecording) {
        log("System", "A recording is already in progress.", "warn");
        return;
    }
    state.isRecording = true;
    if (state.isPlaying) togglePlay();
    const duration = (state.totalFrames / 30) * 1000;
    showLoading("Recording in Progress...", `This will take about ${Math.round(duration / 1000)} seconds.`);
    let listener;
    try {
        const sourceCanvas = els.frame.contentWindow.document.querySelector('canvas');
        if (!sourceCanvas) throw new Error("Could not find the p5.js canvas to record.");
        const stream = sourceCanvas.captureStream(playbackFps);
        const recorder = new MediaRecorder(stream, {
            mimeType: 'video/webm;codecs=vp9',
            bitsPerSecond: 2500000,
        });
        const chunks = [];
        recorder.ondataavailable = e => e.data.size > 0 && chunks.push(e.data);
        const recordingPromise = new Promise(resolve => {
            recorder.onstop = () => {
                showLoading("Finalizing Video...", "Creating downloadable file.");
                const blob = new Blob(chunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'render.webm';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                log("System", "WebM file has been saved.", "info");
                resolve();
            };
        });
        listener = (e) => {
            if (e.source === els.frame.contentWindow && e.data.type === 'RECORDING_FINISHED') {
                if (recorder.state === 'recording') {
                    recorder.stop();
                }
            }
        };
        window.addEventListener('message', listener);
        recorder.start();
        els.frame.contentWindow.postMessage({ type: 'PLAY_FOR_RECORDING' }, '*');
        await recordingPromise;
    } catch (error) {
        console.error("renderWebM error:", error);
        log("Render Error", error.message, "error");
        alert("A critical error occurred during rendering: " + error.message);
    } finally {
        state.isRecording = false;
        hideLoading();
        seek(0);
        if (listener) {
            window.removeEventListener('message', listener);
        }
    }
}