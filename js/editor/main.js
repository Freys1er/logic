import { state, els } from './state.js';
import { initUIManager } from './ui-manager.js';
import { initPreviewManager, updatePreview } from './preview-manager.js';
import { initAssetManager } from './asset-manager.js';
import { initApi, loadFromServer } from './api.js';
import { getDefaultTemplate } from './default-template.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize CodeMirror Editor
    state.editorCM = CodeMirror(document.getElementById('editor-wrapper'), {
        mode: "javascript", theme: "dracula", lineNumbers: true, lineWrapping: true
    });

    // ========================================================================
    // START: UPDATED AUTOSAVE LOGIC
    // ========================================================================
    state.editorCM.on("change", (cm, changeObj) => {
        if (changeObj.origin === 'from_form') return; // Prevent feedback loop
        clearTimeout(state.saveTimeout);

        state.saveTimeout = setTimeout(() => {
            // Determine the correct key based on the URL
            const currentId = new URLSearchParams(window.location.search).get('id');
            const saveKey = currentId ? `fs_autosave_${currentId}` : 'fs_autosave_local';

            localStorage.setItem(saveKey, state.editorCM.getValue());
            console.log(`Work autosaved to project key: ${saveKey}`); // For debugging
            updatePreview();
        }, 800);
    });

    els.projectNameInput.addEventListener('input', () => {
        const currentId = new URLSearchParams(window.location.search).get('id');
        // Use a different key for the name to keep it separate from the code
        const nameSaveKey = currentId ? `fs_autosave_name_${currentId}` : 'fs_autosave_name_local';
        localStorage.setItem(nameSaveKey, els.projectNameInput.value);
    });
    // ========================================================================
    // END: UPDATED AUTOSAVE LOGIC
    // ========================================================================

    // 2. Initialize all other modules
    initUIManager();
    initPreviewManager();
    initAssetManager();
    initApi();

    document.querySelector('.nav-brand').addEventListener('click', () => {
        window.location.href = 'dashboard.html';
    });

    // ========================================================================
    // START: UPDATED LOADING LOGIC
    // ========================================================================
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const templateId = urlParams.get('id');

        // 1. Define the correct local storage keys for this project.
        const codeSaveKey = templateId ? `fs_autosave_${templateId}` : 'fs_autosave_local';
        const nameSaveKey = templateId ? `fs_autosave_name_${templateId}` : 'fs_autosave_name_local';

        // 2. ALWAYS try to load the name from local storage immediately.
        const localName = localStorage.getItem(nameSaveKey);
        if (localName) {
            els.projectNameInput.value = localName;
        }

        // 3. Load the CODE based on whether there's an ID.
        if (templateId) {
            // This is an existing project.
            state.currentCloudId = templateId;
            const savedCode = localStorage.getItem(codeSaveKey);

            if (savedCode) {
                // If an autosave exists for the code, load it.
                state.editorCM.setValue(savedCode);
                log("System", `Loaded project '${localName || templateId}' from local autosave.`);
            } else {
                // Otherwise, load the project from the server.
                log("System", `No local autosave found. Loading project ${templateId} from server...`);
                const serverData = loadFromServer(templateId);
                state.editorCM.setValue(serverData.p5_code);

                // If the server provided a name, update the UI and state.
                if (serverData.name) {
                    els.projectNameInput.value = serverData.name;
                    state.currentProjectName = serverData.name;
                    localStorage.setItem(nameSaveKey, serverData.name);
                }
            }
        } else {
            // This is a new, local project.
            const savedCode = localStorage.getItem(codeSaveKey);
            state.editorCM.setValue(savedCode || getDefaultTemplate());
            log("System", "Loaded new project from local autosave or default template.");
        }
    } catch (error) {
        // If anything in the loading process fails, load the default template.
        log("Loading Error", `Failed to load project: ${error.message}. Loading default template.`, "error");
        state.editorCM.setValue(getDefaultTemplate());
    } finally {
        // 4. Finally, update the preview with whatever content was loaded.
        updatePreview();
    }
    // ========================================================================
    // END: UPDATED LOADING LOGIC
    // ========================================================================
});