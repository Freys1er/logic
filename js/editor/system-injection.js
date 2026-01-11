export const INJECTED_SYSTEM_CODE = `
<script>
// --- INTERNAL STATE ---
let state = {};
let currentFrame = 0;
let _sysTotalFrames = 300;
const _assetCache = {};
const _assetWaitList = {};
let _availableAssets = [];
let _isRecording = false;
let _voices = [];

// --- VOICE INITIALIZATION ---
function _loadVoices() {
    if ('speechSynthesis' in window) {
        _voices = window.speechSynthesis.getVoices();
        if (_voices.length === 0) {
            window.speechSynthesis.onvoiceschanged = () => {
                _voices = window.speechSynthesis.getVoices();
            };
        }
    }
}
_loadVoices();

// --- OS API ---
const os = {
    files: {
        list: () => _availableAssets.map(a => a.name),
        exists: (name) => _availableAssets.some(a => a.name === name),
        info: (name) => _availableAssets.find(a => a.name === name) || null,
        get: (filename) => {
            if (_assetCache[filename]) return _assetCache[filename];
            const assetInfo = os.files.info(filename);
            if (!assetInfo) return null;

            // --- FIXED: ADDED VIDEO HANDLING LOGIC ---
            if (assetInfo.type.startsWith('image/')) {
                const placeholder = createImage(1, 1);
                _assetCache[filename] = placeholder;
                window.parent.postMessage({ type: 'REQUEST_ASSET_BY_NAME', payload: { name: filename } }, '*');
                _assetWaitList[filename] = (img) => {
                    placeholder.width = img.width; placeholder.height = img.height;
                    placeholder.drawingContext = img.drawingContext; placeholder.canvas = img.canvas;
                    if(typeof redraw === 'function') redraw();
                };
                return placeholder;
            } else if (assetInfo.type.startsWith('video/')) {
                // Create an empty video element as a placeholder to prevent crashes
                const placeholder = createVideo('');
                _assetCache[filename] = placeholder;
                // Request the actual video data from the parent
                window.parent.postMessage({ type: 'REQUEST_ASSET_BY_NAME', payload: { name: filename } }, '*');
                return placeholder;
            } else if (assetInfo.type.startsWith('audio/')) {
                 if(!_assetWaitList[filename]) {
                     _assetWaitList[filename] = true;
                     window.parent.postMessage({ type: 'REQUEST_ASSET_BY_NAME', payload: { name: filename } }, '*');
                 }
            }
            return null;
        }
    },
    sound: {
        play: (filename) => {
            const soundAsset = _assetCache[filename];
            if (soundAsset && soundAsset instanceof Audio) {
                if (soundAsset.paused) { soundAsset.play().catch(e => {}); }
                return true;
            } else if (os.files.exists(filename) && !_assetWaitList[filename]) {
                os.files.get(filename);
            }
            return false;
        },
        speak: (text, voiceName = 'default', rate = 1.0, pitch = 1.0) => {
            if (!('speechSynthesis' in window)) { return false; }
            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.cancel();
            }
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = Math.max(0.1, Math.min(rate, 2));
            utterance.pitch = Math.max(0, Math.min(pitch, 2));
            if (_voices.length > 0) {
                let selectedVoice = _voices.find(v => v.name === voiceName);
                if (selectedVoice) { utterance.voice = selectedVoice; }
            }
            window.speechSynthesis.speak(utterance);
            return true;
        },
        listVoices: () => {
            if (_voices.length === 0) _loadVoices();
            return _voices.map(v => v.name);
        }
    },
    time: { progress: () => _sysTotalFrames > 0 ? currentFrame / _sysTotalFrames : 0, frame: () => currentFrame, duration: () => _sysTotalFrames },
    sys: { setDuration: (f) => { _sysTotalFrames = f; window.parent.postMessage({ type: 'DURATION_UPDATE', totalFrames: f }, '*'); } }
};
function duration(f) { os.sys.setDuration(f); }

// --- EVENT HANDLING ---
window.addEventListener('message', function(event) {
    if (event.source !== window.parent) return;
    const data = event.data;
    switch(data.type) {
        case 'ASSET_DATA_RESPONSE':
            const { name, type, dataUrl } = data.payload;
            if (type.startsWith('image/')) {
                loadImage(dataUrl, (loadedImg) => {
                    if (typeof _assetWaitList[name] === 'function') _assetWaitList[name](loadedImg);
                    _assetCache[name] = loadedImg;
                });
            } else if (type.startsWith('audio/')) {
                const audio = new Audio(dataUrl);
                _assetCache[name] = audio;
                delete _assetWaitList[name];
                window.parent.postMessage({ type: 'LOG', payload: { src: 'System', msg: \`Sound '\${name}' loaded.\` } }, '*');
            // --- FIXED: HANDLE VIDEO DATA WHEN IT ARRIVES ---
            } else if (type.startsWith('video/')) {
                const videoPlaceholder = _assetCache[name];
                if (videoPlaceholder && videoPlaceholder.elt) {
                    // Inject the source into the existing placeholder element and load it
                    videoPlaceholder.elt.src = dataUrl;
                    videoPlaceholder.load();
                    window.parent.postMessage({ type: 'LOG', payload: { src: 'System', msg: \`Video '\${name}' is loading.\` } }, '*');
                }
            }
            break;
        case 'UPDATE_STATE':
            state = data.payload;
            if(typeof redraw === 'function') redraw();
            break;
        case 'SEEK_FRAME':
            currentFrame = data.frame;
            if (!data.isPlaying) {
                Object.values(_assetCache).forEach(asset => {
                    if (asset instanceof Audio && !asset.paused) { asset.pause(); asset.currentTime = 0; }
                });
                if(window.speechSynthesis && window.speechSynthesis.speaking) { window.speechSynthesis.cancel(); }
            }
            if(typeof redraw === 'function') redraw();
            window.parent.postMessage({ type: 'P5_FRAME_RENDERED' }, '*');
            break;
        case 'PLAY_FOR_RECORDING':
            currentFrame = 0; _isRecording = true; loop();
            break;
        case 'INITIALIZE_AUDIO':
             _loadVoices();
             const context = new (window.AudioContext || window.webkitAudioContext)();
             if (context.state === 'suspended') { context.resume(); }
            break;
    }
});

// --- P5.JS HOOKS ---
const _userSetup = window.setup || function(){};
const _userDraw = window.draw || null;
window.setup = function() {
    try { _userSetup(); } catch(e) { window.parent.postMessage({ type: 'P5_ERROR', payload: e.message }, '*'); }
    if (typeof render === 'function' || _userDraw) { noLoop(); }
    window.parent.postMessage({ type: 'P5_READY' }, '*');
};
window.draw = function() {
    Object.assign(window, state);
    let t = _sysTotalFrames > 0 ? currentFrame / _sysTotalFrames : 0;
    try {
        if (typeof render === 'function') { push(); render(t, currentFrame); pop(); }
        else if (_userDraw) { _userDraw(); }
    } catch(e) {
        noLoop();
        window.parent.postMessage({ type: 'P5_ERROR', payload: "Runtime: " + e.message }, '*');
    }
    if (_isRecording) {
        if (currentFrame >= _sysTotalFrames - 1) {
            _isRecording = false; noLoop();
            window.parent.postMessage({ type: 'RECORDING_FINISHED' }, '*');
        } else { currentFrame++; }
    }
};
</script>
`;