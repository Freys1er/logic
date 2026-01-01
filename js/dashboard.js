// ==========================================
// 1. CONFIG & AUTH CHECK
// ==========================================

let currentPage = 1;
let currentSort = 'popular';
let currentSearch = ''; // New variable to track search text


const userEmail = localStorage.getItem('freyster_user');
const userKey = localStorage.getItem('freyster_key');
let userTier = localStorage.getItem('freyster_tier') || 'free';

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



// ==========================================
// SEARCH HANDLER (Updated)
// ==========================================
let searchTimeout;

function handleSearch(e) {
    // 1. Update the global variable IMMEDIATELY
    currentSearch = e.target.value;

    // 2. Clear any pending auto-search
    clearTimeout(searchTimeout);

    // 3. If User hits ENTER -> Search Immediately
    if (e.key === 'Enter') {
        fetchLibrary(currentSort);
        return; 
    }
    
    // 4. Otherwise -> Wait 500ms (Debounce)
    searchTimeout = setTimeout(() => {
        fetchLibrary(currentSort); 
    }, 500);
}


// Current View State
let currentView = 'library';

// ==========================================
// 3. MAIN INIT
// ==========================================
// ==========================================
// 3. MAIN INIT (UPDATED)
// ==========================================
async function initDashboard() {
    // 1. ASK SERVER FIRST!
    await syncUserStatus();

    // 2. Now handle the view, knowing userTier is 100% accurate
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
    const finalUrl = `${CONFIG.CONFIG.CONFIG.STRIPE_LINK}?prefilled_email=${encodeURIComponent(userEmail)}`;

    // Open in new tab
    window.open(finalUrl, '_blank');
}

// ==========================================
// 6. DATA FETCHING
// ==========================================

// A. FETCH PUBLIC LIBRARY

async function fetchLibrary(sortMode = 'popular') {
    currentSort = sortMode;
    currentPage = 1; // Reset to page 1
    
    const grid = document.getElementById('template-grid');
    grid.innerHTML = '<div class="loader-card"></div><div class="loader-card"></div>';
    
    // Hide button while loading
    document.getElementById('load-more-container').style.display = 'none';

    await loadData(false); // False = Don't Append, Overwrite
}


async function loadNextPage() {
    currentPage++;
    const btn = document.querySelector('#load-more-container button');
    btn.innerText = "Loading...";
    
    await loadData(true); // True = Append to bottom
    
    btn.innerText = "Load More...";
}

async function loadData(isAppend) {
    try {
        // Construct URL with Sort, Page, AND Search
        const url = `${CONFIG.API_URL}?action=get_library&sort=${currentSort}&page=${currentPage}&search=${encodeURIComponent(currentSearch)}`;
        
        const response = await fetch(url);
        const data = await response.json();

        if (data.success) {
            renderGrid(data.library, 'library', isAppend);
            
            // --- FIXING THE BUTTON VISIBILITY ---
            const btnContainer = document.getElementById('load-more-container');
            
            if (data.has_more) {
                btnContainer.style.display = 'block'; // Show if more pages exist
            } else {
                btnContainer.style.display = 'none';  // Hide if end of list
            }
        }
    } catch (e) {
        console.error("Load Error", e);
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
            // Use the global 'userTier' which was just synced with the server
            const isPremiumTemplate = item.isPremium;
            const isUserFree = userTier !== 'premium_monthly';

            // 1. BLOCK if Premium Template + Free User
            if (currentView === 'library' && isPremiumTemplate && isUserFree) {

                // Visual shake/red border
                card.style.border = "2px solid red";
                setTimeout(() => card.style.border = "none", 500);

                if (confirm("⭐️ This is a Pro template.\n\nOur server indicates you are currently on the Free plan.\nClick OK to upgrade!")) {
                    upgradeToPro();
                }
                return;
            }

            // 2. Allow Access
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

// ==========================================
// NEW: SERVER SYNC FUNCTION
// ==========================================
async function syncUserStatus() {
    console.log("🔄 Syncing status with server...");

    // 1. If we don't have credentials, we can't check
    if (!userEmail || !userKey) return;

    try {
        // 2. Ask the Pi: "What is my tier?"
        const response = await fetch(`${CONFIG.API_URL}?action=verify_status&email=${encodeURIComponent(userEmail)}&userKey=${userKey}`);
        const data = await response.json();

        if (data.success) {
            console.log("✅ Server says tier is:", data.tier);

            // 3. Update Global Variable
            // (We update the variable used by the rest of the script immediately)
            userTier = data.tier;

            // 4. Update Local Storage (so next refresh is faster)
            localStorage.setItem('freyster_tier', data.tier);

            // 5. Update UI Badge Immediately
            const badgeEl = document.getElementById('user-badge');
            if (userTier === 'premium_monthly') {
                badgeEl.innerText = 'PRO';
                badgeEl.classList.add('badge-pro');
            } else {
                badgeEl.innerText = 'FREE';
                badgeEl.classList.remove('badge-pro');
            }
        } else {
            // If key is invalid (e.g. user deleted on server), log them out
            console.warn("Session invalid:", data.error);
            logout();
        }
    } catch (e) {
        console.error("Could not sync with server. Using cached tier.", e);
    }
}

// Run
initDashboard();