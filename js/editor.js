

const frame = document.getElementById('preview-frame');
const formContainer = document.getElementById('dynamic-form-container'); // You need a container div in your HTML
const player = { /* ... your player state object ... */ };

let templateConfig = []; // Will hold the UI instructions from the template

// --- THE DYNAMIC UI BUILDER ---
function buildDynamicForm(variables) {
    templateConfig = variables; // Store the config globally
    formContainer.innerHTML = ""; // Clear any loaders

    variables.forEach(v => {
        const group = document.createElement('div');
        group.className = 'input-group';
        const label = document.createElement('label');
        label.innerText = v.label;
        let input;

        switch (v.type) {
            case "textarea":
                input = document.createElement('textarea');
                input.rows = 8;
                break;
            case "color":
                input = document.createElement('input');
                input.type = "color";
                break;
            default: // "text"
                input = document.createElement('input');
                input.type = "text";
        }
        input.id = `inp-${v.id}`;
        input.value = v.defaultValue;
        input.addEventListener('input', pushUpdate);

        group.appendChild(label);
        group.appendChild(input);
        formContainer.appendChild(group);
    });
}

function pushUpdate() {
    // Read values from the dynamically created form.
    const state = {};
    templateConfig.forEach(v => {
        const inputElement = document.getElementById(`inp-${v.id}`);
        if (inputElement) {
            state[v.id] = inputElement.value;
        }
    });

    if (frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'UPDATE_STATE', payload: state }, '*');
    }
    // (Your timeline recalculation logic here)
}

async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const templateId = urlParams.get('id');
    if (!templateId) { return; }

    const response = await fetch(`${CONFIG.API_URL}?action=load_template&id=${templateId}`);
    const data = await response.json();

    if (data.success) {
        // THE MAGIC: Build the UI before loading the iframe
        buildDynamicForm(data.config);

        const doc = document.implementation.createHTMLDocument("");
        doc.body.style.margin = "0";
        const p5lib = doc.createElement('script');
        p5lib.src = "https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js";
        doc.head.appendChild(p5lib);
        const userScript = doc.createElement('script');
        userScript.textContent = data.p5_code;
        doc.body.appendChild(userScript);
        frame.srcdoc = new XMLSerializer().serializeToString(doc);
    }
}

// Handshake listener (remains the same)
window.addEventListener('message', function(event) {
    if (event.source === frame.contentWindow && event.data.type === 'P5_READY') {
        console.log("P5 Sketch is ready. Sending initial form state.");
        pushUpdate(); // Send the default values from the form.
    }
});

// (All your player control logic - seekFrame, play/pause - remains the same)

init();