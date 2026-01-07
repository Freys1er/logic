// ==========================================
// 1. CONFIG & SYSTEM INJECTION
// ==========================================

// --- INJECTED SYSTEM LOGIC (The "OS" & Engine) ---
let currentCloudId = null;

// Note: _availableAssets is now initialized empty but populated during injection
const INJECTED_SYSTEM_CODE = `
<script>
// --- 1. INTERNAL STATE & CACHE ---
let state = {};
let currentFrame = 0;
let _sysTotalFrames = 300; 

const _assetCache = {};       
const _assetWaitList = {};    
let _availableAssets = []; // This gets overwritten by updatePreview()

// --- 2. THE "OS" API ---
const os = {
    files: {
        list: () => _availableAssets.map(a => a.name),
        exists: (name) => _availableAssets.some(a => a.name === name),
        info: (name) => {
            const m = _availableAssets.find(a => a.name === name);
            return m ? { ...m } : null; 
        },
        get: (filename) => {
            if (_assetCache[filename]) return _assetCache[filename];

            const placeholder = createImage(1, 1);
            _assetCache[filename] = placeholder;

            if (os.files.exists(filename)) {
                window.parent.postMessage({ 
                    type: 'REQUEST_ASSET_BY_NAME', 
                    payload: { name: filename } 
                }, '*');
                
                _assetWaitList[filename] = (img) => {
                    placeholder.width = img.width;
                    placeholder.height = img.height;
                    placeholder.canvas = img.canvas;
                    placeholder.drawingContext = img.drawingContext;
                    placeholder.pixels = img.pixels;
                    if(typeof redraw === 'function') redraw();
                };
            }
            return placeholder;
        }
    },
    time: {
        progress: () => _sysTotalFrames > 0 ? currentFrame / _sysTotalFrames : 0,
        frame: () => currentFrame,
        duration: () => _sysTotalFrames,
        seconds: () => currentFrame / 30
    },
    sys: {
        setDuration: (f) => {
            _sysTotalFrames = f; 
            notifyDuration(f);
        }
    }
};

function duration(f) { os.sys.setDuration(f); }
function notifyDuration(frames) { window.parent.postMessage({ type: 'DURATION_UPDATE', totalFrames: frames }, '*'); }

window.addEventListener('message', function(event) {
    if (event.source !== window.parent) return;
    const data = event.data;

    if (data.type === 'ASSET_DATA_RESPONSE') {
        const { name, type, dataUrl } = data.payload;
        if (type.startsWith('image/')) {
            loadImage(dataUrl, (loadedImg) => {
                if (_assetWaitList[name]) {
                    _assetWaitList[name](loadedImg);
                    delete _assetWaitList[name];
                }
                _assetCache[name] = loadedImg;
            });
        }
    }
    else if (data.type === 'UPDATE_STATE') {
        state = data.payload;
        if(typeof redraw === 'function') redraw();
    } 
    else if (data.type === 'SEEK_FRAME') {
        currentFrame = data.frame;
        if(typeof redraw === 'function') redraw();
        window.parent.postMessage({ type: 'P5_FRAME_RENDERED' }, '*');
    }
    else if (data.type === 'INITIALIZE_AUDIO') {
        if (getAudioContext().state !== 'running') getAudioContext().resume();
    }
});

const _userSetup = window.setup || function(){};

window.setup = function() {
    try { _userSetup(); } catch(e) { window.parent.postMessage({ type: 'P5_ERROR', payload: e.message }, '*'); }
    window.parent.postMessage({ type: 'P5_READY' }, '*');
};

window.draw = function() {
    if (typeof state !== 'undefined') {
        for (let key in state) {
            if (typeof window[key] !== 'undefined') window[key] = state[key];
        }
    }
    let t = 0;
    if (_sysTotalFrames > 0) t = currentFrame / _sysTotalFrames;

    try {
        if (typeof render === 'function') { push(); render(t); pop(); } 
        else if (typeof _userDraw === 'function') { _userDraw(); }
    } catch(e) {
        noLoop();
        window.parent.postMessage({ type: 'P5_ERROR', payload: "Runtime: " + e.message }, '*');
    }
};
</script>
`;

// ===================================================================================
// --- DOM ELEMENTS & STATE ---
// ===================================================================================
const els = {
    frame: document.getElementById('preview-frame'),
    form: document.getElementById('dynamic-form-container'),
    playBtn: document.getElementById('play-btn'),
    timeline: document.getElementById('timeline'),
    frameDisplay: document.getElementById('frame-display'),
    console: document.getElementById('console-output'),
    assetList: document.getElementById('asset-list'),
    toggleDev: document.getElementById('dev-mode-toggle'),
    panels: {
        settings: document.getElementById('panel-settings'),
        preview: document.getElementById('panel-preview'),
        assets: document.getElementById('panel-assets'),
        code: document.getElementById('panel-code'),
        resizer: document.getElementById('code-panel-resizer')
    },
    modals: {
        loading: document.getElementById('loading-overlay')
    },
    auth: {
        email: localStorage.getItem('freyster_user'),
        key: localStorage.getItem('freyster_key')
    }
};

let editorCM;
let projectAssets = [];
let isPlaying = false;
let isRecording = false; // Flag to prevent multiple recordings
let animationId;
let currentFrame = 0;
let totalFrames = 300;
let currentBlobUrl = null;
let dragStartIndex;
let saveTimeout;
let currentConfig = []; // GLOBAL CONFIG FOR AI

// ===================================================================================
// --- INITIALIZATION ---
// ===================================================================================
document.addEventListener('DOMContentLoaded', () => {
    initCodeMirror();
    initEventListeners();
    initResizing();
    initProjectState();
    log("System", "Environment Initialized");
});

function initCodeMirror() {
    editorCM = CodeMirror(document.getElementById('editor-wrapper'), {
        mode: "javascript", theme: "dracula", lineNumbers: true, lineWrapping: true
    });
    editorCM.on("change", (cm, changeObj) => {
        if (changeObj && changeObj.origin === 'from_form') return;
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(updatePreview, 800);
    });
}

function initEventListeners() {
    document.getElementById('run-code-btn').addEventListener('click', updatePreview);
    document.getElementById('publish-btn').addEventListener('click', publishProject);

    document.getElementById('export-btn').addEventListener('click', () => {
        if (isRecording) return;
        renderWebM(10, 30);
    });

    els.playBtn.addEventListener('click', togglePlay);
    els.timeline.addEventListener('input', (e) => seek(parseInt(e.target.value)));

    if (els.toggleDev) {
        els.toggleDev.addEventListener('change', (e) => {
            const isDev = e.target.checked;
            els.panels.code.classList.toggle('visible', isDev);
            if (isDev) setTimeout(() => editorCM.refresh(), 10);
        });
    }

    document.getElementById('add-asset-btn').addEventListener('click', () => {
        document.getElementById('asset-file-input').click();
    });
    document.getElementById('asset-file-input').addEventListener('change', handleAssetUpload);

    els.assetList.addEventListener('dragover', handleDragOver);
    els.assetList.addEventListener('drop', handleDrop);
}

function initResizing() {
    const resizers = document.querySelectorAll('.resizer-vertical');
    resizers.forEach(resizer => {
        resizer.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const left = resizer.previousElementSibling;
            const right = resizer.nextElementSibling;
            if (!left || !right) return;
            const startX = e.clientX;
            const leftW = left.offsetWidth;
            const rightW = right.offsetWidth;
            document.body.style.cursor = 'col-resize';
            document.body.style.pointerEvents = 'none';

            const onMove = (em) => {
                const dx = em.clientX - startX;
                const newL = leftW + dx;
                const newR = rightW - dx;
                if (newL > 50 && newR > 50) {
                    left.style.flexBasis = `${newL}px`;
                    right.style.flexBasis = `${newR}px`;
                }
            };
            const onUp = () => {
                document.body.style.cursor = '';
                document.body.style.pointerEvents = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });
}

async function initProjectState() {
    const urlParams = new URLSearchParams(window.location.search);
    const templateId = urlParams.get('id');

    if (templateId) {
        await loadFromServer(templateId);
    } else {
        const saved = localStorage.getItem('fs_autosave');
        editorCM.setValue(saved || getDefaultTemplate());
        updatePreview();
    }
}

// ===================================================================================
// --- CORE: PREVIEW & PARSING ---
// ===================================================================================
function parseUserConfig(code) {
    const config = [];
    const lines = code.split('\n');
    let pendingData = {};

    lines.forEach((line) => {
        const cleanLine = line.trim();

        // 1. Capture Description
        const descMatch = cleanLine.match(/\/\/\s*@description\s+(.+)/);
        if (descMatch) { pendingData.description = descMatch[1].trim(); }

        // 2. Capture Label & Type
        const labelMatch = cleanLine.match(/\/\/\s*@label\s+(.+?)\s+@type\s+(\w+)/);
        if (labelMatch) {
            pendingData.label = labelMatch[1].trim();
            pendingData.type = labelMatch[2].trim();
        }

        // 3. Capture Variable
        const varMatch = cleanLine.match(/(?:let|var)\s+(\w+)\s*=\s*(["'].*?["]|[^;/\n]+)/);
        if (varMatch && pendingData.label) {
            const varName = varMatch[1];
            const rawVal = varMatch[2].trim();
            let finalVal = rawVal;
            if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
                try { finalVal = new Function('return ' + rawVal)(); } catch (e) { finalVal = rawVal.slice(1, -1); }
            }

            config.push({
                id: varName,
                label: pendingData.label,
                type: pendingData.type,
                description: pendingData.description || "",
                defaultValue: finalVal
            });
            pendingData = {};
        }
    });
    currentConfig = config; // Update global state
    return config;
}

function updatePreview() {
    let userCode = editorCM.getValue();
    let config = parseUserConfig(userCode);

    // BUILD FORM
    if (config && config.length > 0) buildForm(config);

    const assetMeta = projectAssets.map(a => ({ name: a.name, type: a.type }));
    const systemCodeWithAssets = INJECTED_SYSTEM_CODE.replace(
        'let _availableAssets = [];',
        `let _availableAssets = ${JSON.stringify(assetMeta)};`
    );

    if (config) {
        config.forEach(field => {
            const re = new RegExp(`let\\s+${field.id}\\s*=`, 'g');
            userCode = userCode.replace(re, `var ${field.id} =`);
        });
    }

    const fullScript = `
        ${systemCodeWithAssets}
        <script>
        // --- USER SCRIPT START ---
        ${userCode}
        // --- USER SCRIPT END ---
        </script>
    `;

    const html = `
    <html>
      <head>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.js"><\/script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/addons/p5.sound.js"><\/script> 
        <style>body{margin:0;overflow:hidden;background:#fff;}canvas{width:100% !important;height:100% !important;object-fit:contain;}</style>
      </head>
      <body>
        ${fullScript}
      </body>
    </html>`;

    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    const blob = new Blob([html], { type: 'text/html' });
    currentBlobUrl = URL.createObjectURL(blob);
    els.frame.src = currentBlobUrl;
}

// --- FORM BUILDER (Global AI Button) ---
function buildForm(config) {
    els.form.innerHTML = '';

    // 1. MAGIC FILL BUTTON
    const magicContainer = document.createElement('div');
    magicContainer.className = 'magic-fill-container';
    magicContainer.innerHTML = `
        <button class="magic-fill-btn" onclick="openMagicPrompt()">
            <span class="material-symbols-outlined">auto_awesome</span>
            <span>Magic Fill Form</span>
        </button>
        <div id="magic-prompt-box" class="magic-prompt-box hidden">
            <textarea id="magic-prompt-input" placeholder="Describe the scene (e.g., 'A suspenseful chat about a secret party location')..."></textarea>
            <button class="btn-primary" onclick="executeMagicFill()">Generate</button>
        </div>
    `;
    els.form.appendChild(magicContainer);

    // 2. INPUT FIELDS
    config.forEach(field => {
        const group = document.createElement('div');
        group.className = 'input-group';

        const label = document.createElement('label');
        label.innerText = field.label;
        group.appendChild(label);

        if (field.description) {
            const desc = document.createElement('div');
            desc.className = 'input-help-text';
            desc.innerText = field.description;
            group.appendChild(desc);
        }

        let input;
        if (field.type === 'textarea') {
            input = document.createElement('textarea');
            input.rows = 6;
        } else {
            input = document.createElement('input');
            input.type = field.type;
        }
        input.value = field.defaultValue;
        input.dataset.id = field.id;

        input.addEventListener('change', () => saveVariablesToCode());

        group.appendChild(input);
        els.form.appendChild(group);
    });
}

/**
 * Renders the animation to a WebM video file by sampling frames.
 * @param {number} sampleFps - The rate at which to capture frames from the animation (lower is faster).
 * @param {number} playbackFps - The final video's playback framerate.
 */
async function renderWebM(sampleFps, playbackFps) {
    if (isRecording) {
        alert("A recording is already in progress.");
        return;
    }
    isRecording = true;
    if(isPlaying) togglePlay(); // Pause playback

    log("Export", `Starting export. Playback: ${playbackFps}fps, Capture: ${sampleFps}fps.`);
    
    const capturer = new CCapture({
        format: 'webm',
        framerate: playbackFps, // CCapture uses the final playback rate
        verbose: false
    });

    const captureFrame = (frame) => {
        return new Promise((resolve) => {
            const frameRenderedListener = (e) => {
                if (e.source === els.frame.contentWindow && e.data.type === 'P5_FRAME_RENDERED') {
                    const canvas = els.frame.contentWindow.document.querySelector('canvas');
                    if (canvas) {
                        capturer.capture(canvas);
                    }
                    window.removeEventListener('message', frameRenderedListener);
                    resolve();
                }
            };
            window.addEventListener('message', frameRenderedListener);
            seek(frame); // Tell iframe to render this specific frame
        });
    };

    capturer.start();

    // --- KEY CHANGE IS HERE ---
    // Calculate how many animation frames to skip for each video frame captured
    const step = Math.max(1, playbackFps / sampleFps);
    const totalFramesToCapture = Math.floor(totalFrames / step);
    let framesCaptured = 0;
    
    log("Export", `Capturing every ${step.toFixed(2)} frame(s). Total frames to render: ${totalFramesToCapture}.`);
    showLoading("Preparing Export...", `0 / ${totalFramesToCapture}`);

    // Loop through the animation, stepping by the calculated amount
    for (let i = 0; i < totalFrames; i += step) {
        const frameToRender = Math.floor(i);
        showLoading("Rendering Video...", `${++framesCaptured} / ${totalFramesToCapture}`);
        await captureFrame(frameToRender);
    }
    
    log("Export", "All frames captured. Finalizing video file.");
    showLoading("Finalizing Video...", "This may take a moment.");
    
    capturer.stop();
    capturer.save();

    // Cleanup
    isRecording = false;
    hideLoading();
    seek(0); // Rewind to the beginning
    log("Export", "Video saved successfully.");
}

// ==========================================
// AI LOGIC (Single Global Request)
// ==========================================
window.openMagicPrompt = function () {
    const box = document.getElementById('magic-prompt-box');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) {
        document.getElementById('magic-prompt-input').focus();
    }
}

window.executeMagicFill = async function () {
    const promptText = document.getElementById('magic-prompt-input').value;
    if (!promptText) return;

    showLoading("Magic Fill...", "AI is rewriting your template...");

    // Build Schema for AI
    const schema = currentConfig.map(c => ({
        id: c.id,
        label: c.label,
        type: c.type,
        description: c.description
    }));

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'magic_fill_variables',
                email: els.auth.email,
                userKey: els.auth.key,
                prompt: promptText,
                schema: schema
            })
        });

        const data = await response.json();

        if (data.success && data.variables) {
            updateAllInputs(data.variables);
            document.getElementById('magic-prompt-box').classList.add('hidden');
            alert("✨ Form Updated!");
        } else {
            alert("AI Error: " + (data.error || "Failed to generate"));
        }
    } catch (e) {
        console.error(e);
        alert("Network Error during AI request.");
    } finally {
        hideLoading();
    }
}

function updateAllInputs(newValues) {
    for (const [key, value] of Object.entries(newValues)) {
        const input = els.form.querySelector(`[data-id="${key}"]`);
        if (input) { input.value = value; }
    }
    saveVariablesToCode();
}

function saveVariablesToCode() {
    const state = {};
    let code = editorCM.getValue();
    let hasChanged = false;

    els.form.querySelectorAll('input, textarea').forEach(inp => {
        const id = inp.dataset.id;
        const val = inp.value;
        if (!id) return;
        state[id] = val;

        const typeCheckRegex = new RegExp(`((?:let|var)\\s+${id}\\s*=\\s*)(["']?)`, '');
        const typeMatch = typeCheckRegex.exec(code);

        if (typeMatch) {
            const quote = typeMatch[2];
            let newValFormatted;
            let replaceRegex;

            if (quote) {
                const escapedVal = val.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`).replace(/\n/g, '\\n');
                newValFormatted = `${quote}${escapedVal}${quote}`;
                replaceRegex = new RegExp(`((?:let|var)\\s+${id}\\s*=\\s*)${quote}(.*?)${quote}`);
            } else {
                newValFormatted = val;
                replaceRegex = new RegExp(`((?:let|var)\\s+${id}\\s*=\\s*)([^;\\/\\n]+)`);
            }

            const match = replaceRegex.exec(code);
            if (match && match[2] !== undefined) {
                code = code.replace(replaceRegex, `$1${newValFormatted}`);
                hasChanged = true;
            }
        }
    });

    if (hasChanged) {
        const cursor = editorCM.getCursor();
        editorCM.setValue(code);
        editorCM.setCursor(cursor);
        localStorage.setItem('fs_autosave', code);
    }
    if (els.frame.contentWindow) {
        els.frame.contentWindow.postMessage({ type: 'UPDATE_STATE', payload: state }, '*');
    }
}

// ==========================================
// PARENT / CHILD / ASSET / LOADING
// ==========================================
window.addEventListener('message', (e) => {
    if (e.source !== els.frame.contentWindow) return;
    const d = e.data;
    switch (d.type) {
        case 'P5_READY': log("System", "Preview Ready"); break;
        case 'DURATION_UPDATE':
            totalFrames = d.totalFrames;
            els.timeline.max = totalFrames;
            els.frameDisplay.innerText = `${currentFrame} / ${totalFrames}`;
            break;
        case 'P5_ERROR': log("Runtime Error", d.payload, "error"); break;
        case 'REQUEST_ASSET_BY_NAME':
            const reqName = d.payload.name;
            const asset = projectAssets.find(a => a.name === reqName);
            if (asset) {
                els.frame.contentWindow.postMessage({
                    type: 'ASSET_DATA_RESPONSE',
                    payload: { name: asset.name, type: asset.type, dataUrl: asset.dataUrl }
                }, '*');
            } else { log("Warn", `Missing asset: ${reqName}`, "warn"); }
            break;
    }
});

async function loadFromServer(id) {
    showLoading("Downloading Template...");
    const email = localStorage.getItem('freyster_user') || "";
    const key = localStorage.getItem('freyster_key') || "";

    try {
        const url = `${CONFIG.API_URL}?action=load_template&id=${id}&email=${encodeURIComponent(email)}&userKey=${key}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.success) {
            currentCloudId = id;
            editorCM.setValue(data.p5_code);
            setTimeout(updatePreview, 100);
            log("System", "Template loaded.");
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        log("Error", e.message, "error");
        editorCM.setValue(getDefaultTemplate());
        updatePreview();
    } finally {
        hideLoading();
    }
}

function handleAssetUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        projectAssets.push({ type: file.type, name: file.name, dataUrl: evt.target.result });
        renderAssetList();
        updatePreview();
    };
    reader.readAsDataURL(file);
}

function renderAssetList() {
    els.assetList.innerHTML = '';
    projectAssets.forEach((asset, i) => {
        const div = document.createElement('div');
        div.className = 'asset-item';
        div.setAttribute('draggable', true);
        div.dataset.index = i;
        let thumb = asset.type.startsWith('image/')
            ? `<img src="${asset.dataUrl}" class="asset-thumb">`
            : `<span class="asset-thumb material-symbols-outlined">movie</span>`;
        div.innerHTML = `${thumb}<span class="asset-name">${asset.name}</span>
            <div class="asset-item-actions"><button class="btn-icon del-btn"><span class="material-symbols-outlined">delete</span></button></div>`;
        div.querySelector('.del-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            projectAssets.splice(i, 1);
            renderAssetList();
            updatePreview();
        });
        div.addEventListener('dragstart', (e) => { dragStartIndex = i; div.classList.add('dragging'); });
        div.addEventListener('dragend', () => div.classList.remove('dragging'));
        els.assetList.appendChild(div);
    });
}

function handleDragOver(e) { e.preventDefault(); }
function handleDrop(e) { e.preventDefault(); /* Simplify logic for brevity */ }

// Playback
function togglePlay() {
    isPlaying = !isPlaying;
    els.playBtn.innerHTML = isPlaying ? '<span class="material-symbols-outlined">pause</span>' : '<span class="material-symbols-outlined">play_arrow</span>';
    if (isPlaying) { els.frame.contentWindow.postMessage({ type: 'INITIALIZE_AUDIO' }, '*'); animate(); }
    else { cancelAnimationFrame(animationId); }
}

function animate() {
    if (!isPlaying) return;
    currentFrame = (currentFrame + 1) % totalFrames;
    seek(currentFrame);
    animationId = requestAnimationFrame(animate);
}

function seek(frame) {
    currentFrame = frame;
    els.timeline.value = frame;
    els.frameDisplay.innerText = `${frame} / ${totalFrames}`;
    if (els.frame.contentWindow) els.frame.contentWindow.postMessage({ type: 'SEEK_FRAME', frame: frame }, '*');
}

async function publishProject() {
    if (!els.auth.email || !els.auth.key) { alert("Authentication missing."); return; }
    const name = prompt("Template Name:");
    if (!name) return;

    showLoading("Publishing...");
    const payload = {
        action: 'publish_template',
        id: currentCloudId,
        name: name,
        creatorEmail: els.auth.email,
        userKey: els.auth.key,
        jsContent: editorCM.getValue(),
        variables: currentConfig
    };

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.success) { alert("✅ Published!"); }
        else { alert("Publish Failed: " + data.error); }
    } catch (e) { log("Error", e.message, "error"); }
    finally { hideLoading(); }
}

window.switchMobileTab = function (name, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    Object.values(els.panels).forEach(p => p.classList.remove('active'));
    if (els.panels[name]) els.panels[name].classList.add('active');
    if (name === 'code' && editorCM) setTimeout(() => editorCM.refresh(), 100);
}

function log(src, msg, type = 'info') {
    const d = document.createElement('div');
    const color = type === 'error' ? 'red' : (type === 'warn' ? 'orange' : '#00b6ff');
    d.innerHTML = `<span style="opacity:0.5">[${new Date().toLocaleTimeString()}]</span> <strong style="color:${color}">${src}:</strong> ${msg}`;
    els.console.appendChild(d);
    els.console.scrollTop = els.console.scrollHeight;
}

function showLoading(txt, sub = "") {
    document.getElementById('loading-text').innerText = txt;
    if (document.getElementById('loading-subtext')) document.getElementById('loading-subtext').innerText = sub;
    els.modals.loading.classList.remove('hidden');
}

function hideLoading() { els.modals.loading.classList.add('hidden'); }

function getDefaultTemplate() {
    return `// ==========================================
// Freyster Template: The Penthouse Chat
// ==========================================

// @label Header Name @type text
// @description The name of the group chat or contact displayed at the top.
let chatName = "The Penthouse";

// @label Background Color @type color
// @description The hex color code for the app background.
let bgColor = "#141414";

// @label Default 'Me' Color @type color
// @description Hex color for message bubbles sent by the main user (right side).
let myColor = "#00ffcc";

// @label Default 'Them' Color @type color
// @description Hex color for message bubbles sent by others (left side).
let theirColor = "#ff0055";

// @label Name to Color Map @type text
let nameColors = "ZAY:#FF0055, TY:#00FFCC";

// @label Script @type textarea
// @description Chat history. Format: "NAME: Message".
let scriptText = "ZAY: wait stop scrolling for a sec\n ZAY: u guys are actually not gonna believe this\n TY: what now\n RIA: zay if this is another fake leak istg\n ZAY: its not a leak\n ZAY: i am literally standing outside the venue right now\n TY: the warehouse one?\n TY: nobody has the address yet\n RIA: yeah the group chat has been dead for hours because of it\n ZAY: check this\n ZAY: [SNAP]\n RIA: NO WAY\n RIA: how did u even get the qr code??\n TY: wait the invite has your name on it\n TY: ur actually the goat for this\n ZAY: if u want the drop for the next one hit the like button right now\n RIA: already liked it\n RIA: send the location pin or i am blocking u lol\n ZAY: check your dms in 5 seconds\n TY: lets gooo\n";

// --- INTERNAL STATE ---
let parsedScript = [];
let lastScriptHash = ""; // To detect changes
let totalScriptFrames = 300;
let availableImages = [];

function setup() {
    createCanvas(1080, 1920);
    textAlign(LEFT, TOP);
    
    // Get list of images for the [SNAP] logic
    // We filter for images only
    availableImages = os.files.list().filter(f => f.match(/\.(jpg|jpeg|png|webp|gif)$/i));
    
    // Initial Parse
    parseScriptLogic();
}

function render(t) {
    // 1. Detect if the user changed the script or colors in the UI
    if (scriptText !== lastScriptHash) {
        parseScriptLogic();
    }

    // 2. Calculate current frame based on progress 't'
    // We use the calculated total frames from the parser
    let currentFrame = t * totalScriptFrames;

    // 3. Draw Background
    background(bgColor);
    
    // 4. Calculate Theme Colors based on luminance
    const isDark = luminance(bgColor) < 0.5;
    const txtColor = isDark ? '#FFFFFF' : '#000000';
    const secondaryTxt = isDark ? '#888888' : '#666666';
    const borderColor = isDark ? '#1A1A1A' : '#EEEEEE';

    // 5. Calculate Scroll Position
    // We sum up the height of all active messages
    let totalContentHeight = parsedScript.reduce((acc, m) => 
        (currentFrame >= m.startFrame ? acc + m.totalH + 30 : acc), 0);
        
    let scrollY = 0;
    const viewBottom = height - 350; // Space reserved for bottom bar
    
    // If content exceeds view, scroll up
    if (totalContentHeight > viewBottom - 250) {
        scrollY = (viewBottom - 250) - totalContentHeight;
    }

    // 6. Draw Messages
    push();
    translate(0, scrollY);
    let yOffset = 250; // Start below header

    parsedScript.forEach((msg) => {
        if (currentFrame >= msg.startFrame) {
            // Fade in animation
            const alpha = constrain(map(currentFrame, msg.startFrame, msg.startFrame + 10, 0, 255), 0, 255);
            
            let c = color(msg.msgColor); 
            c.setAlpha(alpha);
            
            let tC = color(txtColor); 
            tC.setAlpha(alpha);

            // A. Sidebar Color Indicator
            fill(c); noStroke();
            rect(30, yOffset - 30, 8, msg.totalH - 20, 4);

            // B. Speaker Name
            textAlign(LEFT, TOP); textSize(30); textStyle(BOLD); fill(c);
            text(msg.speaker.toUpperCase(), 60, yOffset - 20);

            // C. Message Content (Text or Image)
            if (msg.isSnap) {
                // Determine which image to show based on order
                // If we have 3 images and this is the 4th snap, it wraps around
                let imgName = null;
                if (availableImages.length > 0) {
                    imgName = availableImages[msg.snapIndex % availableImages.length];
                }

                if (imgName && os.files.exists(imgName)) {
                    // Use OS API to get image
                    let img = os.files.get(imgName);
                    
                    // Aspect Ratio handling could go here, for now strictly 300x400
                    image(img, 60, yOffset + 20, 300, 400);
                } else {
                    // Placeholder if no image uploaded
                    fill(snapColor); 
                    rect(60, yOffset + 20, 300, 400, 20);
                    
                    fill(0); noStroke();
                    textAlign(CENTER, CENTER); textSize(20);
                    text("UPLOAD IMAGE\nFOR [SNAP]", 210, yOffset + 220);
                }
            } else {
                fill(tC); textAlign(LEFT, TOP); textStyle(NORMAL); 
                textLeading(52); textSize(44);
                text(msg.text, 60, yOffset + 20, 880);
            }
            
            // Advance Y position for next message
            yOffset += msg.totalH + 30;
        }
    });
    pop();

    // 7. Draw UI Overlays (Header & Footer)
    renderHeader(txtColor, secondaryTxt, borderColor);
    renderBottomBar(txtColor, secondaryTxt, borderColor);
}

// --- LOGIC: SCRIPT PARSER ---
function parseScriptLogic() {
    lastScriptHash = scriptText; // Mark as processed
    
    const lines = scriptText.split('\n').filter(line => line.includes(':'));
    parsedScript = [];
    
    let frameCounter = 30; // Start with a small delay
    let snapCounter = 0;

    // Parse Name Colors: "Name:Color, Name2:Color2"
    const colorMap = {};
    if (nameColors) {
        nameColors.split(',').forEach(pair => {
            const parts = pair.split(':');
            if (parts.length === 2) {
                colorMap[parts[0].trim().toLowerCase()] = parts[1].trim();
            }
        });
    }

    for (const line of lines) {
        const parts = line.split(':');
        const speaker = parts.shift().trim();
        const text = parts.join(':').trim();
        
        const isMe = speaker.toLowerCase() === 'me';
        const isSnap = text.toUpperCase().includes("[SNAP]");

        // Resolve Color
        let msgColor = isMe ? myColor : theirColor;
        if (colorMap[speaker.toLowerCase()]) {
            msgColor = colorMap[speaker.toLowerCase()];
        }

        let snapIndex = isSnap ? snapCounter++ : -1;

        // Calculate Height
        textSize(44);
        let h = isSnap ? 450 : (Math.ceil(textWidth(text) / 850) * 52) + 80;

        parsedScript.push({
            speaker, 
            text, 
            isSnap, 
            isMe, 
            snapIndex, 
            msgColor,
            startFrame: frameCounter,
            totalH: h
        });

        // Add time for reading
        frameCounter += isSnap ? 90 : 45 + (text.length * 1.5);
    }
    
    // Update System Duration
    totalScriptFrames = frameCounter + 60; // Add padding at end
    duration(totalScriptFrames);
}

// --- HELPERS: UI DRAWING ---
function renderHeader(txt, sec, brd) {
    fill(bgColor); noStroke(); rect(0, 0, width, 220);
    stroke(brd); strokeWeight(2); line(0, 220, width, 220);
    
    // Back Arrow
    stroke(myColor); strokeWeight(6); noFill();
    beginShape(); vertex(60, 115); vertex(40, 100); vertex(60, 85); endShape();
    
    // Avatar
    noStroke(); fill(brd); ellipse(130, 100, 90, 90);
    
    // Text
    fill(txt); textAlign(LEFT, CENTER); textStyle(BOLD); textSize(48);
    text(chatName, 200, 85);
    fill(sec); textStyle(NORMAL); textSize(28); 
    text("Snapchat", 200, 125);
}

function renderBottomBar(txt, sec, brd) {
    fill(bgColor); noStroke(); 
    rect(0, height - 150, width, 150);
    
    stroke(brd); strokeWeight(2); 
    line(0, height - 150, width, height - 150);
    
    // Camera Icon Placeholder
    fill(sec); ellipse(70, height - 75, 75, 75);
    
    // Text Input Bar
    fill(brd); rect(140, height - 115, 700, 80, 40);
    
    fill(sec); textAlign(LEFT, CENTER); textSize(36); noStroke();
    text("Send a chat", 180, height - 75);
}

function luminance(col) {
    let c = color(col);
    return (0.299 * red(c) + 0.587 * green(c) + 0.114 * blue(c)) / 255;
}
`;
}
function clearConsole() { els.console.innerHTML = ''; }