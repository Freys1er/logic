// ==========================================
// 1. CONFIG & AUTH CHECK
// ==========================================
const STRIPE_LINK = "https://buy.stripe.com/aFa5kw6IB0pe1Im47d4ko00";
const userEmail = localStorage.getItem('freyster_user');
const userKey = localStorage.getItem('freyster_key');
const userTier = localStorage.getItem('freyster_tier') || 'free';

// Redirect to Login if not auth
if (!userEmail || !userKey) {
    window.location.href = "index.html";
}

// ==========================================
// 2. SETUP UI ON LOAD
// ==========================================
document.getElementById('user-email').innerText = userEmail;
document.getElementById('user-initial').innerText = userEmail.charAt(0).toUpperCase();

// Handle Badge Display
const badgeEl = document.getElementById('user-badge');
if (userTier === 'premium_monthly') {
    badgeEl.innerText = 'PRO';
    badgeEl.classList.add('badge-pro'); // Add CSS class for gold color if needed
} else {
    badgeEl.innerText = 'FREE';
}

// Current View State
let currentView = 'library';

// ==========================================
// 3. MAIN INIT
// ==========================================
async function initDashboard() {
    // Check if URL has a ?view= parameter (optional enhancement)
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');

    if (viewParam === 'projects') {
        switchView('projects');
    } else {
        switchView('library');
    }
}

// ==========================================
// 4. VIEW SWITCHER
// ==========================================
function switchView(viewName) {
    currentView = viewName;
    const title = document.getElementById('page-title');

    // Update Sidebar Active State
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));

    if (viewName === 'library') {
        document.getElementById('nav-library').classList.add('active');
        title.innerText = "Community Library";
        fetchLibrary(); // Load from Cloud
    } else {
        document.getElementById('nav-projects').classList.add('active');
        title.innerText = "My Projects";
        fetchMyProjects(); // Load Cloud Profile + Local Storage
    }
}

// ==========================================
// 5. STRIPE PAYMENT HANDLER
// ==========================================
function upgradeToPro() {
    if (userTier === 'premium_monthly') {
        alert("You are already a Pro member!");
        return;
    }

    // Construct URL with prefilled email
    // Stripe format: ?prefilled_email=user@example.com
    const finalUrl = `${STRIPE_LINK}?prefilled_email=${encodeURIComponent(userEmail)}`;

    // Open in new tab
    window.open(finalUrl, '_blank');
}

// ==========================================
// 6. DATA FETCHING
// ==========================================

// A. FETCH PUBLIC LIBRARY
async function fetchLibrary() {
    const grid = document.getElementById('template-grid');
    grid.innerHTML = '<div class="loader-card"></div><div class="loader-card"></div>';

    try {
        // Ensure CONFIG is defined in config.js
        const response = await fetch(`${CONFIG.API_URL}?action=get_library`);
        const data = await response.json();
        console.log(data);

        if (data.success) {
            renderGrid(data.library, 'library');
        } else {
            grid.innerHTML = "<p>Error loading library.</p>";
        }
    } catch (e) {
        console.error(e);
        grid.innerHTML = "<p class='error-msg'>Unable to connect to server.</p>";
    }
}

// B. FETCH MY PROJECTS (Profile + Local)
async function fetchMyProjects() {
    const grid = document.getElementById('template-grid');
    grid.innerHTML = '<div class="loader-card"></div>';

    let allProjects = [];

    // 1. Get Local Storage Projects (Autosaves)
    Object.keys(localStorage).forEach(key => {
        // Look for keys starting with 'local_' or the specific 'p5_studio_autosave'
        if (key.startsWith('local_') || key === 'p5_studio_autosave') {
            try {
                const item = JSON.parse(localStorage.getItem(key));
                allProjects.push({
                    id: key,
                    name: key === 'p5_studio_autosave' ? 'Unsaved Draft' : key.replace('local_', ''),
                    desc: 'Local Device Storage',
                    views: null, // Local has no views
                    isLocal: true,
                    lastUpdated: item.lastUpdated || Date.now()
                });
            } catch (e) { console.log('Skipping invalid local item', key); }
        }
    });

    // 2. Get Cloud Projects from Backend
    try {
        const url = `${CONFIG.API_URL}?action=get_profile&email=${encodeURIComponent(userEmail)}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.success) {
            // Merge Cloud items
            const cloudItems = data.templates.map(t => ({
                id: t.id,
                name: t.name,
                desc: 'Published to Cloud',
                views: t.views,
                isLocal: false,
                isPremium: t.isPremium || false
            }));

            allProjects = [...allProjects, ...cloudItems];
        }
    } catch (e) {
        console.error("Failed to fetch cloud profile", e);
        // We don't block local files if cloud fails
    }

    renderGrid(allProjects, 'projects');
}

// ==========================================
// 7. RENDERING
// ==========================================

function renderGrid(items) {
    const grid = document.getElementById('template-grid');
    grid.innerHTML = "";

    if (items.length === 0) {
        grid.innerHTML = "<p style='padding:20px; color:#666;'>No projects found.</p>";
        return;
    }

    items.forEach(item => {
        console.log(item);
        const card = document.createElement('div');
        card.className = 'card';

        // Add a visual 'locked' icon if the user can't access it
        const isLocked = (currentView === 'library' && item.isPremium && userTier !== 'premium_monthly');
        const lockIcon = isLocked ? '<span class="material-symbols-outlined" style="font-size:16px; margin-left:5px;">lock</span>' : '';

        card.innerHTML = `
            <div class="card-top">
                <span class="views">
                    <span class="material-symbols-outlined">visibility</span> ${item.views}
                </span>
                <div style="display:flex; align-items:center; gap:5px;">
                    ${item.isPremium ? '<span class="badge pro">PRO</span>' : ''}
                    ${lockIcon}
                </div>
            </div>
            <h3>${item.name}</h3>
            <p>${item.desc || 'No description'}</p>
        `;

        // --- NEW CLICK LOGIC ---
        card.onclick = () => {
            // 1. If it's a Library item, is Premium, and User is Free -> BLOCK & UPGRADE
            if (currentView === 'library' && item.isPremium && userTier !== 'premium_monthly') {
                // Optional: visual feedback
                card.style.borderColor = "red";
                setTimeout(() => card.style.borderColor = "transparent", 500);

                if (confirm("⭐️ This is a Pro template.\n\nClick OK to upgrade and unlock full access!")) {
                    upgradeToPro(); // Opens the Stripe page
                }
                return; // Stop here, do not open editor
            }

            // 2. Otherwise (Free item OR User is Pro OR It's their own project) -> OPEN EDITOR
            window.location.href = `editor.html?id=${item.id}`;
        };

        grid.appendChild(card);
    });
}

// ==========================================
// 8. ACTIONS
// ==========================================

async function deleteProject(e, id, isLocal) {
    e.stopPropagation(); // Stop card click
    if (!confirm("Are you sure you want to delete this project? This cannot be undone.")) return;

    if (isLocal) {
        // 1. Local Delete
        localStorage.removeItem(id);
        fetchMyProjects(); // Refresh view
    } else {
        // 2. Cloud Delete
        try {
            const btn = e.target.closest('button');
            const originalIcon = btn.innerHTML;
            btn.innerHTML = '<span class="material-symbols-outlined spin">refresh</span>'; // Loading state

            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'delete_template',
                    id: id,
                    email: userEmail,
                    userKey: userKey
                })
            });

            const res = await response.json();
            if (res.success) {
                fetchMyProjects(); // Refresh view
            } else {
                alert("Error: " + res.error);
                btn.innerHTML = originalIcon;
            }
        } catch (err) {
            alert("Connection error");
        }
    }
}

function logout() {
    localStorage.removeItem('freyster_user');
    localStorage.removeItem('freyster_key');
    localStorage.removeItem('freyster_tier');
    window.location.href = "index.html";
}

// Run
initDashboard();