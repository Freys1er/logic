import { state, els } from './state.js';
import { log, showLoading, hideLoading, buildForm } from './ui-manager.js';
import { INJECTED_SYSTEM_CODE } from './system-injection.js';

export function initPreviewManager() {
    els.playBtn.addEventListener('click', togglePlay);
    els.timeline.addEventListener('input', (e) => seek(parseInt(e.target.value, 10)));
    document.getElementById('run-code-btn').addEventListener('click', updatePreview);
    // MODIFIED: The function call no longer needs sampleFps, so we simplify it here.
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

/**
 * Parses user code for variable definitions and configuration comments.
 * @param {string} code The user's code string.
 * @returns {Array} An array of variable configuration objects.
 */
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
        // This regex finds let/var assignments with values that are either quoted or unquoted
        const varMatch = cleanLine.match(/(?:let|var)\s+(\w+)\s*=\s*(["'].*?["]|[^;/\n]+)/);
        if (varMatch && pendingData.label) {
            const varName = varMatch[1];
            const rawVal = varMatch[2].trim();
            let finalVal = rawVal;

            // Check if the value is a quoted string
            if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
                try {
                    // FIX: Use JSON.parse to safely and correctly un-escape the string literal
                    finalVal = JSON.parse(rawVal);
                } catch (e) {
                    // Fallback: strip quotes if parsing fails
                    finalVal = rawVal.slice(1, -1);
                }
            } else if (pendingData.type === 'number') {
                // For unquoted numbers, convert to a number type for the form default value
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

    // --- MODIFIED: CACHE INVALIDATION ---
    // Any time the code changes, the old render cache is invalid.
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

    const html = `
    <html>
      <head>
        <style> body { margin: 0; overflow: hidden; } #sketch-holder { width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; } canvas { max-width: 100%; max-height: 100%; object-fit: contain; } </style>
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



/**
 * Reads variable values from the dynamic form and writes them back into the code editor.
 */
export function saveVariablesToCode() {
    const values = {};
    let code = state.editorCM.getValue();
    let hasChanged = false;

    els.form.querySelectorAll('input, textarea').forEach(inp => {
        const id = inp.dataset.id;
        if (!id) return;

        values[id] = inp.value;

        // 1. Check if the variable exists in the code
        const assignmentPrefixRegex = new RegExp(`((?:let|var)\\s+${id}\\s*=\\s*)`);
        if (!code.match(assignmentPrefixRegex)) return;

        let newValFormatted;
        const rawValue = inp.value;

        // 2. Format the value based on the Input Type
        if (inp.type === 'number' || inp.type === 'range') {
            // === NUMBERS ===
            // Don't add quotes! 
            // If empty, default to 0 to prevent syntax errors (like "let x = ;")
            newValFormatted = rawValue.trim() === '' ? '0' : rawValue;
        } else if (inp.type === 'checkbox') {
            // === BOOLEANS ===
            // Use the checked state (true/false) without quotes
            newValFormatted = inp.checked.toString();
        } else {
            // === STRINGS (Text, Color, Textarea, etc.) ===
            // Clean and wrap in quotes
            const sanitized = rawValue.replace(/"/g, '');
            const escaped = sanitized.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
            newValFormatted = `"${escaped}"`;
        }

        // 3. AGGRESSIVE REPLACE
        // Finds the variable assignment and consumes EVERYTHING until the next semicolon or newline.
        // This ensures we replace the whole old value (even if it was messy like ""#fff""#fff"")
        const replaceRegex = new RegExp(`((?:let|var)\\s+${id}\\s*=\s*)([^;\\n]+)`, 'g');

        if (replaceRegex.test(code)) {
            // Replace the old value ($2) with the new formatted value
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

/**
 * --- NEW: FAST REAL-TIME RENDERING ---
 * Renders the animation to a WebM file using the high-performance MediaRecorder API.
 * This is significantly faster than the old frame-by-frame caching method.
 * @param {number} playbackFps - The desired frames per second for the output video.
 */
async function renderWebM(playbackFps) {
    log("System", "Starting real-time render with MediaRecorder...");
    if (state.isRecording) {
        log("System", "A recording is already in progress.", "warn");
        return;
    }
    state.isRecording = true;
    if (state.isPlaying) togglePlay(); // Ensure animation is paused before starting

    const duration = (state.totalFrames / 30) * 1000; // Calculate duration based on a 30fps timeline
    showLoading("Recording in Progress...", `This will take about ${Math.round(duration / 1000)} seconds.`);
    
    let listener; // Declare listener here to be accessible in the finally block

    try {
        const sourceCanvas = els.frame.contentWindow.document.querySelector('canvas');
        if (!sourceCanvas) throw new Error("Could not find the p5.js canvas to record.");

        const stream = sourceCanvas.captureStream(playbackFps);
        const recorder = new MediaRecorder(stream, {
            mimeType: 'video/webm;codecs=vp9',
            // Set a bitrate for quality control. 2.5Mbps is good for 1080p.
            bitsPerSecond: 2500000, 
        });

        const chunks = [];
        recorder.ondataavailable = e => e.data.size > 0 && chunks.push(e.data);

        // This promise resolves when the 'onstop' event fires, completing the file save.
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
        
        // This listener waits for the p5.js sketch to tell us it has finished its animation loop.
        listener = (e) => {
            if (e.source === els.frame.contentWindow && e.data.type === 'RECORDING_FINISHED') {
                if (recorder.state === 'recording') {
                    recorder.stop();
                }
            }
        };
        window.addEventListener('message', listener);

        recorder.start();
        // Tell the iframe to play through the animation from the start, specifically for recording.
        els.frame.contentWindow.postMessage({ type: 'PLAY_FOR_RECORDING' }, '*');
        
        await recordingPromise; // Wait for the onstop promise to resolve

    } catch (error) {
        console.error("renderWebM error:", error);
        log("Render Error", error.message, "error");
        alert("A critical error occurred during rendering: " + error.message);
    } finally {
        state.isRecording = false;
        hideLoading();
        seek(0);
        // Important: Clean up the event listener to prevent memory leaks.
        if (listener) {
            window.removeEventListener('message', listener);
        }
    }
}