// --- INJECTED SYSTEM LOGIC (The "OS" & Engine) ---
let currentCloudId = null; // Tracks if we are editing an existing cloud file

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

// --- 2. THE "OS" API (Public Helper for Users) ---
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
                // Request the heavy data (base64) from parent
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
            } else {
                console.warn('[OS] File not found:', filename);
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

// --- 3. COMMUNICATION PROTOCOL ---
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
        // Trigger loop for immediate visual feedback
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

// --- 4. ENGINE & RENDER LOOP ---
const _userSetup = window.setup || function(){};

window.setup = function() {
    try {
        _userSetup();
    } catch(e) {
        window.parent.postMessage({ type: 'P5_ERROR', payload: e.message }, '*');
    }
    window.parent.postMessage({ type: 'P5_READY' }, '*');
};

window.draw = function() {
    // 1. Inject State into Global Scope
    if (typeof state !== 'undefined') {
        for (let key in state) {
            // We use standard assignment. 
            // Because we converted 'let' to 'var' in updatePreview, 
            // these variables are now on 'window' and can be updated!
            if (typeof window[key] !== 'undefined') {
                window[key] = state[key];
            }
        }
    }

    // 2. Calculate Progress (t)
    let t = 0;
    if (_sysTotalFrames > 0) t = currentFrame / _sysTotalFrames;

    // 3. Execute User Render
    try {
        if (typeof render === 'function') {
            push();
            render(t); 
            pop();
        } else if (typeof _userDraw === 'function') {
            _userDraw(); 
        }
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
        code: document.getElementById('code-panel'),
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
let animationId;
let currentFrame = 0;
let totalFrames = 300;
let currentBlobUrl = null;
let dragStartIndex;
let saveTimeout;

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
        mode: "javascript",
        theme: "dracula",
        lineNumbers: true,
        lineWrapping: true
    });

    editorCM.on("change", (cm, changeObj) => {
        if (changeObj && changeObj.origin === 'from_form') return;

        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            updatePreview();
            document.getElementById('save-status').innerText = "Saved";
        }, 800);
    });
}

function initEventListeners() {
    document.getElementById('run-code-btn').addEventListener('click', updatePreview);
    document.getElementById('format-code-btn').addEventListener('click', () => {
        editorCM.execCommand("selectAll");
        editorCM.execCommand("indentAuto");
    });
    document.getElementById('export-video-btn').addEventListener('click', exportWebM);
    document.getElementById('publish-btn').addEventListener('click', publishProject);

    els.playBtn.addEventListener('click', togglePlay);
    els.timeline.addEventListener('input', (e) => seek(parseInt(e.target.value)));

    els.toggleDev.addEventListener('change', (e) => {
        const isDev = e.target.checked;
        els.panels.code.classList.toggle('hidden', !isDev);
        if (els.panels.resizer) els.panels.resizer.classList.toggle('hidden', !isDev);
        if (isDev) setTimeout(() => editorCM.refresh(), 10);
    });

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
                if (newL > 200 && newR > 200) {
                    left.style.flexBasis = `${newL}px`;
                    right.style.flexBasis = `${newR}px`;
                    left.style.flexGrow = '0';
                    right.style.flexGrow = '0';
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
    // console.group("--- Parsing Magic Variables ---");
    const config = [];
    const lines = code.split('\n');
    let pendingConfig = null;

    lines.forEach((line, index) => {
        const cleanLine = line.trim();

        // 1. Check for Magic Comment
        const commentMatch = cleanLine.match(/\/\/\s*@label\s+(.+?)\s+@type\s+(\w+)/);

        // 2. Check for Variable Declaration
        const varMatch = cleanLine.match(/(?:let|var)\s+(\w+)\s*=\s*(["'].*?["]|[^;/\n]+)/);

        if (commentMatch && !varMatch) {
            pendingConfig = {
                label: commentMatch[1].trim(),
                type: commentMatch[2].trim()
            };
        }
        else if (varMatch) {
            const varName = varMatch[1];
            const rawVal = varMatch[2].trim();

            let finalVal = rawVal;

            // --- FIX FOR BACKSLASHES ---
            // We use new Function to parse the JS literal correctly.
            // e.g. '"C:\\Path"' becomes 'C:\Path'
            if ((rawVal.startsWith('"') && rawVal.endsWith('"')) ||
                (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
                try {
                    // This evaluates the string literal safely
                    finalVal = new Function('return ' + rawVal)();
                } catch (e) {
                    // Fallback if parsing fails (remove quotes manually)
                    finalVal = rawVal.slice(1, -1);
                }
            }

            let activeConfig = null;
            if (commentMatch) {
                activeConfig = {
                    label: commentMatch[1].trim(),
                    type: commentMatch[2].trim()
                };
            } else if (pendingConfig) {
                activeConfig = pendingConfig;
            }

            if (activeConfig) {
                config.push({
                    id: varName,
                    label: activeConfig.label,
                    type: activeConfig.type,
                    defaultValue: finalVal
                });
            }
            pendingConfig = null;
        }
    });

    // console.groupEnd();
    return config;
}

function updatePreview() {
    let userCode = editorCM.getValue();

    // 1. Build Form
    let config = parseUserConfig(userCode);
    if (config.length === 0) {
        try {
            const m = userCode.match(/const\s+templateConfig\s*=\s*(\[[\s\S]*?\]);/);
            if (m) config = new Function(`return ${m[1]}`)();
        } catch (e) { }
    }
    if (config && config.length > 0) buildForm(config);

    // 2. PREPARE ASSETS (INJECTION FIX)
    // We inject the list directly so it is available immediately in setup()
    const assetMeta = projectAssets.map(a => ({ name: a.name, type: a.type }));
    const systemCodeWithAssets = INJECTED_SYSTEM_CODE.replace(
        'let _availableAssets = [];',
        `let _availableAssets = ${JSON.stringify(assetMeta)};`
    );

    // 3. PREPARE USER CODE (VARIABLE FIX)
    // We convert magic 'let' variables to 'var' so they attach to window
    // This allows the system to update them dynamically
    if (config) {
        config.forEach(field => {
            // Replace "let varName =" with "var varName ="
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

function buildForm(config) {
    els.form.innerHTML = '';

    // --- 1. CREATE SAVE BUTTON ---
    const btnContainer = document.createElement('div');
    btnContainer.style.marginBottom = "15px";
    btnContainer.style.textAlign = "right";

    const saveBtn = document.createElement('button');
    saveBtn.innerText = "Save Variables";
    saveBtn.className = "btn-primary"; // Re-using existing class if available
    saveBtn.style.width = "100%";
    saveBtn.style.padding = "10px";
    saveBtn.style.cursor = "pointer";
    saveBtn.style.backgroundColor = "#007ca9ff";
    saveBtn.style.color = "white";
    saveBtn.style.border = "none";
    saveBtn.style.borderRadius = "4px";
    saveBtn.style.fontSize = "14px";

    // Click Handler for Saving
    saveBtn.addEventListener('click', () => {
        saveVariablesToCode(); // Call the new save function
        // Visual feedback
        const oldText = saveBtn.innerText;
        saveBtn.innerText = "✅ Saved!";
        setTimeout(() => saveBtn.innerText = oldText, 1000);
    });

    els.form.appendChild(btnContainer);

    // --- 2. BUILD INPUTS ---
    config.forEach(field => {
        const group = document.createElement('div');
        group.className = 'input-group';

        const label = document.createElement('label');
        label.innerText = field.label;

        let input;
        if (field.type === 'textarea') {
            input = document.createElement('textarea');
            input.rows = 4;
        } else {
            input = document.createElement('input');
            input.type = field.type;
        }

        input.value = field.defaultValue;
        input.dataset.id = field.id;

        // REMOVED: input.addEventListener('input', pushStateToFrame); 
        // We no longer auto-save on typing!

        group.appendChild(label);
        group.appendChild(input);
        els.form.appendChild(group);
    });


    btnContainer.appendChild(saveBtn);
}

function saveVariablesToCode() {
    const state = {};
    let code = editorCM.getValue();
    let hasChanged = false;

    els.form.querySelectorAll('input, textarea').forEach(inp => {
        const id = inp.dataset.id;
        const val = inp.value;
        state[id] = val;

        // 1. Find the variable in the code
        const typeCheckRegex = new RegExp(`((?:let|var)\\s+${id}\\s*=\\s*)(["']?)`, '');
        const typeMatch = typeCheckRegex.exec(code);

        if (typeMatch) {
            const prefix = typeMatch[1];
            const quote = typeMatch[2];

            let newValFormatted;
            let replaceRegex;
            let comparisonVal; // The value we compare against the existing code

            if (quote) {
                // --- STRING HANDLING ---
                const escapedVal = val
                    .replace(/\\/g, '\\\\')
                    .replace(new RegExp(quote, 'g'), `\\${quote}`)
                    .replace(/\n/g, '\\n');

                newValFormatted = `${quote}${escapedVal}${quote}`;
                comparisonVal = escapedVal; // In code, we look for the escaped version inside quotes

                // Regex: Group 1 (Prefix), Group 2 (Content inside quotes)
                replaceRegex = new RegExp(`((?:let|var)\\s+${id}\\s*=\\s*)${quote}(.*?)${quote}`);
            } else {
                // --- NUMBER/BOOL HANDLING ---
                newValFormatted = val;
                comparisonVal = val; // In code, we look for the raw value

                // Regex: Group 1 (Prefix), Group 2 (Raw Value)
                replaceRegex = new RegExp(`((?:let|var)\\s+${id}\\s*=\\s*)([^;\\/\\n]+)`);
            }

            const match = replaceRegex.exec(code);

            if (match && match[2] !== undefined) {
                const currentCodeVal = match[2];

                // Only replace if the content is actually different
                // We trim() to ignore accidental spaces in numbers (e.g. "100 " vs "100")
                if (currentCodeVal !== comparisonVal && currentCodeVal.trim() !== comparisonVal.trim()) {
                    code = code.replace(replaceRegex, `$1${newValFormatted}`);
                    hasChanged = true;
                }
            }
        }
    });

    if (hasChanged) {
        const cursor = editorCM.getCursor();
        const info = editorCM.getScrollInfo();

        editorCM.setValue(code);
        editorCM.setCursor(cursor);
        editorCM.scrollTo(info.left, info.top);

        localStorage.setItem('fs_autosave', code);
    }

    if (els.frame.contentWindow) {
        els.frame.contentWindow.postMessage({ type: 'UPDATE_STATE', payload: state }, '*');
    }
}
// ===================================================================================
// --- PARENT / CHILD COMMUNICATION ---
// ===================================================================================
window.addEventListener('message', (e) => {
    if (e.source !== els.frame.contentWindow) return;
    const d = e.data;

    switch (d.type) {
        case 'P5_READY':
            // Sync Form State
            pushStateToFrame();
            log("System", "Preview Ready");
            break;

        case 'DURATION_UPDATE':
            totalFrames = d.totalFrames;
            els.timeline.max = totalFrames;
            els.frameDisplay.innerText = `${currentFrame} / ${totalFrames}`;
            break;

        case 'P5_ERROR':
            log("Runtime Error", d.payload, "error");
            break;

        case 'REQUEST_ASSET_BY_NAME':
            const reqName = d.payload.name;
            const asset = projectAssets.find(a => a.name === reqName);
            if (asset) {
                els.frame.contentWindow.postMessage({
                    type: 'ASSET_DATA_RESPONSE',
                    payload: { name: asset.name, type: asset.type, dataUrl: asset.dataUrl }
                }, '*');
            } else {
                log("Warn", `Missing asset requested: ${reqName}`, "warn");
            }
            break;
    }
});

// ===================================================================================
// --- ASSET HANDLING ---
// ===================================================================================
function handleAssetUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        const exists = projectAssets.some(a => a.name === file.name);
        if (exists) {
            alert("File exists.");
            return;
        }

        projectAssets.push({
            type: file.type,
            name: file.name,
            dataUrl: evt.target.result
        });

        renderAssetList();
        log("System", `Asset loaded: ${file.name}`);
        updatePreview(); // Re-injects HTML with new asset list
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

        div.innerHTML = `
            ${thumb}
            <span class="asset-name">${asset.name}</span>
            <div class="asset-item-actions">
                <button class="btn-icon del-btn"><span class="material-symbols-outlined">delete</span></button>
            </div>
        `;

        div.querySelector('.del-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Delete ' + asset.name + '?')) {
                projectAssets.splice(i, 1);
                renderAssetList();
                updatePreview();
            }
        });

        div.addEventListener('dragstart', (e) => { dragStartIndex = i; div.classList.add('dragging'); });
        div.addEventListener('dragend', () => div.classList.remove('dragging'));

        els.assetList.appendChild(div);
    });
}

function handleDragOver(e) {
    e.preventDefault();
    const draggingEl = els.assetList.querySelector('.dragging');
    const afterEl = getDragAfterElement(els.assetList, e.clientY);
    if (!afterEl) els.assetList.appendChild(draggingEl);
    else els.assetList.insertBefore(draggingEl, afterEl);
}

function handleDrop(e) {
    e.preventDefault();
    const draggingEl = els.assetList.querySelector('.dragging');
    const newIndex = Array.from(els.assetList.children).indexOf(draggingEl);
    if (newIndex !== dragStartIndex) {
        const [moved] = projectAssets.splice(dragStartIndex, 1);
        projectAssets.splice(newIndex, 0, moved);
    }
    renderAssetList();
    updatePreview();
}

function getDragAfterElement(container, y) {
    const els = [...container.querySelectorAll('.asset-item:not(.dragging)')];
    return els.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        else return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// ===================================================================================
// --- PLAYBACK ---
// ===================================================================================
function togglePlay() {
    isPlaying = !isPlaying;
    els.playBtn.innerHTML = isPlaying
        ? '<span class="material-symbols-outlined">pause</span>'
        : '<span class="material-symbols-outlined">play_arrow</span>';

    if (isPlaying) {
        els.frame.contentWindow.postMessage({ type: 'INITIALIZE_AUDIO' }, '*');
        animate();
    } else {
        cancelAnimationFrame(animationId);
    }
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
    if (els.frame.contentWindow) {
        els.frame.contentWindow.postMessage({ type: 'SEEK_FRAME', frame: frame }, '*');
    }
}

// ===================================================================================
// --- SERVER & EXPORT ---
// ===================================================================================
async function loadFromServer(id) {
    showLoading("Downloading Template...");

    // 1. Get credentials from storage
    const email = localStorage.getItem('freyster_user') || "";
    const key = localStorage.getItem('freyster_key') || "";

    try {
        // 2. Attach them to the URL
        const url = `${CONFIG.API_URL}?action=load_template&id=${id}&email=${encodeURIComponent(email)}&userKey=${key}`;

        const res = await fetch(url);
        const data = await res.json();

        if (data.success) {
            currentCloudId = id;
            editorCM.setValue(data.p5_code);
            updatePreview();
            log("System", "Template loaded.");
        } else {
            // This handles errors like "Subscription required" or "Login required"
            throw new Error(data.error);
        }
    } catch (e) {
        log("Error", e.message, "error");

        // Optional: If auth failed, maybe don't overwrite with default template immediately?
        // But keeping your logic safe:
        editorCM.setValue(getDefaultTemplate());
        updatePreview();
    } finally {
        hideLoading();
    }
}

async function publishProject() {
    // 1. Basic Auth Check
    if (!els.auth.email || !els.auth.key) {
        alert("Authentication missing. Please login.");
        return;
    }

    // ===============================================
    // 2. CLIENT-SIDE PREMIUM CHECK (Optimization)
    // ===============================================
    const currentTier = localStorage.getItem('freyster_tier');

    // If NOT premium, stop right here. Don't even bother the server.
    if (currentTier !== 'premium_monthly') {
        if (confirm("🔒 Publishing is a Pro feature.\n\nClick OK to upgrade to Premium!")) {
            const stripeUrl = "https://buy.stripe.com/aFa5kw6IB0pe1Im47d4ko00?prefilled_email=" + encodeURIComponent(els.auth.email);
            window.open(stripeUrl, '_blank');
        }
        return; // <--- STOP EXECUTION
    }

    // 3. Name Prompt
    const name = prompt("Template Name:");
    if (!name) return;

    showLoading("Publishing...");

    const currentVars = parseUserConfig(editorCM.getValue());

    const payload = {
        action: 'publish_template',
        id: currentCloudId,
        name: name,
        creatorEmail: els.auth.email,
        userKey: els.auth.key,
        jsContent: editorCM.getValue(),
        variables: currentVars
    };

    try {
        // 4. Send Request (Standard Mode, NOT no-cors)
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.success) {
            alert("✅ Published successfully!");
        } else {
            // Backup check in case they faked localStorage but server blocked them
            if (data.error.includes("Premium")) {
                alert("Server rejected: Premium subscription required.");
            } else {
                alert("Publish Failed: " + data.error);
            }
        }
    } catch (e) {
        log("Error", "Publishing failed: " + e.message, "error");
    } finally {
        hideLoading();
    }
}

async function exportWebM() {
    if (isPlaying) togglePlay();
    showLoading("Rendering Video...");

    const capturer = new CCapture({ format: 'webm', framerate: 60, name: 'freyster_export' });
    let frameResolver = null;

    const onFrame = (e) => {
        if (e.source === els.frame.contentWindow && e.data.type === 'P5_FRAME_RENDERED') {
            if (frameResolver) frameResolver();
        }
    };
    window.addEventListener('message', onFrame);

    capturer.start();

    for (let i = 0; i < totalFrames; i++) {
        document.getElementById('loading-subtext').innerText = `${i}/${totalFrames}`;
        await new Promise(r => { frameResolver = r; seek(i); });

        const canvas = els.frame.contentWindow.document.querySelector('canvas');
        if (canvas) capturer.capture(canvas);
    }

    capturer.stop();
    capturer.save();
    window.removeEventListener('message', onFrame);
    hideLoading();
}

// ===================================================================================
// --- UTILS ---
// ===================================================================================
function log(src, msg, type = 'info') {
    const d = document.createElement('div');
    const color = type === 'error' ? 'red' : (type === 'warn' ? 'orange' : '#00b6ff');
    d.innerHTML = `<span style="opacity:0.5">[${new Date().toLocaleTimeString()}]</span> <strong style="color:${color}">${src}:</strong> ${msg}`;
    els.console.appendChild(d);
    els.console.scrollTop = els.console.scrollHeight;
}

function showLoading(txt, sub = "") {
    document.getElementById('loading-text').innerText = txt;
    document.getElementById('loading-subtext').innerText = sub;
    els.modals.loading.classList.remove('hidden');
}

function hideLoading() { els.modals.loading.classList.add('hidden'); }

function getDefaultTemplate() {
    return `// ==========================================
// Freyster Template: OS & Magic Config
// ==========================================

// @label Main Text @type text
let msg = "Hello Freyster";

// @label Text Color @type color
let txtColor = "#ffffff";

// @label Background @type color
let bgColor = "#00B6FF";

function setup() {
    createCanvas(1080, 1920);
    textAlign(CENTER, CENTER);
    textSize(100);
    
    // Set duration to 5 seconds (30fps)
    duration(150); 
    
    // Check available files
    console.log("Files:", os.files.list());
}

function render(t) {
    background(bgColor);
    
    fill(txtColor);
    noStroke();
    
    // Simple slide up animation
    let y = height/2 - (t * 200);
    
    text(msg, width/2, y);
    
    // Progress bar
    stroke(255);
    strokeWeight(10);
    line(0, height-20, width * t, height-20);
}`;
}


function clearConsole() { els.console.innerHTML = ''; }