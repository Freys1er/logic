// ==========================================
// 1. CONFIG & AUTH CHECK
// ==========================================
let currentPage = 1;
let currentSort = 'popular';
let currentSearch = '';
let currentView = 'library'; // 'library', 'projects', 'profile'
let searchTimeout;

const userEmail = localStorage.getItem('freyster_user');
const userKey = localStorage.getItem('freyster_key');
let userTier = localStorage.getItem('freyster_tier') || 'free';

// Redirect if not authenticated
if (!userEmail || !userKey) {
    window.location.href = "index.html";
}

// ==========================================
// 2. SETUP UI ON LOAD
// ==========================================
document.getElementById('user-email').innerText = userEmail;
document.getElementById('user-initial').innerText = userEmail.charAt(0).toUpperCase();
updateBadgeUI();

// ==========================================
// 3. MAIN INIT
// ==========================================
async function initDashboard() {
    await syncUserStatus();

    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    const userParam = urlParams.get('user'); // Check for ?user=email

    if (userParam) {
        viewUserProfile(userParam);
    } else if (viewParam === 'projects') {
        switchView('projects');
    } else {
        switchView('library');
    }
}

// ==========================================
// 4. NAVIGATION HANDLERS
// ==========================================
function switchView(viewName) {
    currentView = viewName;
    const title = document.getElementById('page-title');
    const controls = document.querySelector('.controls-container');

    // Reset Sidebar
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));

    if (viewName === 'library') {
        document.getElementById('nav-library').classList.add('active');
        title.innerText = "Community Library";
        if(controls) controls.style.visibility = 'visible';
        fetchLibrary();
    } 
    else if (viewName === 'projects') {
        document.getElementById('nav-projects').classList.add('active');
        title.innerText = "My Projects";
        if(controls) controls.style.visibility = 'hidden';
        fetchProfileData(userEmail); // Fetch ME
    }
}

function viewUserProfile(targetEmail) {
    currentView = 'profile';
    const title = document.getElementById('page-title');
    const controls = document.querySelector('.controls-container');

    // Reset Sidebar
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));

    // If I clicked my own link, go to "My Projects" view instead
    if (targetEmail === userEmail) {
        switchView('projects');
        return;
    }

    const displayName = targetEmail.includes('@') ? targetEmail.split('@')[0] : targetEmail;
    title.innerHTML = `<span style="color:#888">Profile:</span> ${displayName}`;
    
    if(controls) controls.style.visibility = 'hidden';

    fetchProfileData(targetEmail);
}

// ==========================================
// 5. DATA FETCHING
// ==========================================

// --- LIBRARY ---
async function fetchLibrary(sortMode = 'popular') {
    currentSort = sortMode;
    currentPage = 1;
    
    document.getElementById('template-grid').innerHTML = '<div class="loader-card"></div><div class="loader-card"></div>';
    document.getElementById('load-more-container').style.display = 'none';

    await loadData(false);
}

async function loadData(isAppend) {
    try {
        const url = `${CONFIG.API_URL}?action=get_library&sort=${currentSort}&page=${currentPage}&search=${encodeURIComponent(currentSearch)}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.success) {
            renderGrid(data.library, 'library', isAppend);
            document.getElementById('load-more-container').style.display = data.has_more ? 'block' : 'none';
        }
    } catch (e) {
        console.error(e);
    }
}

async function loadNextPage() {
    currentPage++;
    const btn = document.querySelector('#load-more-container button');
    btn.innerText = "Loading...";
    await loadData(true);
    btn.innerText = "Load More";
}

// --- PROFILE (The missing function!) ---
async function fetchProfileData(targetEmail) {
    const grid = document.getElementById('template-grid');
    grid.innerHTML = '<div class="loader-card"></div>';
    document.getElementById('load-more-container').style.display = 'none';

    let allProjects = [];

    // 1. Get Local Storage (Only if viewing myself)
    if (targetEmail === userEmail) {
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('local_') || key === 'p5_studio_autosave') {
                try {
                    const item = JSON.parse(localStorage.getItem(key));
                    allProjects.push({
                        id: key,
                        name: key === 'p5_studio_autosave' ? 'Unsaved Draft' : key.replace('local_', ''),
                        desc: 'Local Device Storage',
                        views: 0,
                        isLocal: true,
                        isPremium: false
                    });
                } catch (e) {}
            }
        });
    }

    // 2. Get Cloud Projects
    try {
        const url = `${CONFIG.API_URL}?action=get_profile&email=${encodeURIComponent(targetEmail)}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.success) {
            const cloudItems = data.templates.map(t => ({
                id: t.id,
                name: t.name,
                desc: targetEmail,
                views: t.views,
                isLocal: false,
                isPremium: t.isPremium || false
            }));
            allProjects = [...allProjects, ...cloudItems];
        }
    } catch (e) {
        console.error("Profile fetch error", e);
    }

    const context = (targetEmail === userEmail) ? 'my_projects' : 'library'; // Treat other profiles like library (no delete)
    renderGrid(allProjects, context);
}

// ==========================================
// 6. RENDERING (FIXED CLICK LOGIC)
// ==========================================
function renderGrid(items, context, isAppend = false) {
    const grid = document.getElementById('template-grid');
    if (!isAppend) grid.innerHTML = "";

    if (items.length === 0 && !isAppend) {
        grid.innerHTML = "<p style='color:#666; padding:20px; grid-column:1/-1; text-align:center;'>No projects found.</p>";
        return;
    }

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card';

        // 1. BADGES
        let badgesHtml = '';
        if (item.isPremium) badgesHtml += `<span class="badge badge-pro">PRO</span> `;
        if (item.isLocal) badgesHtml += `<span class="badge" style="background:#e3f2fd; color:#1976d2">LOCAL</span> `;

        // 2. DELETE BUTTON
        let deleteBtn = '';
        if (context === 'my_projects' && !item.isLocal) {
            // We'll attach the event manually below to be safe
            deleteBtn = `<button class="icon-btn delete-trigger" title="Delete"><span class="material-symbols-outlined">delete</span></button>`;
        }

        // 3. HTML CONTENT (Without the Author Link logic yet)
        const rawEmail = item.desc || "Unknown";
        const displayName = rawEmail.includes('@') ? rawEmail.split('@')[0] : rawEmail;

        card.innerHTML = `
            <div class="card-top">
                <div class="stat-item">
                    <span class="material-symbols-outlined" style="font-size:16px;">visibility</span>
                    ${item.views || 0}
                </div>
                <div style="display:flex; gap:5px; align-items:center;">
                    ${badgesHtml}
                    ${deleteBtn}
                </div>
            </div>
            <h3>${item.name}</h3>
            <!-- Author Container -->
            <div class="author-container"></div>
        `;

        // 4. ATTACH AUTHOR LINK (MANUALLY)
        // This ensures the click event is handled purely in JS, preventing bubbling issues
        const authorContainer = card.querySelector('.author-container');
        if (context === 'library' && !item.isLocal) {
            const link = document.createElement('a');
            link.href = `?user=${encodeURIComponent(rawEmail)}`;
            link.className = 'author-link';
            link.innerText = `By ${displayName}`;
            
            // CRITICAL: Stop Propagation here
            link.onclick = (e) => {
                e.preventDefault(); // Don't refresh
                e.stopPropagation(); // Don't click the card
                viewUserProfile(rawEmail);
            };
            authorContainer.appendChild(link);
        } else {
            // Static text
            authorContainer.innerHTML = `<span class="author-link" style="text-decoration:none; cursor:default">By ${displayName}</span>`;
        }

        // 5. ATTACH DELETE CLICK (If exists)
        const delBtn = card.querySelector('.delete-trigger');
        if (delBtn) {
            delBtn.onclick = (e) => deleteCloudProject(item.id, e);
        }

        // 6. ATTACH CARD CLICK (Open Editor)
        card.onclick = () => handleCardClick(item);

        grid.appendChild(card);
    });
}

// ==========================================
// 7. ACTIONS
// ==========================================
function handleCardClick(item) {
    const isPremiumTemplate = item.isPremium;
    const isUserFree = (userTier !== 'premium_monthly');

    if (isPremiumTemplate && isUserFree) {
        if (confirm("⭐️ This is a Pro template.\n\nClick OK to upgrade!")) {
            upgradeToPro();
        }
        return;
    }
    window.location.href = `editor.html?id=${item.id}`;
}

async function deleteCloudProject(id, event) {
    event.stopPropagation(); // Prevent opening editor
    if (!confirm("⚠️ Are you sure you want to delete this project?")) return;

    try {
        const btn = event.currentTarget;
        btn.innerHTML = '<span class="material-symbols-outlined spin">refresh</span>';

        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'delete_template',
                id: id,
                email: userEmail,
                userKey: userKey
            })
        });

        const data = await response.json();
        if (data.success) {
            fetchProfileData(userEmail);
        } else {
            alert("Error: " + data.error);
        }
    } catch (e) { console.error(e); }
}

function handleSearch(e) {
    currentSearch = e.target.value;
    clearTimeout(searchTimeout);
    if (e.key === 'Enter') { fetchLibrary(currentSort); return; }
    searchTimeout = setTimeout(() => fetchLibrary(currentSort), 500);
}

// Sync Status
async function syncUserStatus() {
    if (!userEmail || !userKey) return;
    try {
        const res = await fetch(`${CONFIG.API_URL}?action=verify_status&email=${encodeURIComponent(userEmail)}&userKey=${userKey}`);
        const data = await res.json();
        if (data.success) {
            userTier = data.tier;
            localStorage.setItem('freyster_tier', data.tier);
            updateBadgeUI();
            const upBtn = document.getElementById('btn-upgrade-plan');
            if(userTier === 'premium_monthly' && upBtn) upBtn.style.display = 'none';
        } else { logout(); }
    } catch (e) { console.warn(e); }
}

function updateBadgeUI() {
    const badgeEl = document.getElementById('user-badge');
    if (userTier === 'premium_monthly') {
        badgeEl.innerText = 'PRO';
        badgeEl.classList.add('badge-pro');
    } else {
        badgeEl.innerText = 'FREE';
        badgeEl.classList.remove('badge-pro');
    }
}

function upgradeToPro() {
    const finalUrl = `${CONFIG.STRIPE_LINK}?prefilled_email=${encodeURIComponent(userEmail)}`;
    window.open(finalUrl, '_blank');
}

function logout() {
    localStorage.clear();
    window.location.href = "index.html";
}

// Run
initDashboard();