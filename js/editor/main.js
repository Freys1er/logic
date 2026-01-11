import { state, els } from './state.js';
import { initUIManager } from './ui-manager.js';
import { initPreviewManager, updatePreview } from './preview-manager.js';
import { initAssetManager } from './asset-manager.js';
import { initApi, loadFromServer } from './api.js';
import { getDefaultTemplate } from './default-template.js';

document.addEventListener('DOMContentLoaded', async () => { // <-- Make the function async
    // --- Initializations (unchanged) ---
    state.editorCM = CodeMirror(document.getElementById('editor-wrapper'), {
        mode: "javascript", theme: "dracula", lineNumbers: true, lineWrapping: true
    });
    initUIManager();
    initPreviewManager();
    initAssetManager();
    initApi();
    document.querySelector('.nav-brand').addEventListener('click', () => { window.location.href = 'dashboard.html'; });

    // --- Autosave Logic (unchanged) ---
    state.editorCM.on("change", () => { /* ... */ });
    els.projectNameInput.addEventListener('input', () => { /* ... */ });

    // ========================================================================
    // START: FINAL, CORRECTED LOADING LOGIC
    // ========================================================================
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const templateId = urlParams.get('id');

        if (templateId) {
            // --- A project ID exists in the URL ---
            state.currentCloudId = templateId;
            const isLocal = templateId.startsWith('local_');
            const codeSaveKey = `fs_autosave_${templateId}`;
            const nameSaveKey = `fs_autosave_name_${templateId}`;

            if (isLocal) {
                // --- CASE 1: LOAD A LOCAL PROJECT ---
                console.log(`Loading LOCAL project: ${templateId}`);
                const savedCode = localStorage.getItem(codeSaveKey) || "/* Local project not found. */";
                const savedName = localStorage.getItem(nameSaveKey) || "Untitled Local Project";
                state.editorCM.setValue(savedCode);
                els.projectNameInput.value = savedName;
                state.currentProjectName = savedName;

            } else {
                // --- CASE 2: LOAD A CLOUD PROJECT ---
                console.log(`Fetching CLOUD project from server: ${templateId}`);
                
                // CRITICAL: await the result from the server before continuing.
                const serverData = await loadFromServer(templateId);
                
                state.editorCM.setValue(serverData.p5_code);
                
                if (serverData.name) {
                    // This now works because the backend is sending the name.
                    els.projectNameInput.value = serverData.name;
                    state.currentProjectName = serverData.name;
                    localStorage.setItem(nameSaveKey, serverData.name);
                }
            }
        } else {
            // --- CASE 3: LOAD A NEW (NO ID) PROJECT ---
            console.log("Loading NEW project (no ID).");
            const savedCode = localStorage.getItem('fs_autosave_local');
            const savedName = localStorage.getItem('fs_autosave_name_local');
            state.editorCM.setValue(savedCode || getDefaultTemplate());
            els.projectNameInput.value = savedName || "";
        }

    } catch (error) {
        // --- CATCH-ALL ERROR HANDLING ---
        console.error("Failed to load project:", error);
        alert(`A critical error occurred while loading the project.\n\nDEBUG INFO: ${error.message}\n\nLoading a blank template instead.`);
        state.editorCM.setValue(getDefaultTemplate());

    } finally {
        updatePreview();
    }
    // ========================================================================
    // END: FINAL, CORRECTED LOADING LOGIC
    // ========================================================================
});