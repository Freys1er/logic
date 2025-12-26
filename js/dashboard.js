// 1. SECURITY CHECK
const userEmail = localStorage.getItem('freyster_user');
const userKey = localStorage.getItem('freyster_key');

if (!userEmail || !userKey) {
    window.location.href = "index.html"; // Kick them out
}

// 2. SETUP UI
document.getElementById('user-email').innerText = userEmail;
document.getElementById('user-initial').innerText = userEmail.charAt(0).toUpperCase();

// 3. FETCH LIBRARY
async function initDashboard() {
    const grid = document.getElementById('template-grid');
    
    try {
        const url = `${CONFIG.API_URL}?action=get_library`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.success) {
            renderGrid(data.library);
        } else {
            grid.innerHTML = "<p>Error loading vault.</p>";
        }
    } catch (e) {
        console.error(e);
        grid.innerHTML = "<p>Connection failed.</p>";
    }
}
function renderGrid(templates) {
    const grid = document.getElementById('template-grid');
    grid.innerHTML = ""; 

    if (templates.length === 0) {
        grid.innerHTML = "<p>No templates found.</p>";
        return;
    }

    templates.forEach(tpl => {
        const card = document.createElement('div');
        card.className = 'card';
        
        // --- THE FIX: Point to editor.html with the ID ---
        card.onclick = () => {
            window.location.href = `editor.html?id=${tpl.id}`;
        };

        card.innerHTML = `
            <h3>${tpl.name}</h3>
            <p>${tpl.desc}</p>
            <div class="card-footer">
                <span><span class="status-dot"></span>Ready</span>
                <span>OPEN &rarr;</span>
            </div>
        `;
        grid.appendChild(card);
    });
}

function launchEditor(templateId) {
    // Redirect to the editor with the ID in the URL
    window.location.href = `dashboard.html?mode=editor&id=${templateId}`;
    // Note: We will handle this "mode" in the next step (making the editor fit into this layout)
}

function logout() {
    localStorage.removeItem('freyster_user');
    localStorage.removeItem('freyster_key');
    window.location.href = "index.html";
}

// Run on load
initDashboard();