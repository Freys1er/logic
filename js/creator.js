
const editorTextarea = document.getElementById('source-code');
const templateNameInput = document.getElementById('tpl-name');
const previewFrame = document.getElementById('preview-frame');
const publishButton = document.getElementById('publish-btn');

function updatePreview() {
    const p5Code = editorTextarea.value;
    const doc = document.implementation.createHTMLDocument("");
    doc.body.style.margin = "0";
    const p5lib = doc.createElement('script');
    p5lib.src = "https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js";
    doc.head.appendChild(p5lib);
    const userScript = doc.createElement('script');
    userScript.textContent = p5Code;
    doc.body.appendChild(userScript);
    previewFrame.srcdoc = new XMLSerializer().serializeToString(doc);
}

function extractConfigFromCode(code) {
    try {
        // This regex finds the object assigned to templateConfig.
        const configMatch = code.match(/const\s+templateConfig\s*=\s*(\{[\s\S]*?\});/);
        if (!configMatch || !configMatch[1]) {
            throw new Error("Could not find a valid 'templateConfig' object in your code.");
        }
        // Use a function constructor for a safe evaluation of the object.
        const configObject = new Function(`return ${configMatch[1]}`)();
        return configObject.variables;
    } catch (e) {
        console.error("Config Extraction Error:", e);
        return null;
    }
}

async function publishTemplate() {
    const name = templateNameInput.value;
    const code = editorTextarea.value;
    const userEmail = localStorage.getItem('freyster_user');

    if (!name || !userEmail) { alert("Name and Login required."); return; }

    // Extract the self-described variables.
    const variables = extractConfigFromCode(code);
    if (!variables) {
        alert("Publish failed. Please ensure your 'templateConfig' object is correctly formatted.");
        return;
    }

    publishButton.innerText = "UPLOADING...";
    publishButton.disabled = true;

    const payload = {
        action: 'publish_template',
        name: name,
        creatorEmail: userEmail,
        jsContent: code,
        variables: variables // Send the extracted config
    };

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: "POST",
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.success) {
            alert(`Published! ID: ${data.id}`);
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        publishButton.innerText = "PUBLISH";
        publishButton.disabled = false;
    }
}

editorTextarea.addEventListener('input', updatePreview);
publishButton.addEventListener('click', publishTemplate);

// Load the default template into the editor on start
fetch('p5_template_imessage.js') // You would create this file with the code above
    .then(res => res.text())
    .then(code => {
        editorTextarea.value = code;
        updatePreview();
    });
