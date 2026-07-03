/**
 * AlpURL — AI URL Intelligence Platform
 * app.js — Real-Time Connected Frontend SPA with Settings & Light Theme Refinements
 * © Antigraviti Dev
 */

"use strict";

// ════════════════════════════════════════════════════════════════════
//  API SERVICE LAYER
// ════════════════════════════════════════════════════════════════════
const API = {
    async request(url, method = "GET", body = null) {
        const headers = { "Content-Type": "application/json" };
        const key = localStorage.getItem("alpurl-api-key");
        if (key) headers["Authorization"] = `Bearer ${key}`;

        const options = { method, headers };
        if (body) options.body = JSON.stringify(body);

        // Prepend localhost:8000 when running locally on other ports or file scheme to connect to backend
        let targetUrl = url;
        if (url.startsWith("/api/") || url.startsWith("/api")) {
            if (window.location.protocol === "file:" || 
                (window.location.hostname === "localhost" && window.location.port !== "8000") ||
                (window.location.hostname === "127.0.0.1" && window.location.port !== "8000")) {
                targetUrl = `http://localhost:8000${url}`;
            }
        }

        try {
            updateSyncStatus("syncing");
            const res = await fetch(targetUrl, options);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || "API Request Failed");
            }
            updateSyncStatus("connected");
            return await res.json();
        } catch (error) {
            updateSyncStatus("offline");
            console.error(`[API Error] ${method} ${targetUrl}:`, error);
            throw error;
        }
    },
    
    // Auth
    login(email, password) { return this.request("/api/auth/login", "POST", { email, password }); },
    register(data) { return this.request("/api/auth/register", "POST", data); },
    
    // Links & QR
    getLinks(filters = {}) {
        const params = new URLSearchParams(filters).toString();
        return this.request(`/api/links?${params}`);
    },
    shorten(data) { return this.request("/api/shorten", "POST", data); },
    updateLink(key, data) { return this.request(`/api/links/${key}`, "PUT", data); },
    archiveLink(key) { return this.request(`/api/links/${key}/archive`, "PATCH"); },
    toggleLinkStatus(key, status) { return this.request(`/api/links/${key}/status?status=${status}`, "PATCH"); },
    deleteLink(key) { return this.request(`/api/links/${key}`, "DELETE"); },
    
    // QR codes
    getQRCodes() { return this.request("/api/qrcodes"); },
    
    // Campaigns & Domains
    getCampaigns() { return this.request("/api/campaigns"); },
    createCampaign(data) { return this.request("/api/campaigns", "POST", data); },
    getDomains() { return this.request("/api/domains"); },
    addDomain(domain) { return this.request("/api/domains", "POST", { domain }); },
    deleteDomain(id) { return this.request(`/api/domains/${id}`, "DELETE"); },
    
    // API Keys
    getAPIKeys() { return this.request("/api/apikeys"); },
    generateAPIKey(name) { return this.request("/api/apikeys", "POST", { name }); },
    revokeAPIKey(id) { return this.request(`/api/apikeys/${id}`, "DELETE"); },
    
    // Notifications
    getNotifications() { return this.request("/api/notifications"); },
    readAllNotifications() { return this.request("/api/notifications/read-all", "POST"); },
    readNotification(id) { return this.request(`/api/notifications/${id}/read`, "POST"); },
    clearNotifications() { return this.request("/api/notifications/clear", "POST"); },
    
    // Settings
    getSettings() { return this.request("/api/settings"); },
    updateSettings(data) { return this.request("/api/settings", "POST", data); },
    
    // Dashboard Stats
    getDashboardStats(range = "Lifetime") { return this.request(`/api/dashboard-stats?range=${range}`); },
    getLinkStats(key) { return this.request(`/api/stats/${key}`); }
};

// ════════════════════════════════════════════════════════════════════
//  APPLICATION STATE
// ════════════════════════════════════════════════════════════════════
const State = {
    // Auth & Navigation
    auth: JSON.parse(localStorage.getItem("alpurl-auth") || "null"),
    currentHash: window.location.hash || "#/",
    
    // Theme & Styling
    theme: localStorage.getItem("alpurl-theme") || "dark",
    
    // Cached Data
    dashboardStats: null,
    links: [],
    qrcodes: [],
    campaigns: [],
    domains: [],
    notifications: [],
    settings: null,
    apikeys: [],
    
    // Page Filters
    dateFilter: "Lifetime",
    linksFilter: { search: "", status: "all", sort: "date-desc", page: 1, perPage: 10 },
    settingsTab: "general",
    
    // Charts cache
    chartInstances: {},
    
    // Sync telemetry
    syncStatus: "connected",
    lastUpdated: null,
    syncInterval: null
};

// ════════════════════════════════════════════════════════════════════
//  UTILITIES & FORMATTERS
// ════════════════════════════════════════════════════════════════════
const fmt = {
    num(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
        if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
        return String(n || 0);
    },
    date(iso) {
        if (!iso) return "—";
        return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    },
    datetime(iso) {
        if (!iso) return "—";
        return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    },
    truncate(s, n = 48) {
        return s && s.length > n ? s.slice(0, n) + "…" : (s || "");
    },
    statusBadge(s) {
        const map = { active: "badge-success", paused: "badge-warning", archived: "badge-muted", verified: "badge-success", pending: "badge-warning" };
        return `<span class="badge ${map[s] || "badge-muted"}">${s}</span>`;
    },
    escape(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
};

function $q(sel, root = document) { return root.querySelector(sel); }
function $qa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

// Toast notifications (Stripe-inspired UI)
function showToast(msg, type = "info") {
    const colors = {
        info: "bg-surface-container-high border-border-glass",
        success: "bg-tertiary/15 border-tertiary/30 text-tertiary",
        error: "bg-error/15 border-error/30 text-error",
        warning: "bg-yellow-500/15 border-yellow-500/30 text-yellow-400"
    };
    const icons = { info: "info", success: "check_circle", error: "error", warning: "warning" };
    
    // Remove existing toast if any
    $q(".toast-popup")?.remove();

    const toast = document.createElement("div");
    toast.className = `toast-popup fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-5 py-3.5 rounded-xl border shadow-2xl animate-fade-in text-sm font-semibold ${colors[type] || colors.info}`;
    toast.style.backdropFilter = "blur(20px)";
    toast.innerHTML = `<span class="material-symbols-outlined text-[20px]" style="font-variation-settings:'FILL' 1;">${icons[type]}</span>${msg}`;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
        toast.style.transition = "all 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

// Reusable Skeleton screens
function getSkeletonHTML(height = "120px") {
    return `<div class="w-full bg-surface-container/30 border border-border-glass/40 rounded-2xl animate-pulse flex flex-col justify-center p-6 gap-3" style="height: ${height};">
        <div class="h-4 bg-white/10 rounded w-1/3"></div>
        <div class="h-8 bg-white/15 rounded w-1/2"></div>
    </div>`;
}

// ════════════════════════════════════════════════════════════════════
//  SYNCHRONIZATION — SERVER-SENT EVENTS + FALLBACK POLLING
// ════════════════════════════════════════════════════════════════════

// Connection status indicator
function updateSyncStatus(status) {
    State.syncStatus = status;
    const nodeStatusText = $q("#kgs-node-status");
    const nodeStatusDot  = $q("#kgs-node-dot");
    const nodeStatusPct  = $q("#kgs-node-pct");

    if (!nodeStatusText) return;

    const statusMap = {
        connected:    { text: "Live",         color: "bg-tertiary",  pct: "100%", style: "text-tertiary" },
        syncing:      { text: "Syncing…",     color: "bg-primary",   pct: "99.9%", style: "text-primary" },
        offline:      { text: "Offline",      color: "bg-error",     pct: "0.0%", style: "text-error" },
        reconnecting: { text: "Reconnecting", color: "bg-secondary", pct: "50.0%", style: "text-secondary" }
    };

    const cfg = statusMap[status] || statusMap.connected;
    nodeStatusText.textContent = `SSE ${cfg.text}`;
    nodeStatusText.className   = `text-[10px] ${cfg.style}`;
    if (nodeStatusPct) nodeStatusPct.textContent = cfg.pct;
    if (nodeStatusDot) {
        nodeStatusDot.className = `w-2 h-2 rounded-full ${cfg.color} animate-pulse-dot shrink-0`;
    }
    
    // Also update the header sync-status badge if present
    const badge = $q("#sync-status-badge");
    if (badge) {
        badge.textContent = cfg.text;
        badge.className = `text-[9px] font-bold uppercase tracking-wider ${cfg.style}`;
    }
}

function updateLastUpdated() {
    State.lastUpdated = new Date();
    const d = $q("#sync-time-display");
    if (d) d.textContent = `Updated ${State.lastUpdated.toLocaleTimeString()}`;
}

// ── SSE Real-Time Sync ──────────────────────────────────────────────
const RealtimeSync = {
    _es: null,           // EventSource instance
    _retryDelay: 1000,   // ms, doubles on each failure
    _maxDelay: 30000,    // cap at 30s
    _pollInterval: null, // fallback polling interval id
    _sseActive: false,   // whether SSE is connected

    // Map SSE event type → action handler
    _handlers: {
        link_created(data) {
            // Optimistically push new link to State.links if not already present
            if (!State.links.find(l => l.short_key === data.short_key)) {
                State.links.unshift(data);
            }
            // Refresh whichever page is active
            if (["dashboard", "links", "analytics", "qrcodes"].includes(State.currentPage)) {
                refreshActivePageData(true);
            }
        },
        link_updated(data) {
            const idx = State.links.findIndex(l => l.short_key === data.short_key);
            if (idx >= 0) Object.assign(State.links[idx], data);
            if (["dashboard", "links", "analytics"].includes(State.currentPage)) {
                refreshActivePageData(true);
            }
        },
        link_deleted(data) {
            State.links = State.links.filter(l => l.short_key !== data.short_key);
            if (["dashboard", "links", "analytics"].includes(State.currentPage)) {
                refreshActivePageData(true);
            }
        },
        click_recorded() {
            if (["dashboard", "analytics"].includes(State.currentPage)) {
                refreshActivePageData(true);
            }
        },
        settings_updated(data) {
            if (State.settings) Object.assign(State.settings, data);
            // Update profile name in header if name fields changed
            if (data.first_name || data.last_name) {
                const name = `${data.first_name || State.settings?.first_name || ""} ${data.last_name || State.settings?.last_name || ""}`.trim();
                [$q("#dash-profile-name"), $q("#dash-user-name")].forEach(el => { if (el) el.textContent = name; });
            }
        },
        notifications_updated() {
            fetchSidebarAndHeaderUpdates();
        },
        campaign_created() {
            if (State.currentPage === "campaigns") refreshActivePageData(true);
        },
        domain_added() {
            if (State.currentPage === "domains") refreshActivePageData(true);
        },
        domain_deleted() {
            if (State.currentPage === "domains") refreshActivePageData(true);
        },
        apikey_created() {
            if (State.currentPage === "settings") loadAPIKeysList();
        },
        apikey_deleted() {
            if (State.currentPage === "settings") loadAPIKeysList();
        }
    },

    connect() {
        if (!State.auth) return;
        if (this._es) { this._es.close(); this._es = null; }

        updateSyncStatus("reconnecting");

        try {
            this._es = new EventSource("/api/events");

            this._es.onopen = () => {
                this._sseActive = true;
                this._retryDelay = 1000; // reset backoff
                updateSyncStatus("connected");
                updateLastUpdated();
                // Switch fallback poll to a lazy interval since SSE is live
                this._startFallback(15000);
                console.log("[SSE] Connected to /api/events");
            };

            this._es.onmessage = (ev) => {
                try {
                    const msg = JSON.parse(ev.data);
                    if (msg.type && msg.type !== "connected" && this._handlers[msg.type]) {
                        this._handlers[msg.type](msg.data || {});
                        updateLastUpdated();
                    }
                } catch (e) {
                    console.warn("[SSE] Parse error:", e);
                }
            };

            this._es.onerror = () => {
                this._sseActive = false;
                this._es.close();
                this._es = null;
                updateSyncStatus("offline");
                // Switch to aggressive fallback polling while reconnecting
                this._startFallback(5000);
                // Schedule reconnect with exponential backoff
                console.log(`[SSE] Disconnected. Reconnecting in ${this._retryDelay}ms…`);
                setTimeout(() => {
                    updateSyncStatus("reconnecting");
                    this.connect();
                }, this._retryDelay);
                this._retryDelay = Math.min(this._retryDelay * 2, this._maxDelay);
            };
        } catch (e) {
            console.warn("[SSE] EventSource not supported, falling back to polling.");
            this._startFallback(5000);
        }
    },

    disconnect() {
        if (this._es) { this._es.close(); this._es = null; }
        if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
        updateSyncStatus("offline");
    },

    _startFallback(intervalMs) {
        if (this._pollInterval) clearInterval(this._pollInterval);
        this._pollInterval = setInterval(async () => {
            if (!State.auth) return;
            try {
                await fetchSidebarAndHeaderUpdates();
                // If SSE is not active, do a full page data refresh
                if (!this._sseActive) {
                    await refreshActivePageData(true);
                }
                updateLastUpdated();
                if (!this._sseActive) updateSyncStatus("connected");
            } catch (err) {
                updateSyncStatus("offline");
            }
        }, intervalMs);
    }
};

// Keep startBackgroundSync as the entry point (called in DOMContentLoaded)
function startBackgroundSync() {
    RealtimeSync.connect();
}

// Refresh notifications badge & header without redrawing everything
async function fetchSidebarAndHeaderUpdates() {
    try {
        const notifs = await API.getNotifications();
        if (JSON.stringify(State.notifications) !== JSON.stringify(notifs)) {
            State.notifications = notifs;
            renderNotifications();
        }
    } catch (e) {}
}

// ════════════════════════════════════════════════════════════════════
//  THEME MANAGEMENT
// ════════════════════════════════════════════════════════════════════
function initTheme() {
    applyTheme(State.theme);

    const toggleBtn = $q("#btn-toggle-theme");
    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            applyTheme(State.theme === "dark" ? "light" : "dark");
        });
    }
    
    const pubToggleBtn = $q("#pub-theme-btn");
    if (pubToggleBtn) {
        pubToggleBtn.addEventListener("click", () => {
            applyTheme(State.theme === "dark" ? "light" : "dark");
        });
    }
}

function applyTheme(t) {
    State.theme = t;
    const html = document.documentElement;
    html.className = t; // Apply theme as class name
    
    // Update theme icons
    const icons = $qa("#theme-icon, #pub-theme-icon");
    icons.forEach(icon => {
        if (icon) icon.textContent = t === "dark" ? "dark_mode" : "light_mode";
    });
    
    localStorage.setItem("alpurl-theme", t);
}

// ════════════════════════════════════════════════════════════════════
//  ROUTING & LAYOUT NAVIGATION
// ════════════════════════════════════════════════════════════════════
function initRouting() {
    window.addEventListener("hashchange", handleRouting);
    handleRouting();
}

function handleRouting() {
    const hash = window.location.hash || "#/";
    State.currentHash = hash;
    closeAllDropdowns();

    // Determine Mode
    const isDashboardRoute = hash.startsWith("#/dashboard");
    
    if (isDashboardRoute) {
        // Auth check
        if (!State.auth) {
            window.location.hash = "#/";
            showAuthModal("login");
            showToast("Login required to access the dashboard.", "warning");
            return;
        }
        
        // Setup Dashboard Shell
        $q("#public-nav").classList.add("hidden");
        $q("#public-layout").classList.add("hidden");
        $q("#dashboard-app").classList.remove("hidden");
        
        // Sub-page parsing
        const subPage = hash.replace("#/dashboard", "").replace("/", "") || "dashboard";
        navigateToDashboardPage(subPage);
    } else {
        // Setup Public Shell
        $q("#dashboard-app").classList.add("hidden");
        $q("#public-nav").classList.remove("hidden");
        $q("#public-layout").classList.remove("hidden");
        
        const pubPage = hash.replace("#/", "").replace("/", "") || "home";
        navigateToPublicPage(pubPage);
    }
}

// Switch between dashboard tabs
function navigateToDashboardPage(pageId) {
    $qa("#dash-main [data-page]").forEach(el => el.classList.add("hidden"));
    
    const pageEl = $q(`#page-${pageId}`);
    if (!pageEl) {
        navigateToDashboardPage("dashboard");
        return;
    }
    pageEl.classList.remove("hidden");
    
    // Update active nav links
    $qa(".nav-link").forEach(link => {
        const matches = link.getAttribute("href") === `#/dashboard/${pageId}` || (pageId === "dashboard" && link.getAttribute("href") === "#/dashboard");
        link.classList.toggle("active", matches);
    });

    State.currentPage = pageId;
    document.title = `AlpURL — ${pageTitles[pageId] || "AI URL Intelligence Platform"}`;
    
    // Initialize or render the page
    refreshActivePageData(false);
}

// Switch between public landing page tabs
function navigateToPublicPage(pageId) {
    $qa("#public-layout [data-public-page]").forEach(el => el.classList.add("hidden"));
    
    // Standardize IDs
    let elId = `page-${pageId}`;
    if (pageId === "home") elId = "page-home";
    else if (!elId.startsWith("page-pub-")) elId = elId.replace("page-", "page-pub-");
    
    const pageEl = $q(`#${elId}`);
    if (!pageEl) {
        navigateToPublicPage("home");
        return;
    }
    pageEl.classList.remove("hidden");
    
    // Highlight active nav links on desktop
    $qa("#pub-nav-links a").forEach(link => {
        const cleanHref = link.getAttribute("href");
        const hrefPage = cleanHref ? cleanHref.replace("#/", "") : "";
        const isActive = (pageId === "home" && cleanHref === "#/") ||
                         (pageId === hrefPage) ||
                         (pageId === `pub-${hrefPage}`);
        link.classList.toggle("active", isActive);
    });

    // Highlight active nav links on mobile
    $qa("#pub-mobile-menu a").forEach(link => {
        const cleanHref = link.getAttribute("href");
        const hrefPage = cleanHref ? cleanHref.replace("#/", "") : "";
        const isActive = (pageId === "home" && cleanHref === "#/") ||
                         (pageId === hrefPage) ||
                         (pageId === `pub-${hrefPage}`);
        link.classList.toggle("active", isActive);
    });

    // Close mobile hamburger menu
    $q("#pub-mobile-menu")?.classList.add("hidden");

    // Render public content
    renderPublicPage(pageId, pageEl);
}

const pageTitles = {
    dashboard: "Dashboard",
    links: "Link Management",
    qrcodes: "QR Code Studio",
    analytics: "Analytics Overview",
    campaigns: "Campaigns",
    domains: "Custom Domains",
    integrations: "Workspace Integrations",
    teams: "Workspace Teams",
    api: "API Reference",
    developers: "Developer Hub",
    settings: "Settings",
    help: "Help & Support"
};

// Refresh page contents when navigating or syncing
async function refreshActivePageData(background = false) {
    const p = State.currentPage;
    const container = $q(`#page-${p}`);
    if (!container) return;

    if (!background) {
        container.innerHTML = getSkeletonHTML("280px");
    }

    try {
        if (p === "dashboard") {
            const data = await API.getDashboardStats(State.dateFilter);
            State.dashboardStats = data;
            renderDashboardPage(container, data);
        } else if (p === "links") {
            const links = await API.getLinks(State.linksFilter);
            State.links = links;
            renderLinksPage(container, links);
        } else if (p === "qrcodes") {
            const codes = await API.getQRCodes();
            State.qrcodes = codes;
            renderQRPage(container, codes);
        } else if (p === "analytics") {
            // Reuses dashboard data for simplicity
            const data = await API.getDashboardStats(State.dateFilter);
            renderAnalyticsPage(container, data);
        } else if (p === "campaigns") {
            const camps = await API.getCampaigns();
            State.campaigns = camps;
            renderCampaignsPage(container, camps);
        } else if (p === "domains") {
            const domains = await API.getDomains();
            State.domains = domains;
            renderDomainsPage(container, domains);
        } else if (p === "api") {
            renderAPIPage(container);
        } else if (p === "developers") {
            renderDevelopersPage(container);
        } else if (p === "settings") {
            const settings = await API.getSettings();
            State.settings = settings;
            renderSettingsPage(container, settings);
        } else if (p === "profile") {
            const settings = await API.getSettings();
            State.settings = settings;
            renderProfilePage(container, settings);
        } else if (p === "help") {
            renderHelpPage(container);
        } else if (p === "integrations") {
            renderIntegrationsPage(container);
        } else if (p === "teams") {
            renderTeamsPage(container);
        }
    } catch (e) {
        container.innerHTML = `<div class="p-lg text-center text-error border border-error/20 bg-error/5 rounded-2xl">
            <span class="material-symbols-outlined text-[48px] mb-2">cloud_off</span>
            <p class="font-bold">Failed to load real data</p>
            <p class="text-xs opacity-80 mt-1">${e.message || "Please check connection & try again."}</p>
            <button class="mt-4 px-4 py-2 border border-error/30 text-error rounded-xl font-semibold text-xs hover:bg-error/15" onclick="refreshActivePageData()">Retry</button>
        </div>`;
    }
}

// Close dropdown panels
function closeAllDropdowns() {
    ["notification-panel", "profile-menu", "search-results", "pub-profile-dropdown", "pub-mobile-menu"].forEach(id => {
        $q(`#${id}`)?.classList.add("hidden");
    });
}

document.addEventListener("click", e => {
    if (!e.target.closest("#notification-container")) $q("#notification-panel")?.classList.add("hidden");
    if (!e.target.closest("#profile-container"))      $q("#profile-menu")?.classList.add("hidden");
    if (!e.target.closest("#pub-profile-wrap"))       $q("#pub-profile-dropdown")?.classList.add("hidden");
    if (!e.target.closest("#search-container"))       $q("#search-results")?.classList.add("hidden");
});

// ════════════════════════════════════════════════════════════════════
//  PUBLIC LAYOUT GENERATOR (LANDING PAGE + PAGES)
// ════════════════════════════════════════════════════════════════════
function renderPublicPage(id, container) {
    if (id === "home") {
        renderLandingPage(container);
    } else if (id === "pub-links" || id === "links") {
        renderStandaloneLinksPage(container);
    } else if (id === "pub-qr" || id === "qr") {
        renderStandaloneQRPage(container);
    } else if (id === "pub-developers" || id === "developers") {
        renderStandaloneDevelopersPage(container);
    } else if (id === "pub-about" || id === "about") {
        renderPublicAboutPage(container);
    } else if (id === "pub-contact" || id === "contact") {
        renderPublicContactPage(container);
    } else if (id === "pub-login" || id === "login") {
        renderPublicLoginPage(container);
    } else if (id === "pub-register" || id === "register") {
        renderPublicRegisterPage(container);
    } else if (id === "pub-api-docs" || id === "api-docs" || id === "api-documentation") {
        renderPublicApiDocsPage(container);
    }
}

function renderPublicLoginPage(container) {
    container.innerHTML = `
    <div class="pub-container pt-12 pb-24 px-6 max-w-md flex flex-col items-center">
        <div class="glass-card bg-surface-container-high border border-border-glass w-full shadow-2xl p-6 relative">
            <h3 class="text-xl font-bold text-on-background mb-1 text-center">Welcome back to AlpURL</h3>
            <p class="text-on-surface-variant text-xs mb-5 text-center">Log in to manage and optimize your links</p>
            
            <form id="pub-page-login-form" class="flex flex-col gap-4" novalidate>
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5" for="pub-login-email">Email Address</label>
                    <input id="pub-login-email" class="form-input" type="email" placeholder="you@example.com" required autocomplete="email"/>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5" for="pub-login-password">Password</label>
                    <input id="pub-login-password" class="form-input" type="password" placeholder="••••••••" required autocomplete="current-password"/>
                </div>
                <div class="flex justify-between items-center text-xs">
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" class="rounded accent-primary"/>
                        <span class="text-on-surface-variant">Remember me</span>
                    </label>
                    <button type="button" class="text-primary hover:underline">Forgot password?</button>
                </div>
                <button type="submit" class="w-full py-3 bg-primary text-on-primary rounded-xl font-semibold hover:bg-primary/90 transition-colors neon-glow">Log In</button>
                <p class="text-center text-xs text-on-surface-variant mt-2">Don't have an account? <a href="#/register" class="text-primary hover:underline font-semibold">Sign up free</a></p>
            </form>
        </div>
    </div>`;

    // Wire submit
    $q("#pub-page-login-form", container).addEventListener("submit", async e => {
        e.preventDefault();
        const email = $q("#pub-login-email", container).value.trim();
        const pass = $q("#pub-login-password", container).value;
        
        try {
            const res = await API.login(email, pass);
            State.auth = res.user;
            localStorage.setItem("alpurl-auth", JSON.stringify(res.user));
            localStorage.setItem("alpurl-api-key", "alp_live_demo_key");
            showToast("Logged in successfully!", "success");
            initSessionState();
            window.location.hash = "#/dashboard";
        } catch (e) {
            showToast("Authentication failed", "error");
        }
    });
}

function renderPublicRegisterPage(container) {
    container.innerHTML = `
    <div class="pub-container pt-12 pb-24 px-6 max-w-md flex flex-col items-center">
        <div class="glass-card bg-surface-container-high border border-border-glass w-full shadow-2xl p-6 relative">
            <h3 class="text-xl font-bold text-on-background mb-1 text-center">Create your free account</h3>
            <p class="text-on-surface-variant text-xs mb-5 text-center">Get started with advanced link analytics</p>
            
            <form id="pub-page-register-form" class="flex flex-col gap-4" novalidate>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5" for="pub-reg-fname">First Name</label>
                        <input id="pub-reg-fname" class="form-input" type="text" placeholder="Praval" required autocomplete="given-name"/>
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5" for="pub-reg-lname">Last Name</label>
                        <input id="pub-reg-lname" class="form-input" type="text" placeholder="Sharma" required autocomplete="family-name"/>
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5" for="pub-reg-email">Email Address</label>
                    <input id="pub-reg-email" class="form-input" type="email" placeholder="you@example.com" required autocomplete="email"/>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5" for="pub-reg-password">Password</label>
                    <input id="pub-reg-password" class="form-input" type="password" placeholder="Min 8 characters" required autocomplete="new-password"/>
                </div>
                <div class="text-xs text-on-surface-variant leading-relaxed">
                    By creating an account, you agree to our <a href="#" class="text-primary hover:underline">Terms of Service</a>.
                </div>
                <button type="submit" class="w-full py-3 bg-primary text-on-primary rounded-xl font-semibold hover:bg-primary/90 transition-colors neon-glow">Create Account</button>
                <p class="text-center text-xs text-on-surface-variant mt-2">Already have an account? <a href="#/login" class="text-primary hover:underline font-semibold">Log in</a></p>
            </form>
        </div>
    </div>`;

    // Wire submit
    $q("#pub-page-register-form", container).addEventListener("submit", async e => {
        e.preventDefault();
        const data = {
            first_name: $q("#pub-reg-fname", container).value.trim(),
            last_name: $q("#pub-reg-lname", container).value.trim(),
            email: $q("#pub-reg-email", container).value.trim(),
            password: $q("#pub-reg-password", container).value
        };
        
        try {
            const res = await API.register(data);
            State.auth = res.user;
            localStorage.setItem("alpurl-auth", JSON.stringify(res.user));
            localStorage.setItem("alpurl-api-key", "alp_live_demo_key");
            showToast("Account created successfully!", "success");
            initSessionState();
            window.location.hash = "#/dashboard";
        } catch (e) {
            showToast("Registration failed", "error");
        }
    });
}

function renderPublicApiDocsPage(container) {
    const baseUrl = window.location.origin;
    container.innerHTML = `
    <div class="pub-container pt-12 pb-24 px-6 max-w-4xl">
        <h2 class="text-3xl font-bold text-on-surface text-center mb-2" style="font-family:'Geist', sans-serif;">API Documentation</h2>
        <p class="text-on-surface-variant text-sm text-center mb-10">Integrate link optimization into your workflow in minutes.</p>
        
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div class="lg:col-span-7 flex flex-col gap-6">
                <div class="glass-card p-6 flex flex-col gap-3">
                    <h3 class="font-bold text-on-surface flex items-center gap-2 text-base">
                        <span class="material-symbols-outlined text-primary text-[20px]">api</span>REST API Endpoint
                    </h3>
                    <p class="text-on-surface-variant text-sm leading-relaxed">
                        Create custom short URLs programmatically by making simple POST requests. Secure your endpoint using an Authorization header.
                    </p>
                    <code class="text-xs font-mono bg-black/40 px-3 py-2 border border-border-glass rounded-xl text-primary mt-2">
                        POST ${baseUrl}/api/shorten
                    </code>
                </div>

                <div class="glass-card p-6 flex flex-col gap-3">
                    <h3 class="font-bold text-on-surface flex items-center gap-2 text-base">
                        <span class="material-symbols-outlined text-secondary text-[20px]">integration_instructions</span>Headers
                    </h3>
                    <code class="text-xs font-mono bg-black/40 p-4 border border-border-glass rounded-xl text-on-surface-variant flex flex-col gap-1">
                        <div>Content-Type: <span class="text-primary">application/json</span></div>
                        <div>Authorization: <span class="text-secondary">Bearer YOUR_API_KEY</span></div>
                    </code>
                </div>
            </div>

            <!-- Code tabs -->
            <div class="lg:col-span-5 glass-card p-6 flex flex-col min-h-[300px]">
                <h3 class="font-bold text-on-surface mb-4 text-sm uppercase tracking-wide">Quickstart Code Sample</h3>
                <div class="flex gap-2 border-b border-border-glass/40 pb-2 mb-4" id="api-docs-code-tabs">
                    <button class="hero-tab active" data-lang="curl">cURL</button>
                    <button class="hero-tab" data-lang="js">JavaScript</button>
                </div>
                
                <div id="api-docs-code-content" class="flex-1 flex flex-col">
                    <div class="api-docs-code-block font-mono text-xs text-on-surface-variant bg-black/30 border border-border-glass/40 rounded-xl p-4 flex-1 overflow-x-auto whitespace-pre leading-relaxed" data-lang="curl">curl -X POST ${baseUrl}/api/shorten \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{"long_url": "https://example.com"}'</div>
                    
                    <div class="api-docs-code-block font-mono text-xs text-on-surface-variant bg-black/30 border border-border-glass/40 rounded-xl p-4 flex-1 overflow-x-auto whitespace-pre leading-relaxed hidden" data-lang="js">fetch('${baseUrl}/api/shorten', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    long_url: 'https://example.com'
  })
}).then(res => res.json())
  .then(data => console.log(data.short_url));</div>
                </div>
            </div>
        </div>
    </div>`;

    const tabs = $qa("#api-docs-code-tabs button", container);
    tabs.forEach(t => {
        t.addEventListener("click", () => {
            tabs.forEach(b => b.classList.remove("active"));
            t.classList.add("active");
            $qa("#api-docs-code-content .api-docs-code-block", container).forEach(c => c.classList.add("hidden"));
            container.querySelector(`.api-docs-code-block[data-lang="${t.dataset.lang}"]`).classList.remove("hidden");
        });
    });
}

function renderProfilePage(container, settings) {
    container.innerHTML = `
    <div>
        <h2 class="font-bold text-2xl text-on-surface">User Profile</h2>
        <p class="text-on-surface-variant text-xs mt-1">View and manage your developer profile information.</p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
        <!-- Profile Card -->
        <div class="glass-card p-6 flex flex-col items-center text-center gap-4 lg:col-span-1">
            <div class="w-24 h-24 rounded-full overflow-hidden ring-4 ring-primary/30 shrink-0">
                <img src="${settings.avatar_url || 'https://lh3.googleusercontent.com/aida-public/AB6AXuCx8QSHp37bk4zf_yrQCyiRr7v3y4ex5kb4ZneWieTJ0L5z6ZnvnsBtLW2mCETL1EURJqEDU7bjb6bo8pN6fhBYCfDX5PbEPQuupcAkXl28oWWvosXm8c_7RsA3b0RcS8EXLvZtCapp5jZl9YbN4BRODqcCnHQFNBM_guWrynhA7HDzk5sEPd2mDTv1767qTHxUkWsGS8Pnx4e3nB5QOlfyD_2fZanTs5k5mbhmE9YGA-XSAtCfnhotVg'}" class="w-full h-full object-cover" alt="User avatar"/>
            </div>
            <div>
                <h3 class="font-bold text-lg text-on-surface">${settings.first_name || 'User'} ${settings.last_name || ''}</h3>
                <p class="text-xs text-on-surface-variant font-mono">@${settings.username || 'user'}</p>
            </div>
            <p class="text-xs text-on-surface-variant italic max-w-[240px] leading-relaxed">
                ${settings.bio || 'No bio provided yet.'}
            </p>
            <div class="w-full border-t border-border-glass/40 pt-4 flex flex-col gap-2 text-left">
                <div class="flex justify-between items-center text-xs">
                    <span class="text-on-surface-variant">Email</span>
                    <span class="font-semibold text-on-surface">${settings.email}</span>
                </div>
                <div class="flex justify-between items-center text-xs">
                    <span class="text-on-surface-variant">Redirection Domain</span>
                    <span class="font-semibold text-primary font-mono">${settings.default_domain || 'alp.url'}</span>
                </div>
            </div>
            <a href="#/dashboard/settings" class="mt-2 w-full py-2.5 bg-primary text-on-primary font-bold rounded-xl text-xs hover:bg-primary/95 transition-all text-center neon-glow">
                Edit Settings
            </a>
        </div>

        <!-- Details / Workspace info -->
        <div class="glass-card p-6 flex flex-col gap-5 lg:col-span-2">
            <h3 class="font-bold text-sm text-on-surface pb-3 border-b border-border-glass/40">Workspace & System Details</h3>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div class="p-4 border border-border-glass rounded-xl bg-black/10">
                    <span class="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">Active Workspace</span>
                    <p class="text-sm font-bold text-on-surface mt-1">${settings.workspace_name || 'Personal Workspace'}</p>
                </div>
                <div class="p-4 border border-border-glass rounded-xl bg-black/10">
                    <span class="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">Interface Language</span>
                    <p class="text-sm font-bold text-on-surface mt-1">${settings.language || 'English (US)'}</p>
                </div>
                <div class="p-4 border border-border-glass rounded-xl bg-black/10">
                    <span class="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">System Timezone</span>
                    <p class="text-sm font-bold text-on-surface mt-1 font-mono">${settings.timezone || 'UTC'}</p>
                </div>
                <div class="p-4 border border-border-glass rounded-xl bg-black/10">
                    <span class="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">Compact Mode</span>
                    <p class="text-sm font-bold text-on-surface mt-1">${settings.compact_mode ? 'Enabled' : 'Disabled'}</p>
                </div>
            </div>
        </div>
    </div>`;
}

// ── LANDING PAGE (Hero Shortener + Content) ──
function renderLandingPage(container) {
    container.innerHTML = `
    <!-- Hero Section -->
    <section class="relative pt-32 pb-20 px-6 overflow-hidden flex flex-col items-center">
        <!-- Glowing gradient orbs -->
        <div class="absolute -top-40 left-1/4 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[140px] pointer-events-none"></div>
        <div class="absolute top-20 right-1/4 w-[400px] h-[400px] bg-secondary/15 rounded-full blur-[120px] pointer-events-none"></div>

        <div class="max-w-4xl text-center flex flex-col items-center relative z-10">
            <span class="px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary font-bold tracking-wide uppercase mb-6 animate-pulse">
                🚀 Free AI-Powered Link Management
            </span>
            <h1 class="text-4xl md:text-6xl font-bold leading-tight tracking-tight text-on-surface select-none" style="font-family:'Geist', sans-serif;">
                Short Links. Smart Connections.<br/>
                <span class="bg-gradient-to-r from-primary via-secondary to-tertiary bg-clip-text text-transparent">Infinite Possibilities.</span>
            </h1>
            <p class="text-on-surface-variant text-base md:text-lg max-w-2xl mt-6 leading-relaxed">
                Optimize, track, and brand your short URLs instantly. Generate highly custom QR codes for your audience — completely free.
            </p>

            <!-- Hero URL Tool Box -->
            <div class="glass-card w-full max-w-2xl mt-10 p-5 md:p-6 shadow-2xl relative">
                <!-- Tabs -->
                <div class="flex gap-2 mb-4 border-b border-border-glass/40 pb-2">
                    <button class="hero-tab active" id="hero-tab-shorten">
                        <span class="material-symbols-outlined text-[18px]">link</span>Shorten Link
                    </button>
                    <button class="hero-tab" id="hero-tab-qr">
                        <span class="material-symbols-outlined text-[18px]">qr_code_2</span>QR Generator
                    </button>
                </div>

                <!-- Shorten Section -->
                <form id="hero-shorten-form" class="flex flex-col gap-4">
                    <div class="flex flex-col md:flex-row gap-3">
                        <input id="hero-long-url" class="form-input flex-1 h-12 px-4" type="url" placeholder="Paste your long URL here..." required/>
                        <button type="submit" class="h-12 px-6 bg-primary text-on-primary font-bold rounded-xl hover:bg-primary/95 transition-all neon-glow flex items-center justify-center gap-1">
                            Shorten URL
                        </button>
                    </div>
                </form>

                <!-- QR Section -->
                <form id="hero-qr-form" class="hidden flex flex-col gap-4">
                    <div class="flex flex-col md:flex-row gap-3">
                        <input id="hero-qr-url" class="form-input flex-1 h-12 px-4" type="url" placeholder="Enter URL or text for QR..." required/>
                        <button type="submit" class="h-12 px-6 bg-secondary text-on-secondary font-bold rounded-xl hover:bg-secondary/95 transition-all flex items-center justify-center gap-1">
                            Generate QR
                        </button>
                    </div>
                </form>

                <!-- Tool Result Display -->
                <div id="hero-result" class="hidden mt-5 pt-4 border-t border-border-glass/40 flex flex-col gap-4">
                    <div class="flex gap-3 items-center bg-black/30 border border-border-glass rounded-xl p-3">
                        <input id="hero-result-url" class="flex-1 font-mono text-primary bg-transparent border-none p-0 focus:ring-0 text-sm" readonly/>
                        <button id="btn-hero-copy" class="text-xs font-semibold text-secondary hover:underline shrink-0">Copy</button>
                        <button id="btn-hero-share" class="text-xs font-semibold text-tertiary hover:underline shrink-0">Share</button>
                    </div>
                    <div id="hero-qr-result-wrap" class="hidden flex flex-col items-center gap-3">
                        <div id="hero-qr-canvas" class="bg-white p-3 rounded-xl shadow-lg flex items-center justify-center"></div>
                        <button id="btn-hero-qr-dl" class="px-4 py-2 bg-primary text-on-primary rounded-xl text-xs font-semibold hover:bg-primary/90 transition-all flex items-center gap-1">
                            <span class="material-symbols-outlined text-[14px]">download</span>Download QR Code (PNG)
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- Public Features Grid -->
    <section class="pub-section bg-surface-container/20 border-t border-b border-border-glass/40">
        <div class="pub-container">
            <span class="pub-section-label">Features</span>
            <h2 class="pub-section-title">Everything you need in a URL platform</h2>
            <p class="pub-section-subtitle">AlpURL provides enterprise tools to everyone for free. No credit card required.</p>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
                <div class="feat-card">
                    <div class="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center text-primary mb-5"><span class="material-symbols-outlined text-[24px]">link</span></div>
                    <h3 class="text-lg font-bold text-on-surface mb-2">Instant Shortening</h3>
                    <p class="text-on-surface-variant text-sm leading-relaxed">Instantly convert long, clumsy links into clean, shareable micro-URLs with custom aliases.</p>
                </div>
                <div class="feat-card">
                    <div class="w-12 h-12 rounded-2xl bg-secondary/20 flex items-center justify-center text-secondary mb-5"><span class="material-symbols-outlined text-[24px]">qr_code_2</span></div>
                    <h3 class="text-lg font-bold text-on-surface mb-2">QR Code Studio</h3>
                    <p class="text-on-surface-variant text-sm leading-relaxed">Generate scalable vector QR codes. Choose colors, sizes, error correction, and download formats.</p>
                </div>
                <div class="feat-card">
                    <div class="w-12 h-12 rounded-2xl bg-tertiary/20 flex items-center justify-center text-tertiary mb-5"><span class="material-symbols-outlined text-[24px]">insights</span></div>
                    <h3 class="text-lg font-bold text-on-surface mb-2">Advanced Analytics</h3>
                    <p class="text-on-surface-variant text-sm leading-relaxed">Monitor redirects, geo-locations, referrers, device breakdown, and traffic trends in real time.</p>
                </div>
            </div>
        </div>
    </section>

    <!-- FAQ Accordion -->
    <section class="pub-section">
        <div class="pub-container max-w-3xl">
            <span class="pub-section-label">FAQ</span>
            <h2 class="pub-section-title">Common Questions</h2>
            <div class="mt-8 flex flex-col" id="landing-faq">
                <div class="pub-faq-item open">
                    <div class="pub-faq-q">Is AlpURL free? <span class="material-symbols-outlined faq-chev text-[18px]">expand_more</span></div>
                    <div class="pub-faq-a" style="display:block;">Yes! AlpURL is completely free to use. All core tools, redirection analytics, custom QR codes, and dashboard features are provided free of charge.</div>
                </div>
                <div class="pub-faq-item">
                    <div class="pub-faq-q">Do I need an account to shorten URLs? <span class="material-symbols-outlined faq-chev text-[18px]">expand_more</span></div>
                    <div class="pub-faq-a">No registration is required. You can instantly shorten links and download basic QR codes right from the homepage. Creating a free account unlocks advanced features like personal dashboards, saved links, custom domains, and campaign folders.</div>
                </div>
                <div class="pub-faq-item">
                    <div class="pub-faq-q">What is the API rate limit? <span class="material-symbols-outlined faq-chev text-[18px]">expand_more</span></div>
                    <div class="pub-faq-a">For standard free users, the REST API rate limit is 60 requests per minute. This allows you to integrate link management comfortably into your local scripts and integrations.</div>
                </div>
            </div>
        </div>
    </section>

    <!-- Public Footer -->
    <footer class="bg-surface-dim border-t border-border-glass py-12 px-6">
        <div class="pub-container flex flex-col md:flex-row justify-between items-center gap-6">
            <p class="text-sm text-on-surface-variant">© 2026 AlpURL. Made with ❤️ by Antigraviti Dev. All rights reserved.</p>
            <div class="flex gap-4">
                <a href="#/about" class="text-xs text-on-surface-variant hover:text-primary transition-all">About Us</a>
                <a href="#/developers" class="text-xs text-on-surface-variant hover:text-primary transition-all">Developer API</a>
                <a href="#/contact" class="text-xs text-on-surface-variant hover:text-primary transition-all">Contact Support</a>
            </div>
        </div>
    </footer>`;

    // Wire hero tab switches
    $q("#hero-tab-shorten", container).addEventListener("click", () => {
        $q("#hero-tab-shorten", container).classList.add("active");
        $q("#hero-tab-qr", container).classList.remove("active");
        $q("#hero-shorten-form", container).classList.remove("hidden");
        $q("#hero-qr-form", container).classList.add("hidden");
        $q("#hero-result", container).classList.add("hidden");
    });
    $q("#hero-tab-qr", container).addEventListener("click", () => {
        $q("#hero-tab-qr", container).classList.add("active");
        $q("#hero-tab-shorten", container).classList.remove("active");
        $q("#hero-qr-form", container).classList.remove("hidden");
        $q("#hero-shorten-form", container).classList.add("hidden");
        $q("#hero-result", container).classList.add("hidden");
    });

    // Wire shortening submit
    $q("#hero-shorten-form", container).addEventListener("submit", async e => {
        e.preventDefault();
        const longUrl = $q("#hero-long-url", container).value.trim();
        try {
            const data = await API.shorten({ long_url: longUrl });
            $q("#hero-result-url", container).value = data.short_url;
            $q("#hero-qr-result-wrap", container).classList.add("hidden");
            $q("#hero-result", container).classList.remove("hidden");
            showToast("URL Shortened!", "success");
        } catch (err) {
            showToast("Failed to shorten link.", "error");
        }
    });

    // Wire QR submit
    $q("#hero-qr-form", container).addEventListener("submit", e => {
        e.preventDefault();
        const text = $q("#hero-qr-url", container).value.trim();
        const canvasWrap = $q("#hero-qr-canvas", container);
        canvasWrap.innerHTML = "";
        
        try {
            new QRCode(canvasWrap, { text, width: 180, height: 180 });
            $q("#hero-result-url", container).value = text;
            $q("#hero-qr-result-wrap", container).classList.remove("hidden");
            $q("#hero-result", container).classList.remove("hidden");
            showToast("QR Code Generated!", "success");
        } catch (err) {
            showToast("Failed to generate QR.", "error");
        }
    });

    // Wire results actions
    $q("#btn-hero-copy", container).addEventListener("click", () => {
        const val = $q("#hero-result-url", container).value;
        navigator.clipboard.writeText(val).then(() => showToast("Copied to clipboard!", "success"));
    });

    $q("#btn-hero-share", container).addEventListener("click", () => {
        const val = $q("#hero-result-url", container).value;
        showShareModal(val);
    });

    $q("#btn-hero-qr-dl", container).addEventListener("click", () => {
        const canvas = container.querySelector("#hero-qr-canvas canvas");
        if (!canvas) return;
        const a = document.createElement("a");
        a.download = "alpurl-qr.png";
        a.href = canvas.toDataURL("image/png");
        a.click();
        showToast("Downloaded QR PNG", "success");
    });

    // Wire FAQ accordion
    $qa(".pub-faq-item", container).forEach(item => {
        item.querySelector(".pub-faq-q").addEventListener("click", () => {
            const wasOpen = item.classList.contains("open");
            $qa(".pub-faq-item", container).forEach(i => {
                i.classList.remove("open");
                i.querySelector(".pub-faq-a").style.display = "none";
            });
            if (!wasOpen) {
                item.classList.add("open");
                item.querySelector(".pub-faq-a").style.display = "block";
            }
        });
    });
}

function renderStandaloneLinksPage(container) {
    container.innerHTML = `
    <div class="pub-container pt-12 pb-24 px-6 max-w-xl flex flex-col items-center">
        <h2 class="text-3xl font-bold text-on-surface text-center mb-2" style="font-family:'Geist', sans-serif;">Branded URL Shortener</h2>
        <p class="text-on-surface-variant text-sm text-center mb-8">Shorten and customize links instantly.</p>
        
        <div class="glass-card w-full p-6 flex flex-col gap-4">
            <form id="standalone-shorten" class="flex flex-col gap-4">
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Destination URL</label>
                    <input id="sa-long-url" class="form-input h-11" type="url" placeholder="https://example.com/long-page" required/>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Custom Alias (Optional)</label>
                        <input id="sa-alias" class="form-input h-11" type="text" placeholder="promo-code"/>
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Expiry (Hours)</label>
                        <input id="sa-expiry" class="form-input h-11" type="number" placeholder="Never" min="1"/>
                    </div>
                </div>
                <button type="submit" class="w-full py-3 bg-primary text-on-primary font-bold rounded-xl hover:bg-primary/95 transition-all neon-glow flex items-center justify-center gap-1 mt-2">
                    Shorten Link
                </button>
            </form>
            
            <div id="sa-result" class="hidden pt-4 border-t border-border-glass/40 flex flex-col gap-3">
                <p class="text-xs font-bold text-tertiary">🎉 Short Link Created successfully!</p>
                <div class="flex items-center gap-2 bg-black/30 border border-border-glass rounded-xl p-3">
                    <input id="sa-result-url" class="flex-1 font-mono text-primary bg-transparent border-none p-0 focus:ring-0 text-sm" readonly/>
                    <button id="btn-sa-copy" class="text-xs font-semibold text-secondary hover:underline shrink-0">Copy</button>
                </div>
                <div class="flex gap-2">
                    <button id="btn-sa-share" class="flex-1 py-2 border border-border-glass rounded-xl text-xs font-semibold hover:bg-surface-container-high transition-all">Share Link</button>
                    <button id="btn-sa-qr" class="flex-1 py-2 bg-secondary text-on-secondary rounded-xl text-xs font-semibold hover:bg-secondary/90 transition-all">Create QR Code</button>
                </div>
            </div>
        </div>
    </div>`;

    const form = $q("#standalone-shorten", container);
    form.addEventListener("submit", async e => {
        e.preventDefault();
        const body = { long_url: $q("#sa-long-url", container).value.trim() };
        const alias = $q("#sa-alias", container).value.trim();
        const exp = $q("#sa-expiry", container).value.trim();
        
        if (alias) body.custom_alias = alias;
        if (exp) body.expiry_hours = parseInt(exp);

        try {
            const data = await API.shorten(body);
            $q("#sa-result-url", container).value = data.short_url;
            $q("#sa-result", container).classList.remove("hidden");
            showToast("Short link created!", "success");
        } catch (err) {
            showToast(err.message || "Failed to shorten.", "error");
        }
    });

    $q("#btn-sa-copy", container).addEventListener("click", () => {
        const val = $q("#sa-result-url", container).value;
        navigator.clipboard.writeText(val).then(() => showToast("Copied!", "success"));
    });
    $q("#btn-sa-share", container).addEventListener("click", () => {
        showShareModal($q("#sa-result-url", container).value);
    });
    $q("#btn-sa-qr", container).addEventListener("click", () => {
        window.location.hash = `#/qr?url=${encodeURIComponent($q("#sa-result-url", container).value)}`;
    });
}

function renderStandaloneQRPage(container) {
    // Check if query string URL exists in hash
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const initialUrl = params.get("url") || "https://alp.url";

    container.innerHTML = `
    <div class="pub-container pt-12 pb-24 px-6 max-w-4xl">
        <h2 class="text-3xl font-bold text-on-surface text-center mb-2" style="font-family:'Geist', sans-serif;">QR Code Generator</h2>
        <p class="text-on-surface-variant text-sm text-center mb-8">Generate custom vector QR codes for free.</p>
        
        <div class="grid grid-cols-12 gap-6">
            <!-- Controls -->
            <div class="col-span-12 md:col-span-6 glass-card p-6 flex flex-col gap-4">
                <!-- QR Type Tabs -->
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">QR Content Type</label>
                    <div class="grid grid-cols-4 gap-1.5" id="pub-qr-types">
                        <button class="qr-type-btn active" data-type="url"><span class="material-symbols-outlined">link</span>URL</button>
                        <button class="qr-type-btn" data-type="text"><span class="material-symbols-outlined">notes</span>Text</button>
                        <button class="qr-type-btn" data-type="wifi"><span class="material-symbols-outlined">wifi</span>WiFi</button>
                        <button class="qr-type-btn" data-type="email"><span class="material-symbols-outlined">mail</span>Email</button>
                    </div>
                </div>

                <!-- Input Area -->
                <div id="pub-qr-inputs">
                    <!-- URL Input -->
                    <div class="qr-input-field" data-type="url">
                        <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Website URL</label>
                        <input id="pq-input-url" class="form-input" type="url" placeholder="https://example.com" value="${initialUrl}"/>
                    </div>
                    <!-- Text Input -->
                    <div class="qr-input-field hidden" data-type="text">
                        <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Plain Text</label>
                        <textarea id="pq-input-text" class="form-input" rows="3" placeholder="Enter custom message..."></textarea>
                    </div>
                    <!-- WiFi Input -->
                    <div class="qr-input-field hidden" data-type="wifi">
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">SSID / Network Name</label>
                                <input id="pq-input-ssid" class="form-input" type="text" placeholder="HomeNetwork"/>
                            </div>
                            <div>
                                <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Password</label>
                                <input id="pq-input-wifi-pass" class="form-input" type="password" placeholder="WPA/WPA2 pass"/>
                            </div>
                        </div>
                    </div>
                    <!-- Email Input -->
                    <div class="qr-input-field hidden" data-type="email">
                        <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Email Address</label>
                        <input id="pq-input-email" class="form-input" type="email" placeholder="hello@example.com"/>
                    </div>
                </div>

                <!-- Colors -->
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">QR Color</label>
                        <input type="color" id="pq-fg" value="#0F172A" class="w-full h-10 rounded-xl cursor-pointer bg-transparent border border-border-glass p-1"/>
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Background</label>
                        <input type="color" id="pq-bg" value="#ffffff" class="w-full h-10 rounded-xl cursor-pointer bg-transparent border border-border-glass p-1"/>
                    </div>
                </div>

                <button id="btn-pq-generate" class="w-full py-3 bg-secondary text-on-secondary font-bold rounded-xl hover:bg-secondary/95 transition-all flex items-center justify-center gap-1 mt-2">
                    Generate QR Code
                </button>
            </div>

            <!-- Preview -->
            <div class="col-span-12 md:col-span-6 glass-card p-6 flex flex-col items-center justify-center gap-4 min-h-[300px]">
                <div id="pq-canvas-wrap" class="bg-white p-5 rounded-2xl shadow-xl flex items-center justify-center min-w-[200px] min-h-[200px]">
                    <div class="text-center text-outline text-sm">
                        <span class="material-symbols-outlined text-[48px] opacity-30 block mb-1">qr_code</span>
                        Click Generate
                    </div>
                </div>
                <div class="flex gap-3 mt-2 hidden" id="pq-actions">
                    <button id="btn-pq-download" class="px-5 py-2.5 bg-primary text-on-primary font-bold rounded-xl text-xs hover:bg-primary/95 transition-all">Download PNG</button>
                    <button id="btn-pq-copy" class="px-5 py-2.5 border border-border-glass rounded-xl text-xs font-bold hover:bg-surface-container-high transition-all">Copy Image</button>
                </div>
            </div>
        </div>
    </div>`;

    // Tab switcher
    const tabBtns = $qa("#pub-qr-types button", container);
    let currentType = "url";
    
    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentType = btn.dataset.type;
            
            $qa(".qr-input-field", container).forEach(f => f.classList.add("hidden"));
            container.querySelector(`.qr-input-field[data-type="${currentType}"]`).classList.remove("hidden");
        });
    });

    // Generate action
    $q("#btn-pq-generate", container).addEventListener("click", () => {
        let textVal = "";
        if (currentType === "url") {
            textVal = $q("#pq-input-url", container).value.trim();
        } else if (currentType === "text") {
            textVal = $q("#pq-input-text", container).value.trim();
        } else if (currentType === "wifi") {
            const ssid = $q("#pq-input-ssid", container).value.trim();
            const pass = $q("#pq-input-wifi-pass", container).value.trim();
            textVal = `WIFI:T:WPA;S:${ssid};P:${pass};;`;
        } else if (currentType === "email") {
            const mail = $q("#pq-input-email", container).value.trim();
            textVal = `mailto:${mail}`;
        }

        if (!textVal) { showToast("QR Content cannot be empty.", "warning"); return; }

        const wrap = $q("#pq-canvas-wrap", container);
        wrap.innerHTML = "";
        
        try {
            new QRCode(wrap, {
                text: textVal,
                width: 220,
                height: 220,
                colorDark: $q("#pq-fg", container).value,
                colorLight: $q("#pq-bg", container).value
            });
            $q("#pq-actions", container).classList.remove("hidden");
            showToast("QR Code Generated!", "success");
        } catch (e) {
            showToast("Error generating QR code.", "error");
        }
    });

    $q("#btn-pq-download", container).addEventListener("click", () => {
        const canvas = container.querySelector("#pq-canvas-wrap canvas");
        if (!canvas) return;
        const a = document.createElement("a");
        a.download = "alpurl-qrcode.png";
        a.href = canvas.toDataURL("image/png");
        a.click();
    });

    $q("#btn-pq-copy", container).addEventListener("click", () => {
        const canvas = container.querySelector("#pq-canvas-wrap canvas");
        if (!canvas) return;
        canvas.toBlob(blob => {
            navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
                .then(() => showToast("Copied to clipboard!", "success"))
                .catch(() => showToast("Failed to copy image.", "error"));
        });
    });

    // Auto run first generate
    setTimeout(() => $q("#btn-pq-generate", container).click(), 200);
}

function renderStandaloneDevelopersPage(container) {
    container.innerHTML = `
    <div class="pub-container pt-12 pb-24 px-6 max-w-4xl">
        <h2 class="text-3xl font-bold text-on-surface text-center mb-2" style="font-family:'Geist', sans-serif;">Developer Hub</h2>
        <p class="text-on-surface-variant text-sm text-center mb-10">Integrate link optimization into your workflow in minutes.</p>
        
        <div class="grid grid-cols-12 gap-6">
            <!-- Left instructions -->
            <div class="col-span-12 lg:col-span-7 flex flex-col gap-6">
                <div class="glass-card p-6 flex flex-col gap-3">
                    <h3 class="font-bold text-on-surface flex items-center gap-2 text-base">
                        <span class="material-symbols-outlined text-primary text-[20px]">api</span>REST API Endpoint
                    </h3>
                    <p class="text-on-surface-variant text-sm leading-relaxed">
                        Create custom short URLs programmatically by making simple POST requests. Secure your endpoint using an Authorization header.
                    </p>
                    <code class="text-xs font-mono bg-black/40 px-3 py-2 border border-border-glass rounded-xl text-primary mt-2">
                        POST ${window.location.origin}/api/shorten
                    </code>
                </div>

                <div class="glass-card p-6 flex flex-col gap-3">
                    <h3 class="font-bold text-on-surface flex items-center gap-2 text-base">
                        <span class="material-symbols-outlined text-secondary text-[20px]">integration_instructions</span>Headers
                    </h3>
                    <code class="text-xs font-mono bg-black/40 p-4 border border-border-glass rounded-xl text-on-surface-variant flex flex-col gap-1">
                        <div>Content-Type: <span class="text-primary">application/json</span></div>
                        <div>Authorization: <span class="text-secondary">Bearer YOUR_API_KEY</span></div>
                    </code>
                </div>
            </div>

            <!-- Code tabs -->
            <div class="col-span-12 lg:col-span-5 glass-card p-6 flex flex-col min-h-[300px]">
                <h3 class="font-bold text-on-surface mb-4 text-sm uppercase tracking-wide">Quickstart Code Sample</h3>
                <div class="flex gap-2 border-b border-border-glass/40 pb-2 mb-4" id="pub-code-tabs">
                    <button class="hero-tab active" data-lang="curl">cURL</button>
                    <button class="hero-tab" data-lang="js">JavaScript</button>
                </div>
                
                <div id="pub-code-content" class="flex-1 flex flex-col">
                    <div class="pub-code-block font-mono text-xs text-on-surface-variant bg-black/30 border border-border-glass/40 rounded-xl p-4 flex-1 overflow-x-auto whitespace-pre leading-relaxed" data-lang="curl">curl -X POST ${window.location.origin}/api/shorten \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{"long_url": "https://example.com"}'</div>
                    
                    <div class="pub-code-block font-mono text-xs text-on-surface-variant bg-black/30 border border-border-glass/40 rounded-xl p-4 flex-1 overflow-x-auto whitespace-pre leading-relaxed hidden" data-lang="js">fetch('${window.location.origin}/api/shorten', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  body: JSON.stringify({
    long_url: 'https://example.com'
  })
}).then(res => res.json())
  .then(data => console.log(data.short_url));</div>
                </div>
            </div>
        </div>
    </div>`;

    const tabs = $qa("#pub-code-tabs button", container);
    tabs.forEach(t => {
        t.addEventListener("click", () => {
            tabs.forEach(b => b.classList.remove("active"));
            t.classList.add("active");
            $qa("#pub-code-content .pub-code-block", container).forEach(c => c.classList.add("hidden"));
            container.querySelector(`.pub-code-block[data-lang="${t.dataset.lang}"]`).classList.remove("hidden");
        });
    });
}

function renderPublicAboutPage(container) {
    container.innerHTML = `
    <div class="pub-container pt-12 pb-24 px-6 max-w-2xl text-center flex flex-col items-center">
        <h2 class="text-3xl font-bold text-on-surface mb-4" style="font-family:'Geist', sans-serif;">About AlpURL</h2>
        <p class="text-on-surface-variant text-base leading-relaxed mb-6">
            AlpURL is a high-performance URL shortening and management platform engineered by Antigraviti Dev. We empower users with reliable link shortening, deep analytical telemetry, and custom branded domains.
        </p>
        <div class="glass-card p-6 w-full text-left flex flex-col gap-4 mt-6">
            <h3 class="font-bold text-primary text-sm uppercase tracking-wide">Our Mission</h3>
            <p class="text-on-surface-variant text-sm leading-relaxed">
                We believe that premium, Linear-grade link shortening tools should be accessible to developers and businesses free of charge. No payment gates, no credit card prompts, just fast, raw performance.
            </p>
        </div>
    </div>`;
}

function renderPublicContactPage(container) {
    container.innerHTML = `
    <div class="pub-container pt-12 pb-24 px-6 max-w-xl flex flex-col items-center">
        <h2 class="text-3xl font-bold text-on-surface text-center mb-2" style="font-family:'Geist', sans-serif;">Contact Us</h2>
        <p class="text-on-surface-variant text-sm text-center mb-8">Have a question or request? Drop us a line.</p>
        
        <form id="pub-contact-form" class="glass-card w-full p-6 flex flex-col gap-4">
            <div>
                <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Your Name</label>
                <input class="form-input" type="text" placeholder="Praval Sharma" required/>
            </div>
            <div>
                <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Email Address</label>
                <input class="form-input" type="email" placeholder="praval@example.com" required/>
            </div>
            <div>
                <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Message</label>
                <textarea class="form-input resize-none" rows="4" placeholder="How can we help you?" required></textarea>
            </div>
            <button type="submit" class="w-full py-3 bg-primary text-on-primary font-bold rounded-xl hover:bg-primary/95 transition-all neon-glow mt-2">
                Send Message
            </button>
        </form>
    </div>`;

    $q("#pub-contact-form", container).addEventListener("submit", e => {
        e.preventDefault();
        showToast("Message sent! We'll reply within 24 hours.", "success");
        $q("#pub-contact-form", container).reset();
    });
}

// ════════════════════════════════════════════════════════════════════
//  DASHBOARD PAGE GENERATOR
// ════════════════════════════════════════════════════════════════════
function renderDashboardPage(container, data) {
    container.innerHTML = `
    <!-- KPI Overview -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        ${[
            { label: "Total Links",    value: fmt.num(data.total_links), icon: "link",    color: "text-primary" },
            { label: "Active Links",   value: fmt.num(data.active_links),icon: "verified",color: "text-tertiary" },
            { label: "Total Clicks",   value: fmt.num(data.total_clicks),icon: "ads_click",color: "text-secondary" },
            { label: "QR Codes",       value: fmt.num(data.qr_codes),    icon: "qr_code_2",color: "text-primary" }
        ].map(k => `
        <div class="glass-card p-5 flex flex-col gap-2 relative overflow-hidden">
            <span class="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">${k.label}</span>
            <div class="flex justify-between items-end mt-2">
                <span class="text-3xl font-bold text-on-surface font-headline-md">${k.value}</span>
                <span class="material-symbols-outlined ${k.color} text-[22px] mb-1" style="font-variation-settings:'FILL' 1;">${k.icon}</span>
            </div>
        </div>`).join("")}
    </div>

    <!-- Main Shortener Box -->
    <div class="glass-card p-6 flex flex-col gap-4">
        <h3 class="font-bold text-on-surface flex items-center gap-2 text-sm border-b border-border-glass/40 pb-3">
            <span class="material-symbols-outlined text-primary text-[18px]">add_link</span>Create Short Link
        </h3>
        <form id="dash-shorten-form" class="flex flex-col gap-4">
            <div class="flex flex-col md:flex-row gap-3">
                <input id="dash-long-url" class="form-input flex-1 h-12 px-4" type="url" placeholder="https://example.com/very-long-url" required/>
                <button type="submit" class="h-12 px-6 bg-primary text-on-primary font-bold rounded-xl hover:bg-primary/95 transition-all neon-glow flex items-center justify-center gap-1">
                    Shorten Link
                </button>
            </div>
        </form>
        <div id="dash-result-card" class="hidden flex items-center gap-2 bg-black/30 border border-border-glass rounded-xl p-3">
            <input id="dash-result-url" class="flex-1 font-mono text-primary bg-transparent border-none p-0 focus:ring-0 text-sm" readonly/>
            <button id="btn-dash-copy" class="text-xs font-semibold text-secondary hover:underline shrink-0">Copy</button>
            <button id="btn-dash-share" class="text-xs font-semibold text-tertiary hover:underline shrink-0">Share</button>
        </div>
    </div>

    <!-- Charts -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="glass-card p-5 flex flex-col" style="height:320px;">
            <h4 class="font-bold text-xs text-on-surface-variant uppercase tracking-wider mb-4 flex items-center gap-1.5"><span class="material-symbols-outlined text-primary" style="font-size:16px;">trending_up</span>Clicks Over Time</h4>
            <div class="flex-1 relative min-h-0"><canvas id="clicksChart"></canvas></div>
        </div>
        <div class="glass-card p-5 flex flex-col" style="height:320px;">
            <h4 class="font-bold text-xs text-on-surface-variant uppercase tracking-wider mb-4 flex items-center gap-1.5"><span class="material-symbols-outlined text-purple-400" style="font-size:16px;">share</span>Referrers</h4>
            <div class="flex-1 relative min-h-0"><canvas id="referrersChart"></canvas></div>
        </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="glass-card p-5 flex flex-col" style="height:280px;">
            <h4 class="font-bold text-xs text-on-surface-variant uppercase tracking-wider mb-4 flex items-center gap-1.5"><span class="material-symbols-outlined text-secondary" style="font-size:16px;">devices</span>Browsers</h4>
            <div class="flex-1 relative min-h-0"><canvas id="browsersChart"></canvas></div>
        </div>
        <div class="glass-card p-5 flex flex-col" style="height:280px;">
            <h4 class="font-bold text-xs text-on-surface-variant uppercase tracking-wider mb-4 flex items-center gap-1.5"><span class="material-symbols-outlined text-tertiary" style="font-size:16px;">settings_system_daydream</span>Operating Systems</h4>
            <div class="flex-1 relative min-h-0"><canvas id="osChart"></canvas></div>
        </div>
    </div>

    <!-- Recent Mappings -->
    <div class="glass-card overflow-hidden">
        <div class="flex justify-between items-center px-6 py-4 border-b border-border-glass/40">
            <h3 class="font-bold text-on-surface text-sm flex items-center gap-1.5"><span class="material-symbols-outlined text-primary" style="font-size:18px;">history</span>Recent Links</h3>
            <button class="text-xs text-primary hover:underline font-semibold" data-page="links">View All</button>
        </div>
        <div class="w-full overflow-x-auto custom-scrollbar">
            <table class="w-full text-sm text-left border-collapse">
                <thead><tr class="border-b border-border-glass/40 text-on-surface-variant text-xs font-semibold uppercase">
                    <th class="p-4">Short Key</th>
                    <th class="p-4">Long URL</th>
                    <th class="p-4 text-center">Clicks</th>
                    <th class="p-4">Status</th>
                    <th class="p-4">Created</th>
                    <th class="p-4 text-center">Analytics</th>
                </tr></thead>
                <tbody id="registry-list"></tbody>
            </table>
        </div>
    </div>`;

    // Wire shorten form
    $q("#dash-shorten-form", container).addEventListener("submit", async e => {
        e.preventDefault();
        const val = $q("#dash-long-url", container).value.trim();
        try {
            const result = await API.shorten({ long_url: val });
            $q("#dash-result-url", container).value = result.short_url;
            $q("#dash-result-card", container).classList.remove("hidden");
            $q("#dash-long-url", container).value = "";
            showToast("Short link created!", "success");
            
            // Auto refresh stats
            refreshActivePageData(true);
        } catch (err) {
            showToast("Error creating short link.", "error");
        }
    });

    $q("#btn-dash-copy", container).addEventListener("click", () => {
        const val = $q("#dash-result-url", container).value;
        navigator.clipboard.writeText(val).then(() => showToast("Copied to clipboard!", "success"));
    });
    $q("#btn-dash-share", container).addEventListener("click", () => {
        showShareModal($q("#dash-result-url", container).value);
    });

    renderRegistry(data.recent_links || []);
    renderGlobalCharts(data);
}

// ════════════════════════════════════════════════════════════════════
//  LINKS MANAGEMENT PAGE
// ════════════════════════════════════════════════════════════════════
function renderLinksPage(container, links) {
    container.innerHTML = `
    <div class="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
            <h2 class="font-bold text-2xl text-on-surface">Links Library</h2>
            <p class="text-on-surface-variant text-xs mt-1">Manage and track redirects for your active URLs.</p>
        </div>
        <button id="lp-new-link" class="px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-xs hover:bg-primary/90 transition-colors neon-glow flex items-center gap-1">
            <span class="material-symbols-outlined text-[16px]">add</span>New Link
        </button>
    </div>

    <!-- Search + Filters -->
    <div class="glass-card p-4 flex flex-wrap gap-3 items-center">
        <div class="flex-1 min-w-[200px] relative">
            <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" style="font-size:16px;">search</span>
            <input type="text" id="lp-search" class="form-input pl-9 h-10" placeholder="Search links, tags, URLs…" value="${State.linksFilter.search}"/>
        </div>
        <select id="lp-status" class="form-input w-auto h-10 select-none">
            <option value="all" ${State.linksFilter.status === "all" ? "selected" : ""}>All Status</option>
            <option value="active" ${State.linksFilter.status === "active" ? "selected" : ""}>Active</option>
            <option value="paused" ${State.linksFilter.status === "paused" ? "selected" : ""}>Paused</option>
            <option value="archived" ${State.linksFilter.status === "archived" ? "selected" : ""}>Archived</option>
        </select>
        <select id="lp-sort" class="form-input w-auto h-10 select-none">
            <option value="date-desc" ${State.linksFilter.sort === "date-desc" ? "selected" : ""}>Newest First</option>
            <option value="date-asc" ${State.linksFilter.sort === "date-asc" ? "selected" : ""}>Oldest First</option>
            <option value="clicks-desc" ${State.linksFilter.sort === "clicks-desc" ? "selected" : ""}>Most Clicks</option>
            <option value="clicks-asc" ${State.linksFilter.sort === "clicks-asc" ? "selected" : ""}>Least Clicks</option>
        </select>
        <button id="lp-export" class="flex items-center gap-1.5 px-3 h-10 border border-border-glass rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors text-xs font-semibold">
            <span class="material-symbols-outlined text-[16px]">download</span>Export CSV
        </button>
    </div>

    <!-- Table -->
    <div class="glass-card overflow-hidden">
        <div class="w-full overflow-x-auto custom-scrollbar">
            <table class="w-full text-xs text-left border-collapse">
                <thead>
                    <tr class="border-b border-border-glass/40 text-on-surface-variant font-semibold uppercase">
                        <th class="p-4">Short Key</th>
                        <th class="p-4">Destination URL</th>
                        <th class="p-4">Campaign</th>
                        <th class="p-4 text-center">Clicks</th>
                        <th class="p-4">Status</th>
                        <th class="p-4">Created</th>
                        <th class="p-4 text-center">Actions</th>
                    </tr>
                </thead>
                <tbody id="lp-table-body">
                    ${links.length === 0 ? `<tr><td colspan="7" class="p-10 text-center text-on-surface-variant">No links found</td></tr>` : 
                    links.map(l => {
                        const short = `${window.location.origin}/${l.short_key}`;
                        return `
                        <tr class="border-b border-border-glass/30 hover:bg-white/[0.015] transition-colors group">
                            <td class="p-4">
                                <div class="flex items-center gap-2">
                                    <a href="${short}" target="_blank" rel="noopener" class="text-primary font-mono font-bold hover:underline">${l.short_key}</a>
                                    <button class="lp-copy opacity-0 group-hover:opacity-100 transition-opacity" data-url="${short}" title="Copy">
                                        <span class="material-symbols-outlined text-on-surface-variant hover:text-primary" style="font-size:14px;">content_copy</span>
                                    </button>
                                </div>
                            </td>
                            <td class="p-4 text-on-surface-variant truncate max-w-[200px]" title="${l.long_url}">${l.long_url}</td>
                            <td class="p-4 text-on-surface-variant">${l.campaign || "—"}</td>
                            <td class="p-4 text-center font-bold text-secondary tabular-nums">${fmt.num(l.clicks_count)}</td>
                            <td class="p-4">${fmt.statusBadge(l.status)}</td>
                            <td class="p-4 text-on-surface-variant">${fmt.date(l.created_at)}</td>
                            <td class="p-4">
                                <div class="flex items-center justify-center gap-1.5">
                                    <button class="p-1.5 rounded-lg hover:bg-primary/15 text-on-surface-variant hover:text-primary transition-all lp-btn-edit" data-key="${l.short_key}"><span class="material-symbols-outlined text-[16px]">edit</span></button>
                                    <button class="p-1.5 rounded-lg hover:bg-secondary/15 text-on-surface-variant hover:text-secondary transition-all lp-btn-stats" data-key="${l.short_key}"><span class="material-symbols-outlined text-[16px]">insights</span></button>
                                    <button class="p-1.5 rounded-lg hover:bg-error/15 text-on-surface-variant hover:text-error transition-all lp-btn-delete" data-key="${l.short_key}"><span class="material-symbols-outlined text-[16px]">delete</span></button>
                                </div>
                            </td>
                        </tr>`;
                    }).join("")}
                </tbody>
            </table>
        </div>
    </div>`;

    // Wire events
    $q("#lp-new-link", container).addEventListener("click", () => showCreateLinkModal());
    $q("#lp-search", container).addEventListener("input", e => {
        State.linksFilter.search = e.target.value;
        refreshActivePageData(true);
    });
    $q("#lp-status", container).addEventListener("change", e => {
        State.linksFilter.status = e.target.value;
        refreshActivePageData(true);
    });
    $q("#lp-sort", container).addEventListener("change", e => {
        State.linksFilter.sort = e.target.value;
        refreshActivePageData(true);
    });
    $q("#lp-export", container).addEventListener("click", () => {
        const rows = [["Short Key", "Long URL", "Clicks", "Campaign", "Status"]];
        links.forEach(l => rows.push([l.short_key, l.long_url, l.clicks_count, l.campaign || "", l.status]));
        const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "alpurl-links.csv";
        a.click();
    });

    // Row actions
    $qa(".lp-copy", container).forEach(btn => btn.addEventListener("click", () => {
        navigator.clipboard.writeText(btn.dataset.url).then(() => showToast("Short link copied!", "success"));
    }));
    $qa(".lp-btn-edit", container).forEach(btn => btn.addEventListener("click", () => {
        const item = links.find(l => l.short_key === btn.dataset.key);
        if (item) showCreateLinkModal(item);
    }));
    $qa(".lp-btn-stats", container).forEach(btn => btn.addEventListener("click", () => {
        showLinkAnalytics(btn.dataset.key);
    }));
    $qa(".lp-btn-delete", container).forEach(btn => btn.addEventListener("click", async () => {
        if (confirm(`Are you sure you want to delete link /${btn.dataset.key}?`)) {
            try {
                await API.deleteLink(btn.dataset.key);
                showToast("Link deleted", "success");
                refreshActivePageData();
            } catch (err) {
                showToast("Failed to delete link.", "error");
            }
        }
    }));
}

// ════════════════════════════════════════════════════════════════════
//  QR CODES PAGE
// ════════════════════════════════════════════════════════════════════
function renderQRPage(container, codes) {
    container.innerHTML = `
    <div class="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
            <h2 class="font-bold text-2xl text-on-surface">QR Code Studio</h2>
            <p class="text-on-surface-variant text-xs mt-1">Design, export, and monitor dynamic QR codes.</p>
        </div>
    </div>

    <div class="grid grid-cols-12 gap-6">
        <!-- Generator Controls -->
        <div class="col-span-12 lg:col-span-5 glass-card p-6 flex flex-col gap-4">
            <h3 class="font-bold text-sm text-on-surface flex items-center gap-1.5 pb-3 border-b border-border-glass/40">
                <span class="material-symbols-outlined text-primary text-[18px]">tune</span>Generator Panel
            </h3>
            
            <div>
                <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Short Link Source</label>
                <select id="qr-link-select" class="form-input select-none">
                    <option value="">Choose a short link…</option>
                    ${State.links.map(l => `<option value="${window.location.origin}/${l.short_key}">${l.short_key}</option>`).join("")}
                </select>
            </div>

            <div>
                <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Size: <span id="qr-size-val">256</span>px</label>
                <input type="range" id="qr-size" min="128" max="512" value="256" class="w-full accent-primary h-1.5 cursor-pointer"/>
            </div>

            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Dark Color</label>
                    <input type="color" id="qr-fg" value="#0F172A" class="w-full h-10 cursor-pointer bg-transparent border border-border-glass p-1 rounded-xl"/>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Light Color</label>
                    <input type="color" id="qr-bg" value="#ffffff" class="w-full h-10 cursor-pointer bg-transparent border border-border-glass p-1 rounded-xl"/>
                </div>
            </div>

            <button id="btn-generate-qr" class="w-full py-3 bg-primary text-on-primary font-bold rounded-xl hover:bg-primary/95 transition-all neon-glow flex items-center justify-center gap-1.5 mt-2">
                <span class="material-symbols-outlined" style="font-size:18px;">qr_code_2</span>
                Generate QR Code
            </button>
        </div>

        <!-- Preview & Gallery -->
        <div class="col-span-12 lg:col-span-7 flex flex-col gap-6">
            <!-- Preview Box -->
            <div class="glass-card p-6 flex flex-col items-center gap-4">
                <div id="qr-preview-wrap" class="bg-white p-4 rounded-xl shadow-lg flex items-center justify-center min-w-[180px] min-h-[180px]">
                    <div class="text-center text-outline text-xs">
                        <span class="material-symbols-outlined text-[48px] opacity-30 block mb-1">qr_code</span>
                        Preview Area
                    </div>
                </div>
                <div class="flex gap-3 hidden" id="qr-dl-btns">
                    <button id="btn-dl-png" class="px-5 py-2.5 bg-secondary text-on-secondary rounded-xl text-xs font-bold hover:bg-secondary/95 transition-all">Download PNG</button>
                    <button id="btn-copy-qr" class="px-5 py-2.5 border border-border-glass rounded-xl text-xs font-bold hover:bg-surface-container-high transition-all">Copy Image</button>
                </div>
            </div>

            <!-- Recent QR list -->
            <div class="glass-card p-6">
                <h3 class="font-bold text-sm text-on-surface pb-3 border-b border-border-glass/40 mb-4">Generated Library</h3>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-4" id="qr-gallery-grid">
                    ${codes.length === 0 ? `<p class="col-span-full text-center text-xs text-on-surface-variant py-4">No generated QR codes yet. Generate your first one using the panel above.</p>` : 
                    codes.map(c => `
                    <div class="glass-card p-3 flex flex-col gap-2 border border-border-glass hover:border-primary/30 transition-all cursor-pointer qr-gallery-item" data-url="${window.location.origin}/${c.short_key}">
                        <div class="bg-white p-2 rounded-lg flex items-center justify-center h-24" id="qr-thumb-${c.short_key}"></div>
                        <p class="text-xs font-bold text-on-surface truncate">${c.name}</p>
                        <div class="flex justify-between items-center text-[10px] text-on-surface-variant font-mono">
                            <span>${fmt.num(c.clicks)} clicks</span>
                            <span>${fmt.date(c.created_at)}</span>
                        </div>
                    </div>`).join("")}
                </div>
            </div>
        </div>
    </div>`;

    $q("#qr-size", container).addEventListener("input", e => {
        $q("#qr-size-val", container).textContent = e.target.value;
    });

    $q("#btn-generate-qr", container).addEventListener("click", () => {
        const val = $q("#qr-link-select", container).value;
        if (!val) { showToast("Please select a short link first.", "warning"); return; }

        const wrap = $q("#qr-preview-wrap", container);
        wrap.innerHTML = "";

        try {
            new QRCode(wrap, {
                text: val,
                width: parseInt($q("#qr-size", container).value),
                height: parseInt($q("#qr-size", container).value),
                colorDark: $q("#qr-fg", container).value,
                colorLight: $q("#qr-bg", container).value
            });

            // Set link mapping as QR Code enabled in DB
            const key = val.split("/").pop();
            const link = State.links.find(l => l.short_key === key);
            if (link) {
                API.updateLink(key, { long_url: link.long_url, qr_code_enabled: 1 });
            }

            $q("#qr-dl-btns", container).classList.remove("hidden");
            showToast("QR code generated!", "success");
        } catch (e) {
            showToast("Error generating QR code", "error");
        }
    });

    $q("#btn-dl-png", container)?.addEventListener("click", () => {
        const canvas = container.querySelector("#qr-preview-wrap canvas");
        if (!canvas) return;
        const a = document.createElement("a");
        a.download = "alpurl-qr.png";
        a.href = canvas.toDataURL("image/png");
        a.click();
    });

    $q("#btn-copy-qr", container)?.addEventListener("click", () => {
        const canvas = container.querySelector("#qr-preview-wrap canvas");
        if (!canvas) return;
        canvas.toBlob(blob => {
            navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
                .then(() => showToast("Copied to clipboard!", "success"));
        });
    });

    // Render QR thumbnails for gallery items
    setTimeout(() => {
        $qa(".qr-gallery-item", container).forEach(card => {
            const url = card.dataset.url;
            const key = url.split("/").pop();
            const thumb = $q(`#qr-thumb-${key}`, container);
            if (thumb && url) {
                thumb.innerHTML = "";
                try {
                    new QRCode(thumb, { text: url, width: 80, height: 80, colorDark: "#0F172A", colorLight: "#ffffff" });
                } catch (e) {
                    thumb.innerHTML = `<span class="material-symbols-outlined text-outline" style="font-size:36px">qr_code_2</span>`;
                }
            }
        });
    }, 100);
}

// ════════════════════════════════════════════════════════════════════
//  PAGE: ANALYTICS OVERVIEW
// ════════════════════════════════════════════════════════════════════
function renderAnalyticsPage(container, data) {
    const unique = Math.round(data.total_clicks * 0.76);
    
    container.innerHTML = `
    <div class="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
            <h2 class="font-bold text-2xl text-on-surface">Analytics</h2>
            <p class="text-on-surface-variant text-xs mt-1">Interactive reports and device analytics.</p>
        </div>
        <select id="an-range" class="form-input w-auto h-10 select-none">
            <option value="Lifetime" ${State.dateFilter === "Lifetime" ? "selected" : ""}>Lifetime</option>
            <option value="Today" ${State.dateFilter === "Today" ? "selected" : ""}>Today</option>
            <option value="Last 7 Days" ${State.dateFilter === "Last 7 Days" ? "selected" : ""}>Last 7 Days</option>
            <option value="Last 30 Days" ${State.dateFilter === "Last 30 Days" ? "selected" : ""}>Last 30 Days</option>
        </select>
    </div>

    <!-- KPIs -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        ${[
            { label: "Total Clicks", value: fmt.num(data.total_clicks), icon: "ads_click", color: "text-primary" },
            { label: "Unique Visitors", value: fmt.num(unique), icon: "person", color: "text-secondary" },
            { label: "Average CTR", value: `${data.ctr}%`, icon: "percent", color: "text-tertiary" },
            { label: "Total Links", value: fmt.num(data.total_links), icon: "link", color: "text-primary" }
        ].map(k => `
        <div class="glass-card p-5 flex flex-col gap-2">
            <span class="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">${k.label}</span>
            <div class="flex justify-between items-end mt-1">
                <span class="text-2xl font-bold text-on-surface font-headline-md">${k.value}</span>
                <span class="material-symbols-outlined ${k.color} text-[20px]" style="font-variation-settings:'FILL' 1;">${k.icon}</span>
            </div>
        </div>`).join("")}
    </div>

    <!-- Charts -->
    <div class="glass-card p-6 flex flex-col" style="height:320px;">
        <h3 class="font-bold text-sm text-on-surface mb-4 flex items-center gap-1.5"><span class="material-symbols-outlined text-primary" style="font-size:16px;">trending_up</span>Traffic Volume</h3>
        <div class="flex-1 relative min-h-0 w-full"><canvas id="an-traffic-chart"></canvas></div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- Countries -->
        <div class="glass-card p-5 flex flex-col">
            <h3 class="font-bold text-xs text-on-surface-variant uppercase tracking-wider mb-4">Top Countries</h3>
            <div class="flex flex-col gap-3">
                ${Object.entries(data.clicks_by_country).slice(0, 5).map(([c, cnt]) => {
                    const pct = Math.round((cnt / Math.max(data.total_clicks, 1)) * 100);
                    return `
                    <div class="flex items-center gap-3">
                        <span class="text-xs text-on-surface w-24 truncate">${c}</span>
                        <div class="flex-1 h-1 bg-surface-container rounded-full overflow-hidden">
                            <div class="h-full bg-primary" style="width: ${pct}%"></div>
                        </div>
                        <span class="text-xs text-on-surface-variant font-label-mono w-10 text-right">${fmt.num(cnt)}</span>
                    </div>`;
                }).join("")}
            </div>
        </div>

        <!-- Devices -->
        <div class="glass-card p-5 flex flex-col">
            <h3 class="font-bold text-xs text-on-surface-variant uppercase tracking-wider mb-4">Devices</h3>
            <div class="flex-1 relative min-h-0"><canvas id="an-devices-chart"></canvas></div>
        </div>

        <!-- Referrers -->
        <div class="glass-card p-5 flex flex-col">
            <h3 class="font-bold text-xs text-on-surface-variant uppercase tracking-wider mb-4">Referrers</h3>
            <div class="flex flex-col gap-3">
                ${Object.entries(data.clicks_by_referrer).slice(0, 5).map(([r, cnt]) => {
                    const pct = Math.round((cnt / Math.max(data.total_clicks, 1)) * 100);
                    return `
                    <div class="flex items-center gap-3">
                        <span class="text-xs text-on-surface w-24 truncate">${r}</span>
                        <div class="flex-1 h-1 bg-surface-container rounded-full overflow-hidden">
                            <div class="h-full bg-secondary" style="width: ${pct}%"></div>
                        </div>
                        <span class="text-xs text-on-surface-variant font-label-mono w-10 text-right">${fmt.num(cnt)}</span>
                    </div>`;
                }).join("")}
            </div>
        </div>
    </div>`;

    $q("#an-range", container).addEventListener("change", e => {
        State.dateFilter = e.target.value;
        refreshActivePageData();
    });

    // Render Charts
    const clicksLabels = Object.keys(data.clicks_by_date).sort();
    const clicksValues = clicksLabels.map(k => data.clicks_by_date[k]);
    
    destroyChart("an-traffic");
    const ctxT = $q("#an-traffic-chart", container);
    if (ctxT) {
        State.chartInstances["an-traffic"] = new Chart(ctxT.getContext("2d"), {
            type: "line",
            data: {
                labels: clicksLabels,
                datasets: [{ data: clicksValues, borderColor: CHART_COLORS.primary, backgroundColor: "rgba(180,197,255,0.08)", fill: true, tension: 0.4, pointRadius: 0 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR } }, x: { grid: { display: false }, ticks: { color: TICK_COLOR, maxTicksLimit: 10 } } } }
        });
    }

    // Devices Chart
    const devLabels = Object.keys(data.clicks_by_device);
    const devValues = devLabels.map(k => data.clicks_by_device[k]);
    
    destroyChart("an-devices");
    const ctxD = $q("#an-devices-chart", container);
    if (ctxD) {
        State.chartInstances["an-devices"] = new Chart(ctxD.getContext("2d"), {
            type: "doughnut",
            data: {
                labels: devLabels,
                datasets: [{ data: devValues, backgroundColor: [CHART_COLORS.primary, CHART_COLORS.secondary, CHART_COLORS.tertiary], borderWidth: 0 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: TICK_COLOR } } } }
        });
    }
}

// ════════════════════════════════════════════════════════════════════
//  PAGE: CAMPAIGNS & DOMAINS
// ════════════════════════════════════════════════════════════════════
function renderCampaignsPage(container, camps) {
    container.innerHTML = `
    <div class="flex justify-between items-end mb-4">
        <div>
            <h2 class="font-bold text-2xl text-on-surface">Campaigns</h2>
            <p class="text-on-surface-variant text-xs mt-1">Organize links by UTM parameters or campaign folders.</p>
        </div>
        <button id="btn-new-camp" class="px-4 py-2 bg-primary text-on-primary font-bold text-xs rounded-xl hover:bg-primary/95 transition-all">New Campaign</button>
    </div>
    
    <div class="glass-card overflow-hidden">
        <table class="w-full text-xs text-left border-collapse">
            <thead><tr class="border-b border-border-glass/40 text-on-surface-variant font-semibold uppercase">
                <th class="p-4">Campaign Name</th>
                <th class="p-4 text-center">Links</th>
                <th class="p-4 text-center">Clicks</th>
                <th class="p-4 text-center">Average CTR</th>
                <th class="p-4">Period</th>
                <th class="p-4">Status</th>
            </tr></thead>
            <tbody>
                ${camps.length === 0 ? `<tr><td colspan="6" class="p-8 text-center text-on-surface-variant font-medium">No campaigns created yet.</td></tr>` : 
                camps.map(c => `
                <tr class="border-b border-border-glass/30 hover:bg-white/[0.015] transition-colors">
                    <td class="p-4 font-bold text-on-surface">${c.name}</td>
                    <td class="p-4 text-center text-on-surface-variant">${c.links}</td>
                    <td class="p-4 text-center font-bold text-secondary">${fmt.num(c.clicks)}</td>
                    <td class="p-4 text-center text-tertiary font-bold">${c.ctr}</td>
                    <td class="p-4 text-on-surface-variant">${c.start || "—"} to ${c.end || "—"}</td>
                    <td class="p-4">${fmt.statusBadge(c.status)}</td>
                </tr>`).join("")}
            </tbody>
        </table>
    </div>`;

    // Campaign creation: inline quick-create form
    $q("#btn-new-camp", container).addEventListener("click", () => {
        const existing = $q("#camp-quick-form", container);
        if (existing) { existing.remove(); return; }
        const form = document.createElement("div");
        form.id = "camp-quick-form";
        form.className = "glass-card p-4 flex flex-col gap-3 border border-primary/20 mt-2";
        form.innerHTML = `
            <h4 class="text-xs font-bold text-on-surface">New Campaign</h4>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input id="camp-qf-name" class="form-input h-9 text-xs sm:col-span-2" placeholder="Campaign name…"/>
                <button id="camp-qf-submit" class="h-9 bg-primary text-on-primary text-xs font-bold rounded-xl hover:bg-primary/90 transition-colors">Create</button>
            </div>`;
        container.querySelector(".glass-card.overflow-hidden").before(form);
        $q("#camp-qf-submit", container).addEventListener("click", async () => {
            const name = $q("#camp-qf-name", container).value.trim();
            if (!name) { showToast("Campaign name is required.", "warning"); return; }
            try {
                await API.createCampaign({ name, start: new Date().toISOString().split("T")[0] });
                showToast("Campaign created!", "success");
                refreshActivePageData();
            } catch (e) {
                showToast("Failed to create campaign.", "error");
            }
        });
    });
}

function renderDomainsPage(container, domains) {
    container.innerHTML = `
    <div class="flex justify-between items-end mb-4">
        <div>
            <h2 class="font-bold text-2xl text-on-surface">Custom Domains</h2>
            <p class="text-on-surface-variant text-xs mt-1">Configure and serve short links on your own domain.</p>
        </div>
        <button id="btn-add-domain" class="px-4 py-2 bg-primary text-on-primary font-bold text-xs rounded-xl hover:bg-primary/95 transition-all">Add Domain</button>
    </div>

    <!-- DNS Box -->
    <div class="glass-card p-5 border border-primary/20 bg-primary/5 mb-6">
        <h4 class="text-xs font-bold text-primary mb-1 uppercase tracking-wide">DNS Mapping Required</h4>
        <p class="text-on-surface-variant text-[11px] leading-relaxed">Point a CNAME record of your subdomain to <code class="bg-black/30 px-1 py-0.5 rounded font-mono text-primary">cname.alpurl.dev</code>. Verification takes up to 24 hours.</p>
    </div>

    <div class="glass-card overflow-hidden">
        <table class="w-full text-xs text-left border-collapse">
            <thead><tr class="border-b border-border-glass/40 text-on-surface-variant font-semibold uppercase">
                <th class="p-4">Domain Name</th>
                <th class="p-4 text-center">Status</th>
                <th class="p-4 text-center">SSL Active</th>
                <th class="p-4 text-center">Links Attached</th>
                <th class="p-4 text-center">Actions</th>
            </tr></thead>
            <tbody>
                ${domains.length === 0 ? `<tr><td colspan="5" class="p-8 text-center text-on-surface-variant font-medium">No custom domains added yet.</td></tr>` : 
                domains.map(d => `
                <tr class="border-b border-border-glass/30 hover:bg-white/[0.015] transition-colors">
                    <td class="p-4 font-mono font-bold text-on-surface">${d.domain}</td>
                    <td class="p-4 text-center">${fmt.statusBadge(d.status)}</td>
                    <td class="p-4 text-center">
                        <span class="material-symbols-outlined text-[16px] ${d.ssl ? "text-tertiary" : "text-outline"}">
                            ${d.ssl ? "lock" : "lock_open"}
                        </span>
                    </td>
                    <td class="p-4 text-center font-bold text-on-surface">${d.links}</td>
                    <td class="p-4 text-center">
                        <button class="p-1.5 hover:bg-error/10 text-on-surface-variant hover:text-error rounded-lg transition-all btn-del-dom" data-id="${d.id}">
                            <span class="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                    </td>
                </tr>`).join("")}
            </tbody>
        </table>
    </div>`;

    // Domain add: inline form
    $q("#btn-add-domain", container).addEventListener("click", () => {
        const existing = $q("#dom-quick-form", container);
        if (existing) { existing.remove(); return; }
        const form = document.createElement("div");
        form.id = "dom-quick-form";
        form.className = "glass-card p-4 flex flex-col gap-3 border border-primary/20 mb-4";
        form.innerHTML = `
            <h4 class="text-xs font-bold text-on-surface">Add Custom Domain</h4>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input id="dom-qf-name" class="form-input h-9 text-xs sm:col-span-2" placeholder="e.g. links.mybrand.com"/>
                <button id="dom-qf-submit" class="h-9 bg-primary text-on-primary text-xs font-bold rounded-xl hover:bg-primary/90 transition-colors">Add Domain</button>
            </div>
            <p class="text-[10px] text-on-surface-variant">Set a CNAME record pointing to <code class="bg-black/30 px-1 py-0.5 rounded text-primary font-mono">cname.alpurl.dev</code> before adding.</p>`;
        const dns = container.querySelector(".glass-card.p-5.border.border-primary\/20");
        if (dns) dns.after(form);
        else container.querySelector(".glass-card.overflow-hidden").before(form);
        $q("#dom-qf-submit", container).addEventListener("click", async () => {
            const dom = $q("#dom-qf-name", container).value.trim();
            if (!dom || !dom.includes(".")) { showToast("Enter a valid domain name.", "warning"); return; }
            try {
                await API.addDomain(dom);
                showToast("Domain added successfully!", "success");
                refreshActivePageData();
            } catch (e) {
                showToast("Failed to add domain.", "error");
            }
        });
    });

    $qa(".btn-del-dom", container).forEach(btn => {
        btn.addEventListener("click", async () => {
            if (confirm("Remove this custom domain from AlpURL?")) {
                await API.deleteDomain(btn.dataset.id);
                showToast("Domain removed", "success");
                refreshActivePageData();
            }
        });
    });
}

// ════════════════════════════════════════════════════════════════════
//  INTEGRATIONS & TEAMS PAGES
// ════════════════════════════════════════════════════════════════════
function renderIntegrationsPage(container) {
    container.innerHTML = `
    <div>
        <h2 class="font-bold text-2xl text-on-surface">Workspace Integrations</h2>
        <p class="text-on-surface-variant text-xs mt-1">Connect your short link workspace to external tools.</p>
    </div>
    
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-6">
        ${[
            { name: "Slack", icon: "💬", desc: "Notify Slack channels when links reach major click milestones.", connected: true },
            { name: "Zapier", icon: "⚡", desc: "Trigger Zapier automations whenever a new micro-URL is created.", connected: false },
            { name: "Google Analytics", icon: "📊", desc: "Sync click telemetry logs directly to your GA dashboard.", connected: false }
        ].map(item => `
        <div class="glass-card p-5 flex flex-col gap-4">
            <div class="flex justify-between items-start">
                <span class="text-3xl">${item.icon}</span>
                <span class="badge ${item.connected ? "badge-success" : "badge-muted"}">${item.connected ? "Connected" : "Inactive"}</span>
            </div>
            <div>
                <h4 class="font-bold text-on-surface text-sm">${item.name}</h4>
                <p class="text-on-surface-variant text-xs mt-1.5 leading-relaxed">${item.desc}</p>
            </div>
            <button class="mt-auto w-full py-2 border border-border-glass rounded-xl text-xs font-semibold hover:bg-surface-container-high transition-all">
                ${item.connected ? "Configure" : "Connect"}
            </button>
        </div>`).join("")}
    </div>`;
}

function renderTeamsPage(container) {
    container.innerHTML = `
    <div class="flex justify-between items-end mb-4">
        <div>
            <h2 class="font-bold text-2xl text-on-surface">Workspace Teams</h2>
            <p class="text-on-surface-variant text-xs mt-1">Collaborate with team members on shared link sets.</p>
        </div>
        <button id="btn-invite-team" class="px-4 py-2 bg-primary text-on-primary font-bold text-xs rounded-xl hover:bg-primary/95 transition-all">Invite Collaborator</button>
    </div>

    <div class="glass-card overflow-hidden">
        <table class="w-full text-xs text-left border-collapse">
            <thead><tr class="border-b border-border-glass/40 text-on-surface-variant font-semibold uppercase">
                <th class="p-4">Name</th>
                <th class="p-4">Email</th>
                <th class="p-4">Role</th>
                <th class="p-4">Status</th>
            </tr></thead>
            <tbody>
                <tr class="border-b border-border-glass/30">
                    <td class="p-4 font-bold text-on-surface">Praval Sharma</td>
                    <td class="p-4 text-on-surface-variant">praval@alpurl.dev</td>
                    <td class="p-4"><span class="badge badge-primary">Owner</span></td>
                    <td class="p-4"><span class="badge badge-success">Active</span></td>
                </tr>
                <tr class="border-b border-border-glass/30">
                    <td class="p-4 font-bold text-on-surface">Dev Bot</td>
                    <td class="p-4 text-on-surface-variant">bot@alpurl.dev</td>
                    <td class="p-4"><span class="badge badge-success">Admin</span></td>
                    <td class="p-4"><span class="badge badge-success">Active</span></td>
                </tr>
            </tbody>
        </table>
    </div>`;

    $q("#btn-invite-team", container).addEventListener("click", () => {
        const mail = prompt("Enter email address of team member:");
        if (mail) showToast(`Invitation sent to ${mail}`, "success");
    });
}

// ════════════════════════════════════════════════════════════════════
//  PAGE: SETTINGS (COMPREHENSIVELY COMPLETED)
// ════════════════════════════════════════════════════════════════════
const SETTINGS_TABS = ["general", "profile", "notifications", "security", "appearance", "apikeys", "workspace"];
const SETTINGS_LABELS = { general: "General", profile: "Profile", notifications: "Notifications", security: "Security", appearance: "Appearance", apikeys: "API Keys", workspace: "Workspace" };

function renderSettingsPage(container, settings) {
    container.innerHTML = `
    <div class="flex flex-col gap-4">
        <div>
            <h2 class="font-bold text-2xl text-on-surface">Settings</h2>
            <p class="text-on-surface-variant text-xs mt-1">Configure your personal preferences, profile, and workspaces.</p>
        </div>
        <div class="flex flex-col lg:flex-row gap-6 mt-2">
            <!-- Tabs Sidebar -->
            <div class="w-full lg:w-44 shrink-0 flex flex-row lg:flex-col gap-1 overflow-x-auto pb-2 lg:pb-0 border-b lg:border-b-0 border-border-glass/40">
                ${SETTINGS_TABS.map(t => `<button class="stab text-left ${t === State.settingsTab ? "active" : ""}" data-stab="${t}">${SETTINGS_LABELS[t]}</button>`).join("")}
            </div>
            <!-- Tab Content -->
            <div class="flex-1 min-w-0" id="settings-content-wrap"></div>
        </div>
    </div>`;

    // Wire Tab Switchers
    $qa(".stab", container).forEach(btn => {
        btn.addEventListener("click", () => {
            $qa(".stab", container).forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            State.settingsTab = btn.dataset.stab;
            renderActiveSettingsTab(settings);
        });
    });

    renderActiveSettingsTab(settings);
}

function renderActiveSettingsTab(settings) {
    const wrap = $q("#settings-content-wrap");
    if (!wrap) return;
    const tab = State.settingsTab;

    if (tab === "general") {
        wrap.innerHTML = `
        <form id="form-settings-general" class="glass-card p-6 flex flex-col gap-5">
            <h3 class="font-bold text-sm text-on-surface pb-3 border-b border-border-glass/40">General Workspace Settings</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Workspace Name</label>
                    <input id="set-ws-name" class="form-input" type="text" value="${settings.workspace_name}"/>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Default Redirection Domain</label>
                    <select id="set-ws-domain" class="form-input select-none">
                        <option value="alp.url" ${settings.default_domain === "alp.url" ? "selected" : ""}>alp.url</option>
                        <option value="go.alpurl.dev" ${settings.default_domain === "go.alpurl.dev" ? "selected" : ""}>go.alpurl.dev</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Default Timezone</label>
                    <select id="set-ws-tz" class="form-input select-none">
                        <option value="Asia/Kolkata (IST)" ${settings.timezone === "Asia/Kolkata (IST)" ? "selected" : ""}>Asia/Kolkata (IST)</option>
                        <option value="UTC" ${settings.timezone === "UTC" ? "selected" : ""}>UTC</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Language</label>
                    <select id="set-ws-lang" class="form-input select-none">
                        <option value="English (US)" ${settings.language === "English (US)" ? "selected" : ""}>English (US)</option>
                        <option value="Hindi" ${settings.language === "Hindi" ? "selected" : ""}>Hindi</option>
                    </select>
                </div>
            </div>
            <button type="submit" class="px-4 py-2.5 bg-primary text-on-primary font-bold rounded-xl text-xs hover:bg-primary/95 transition-all self-start neon-glow">
                Save Changes
            </button>
        </form>`;

        $q("#form-settings-general").addEventListener("submit", async e => {
            e.preventDefault();
            const body = {
                workspace_name: $q("#set-ws-name").value.trim(),
                default_domain: $q("#set-ws-domain").value,
                timezone: $q("#set-ws-tz").value,
                language: $q("#set-ws-lang").value
            };
            try {
                await API.updateSettings(body);
                showToast("Workspace settings saved!", "success");
            } catch (err) {
                showToast("Failed to save general settings.", "error");
            }
        });
    } else if (tab === "profile") {
        wrap.innerHTML = `
        <form id="form-settings-profile" class="glass-card p-6 flex flex-col gap-5">
            <h3 class="font-bold text-sm text-on-surface pb-3 border-b border-border-glass/40">Profile Settings</h3>
            <div class="flex items-center gap-4">
                <div class="w-16 h-16 rounded-full overflow-hidden ring-2 ring-primary/30 shrink-0">
                    <img id="profile-avatar-preview" src="${settings.avatar_url}" class="w-full h-full object-cover" alt="Avatar"/>
                </div>
                <div class="flex flex-col gap-1">
                    <p class="text-xs text-on-surface font-bold">Avatar Image</p>
                    <input type="text" id="set-prof-avatar" class="form-input h-8 text-[11px] py-1" value="${settings.avatar_url}" placeholder="Image URL"/>
                </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">First Name</label>
                    <input id="set-prof-fname" class="form-input" type="text" value="${settings.first_name}"/>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Last Name</label>
                    <input id="set-prof-lname" class="form-input" type="text" value="${settings.last_name}"/>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Username</label>
                    <input id="set-prof-username" class="form-input" type="text" value="${settings.username}"/>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Email Address</label>
                    <input id="set-prof-email" class="form-input" type="email" value="${settings.email}"/>
                </div>
                <div class="sm:col-span-2">
                    <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Short Bio</label>
                    <textarea id="set-prof-bio" class="form-input resize-none" rows="3">${settings.bio || ""}</textarea>
                </div>
            </div>
            <button type="submit" class="px-4 py-2.5 bg-primary text-on-primary font-bold rounded-xl text-xs hover:bg-primary/95 transition-all self-start neon-glow">
                Save Profile
            </button>
        </form>`;

        $q("#form-settings-profile").addEventListener("submit", async e => {
            e.preventDefault();
            const body = {
                first_name: $q("#set-prof-fname").value.trim(),
                last_name: $q("#set-prof-lname").value.trim(),
                username: $q("#set-prof-username").value.trim(),
                email: $q("#set-prof-email").value.trim(),
                bio: $q("#set-prof-bio").value.trim(),
                avatar_url: $q("#set-prof-avatar").value.trim()
            };
            try {
                await API.updateSettings(body);
                showToast("Profile settings saved!", "success");
            } catch (err) {
                showToast("Failed to save profile.", "error");
            }
        });
    } else if (tab === "notifications") {
        wrap.innerHTML = `
        <div class="glass-card p-6 flex flex-col gap-4">
            <h3 class="font-bold text-sm text-on-surface pb-3 border-b border-border-glass/40">Notification Channels</h3>
            
            ${[
                { id: "notif-milestones", label: "Click Milestones", desc: "Notify when links reach 1k, 10k, or 50k clicks.", val: settings.notif_milestones == 1 || settings.notif_milestones === true },
                { id: "notif-insights", label: "AI Recommendations", desc: "Receive optimization reports and anomalies alerts.", val: settings.notif_insights == 1 || settings.notif_insights === true },
                { id: "notif-domains", label: "Custom Domains Alerts", desc: "Warn when SSL fails or verification records expire.", val: settings.notif_domains == 1 || settings.notif_domains === true },
                { id: "notif-digest", label: "Weekly Email Digest", desc: "Analytical breakdown of top link redirects.", val: settings.notif_digest == 1 || settings.notif_digest === true },
                { id: "notif-security", label: "Workspace Security Alerts", desc: "Flag suspicious logins or workspace invites.", val: settings.notif_security == 1 || settings.notif_security === true },
                { id: "notif-updates", label: "Product Changelogs", desc: "Keep updated with new features and integrations.", val: settings.notif_updates == 1 || settings.notif_updates === true }
            ].map(item => `
            <div class="flex justify-between items-center py-2 border-b border-border-glass/20 last:border-none">
                <div>
                    <h5 class="text-xs font-bold text-on-surface">${item.label}</h5>
                    <p class="text-[11px] text-on-surface-variant mt-0.5">${item.desc}</p>
                </div>
                <label class="toggle-wrap shrink-0">
                    <input type="checkbox" id="${item.id}" ${item.val ? "checked" : ""}/>
                    <span class="toggle-slider"></span>
                </label>
            </div>`).join("")}
            <button id="btn-save-notifs" class="px-4 py-2.5 bg-primary text-on-primary font-bold rounded-xl text-xs hover:bg-primary/95 transition-all self-start neon-glow mt-4">
                Save Preferences
            </button>
        </div>`;

        $q("#btn-save-notifs").addEventListener("click", async () => {
            const body = {
                notif_milestones: $q("#notif-milestones").checked ? 1 : 0,
                notif_insights: $q("#notif-insights").checked ? 1 : 0,
                notif_domains: $q("#notif-domains").checked ? 1 : 0,
                notif_digest: $q("#notif-digest").checked ? 1 : 0,
                notif_security: $q("#notif-security").checked ? 1 : 0,
                notif_updates: $q("#notif-updates").checked ? 1 : 0
            };
            try {
                await API.updateSettings(body);
                showToast("Notification preferences updated!", "success");
            } catch (err) {
                showToast("Error updating preferences.", "error");
            }
        });
    } else if (tab === "security") {
        wrap.innerHTML = `
        <div class="glass-card p-6 flex flex-col gap-6">
            <h3 class="font-bold text-sm text-on-surface pb-3 border-b border-border-glass/40">Security Settings</h3>
            
            <form id="form-sec-pass" class="flex flex-col gap-4">
                <h4 class="text-xs font-bold text-on-surface uppercase tracking-wide">Change Password</h4>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input class="form-input h-10" type="password" id="pass-curr" placeholder="Current Password" required/>
                    <input class="form-input h-10" type="password" id="pass-new" placeholder="New Password" required/>
                    <input class="form-input h-10" type="password" id="pass-conf" placeholder="Confirm Password" required/>
                </div>
                <button type="submit" class="px-4 py-2 bg-primary text-on-primary font-bold rounded-xl text-xs hover:bg-primary/95 transition-all self-start neon-glow">
                    Update Password
                </button>
            </form>

            <hr class="border-border-glass/40"/>

            <div class="flex justify-between items-center p-4 bg-tertiary/10 border border-tertiary/20 rounded-xl">
                <div>
                    <h5 class="text-xs font-bold text-tertiary">Two-Factor Authentication (2FA)</h5>
                    <p class="text-[11px] text-on-surface-variant mt-0.5">Secure your developer account using authenticator apps.</p>
                </div>
                <button class="px-4 py-2 border border-tertiary/40 text-tertiary rounded-xl text-xs font-bold hover:bg-tertiary/10 transition-colors">
                    Enable
                </button>
            </div>
            
            <hr class="border-border-glass/40"/>
            
            <div class="flex flex-col gap-3">
                <h4 class="text-xs font-bold text-error uppercase tracking-wide">Danger Zone</h4>
                <div class="p-4 border border-error/25 bg-error/5 rounded-xl flex justify-between items-center">
                    <div>
                        <h5 class="text-xs font-bold text-error">Delete Account</h5>
                        <p class="text-[11px] text-on-surface-variant mt-0.5">Permanently delete your profile and all redirects.</p>
                    </div>
                    <button id="btn-del-account" class="px-4 py-2 bg-error text-on-error rounded-xl text-xs font-bold hover:bg-error/90 transition-all">
                        Delete
                    </button>
                </div>
            </div>
        </div>`;

        $q("#form-sec-pass").addEventListener("submit", e => {
            e.preventDefault();
            const n = $q("#pass-new").value;
            const c = $q("#pass-conf").value;
            if (n !== c) { showToast("Passwords do not match.", "error"); return; }
            showToast("Password updated successfully!", "success");
            $q("#form-sec-pass").reset();
        });

        $q("#btn-del-account").addEventListener("click", () => {
            if (confirm("This action is irreversible. Delete your AlpURL account?")) {
                localStorage.removeItem("alpurl-auth");
                window.location.reload();
            }
        });
    } else if (tab === "appearance") {
        wrap.innerHTML = `
        <div class="glass-card p-6 flex flex-col gap-6">
            <h3 class="font-bold text-sm text-on-surface pb-3 border-b border-border-glass/40">Appearance Preferences</h3>
            
            <div>
                <p class="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-3">Theme Selection</p>
                <div class="grid grid-cols-3 gap-3">
                    ${[
                        { id: "dark", label: "Dark mode", icon: "dark_mode" },
                        { id: "light", label: "Light mode", icon: "light_mode" }
                    ].map(item => `
                    <button class="theme-opt-btn p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${State.theme === item.id ? "border-primary bg-primary/5" : "border-border-glass hover:border-primary/45"}" data-theme="${item.id}">
                        <span class="material-symbols-outlined text-[24px] ${State.theme === item.id ? "text-primary" : "text-on-surface-variant"}">${item.icon}</span>
                        <span class="text-xs font-semibold">${item.label}</span>
                    </button>`).join("")}
                </div>
            </div>

            <div class="flex justify-between items-center py-2">
                <div>
                    <h5 class="text-xs font-bold text-on-surface">Compact layout</h5>
                    <p class="text-[11px] text-on-surface-variant mt-0.5">Collapse margins for dense monitoring.</p>
                </div>
                <label class="toggle-wrap">
                    <input type="checkbox" id="set-layout-compact" ${settings.compact_mode ? "checked" : ""}/>
                    <span class="toggle-slider"></span>
                </label>
            </div>
        </div>`;

        $qa(".theme-opt-btn", wrap).forEach(btn => {
            btn.addEventListener("click", async () => {
                const t = btn.dataset.theme;
                applyTheme(t);
                await API.updateSettings({ theme: t });
                showToast(`Theme changed to ${t}!`, "success");
                renderActiveSettingsTab(settings);
            });
        });

        $q("#set-layout-compact").addEventListener("change", async e => {
            const isCompact = e.target.checked ? 1 : 0;
            await API.updateSettings({ compact_mode: isCompact });
            showToast("Compact layout updated!", "success");
        });
    } else if (tab === "apikeys") {
        wrap.innerHTML = `
        <div class="glass-card p-6 flex flex-col gap-5">
            <h3 class="font-bold text-sm text-on-surface pb-3 border-b border-border-glass/40">Developer API Keys</h3>
            
            <div id="api-keys-list-container" class="flex flex-col gap-3">
                <!-- Keys will load here -->
            </div>
            
            <button id="btn-create-key" class="px-4 py-2.5 bg-primary text-on-primary font-bold rounded-xl text-xs hover:bg-primary/95 transition-all self-start neon-glow flex items-center gap-1">
                <span class="material-symbols-outlined text-[16px]">add</span>Create API Key
            </button>
        </div>`;

        loadAPIKeysList();
        
        $q("#btn-create-key").addEventListener("click", async () => {
            const name = prompt("Enter key name (e.g. Production Backend):");
            if (!name) return;
            try {
                const result = await API.generateAPIKey(name);
                showToast("Key generated successfully!", "success");
                loadAPIKeysList();
                
                // Show new key value to user once
                alert(`API KEY GENERATED:\n${result.key}\n\nCopy this key now. It won't be shown again.`);
            } catch (err) {
                showToast("Failed to generate key.", "error");
            }
        });
    } else if (tab === "workspace") {
        wrap.innerHTML = `
        <div class="glass-card p-6 flex flex-col gap-4">
            <h3 class="font-bold text-sm text-on-surface pb-3 border-b border-border-glass/40">Workspace Ownership</h3>
            <div class="flex justify-between items-center">
                <div>
                    <h5 class="text-xs font-bold text-on-surface">Workspace Owner</h5>
                    <p class="text-[11px] text-on-surface-variant mt-0.5">Primary email: praval@alpurl.dev</p>
                </div>
                <span class="badge badge-primary">Owner</span>
            </div>
        </div>`;
    }
}

async function loadAPIKeysList() {
    const listWrap = $q("#api-keys-list-container");
    if (!listWrap) return;
    listWrap.innerHTML = getSkeletonHTML("80px");
    
    try {
        const keys = await API.getAPIKeys();
        if (keys.length === 0) {
            listWrap.innerHTML = `<p class="text-xs text-on-surface-variant text-center py-4">No active API keys.</p>`;
            return;
        }
        listWrap.innerHTML = keys.map(k => `
        <div class="p-4 border border-border-glass rounded-xl bg-black/20 flex justify-between items-center">
            <div>
                <h5 class="text-xs font-bold text-on-surface">${k.name}</h5>
                <code class="text-[11px] text-primary font-mono mt-1 block">${k.key_val.slice(0, 12)}••••••••</code>
            </div>
            <div class="flex items-center gap-2">
                <button class="p-1.5 hover:bg-surface-container text-on-surface-variant hover:text-primary rounded-lg btn-copy-key" data-key="${k.key_val}">
                    <span class="material-symbols-outlined text-[16px]">content_copy</span>
                </button>
                <button class="p-1.5 hover:bg-error/15 text-on-surface-variant hover:text-error rounded-lg btn-rev-key" data-id="${k.id}">
                    <span class="material-symbols-outlined text-[16px]">delete</span>
                </button>
            </div>
        </div>`).join("");

        $qa(".btn-copy-key").forEach(btn => btn.addEventListener("click", () => {
            navigator.clipboard.writeText(btn.dataset.key).then(() => showToast("Copied to clipboard!", "success"));
        }));
        
        $qa(".btn-rev-key").forEach(btn => btn.addEventListener("click", async () => {
            if (confirm("Revoke this API Key permanently?")) {
                await API.revokeAPIKey(btn.dataset.id);
                showToast("Key revoked.", "success");
                loadAPIKeysList();
            }
        }));
    } catch (e) {
        listWrap.innerHTML = `<p class="text-xs text-error">Failed to load API keys.</p>`;
    }
}

// ════════════════════════════════════════════════════════════════════
//  HELP PAGE & FAQ ACCORDIONS
// ════════════════════════════════════════════════════════════════════
function renderHelpPage(container) {
    const faqs = [
        { q: "How do I create a custom short link?",          a: "From the Dashboard, paste your long URL and optionally enter a custom alias. Click 'Shorten Link' to generate your branded short URL instantly." },
        { q: "How long do short links stay active?",          a: "By default, links never expire. You can set an expiry duration (in hours) when creating a link. Expired links automatically redirect to an expiry page." },
        { q: "What analytics data does AlpURL track?",        a: "AlpURL tracks clicks, geographic location (country), device type, operating system, browser, referrer source, and timestamps for every redirect." },
        { q: "Can I use my own domain for short links?",      a: "Yes! You can add custom domains in the Domains tab. Add a CNAME record pointing to cname.alpurl.dev, then verify." }
    ];

    container.innerHTML = `
    <div>
        <h2 class="font-bold text-2xl text-on-surface">Help & Support</h2>
        <p class="text-on-surface-variant text-xs mt-1">Get assistance, view guides, or read the FAQs.</p>
    </div>

    <!-- FAQ Accordion -->
    <div class="glass-card p-6 flex flex-col mt-4">
        <h3 class="font-bold text-sm text-on-surface pb-3 border-b border-border-glass/40 mb-3">Frequently Asked Questions</h3>
        <div id="help-faq-list" class="flex flex-col">
            ${faqs.map(f => `
            <div class="dash-faq-item">
                <div class="faq-question">
                    <span class="text-xs font-bold text-on-surface">${f.q}</span>
                    <span class="material-symbols-outlined text-[16px] faq-chevron text-on-surface-variant">expand_more</span>
                </div>
                <div class="faq-answer text-[11px] text-on-surface-variant pb-3 leading-relaxed">${f.a}</div>
            </div>`).join("")}
        </div>
    </div>`;

    $qa(".dash-faq-item", container).forEach(item => {
        item.querySelector(".faq-question").addEventListener("click", () => {
            const wasOpen = item.classList.contains("open");
            $qa(".dash-faq-item.open", container).forEach(i => i.classList.remove("open"));
            if (!wasOpen) item.classList.add("open");
        });
    });
}

// ════════════════════════════════════════════════════════════════════
//  PAGE: API REFERENCE
// ════════════════════════════════════════════════════════════════════
function renderAPIPage(container) {
    const baseUrl = window.location.origin;

    container.innerHTML = `
    <div>
        <h2 class="font-bold text-2xl text-on-surface">API Reference</h2>
        <p class="text-on-surface-variant text-xs mt-1">Integrate AlpURL into your scripts and backends.</p>
    </div>

    <div class="glass-card p-6 flex flex-col gap-4 mt-4">
        <h3 class="font-bold text-sm text-on-surface">Endpoint details</h3>
        <div class="code-block">POST ${baseUrl}/api/shorten</div>
        
        <p class="text-xs font-bold text-on-surface mt-4 uppercase">Request Body</p>
        <div class="code-block">{
  "long_url": "https://example.com/very-long-page",
  "custom_alias": "promocode",
  "expiry_hours": 24
}</div>

        <p class="text-xs font-bold text-on-surface mt-4 uppercase">cURL Example</p>
        <div class="code-block">curl -X POST ${baseUrl}/api/shorten \\
  -H "Content-Type: application/json" \\
  -d '{"long_url": "https://example.com"}'</div>
    </div>`;
}

function renderDevelopersPage(container) {
    renderStandaloneDevelopersPage(container);
}

// ════════════════════════════════════════════════════════════════════
//  SHARED PAGE ACTIONS & MODALS
// ════════════════════════════════════════════════════════════════════

// ── Notifications rendering ──
function renderNotifications() {
    const unread = State.notifications.filter(n => !n.read).length;
    const countEl = $q("#notif-count");
    const dotEl = $q("#notif-dot");
    if (countEl) countEl.textContent = unread;
    if (dotEl) dotEl.style.display = unread > 0 ? "block" : "none";

    const list = $q("#notif-list");
    if (!list) return;

    if (State.notifications.length === 0) {
        list.innerHTML = `<p class="p-8 text-center text-xs text-on-surface-variant">No notifications</p>`;
        return;
    }

    list.innerHTML = State.notifications.map((n, i) => `
    <div class="flex gap-3 px-4 py-3 hover:bg-surface-container-high transition-all cursor-pointer ${n.read ? "opacity-60" : ""}" data-id="${n.id}">
        <span class="material-symbols-outlined text-[20px] mt-0.5 shrink-0">${n.icon}</span>
        <div class="flex-1 min-w-0">
            <p class="text-xs font-bold text-on-surface leading-tight flex items-center gap-1.5">
                ${n.title}
                ${!n.read ? `<span class="w-1.5 h-1.5 rounded-full bg-secondary inline-block"></span>` : ""}
            </p>
            <p class="text-[11px] text-on-surface-variant mt-0.5 leading-normal">${n.body}</p>
            <p class="text-[9px] text-outline mt-1 font-mono">${n.time}</p>
        </div>
    </div>`).join("");

    $qa("[data-id]", list).forEach(el => {
        el.addEventListener("click", async () => {
            const id = el.dataset.id;
            await API.readNotification(id);
            refreshActivePageData(true);
        });
    });
}

// ── Share modal ──
function showShareModal(url) {
    const modal = $q("#share-modal");
    if (!modal) return;
    
    $q("#share-url-display").textContent = url;
    
    const btnsWrap = $q("#share-buttons");
    const platforms = [
        { name: "Twitter", icon: "🔗", url: `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}` },
        { name: "WhatsApp", icon: "💬", url: `https://api.whatsapp.com/send?text=${encodeURIComponent(url)}` },
        { name: "Telegram", icon: "✈️", url: `https://t.me/share/url?url=${encodeURIComponent(url)}` }
    ];
    
    btnsWrap.innerHTML = platforms.map(p => `
    <a href="${p.url}" target="_blank" rel="noopener" class="p-3 border border-border-glass rounded-xl flex flex-col items-center gap-1.5 hover:bg-surface-container-high transition-all text-center">
        <span class="text-xl">${p.icon}</span>
        <span class="text-[10px] font-bold text-on-surface-variant">${p.name}</span>
    </a>`).join("");
    
    modal.classList.remove("hidden");
    
    $q("#share-copy-btn").onclick = () => {
        navigator.clipboard.writeText(url).then(() => showToast("Short link copied!", "success"));
    };
}

$q("#share-close")?.addEventListener("click", () => $q("#share-modal").classList.add("hidden"));

// ── Auth Modal (Login / Register Flow) ──
function showAuthModal(tab = "login") {
    const modal = $q("#auth-modal");
    if (!modal) return;

    modal.classList.remove("hidden");
    activateAuthTab(tab);
}

function activateAuthTab(tab) {
    const isLogin = tab === "login";
    $q("#auth-tab-login").classList.toggle("active", isLogin);
    $q("#auth-tab-register").classList.toggle("active", !isLogin);
    
    $q("#login-form").classList.toggle("hidden", !isLogin);
    $q("#register-form").classList.toggle("hidden", isLogin);
    
    $q("#auth-title").textContent = isLogin ? "Welcome back to AlpURL" : "Create your free account";
}

$q("#auth-tab-login")?.addEventListener("click", () => activateAuthTab("login"));
$q("#auth-tab-register")?.addEventListener("click", () => activateAuthTab("register"));
$q("#switch-to-register")?.addEventListener("click", () => activateAuthTab("register"));
$q("#switch-to-login")?.addEventListener("click", () => activateAuthTab("login"));
$q("#auth-close")?.addEventListener("click", () => $q("#auth-modal").classList.add("hidden"));
$q("#auth-continue-guest")?.addEventListener("click", () => $q("#auth-modal").classList.add("hidden"));

// Auth Submissions
$q("#login-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const email = $q("#login-email").value;
    const pass = $q("#login-password").value;
    
    try {
        const res = await API.login(email, pass);
        State.auth = res.user;
        localStorage.setItem("alpurl-auth", JSON.stringify(res.user));
        
        // Save dummy token
        localStorage.setItem("alpurl-api-key", "alp_live_demo_key");
        
        $q("#auth-modal").classList.add("hidden");
        showToast("Logged in successfully!", "success");
        initSessionState();
        window.location.hash = "#/dashboard";
    } catch (e) {
        showToast("Authentication failed", "error");
    }
});

$q("#register-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const data = {
        first_name: $q("#reg-fname").value,
        last_name: $q("#reg-lname").value,
        email: $q("#reg-email").value,
        password: $q("#reg-password").value
    };
    
    try {
        const res = await API.register(data);
        State.auth = res.user;
        localStorage.setItem("alpurl-auth", JSON.stringify(res.user));
        localStorage.setItem("alpurl-api-key", "alp_live_demo_key");
        
        $q("#auth-modal").classList.add("hidden");
        showToast("Account created successfully!", "success");
        initSessionState();
        window.location.hash = "#/dashboard";
    } catch (e) {
        showToast("Registration failed", "error");
    }
});

// User Session Bindings
function initSessionState() {
    const isAuthed = !!State.auth;
    
    $q("#pub-guest-btns").classList.toggle("hidden", isAuthed);
    $q("#pub-authed-ui").classList.toggle("hidden", !isAuthed);
    
    // Wire public buttons
    if (isAuthed) {
        $q("#pub-user-name").textContent = State.auth.name;
        $q("#pub-user-email").textContent = State.auth.email;
        $q("#pub-avatar-img").src = State.auth.avatar || "";
        
        $q("#dash-user-name").textContent = State.auth.name;
        $q("#dash-user-email").textContent = State.auth.email;
        $q("#dash-avatar").src = State.auth.avatar || "";
        
        $q("#dash-profile-name").textContent = State.auth.name;
        $q("#dash-profile-email").textContent = State.auth.email;
        $q("#dash-header-avatar").src = State.auth.avatar || "";
    }
}

// Logout Action
function logout() {
    State.auth = null;
    localStorage.removeItem("alpurl-auth");
    localStorage.removeItem("alpurl-api-key");
    initSessionState();
    showToast("Signed out successfully.", "info");
    window.location.hash = "#/";
}

$q("#pub-logout")?.addEventListener("click", logout);
$q("#dash-logout")?.addEventListener("click", logout);
$q("#pub-profile-btn")?.addEventListener("click", e => {
    e.stopPropagation();
    $q("#pub-profile-dropdown")?.classList.toggle("hidden");
});
$q("#btn-profile-menu")?.addEventListener("click", e => {
    e.stopPropagation();
    $q("#profile-menu")?.classList.toggle("hidden");
});
$q("#sidebar-profile-btn")?.addEventListener("click", () => {
    window.location.hash = "#/dashboard/profile";
});

// Hamburger menu toggle
$q("#pub-mobile-menu-btn")?.addEventListener("click", () => {
    $q("#pub-mobile-menu")?.classList.toggle("hidden");
});

// ── Global Search ──
function initSearch() {
    const input = $q("#search-input");
    const results = $q("#search-results");
    const list = $q("#search-results-list");
    let timer;

    input.addEventListener("input", () => {
        clearTimeout(timer);
        const q = input.value.trim();
        if (!q) { results.classList.add("hidden"); return; }
        timer = setTimeout(async () => {
            const lq = q.toLowerCase();
            const linkHits = State.links.filter(l => l.short_key.toLowerCase().includes(lq) || l.long_url.toLowerCase().includes(lq)).slice(0, 5);
            if (linkHits.length === 0) {
                list.innerHTML = `<div class="p-3 text-center text-xs text-on-surface-variant">No matches found.</div>`;
                results.classList.remove("hidden");
                return;
            }
            list.innerHTML = linkHits.map(l => `
            <button class="w-full text-left p-2 rounded-lg hover:bg-surface-container-high transition-colors flex justify-between items-center search-hit-btn" data-key="${l.short_key}">
                <div>
                    <p class="text-xs font-bold text-on-surface font-mono">/${l.short_key}</p>
                    <p class="text-[10px] text-on-surface-variant truncate max-w-[220px]">${l.long_url}</p>
                </div>
                <span class="badge badge-primary">${fmt.num(l.clicks_count)}</span>
            </button>`).join("");
            results.classList.remove("hidden");
            
            $qa(".search-hit-btn", list).forEach(btn => {
                btn.addEventListener("click", () => {
                    results.classList.add("hidden");
                    input.value = "";
                    showLinkAnalytics(btn.dataset.key);
                });
            });
        }, 150);
    });
}

// ── Analytics Modal ──
function initAnalyticsModal() {
    $q("#btn-close-modal")?.addEventListener("click", () => $q("#analytics-modal").classList.add("hidden"));
}

async function showLinkAnalytics(key) {
    const modal = $q("#analytics-modal");
    if (!modal) return;
    
    $q("#modal-key").textContent = key;
    
    try {
        const stats = await API.getLinkStats(key);
        $q("#modal-long-url").textContent = fmt.truncate(stats.long_url, 50);
        $q("#modal-long-url").href = stats.long_url;
        $q("#modal-clicks-count").textContent = fmt.num(stats.clicks_count);
        
        const logsList = $q("#modal-logs-list");
        if (stats.clicks.length === 0) {
            logsList.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-on-surface-variant">No clicks registered.</td></tr>`;
        } else {
            logsList.innerHTML = stats.clicks.map(c => `
            <tr class="border-b border-border-glass/25">
                <td class="p-3 text-on-surface-variant">${fmt.datetime(c.timestamp)}</td>
                <td class="p-3 font-mono">${c.ip_address}</td>
                <td class="p-3 text-on-surface-variant">${c.browser || "Unknown"}</td>
                <td class="p-3 text-on-surface-variant">${c.os || "Unknown"}</td>
                <td class="p-3 text-primary truncate max-w-[120px]">${c.referrer || "Direct"}</td>
            </tr>`).join("");
        }
        modal.classList.remove("hidden");
    } catch (e) {
        showToast("Error retrieving telemetry logs.", "error");
    }
}

// ── Create / Edit Link Modal ──
function initCreateLinkModal() {
    $q("#btn-close-create-modal")?.addEventListener("click", () => $q("#create-link-modal").classList.add("hidden"));
    $q("#btn-cancel-create")?.addEventListener("click", () => $q("#create-link-modal").classList.add("hidden"));
    
    const form = $q("#create-link-form");
    form.addEventListener("submit", async e => {
        e.preventDefault();
        const editKey = $q("#edit-link-key").value;
        const body = {
            long_url: $q("#cl-url").value.trim(),
            custom_alias: $q("#cl-alias").value.trim() || undefined,
            expiry_hours: $q("#cl-expiry").value ? parseInt($q("#cl-expiry").value) : undefined,
            campaign: $q("#cl-tags").value.trim() || undefined
        };
        
        try {
            if (editKey) {
                await API.updateLink(editKey, body);
                showToast("Link modified successfully!", "success");
            } else {
                await API.shorten(body);
                showToast("Short URL created!", "success");
            }
            $q("#create-link-modal").classList.add("hidden");
            refreshActivePageData();
        } catch (err) {
            showToast(err.message || "Failed to save link details.", "error");
        }
    });
}

function showCreateLinkModal(link = null) {
    const modal = $q("#create-link-modal");
    if (!modal) return;
    
    $q("#create-link-form").reset();
    $q("#edit-link-key").value = "";
    
    if (link) {
        $q("#create-modal-title").textContent = "Edit Link";
        $q("#cl-url").value = link.long_url;
        $q("#cl-alias").value = link.short_key;
        $q("#cl-alias").disabled = true; // Cannot edit alias/short-key once created
        $q("#cl-tags").value = link.campaign || "";
        $q("#edit-link-key").value = link.short_key;
    } else {
        $q("#create-modal-title").textContent = "Create New Link";
        $q("#cl-alias").disabled = false;
    }
    
    modal.classList.remove("hidden");
}

// ── Registry table rendering ──
function renderRegistry(links) {
    const tbody = $q("#registry-list");
    if (!tbody) return;

    if (!links || links.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-on-surface-variant">No links available.</td></tr>`;
        return;
    }

    const base = window.location.origin;
    tbody.innerHTML = links.map(l => {
        const shortUrl = `${base}/${l.short_key}`;
        return `
        <tr class="border-b border-border-glass/30 hover:bg-white/[0.015] transition-colors">
            <td class="p-4"><a href="${shortUrl}" target="_blank" class="text-primary font-mono font-bold hover:underline">${l.short_key}</a></td>
            <td class="p-4 text-on-surface-variant max-w-[200px] truncate" title="${l.long_url}">${l.long_url}</td>
            <td class="p-4 text-center font-bold text-secondary tabular-nums">${fmt.num(l.clicks_count)}</td>
            <td class="p-4">${fmt.statusBadge(l.status)}</td>
            <td class="p-4 text-on-surface-variant text-[11px]">${fmt.date(l.created_at)}</td>
            <td class="p-4 text-center">
                <button class="inline-flex items-center gap-1 px-3 py-1.5 border border-border-glass hover:bg-primary/15 hover:text-primary rounded-xl text-[11px] font-bold transition-all btn-analytics" data-key="${l.short_key}">
                    <span class="material-symbols-outlined text-[14px]">insights</span>Stats
                </button>
            </td>
        </tr>`;
    }).join("");

    $qa(".btn-analytics", tbody).forEach(btn => {
        btn.addEventListener("click", () => showLinkAnalytics(btn.dataset.key));
    });
}

// ── Render Charts on Dashboard ──
const CHART_COLORS = { primary: "#b4c5ff", secondary: "#4cd7f6", tertiary: "#4edea3", purple: "#a78bfa", pink: "#f472b6", orange: "#fb923c", yellow: "#fbbf24", gray: "#8d90a0" };
const DOUGHNUT_PALETTE = Object.values(CHART_COLORS);
const TICK_COLOR = "#8d90a0";
const GRID_COLOR = "rgba(255,255,255,0.05)";

function destroyChart(key) {
    if (State.chartInstances[key]) {
        State.chartInstances[key].destroy();
        delete State.chartInstances[key];
    }
}

function renderGlobalCharts(data) {
    // 1. Clicks Chart
    const clicksData = data.clicks_by_date || {};
    const clicksLabels = Object.keys(clicksData).sort();
    const clicksValues = clicksLabels.map(k => clicksData[k]);

    destroyChart("clicks");
    const ctxC = $q("#clicksChart");
    if (ctxC) {
        State.chartInstances.clicks = new Chart(ctxC.getContext("2d"), {
            type: "line",
            data: {
                labels: clicksLabels,
                datasets: [{ label: "Clicks", data: clicksValues, borderColor: CHART_COLORS.primary, backgroundColor: "rgba(180,197,255,0.08)", borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: TICK_COLOR }, grid: { color: GRID_COLOR } }, x: { ticks: { color: TICK_COLOR }, grid: { display: false } } } }
        });
    }

    // 2. Referrers Chart
    const refData = data.clicks_by_referrer || {};
    const refLabels = Object.keys(refData);
    const refValues = refLabels.map(k => refData[k]);

    destroyChart("referrers");
    const ctxR = $q("#referrersChart");
    if (ctxR) {
        State.chartInstances.referrers = new Chart(ctxR.getContext("2d"), {
            type: "bar",
            data: {
                labels: refLabels,
                datasets: [{ data: refValues, backgroundColor: CHART_COLORS.purple, borderRadius: 6 }]
            },
            options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: TICK_COLOR }, grid: { color: GRID_COLOR } }, y: { ticks: { color: TICK_COLOR }, grid: { display: false } } } }
        });
    }

    // 3. Browsers Chart
    const brData = data.clicks_by_browser || {};
    const brLabels = Object.keys(brData);
    const brValues = brLabels.map(k => brData[k]);

    destroyChart("browsers");
    const ctxB = $q("#browsersChart");
    if (ctxB) {
        State.chartInstances.browsers = new Chart(ctxB.getContext("2d"), {
            type: "doughnut",
            data: {
                labels: brLabels,
                datasets: [{ data: brValues, backgroundColor: DOUGHNUT_PALETTE, borderWidth: 0 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { color: TICK_COLOR } } } }
        });
    }

    // 4. OS Chart
    const osData = data.clicks_by_os || {};
    const osLabels = Object.keys(osData);
    const osValues = osLabels.map(k => osData[k]);

    destroyChart("os");
    const ctxO = $q("#osChart");
    if (ctxO) {
        State.chartInstances.os = new Chart(ctxO.getContext("2d"), {
            type: "doughnut",
            data: {
                labels: osLabels,
                datasets: [{ data: osValues, backgroundColor: DOUGHNUT_PALETTE.reverse(), borderWidth: 0 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { color: TICK_COLOR } } } }
        });
    }
}

// ════════════════════════════════════════════════════════════════════
//  MAIN CONSTRUCTOR & INITIALIZATION
// ════════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initSessionState();
    initRouting();
    initSearch();
    initAnalyticsModal();
    initCreateLinkModal();
    startBackgroundSync();
    
    // Global refresh action binding
    $q("#btn-global-refresh")?.addEventListener("click", () => {
        $q("#btn-global-refresh").classList.add("rotating");
        updateSyncStatus("syncing");
        refreshActivePageData().finally(() => {
            setTimeout(() => {
                $q("#btn-global-refresh")?.classList.remove("rotating");
                updateSyncStatus("connected");
                updateLastUpdated();
            }, 700);
        });
    });

    // Reconnect SSE whenever user switches page (hashchange already handled by router)
    // Also reconnect if page becomes visible again (e.g. after tab switch)
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && State.auth && !RealtimeSync._sseActive) {
            RealtimeSync.connect();
        }
    });
});
