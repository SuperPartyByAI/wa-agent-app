/**
 * Auth Guard — Include on every protected page
 * Checks session token and redirects to login if not authenticated.
 * 
 * Usage: <script src="/js/auth-guard.js"></script>
 */
(function() {
    const BASE_URL = window.location.origin;
    const LOGIN_URL = '/login.html';
    const ONBOARDING_URL = '/onboarding.html';
    
    // Pages that don't need auth
    const PUBLIC_PAGES = ['/login.html', '/onboarding.html'];
    const currentPath = window.location.pathname;
    
    // Bypass auth if opened directly from local machine (file://)
    if (window.location.protocol === 'file:') return;

    if (PUBLIC_PAGES.includes(currentPath)) return;

    const token = localStorage.getItem('sp_session_token');
    
    if (!token) {
        window.location.href = LOGIN_URL;
        return;
    }

    // Verify session with backend
    fetch(`${BASE_URL}/api/auth/check`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        if (!data.authenticated) {
            localStorage.removeItem('sp_session_token');
            window.location.href = LOGIN_URL;
            return;
        }

        // Store user info globally
        window.__spUser = {
            id: data.employee_id,
            email: data.email,
            name: data.name,
            avatar: data.avatar,
            role: data.role,
            onboarding_status: data.onboarding_status
        };

        // If not fully onboarded and not admin, redirect to onboarding
        if (data.role !== 'admin' && data.onboarding_status !== 'admin_approved') {
            if (currentPath !== '/onboarding.html') {
                window.location.href = ONBOARDING_URL;
            }
            return;
        }

        // Inject user badge in top-right corner
        injectUserBadge(data);
    })
    .catch(() => {
        localStorage.removeItem('sp_session_token');
        window.location.href = LOGIN_URL;
    });

    function injectUserBadge(user) {
        const badge = document.createElement('div');
        badge.id = 'sp-user-badge';
        badge.innerHTML = `
            <div style="
                position: fixed; top: 12px; right: 12px; z-index: 9999;
                display: flex; align-items: center; gap: 10px;
                background: rgba(15,15,25,0.85); backdrop-filter: blur(12px);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 12px; padding: 6px 14px 6px 6px;
                font-family: 'Inter', sans-serif; font-size: 13px;
                color: rgba(255,255,255,0.7);
                box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            ">
                <img src="${user.avatar || ''}" alt="" style="
                    width: 28px; height: 28px; border-radius: 8px;
                    ${user.avatar ? '' : 'display:none;'}
                " onerror="this.style.display='none'" />
                <span>${user.name || user.email}</span>
                <button onclick="spLogout()" style="
                    background: rgba(239,68,68,0.15); border: none; color: #f87171;
                    padding: 4px 10px; border-radius: 6px; font-size: 11px;
                    cursor: pointer; font-family: inherit;
                " title="Deconectare">✕</button>
            </div>
        `;
        document.body.appendChild(badge);
    }

    // Global logout function
    window.spLogout = function() {
        const token = localStorage.getItem('sp_session_token');
        if (token) {
            fetch(`${BASE_URL}/api/auth/logout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            }).catch(() => {});
        }
        localStorage.removeItem('sp_session_token');
        window.location.href = LOGIN_URL;
    };
})();
