
// --- START OF FILE ui-manager.js ---

import { state, els } from './state.js';
import { saveVariablesToCode } from './preview-manager.js';
import { generateWithAI } from './api.js';

export function initUIManager() {
    const resizers = document.querySelectorAll('.resizer-vertical');
    resizers.forEach(resizer => resizer.addEventListener('mousedown', initDrag));

    if (els.toggleDev) {
        els.toggleDev.addEventListener('change', (e) => {
            const isDev = e.target.checked;
            els.panels.code.classList.toggle('visible', isDev);
            document.getElementById('code-panel-resizer').classList.toggle('hidden', !isDev);
            els.publishBtn.hidden = !isDev;
            if (isDev) setTimeout(() => state.editorCM.refresh(), 10);
        });
    }

    document.getElementById('tab-btn-settings').addEventListener('click', (e) => switchMobileTab('settings', e.currentTarget));
    document.getElementById('tab-btn-preview').addEventListener('click', (e) => switchMobileTab('preview', e.currentTarget));
    document.getElementById('tab-btn-assets').addEventListener('click', (e) => switchMobileTab('assets', e.currentTarget));
    document.getElementById('tab-btn-code').addEventListener('click', (e) => switchMobileTab('code', e.currentTarget));
    document.getElementById('clear-console-btn').addEventListener('click', () => { els.console.innerHTML = ''; });
    document.getElementById('save-variables-btn').addEventListener('click', () => { saveVariablesToCode(); });

    // Add event listener for the cancel button
    document.getElementById('cancel-render-btn').addEventListener('click', () => {
        log("System", "Render cancelled by user.", "warn");
        state.isRenderingCancelled = true;
    });

    initAIMagicFill();
}

export function buildForm(config) {
    els.form.innerHTML = '';
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
        group.appendChild(input);
        els.form.appendChild(group);
    });
}

function switchMobileTab(name, btn) {
    els.publishBtn.hidden = !(name === 'code');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Object.values(els.panels).forEach(p => p.classList.remove('active'));
    if (els.panels[name]) els.panels[name].classList.add('active');
    if (name === 'code' && state.editorCM) setTimeout(() => state.editorCM.refresh(), 100);
}

function initDrag(e) {
    e.preventDefault();
    const resizer = e.target;
    const left = resizer.previousElementSibling;
    const startX = e.clientX;
    const leftW = left.offsetWidth;
    const onMove = (em) => {
        const dx = em.clientX - startX;
        const newL = leftW + dx;
        if (newL > 50 && (document.body.clientWidth - newL) > 50) {
            left.style.flexBasis = `${newL}px`;
        }
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

export function log(src, msg, type = 'info') {
    const d = document.createElement('div');
    const color = type === 'error' ? '#ff5555' : (type === 'warn' ? '#ffb86c' : '#50fa7b');
    d.innerHTML = `<span style="opacity:0.6">[${new Date().toLocaleTimeString()}]</span> <strong style="color:${color}">${src}:</strong> ${msg}`;
    els.console.appendChild(d);
    els.console.scrollTop = els.console.scrollHeight;
}

export function showLoading(txt, sub = "", options = {}) {
    document.getElementById('loading-text').innerText = txt;
    document.getElementById('loading-subtext').innerText = sub;
    const cancelBtn = document.getElementById('cancel-render-btn');
    if (options.showCancel) {
        cancelBtn.classList.remove('hidden');
    } else {
        cancelBtn.classList.add('hidden');
    }
    els.modals.loading.classList.remove('hidden');
}

export function hideLoading() {
    els.modals.loading.classList.add('hidden');
    document.getElementById('cancel-render-btn').classList.add('hidden');
}

function initAIMagicFill() {
    const magicBtn = document.getElementById('magic-fill-btn');
    const promptBox = document.getElementById('magic-prompt-box');
    const cancelBtn = document.getElementById('ai-cancel-btn');
    const submitBtn = document.getElementById('ai-submit-btn');
    const promptText = document.getElementById('ai-prompt-textarea');
    const statusText = document.getElementById('ai-status-text');

    magicBtn.addEventListener('click', () => {
        promptBox.classList.remove('hidden');
        magicBtn.classList.add('hidden');
    });

    cancelBtn.addEventListener('click', () => {
        promptBox.classList.add('hidden');
        magicBtn.classList.remove('hidden');
    });

    submitBtn.addEventListener('click', async () => {
        const prompt = promptText.value;
        if (!prompt) {
            alert("Please enter a prompt.");
            return;
        }

        submitBtn.disabled = true;
        promptText.disabled = true;
        statusText.innerText = "Generating...";

        try {
            const results = await generateWithAI(prompt, state.currentConfig);
            Object.keys(results).forEach(variableId => {
                const inputElement = els.form.querySelector(`[data-id="${variableId}"]`);
                if (inputElement) {
                    inputElement.value = results[variableId];
                }
            });
            saveVariablesToCode();
            promptText.value = "";
            promptBox.classList.add('hidden');
            magicBtn.classList.remove('hidden');
        } catch (error) {
            log('AI Error', error.message, 'error');
            alert(`AI Generation Failed: ${error.message}`);
        } finally {
            submitBtn.disabled = false;
            promptText.disabled = false;
            statusText.innerText = "";
        }
    });
}