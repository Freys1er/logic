export const INJECTED_SYSTEM_CODE = `
<script>
// --- INTERNAL STATE ---
let state = {};
let currentFrame = 0;
let _sysTotalFrames = 300;
const _assetCache = {};
const _assetWaitList = {};
let _availableAssets = [];
let _speechSynth;

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

            if (assetInfo.type.startsWith('image/')) {
                const placeholder = createImage(1, 1);
                _assetCache[filename] = placeholder;
                window.parent.postMessage({ type: 'REQUEST_ASSET_BY_NAME', payload: { name: filename } }, '*');
                _assetWaitList[filename] = (img) => {
                    placeholder.width = img.width;
                    placeholder.height = img.height;
                    placeholder.drawingContext = img.drawingContext;
                    placeholder.canvas = img.canvas;
                    if(typeof redraw === 'function') redraw();
                };
                return placeholder;
            }
            if(!_assetWaitList[filename]) {
                 _assetWaitList[filename] = true;
                 window.parent.postMessage({ type: 'REQUEST_ASSET_BY_NAME', payload: { name: filename } }, '*');
            }
            return null;
        }
    },
    sound: {
        play: (filename) => {
            const sound = _assetCache[filename];
            if (sound && typeof sound.play === 'function' && sound.isLoaded()) {
                if (!sound.isPlaying()) {
                    sound.play();
                    window.parent.postMessage({ type: 'LOG', payload: { src: 'p5.js', msg: \`Playing sound: \${filename}\`} }, '*');
                }
                return true; // Success
            } else if (os.files.exists(filename)) {
                os.files.get(filename); // Request if not cached
            }
            return false; // Failure (not loaded yet)
        },
        speak: (text, voice = 'Google US English', rate = 1.0, pitch = 1.0) => {
            if (_speechSynth && _speechSynth.voices && _speechSynth.voices.length > 0) {
                _speechSynth.setVoice(voice);
                _speechSynth.setRate(rate);
                _speechSynth.setPitch(pitch);
                _speechSynth.speak(text);
                window.parent.postMessage({ type: 'LOG', payload: { src: 'p5.js', msg: \`Speaking: "\${text.substring(0, 25)}..."\` } }, '*');
                return true;
            }
            return false;
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
                loadSound(dataUrl, (soundFile) => {
                    _assetCache[name] = soundFile;
                    delete _assetWaitList[name];
                    window.parent.postMessage({ type: 'LOG', payload: { src: 'p5.js', msg: \`Sound '\${name}' loaded successfully.\` } }, '*');
                }, (err) => window.parent.postMessage({ type: 'P5_ERROR', payload: \`Sound load error: \${name}\` }, '*'));
            }
            break;
        case 'UPDATE_STATE':
            state = data.payload;
            if(typeof redraw === 'function') redraw();
            break;
        case 'SEEK_FRAME':
            currentFrame = data.frame;
            if (!data.isPlaying) { // Stop all sounds if seeking manually (not during playback)
                Object.values(_assetCache).forEach(asset => {
                    if (asset instanceof p5.SoundFile && asset.isPlaying()) asset.stop();
                });
                if(_speechSynth && _speechSynth.speaking) _speechSynth.cancel();
            }
            if(typeof redraw === 'function') redraw();
            window.parent.postMessage({ type: 'P5_FRAME_RENDERED' }, '*');
            break;
        case 'INITIALIZE_AUDIO':
            if (getAudioContext().state !== 'running') getAudioContext().resume();
            break;
    }
});

// --- P5.JS HOOKS ---
const _userSetup = window.setup || function(){};
const _userDraw = window.draw || null;

window.setup = function() {
    try { 
        _speechSynth = new p5.Speech();
        _userSetup(); 
    } catch(e) { window.parent.postMessage({ type: 'P5_ERROR', payload: e.message }, '*'); }
    window.parent.postMessage({ type: 'P5_READY' }, '*');
};

window.draw = function() {
    Object.assign(window, state); // Make form variables global
    let t = _sysTotalFrames > 0 ? currentFrame / _sysTotalFrames : 0;
    try {
        if (typeof render === 'function') { push(); render(t, currentFrame); pop(); } 
        else if (_userDraw) { _userDraw(); }
    } catch(e) {
        noLoop();
        window.parent.postMessage({ type: 'P5_ERROR', payload: "Runtime: " + e.message }, '*');
    }
};
</script>
`;