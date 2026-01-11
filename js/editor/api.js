import { state, els } from './state.js';
import { log, showLoading, hideLoading } from './ui-manager.js';
import { updatePreview } from './preview-manager.js';
import { getDefaultTemplate } from './default-template.js';

const CONFIG = { API_URL: 'https://api.freyster.dev' };

export function initApi() {
    document.getElementById('publish-btn').addEventListener('click', publishProject);
}

// ========================================================================
// FINAL, ROBUST loadFromServer FUNCTION
// ========================================================================
// In js/editor/api.js

export async function loadFromServer(id) {
    showLoading("Downloading Template...");
    const email = localStorage.getItem('freyster_user') || "";
    const key = localStorage.getItem('freyster_key') || "";

    try {
        const url = `${CONFIG.API_URL}?action=load_template&id=${id}&email=${encodeURIComponent(email)}&userKey=${key}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Server responded with status ${res.status}`);
        
        const data = await res.json();
        console.log(data);
        
        if (data.success) {
            // This function now correctly returns ALL the data to the caller.
            return data; 
        } else {
            throw new Error(data.error || "Unknown server error.");
        }
    } catch (e) {
        log("API Error", e.message, "error");
        // Re-throw the error so the main loader can handle it.
        throw e;
    } finally {
        hideLoading();
    }
}

// ========================================================================
// FINAL publishProject FUNCTION (integrates with name autosave)
// ========================================================================
async function publishProject() {
    const email = localStorage.getItem('freyster_user');
    const key = localStorage.getItem('freyster_key');
    if (!email || !key) {
        alert("Authentication missing. Please log in again.");
        return;
    }

    const projectName = els.projectNameInput.value.trim();
    if (!projectName) {
        alert("Please enter a project name before publishing.");
        els.projectNameInput.focus();
        return;
    }

    const isUpdate = !!state.currentCloudId;
    showLoading(isUpdate ? "Updating..." : "Publishing...");
    
    const payload = {
        action: 'publish_template',
        id: state.currentCloudId,
        name: projectName,
        creatorEmail: email,
        userKey: key,
        jsContent: state.editorCM.getValue(),
        variables: state.currentConfig
    };

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();

        if (data.success) {
            alert(isUpdate ? "✅ Project updated successfully!" : "✅ Published successfully!");
            
            state.currentProjectName = projectName;
            if (data.id) {
                const oldId = state.currentCloudId;
                state.currentCloudId = data.id;

                if (!isUpdate || oldId !== data.id) {
                    // This was a new project or an update to a name-matched project.
                    // We need to migrate the autosaves to the new, official ID.
                    const newCodeSaveKey = `fs_autosave_${data.id}`;
                    const newNameSaveKey = `fs_autosave_name_${data.id}`;
                    const oldCodeSaveKey = oldId ? `fs_autosave_${oldId}` : 'fs_autosave_local';
                    const oldNameSaveKey = oldId ? `fs_autosave_name_${oldId}` : 'fs_autosave_name_local';

                    localStorage.setItem(newCodeSaveKey, localStorage.getItem(oldCodeSaveKey));
                    localStorage.setItem(newNameSaveKey, projectName);
                    localStorage.removeItem(oldCodeSaveKey);
                    localStorage.removeItem(oldNameSaveKey);
                    
                    // Update URL
                    const newUrl = new URL(window.location);
                    newUrl.searchParams.set('id', data.id);
                    window.history.pushState({ path: newUrl.href }, '', newUrl.href);
                }
            }
        } else {
            alert("Publish Failed: " + data.error);
        }
    } catch (e) {
        log("API Error", e.message, "error");
        alert("A network error occurred while publishing.");
    } finally {
        hideLoading();
    }
}

// ========================================================================
// START: CORRECTED AI API FUNCTION
// ========================================================================
export async function generateWithAI(prompt, schema) {
    // --- ADDED: Get user credentials from localStorage ---
    const email = localStorage.getItem('freyster_user');
    const userKey = localStorage.getItem('freyster_key');

    // --- ADDED: Check if user is logged in ---
    if (!email || !userKey) {
        throw new Error("You must be logged in to use the AI generation feature.");
    }

    const filteredSchema = schema.map(field => ({
        id: field.id,
        label: field.label,
        description: field.description,
        type: field.type
    }));

    // --- ADDED: Include user credentials in the payload ---
    const payload = {
        prompt,
        schema: filteredSchema,
        email: email,       // <-- ADDED
        userKey: userKey    // <-- ADDED
    };

    try {
        // Construct the full URL to the /generate endpoint
        const fullUrl = `${CONFIG.API_URL}/generate`;

        const response = await fetch(fullUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json(); // Always try to parse JSON

        if (!response.ok) {
            // Use the error message from the server's JSON response if available
            throw new Error(data.error || `Server responded with status ${response.status}`);
        }
        
        return data;

    } catch (networkError) {
        log('API Network Error', networkError.message, 'error');
        // Re-throw the error so the UI manager can display it
        throw networkError;
    }
}
// ========================================================================
// END: CORRECTED AI API FUNCTION
// ========================================================================