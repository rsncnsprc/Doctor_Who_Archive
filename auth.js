/**
 * auth.js  — shared across all pages
 * 
 * Include with: <script src="auth.js"></script>
 * 
 * Exposes:
 *   Auth.getUser()        → parsed user object or null
 *   Auth.getToken()       → JWT string or null
 *   Auth.logout()         → clears storage + redirects to login
 *   Auth.requireLogin()   → redirects to login if not authenticated
 *   Auth.renderHeader()   → call this in window.onload to update the profile button
 */

const Auth = (() => {
    const TOKEN_KEY = 'ga_token';
    const USER_KEY  = 'ga_user';
    const API       = 'http://localhost:5000/api';

    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    function getUser() {
        const raw = localStorage.getItem(USER_KEY);
        try { return raw ? JSON.parse(raw) : null; } catch { return null; }
    }

    function logout() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        window.location.href = 'login.html';
    }

    // Call on any page that requires login — redirects if not authenticated
    function requireLogin() {
        if (!getToken()) {
            window.location.href = `login.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        }
    }

    // Updates the header profile button to show username + logout option
    // Pass the id of the element you want to replace, or it targets id="header-profile-btn"
    function renderHeader(btnId = 'header-profile-btn') {
        const btn = document.getElementById(btnId);
        if (!btn) return;

        const user = getUser();

        if (user) {
            btn.innerHTML = `
                <span class="text-sm font-medium hidden sm:inline">${user.username}</span>
                <div class="w-8 h-8 bg-yellow-600 rounded-full flex items-center justify-center text-xs font-black">
                    ${user.username.charAt(0).toUpperCase()}
                </div>
            `;
            btn.onclick = () => window.location.href = 'profile.html';

            // Add logout button next to it if not already present
            if (!document.getElementById('header-logout-btn')) {
                const logout_btn = document.createElement('button');
                logout_btn.id = 'header-logout-btn';
                logout_btn.className = 'text-xs bg-white/10 hover:bg-red-500/30 px-3 py-2 rounded-full transition border border-white/20';
                logout_btn.textContent = 'Sign Out';
                logout_btn.onclick = Auth.logout;
                btn.parentNode.insertBefore(logout_btn, btn.nextSibling);
            }
        } else {
            // Not logged in — show Sign In button
            btn.innerHTML = `
                <span class="text-sm font-medium">Sign In</span>
                <div class="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">👤</div>
            `;
            btn.onclick = () => window.location.href = 'login.html';
        }
    }

    return { getToken, getUser, logout, requireLogin, renderHeader };
})();
