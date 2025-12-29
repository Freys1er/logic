if (localStorage.getItem('freyster_key') && localStorage.getItem('freyster_user')) {
    // Optional: Show a quick message so the user knows why they are being moved
    // showStatus("Session found. Accessing Logic Engine...", "success"); 
    window.location.href = "dashboard.html";
}

let isLoginMode = true;

const dom = {
    title: document.getElementById('page-title'),
    subtitle: document.getElementById('page-subtitle'),
    btn: document.getElementById('main-btn'),
    toggle: document.getElementById('toggle-text'),
    status: document.getElementById('status'),
    email: document.getElementById('email'),
    pass: document.getElementById('password')
};

function toggleMode() {
    isLoginMode = !isLoginMode;
    // Animate Text Change
    dom.title.innerText = isLoginMode ? "Freyster Systems" : "Initialize Account";
    dom.subtitle.innerText = isLoginMode ? "Log in to access the Logic Engine." : "Create identity and configure billing.";
    dom.btn.innerText = isLoginMode ? "Sign In" : "Create & Upgrade ($29)";
    dom.toggle.innerText = isLoginMode ? "New here? Create an account" : "Already have access? Sign in";
    
    // Clear status
    dom.status.className = 'status-msg';
}

async function handleAuth() {
    const email = dom.email.value;
    const password = dom.pass.value;

    if (!email || !password) {
        showStatus("Please enter identity and credential.", "error");
        return;
    }

    setLoading(true);

    try {
        const action = isLoginMode ? 'login' : 'signup';
        // Construct URL for GET request
        const url = `${CONFIG.API_URL}?action=${action}&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            showStatus(data.error, "error");
            setLoading(false);
        } else {
            if (isLoginMode) {
                // LOGIN SUCCESS
                if (data.status === 'pending') {
                    showStatus("Account created but unpaid. Redirecting...", "error");
                    setTimeout(() => redirectToStripe(email), 1500);
                } else {
                    showStatus("Access Granted. Loading Engine...", "success");
                    // Save session
                    localStorage.setItem('freyster_key', data.key);
                    localStorage.setItem('freyster_user', email);
                    // Redirect to Dashboard
                    setTimeout(() => window.location.href = "dashboard.html", 1000);
                }
            } else {
                // SIGNUP SUCCESS
                showStatus("Identity Created. Redirecting to Payment...", "success");
                setTimeout(() => redirectToStripe(email), 1000);
            }
        }
    } catch (e) {
        console.error(e);
        showStatus("System Connection Failure.", "error");
        setLoading(false);
    }
}

function redirectToStripe(email) {
    window.location.href = CONFIG.STRIPE_LINK + "?prefilled_email=" + encodeURIComponent(email);
}

function showStatus(msg, type) {
    dom.status.innerText = msg;
    dom.status.className = `status-msg visible ${type}`;
}

function setLoading(isLoading) {
    if (isLoading) {
        dom.btn.innerText = "Processing...";
        dom.btn.style.opacity = "0.7";
        dom.btn.disabled = true;
    } else {
        dom.btn.innerText = isLoginMode ? "Sign In" : "Create & Upgrade ($29)";
        dom.btn.style.opacity = "1";
        dom.btn.disabled = false;
    }
}

// Enter Key Support
document.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') handleAuth();
});