document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements
    const shortenForm = document.getElementById("shorten-form");
    const longUrlInput = document.getElementById("long-url");
    const customAliasInput = document.getElementById("custom-alias");
    const expiryHoursInput = document.getElementById("expiry-hours");
    const btnSubmit = document.getElementById("btn-submit");

    const resultCard = document.getElementById("result-card");
    const shortenedUrlDisplay = document.getElementById("shortened-url-display");
    const btnCopy = document.getElementById("btn-copy");
    const copyText = btnCopy.querySelector(".copy-text");
    const resKey = document.getElementById("res-key");
    const resTtl = document.getElementById("res-ttl");

    const statTotalLinks = document.getElementById("stat-total-links");
    const statTotalClicks = document.getElementById("stat-total-clicks");
    
    const registryList = document.getElementById("registry-list");
    const btnRefreshRegistry = document.getElementById("btn-refresh-registry");

    // Modal elements
    const analyticsModal = document.getElementById("analytics-modal");
    const btnCloseModal = document.getElementById("btn-close-modal");
    const modalKey = document.getElementById("modal-key");
    const modalLongUrl = document.getElementById("modal-long-url");
    const modalClicksCount = document.getElementById("modal-clicks-count");
    const modalLogsList = document.getElementById("modal-logs-list");

    // Chart variables
    let clicksChartInstance = null;
    let browsersChartInstance = null;
    let osChartInstance = null;
    let referrersChartInstance = null;

    // Tab switcher
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const tabId = btn.getAttribute("data-tab");
            
            // Toggle active classes on buttons
            tabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            
            // Toggle active classes on contents
            tabContents.forEach(content => {
                if (content.id === `tab-${tabId}`) {
                    content.classList.remove("hidden");
                } else {
                    content.classList.add("hidden");
                }
            });
        });
    });

    // Fetch and Populate Dashboard Data
    async function fetchDashboardStats() {
        try {
            const res = await fetch("/api/dashboard-stats");
            if (!res.ok) throw new Error("Failed to load dashboard stats");
            const data = await res.json();
            
            // Update Stat Cards
            statTotalLinks.textContent = data.total_links;
            statTotalClicks.textContent = data.total_clicks;

            // Render Registry Table
            renderRegistry(data.recent_links);

            // Render Charts
            renderGlobalCharts(data);
        } catch (err) {
            console.error(err);
        }
    }

    // Render registry table rows
    function renderRegistry(links) {
        if (!links || links.length === 0) {
            registryList.innerHTML = `
                <tr>
                    <td colspan="5" class="p-8 text-center text-on-surface-variant">No links shortened yet. Check KGS!</td>
                </tr>
            `;
            return;
        }

        const baseUri = window.location.origin;
        registryList.innerHTML = links.map(link => {
            const shortUrl = `${baseUri}/${link.short_key}`;
            const createdDate = new Date(link.created_at).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            return `
                <tr class="border-b border-border-glass/40 hover:bg-white/[0.02] transition-colors">
                    <td class="p-4"><a href="${shortUrl}" target="_blank" class="shortkey-link text-primary font-mono font-bold hover:underline">${link.short_key}</a></td>
                    <td class="p-4 text-on-surface-variant max-w-[280px] truncate" title="${link.long_url}">${link.long_url}</td>
                    <td class="p-4 text-center font-bold text-secondary tabular-nums">${link.clicks_count}</td>
                    <td class="p-4 text-on-surface-variant text-xs">${createdDate}</td>
                    <td class="p-4 text-center">
                        <button class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border-glass hover:bg-primary/10 hover:text-primary rounded-xl text-xs font-semibold transition-colors btn-analytics" data-key="${link.short_key}">
                            <span class="material-symbols-outlined text-[16px] pointer-events-none">insights</span>
                            <span class="pointer-events-none">Stats</span>
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

        // Bind analytics buttons
        document.querySelectorAll(".btn-analytics").forEach(btn => {
            btn.addEventListener("click", () => {
                const key = btn.getAttribute("data-key");
                showLinkAnalytics(key);
            });
        });
    }

    // Chart.js helper functions
    function renderGlobalCharts(data) {
        // 1. Clicks over time
        const clicksData = data.clicks_by_date || {};
        const clicksLabels = Object.keys(clicksData).sort();
        const clicksValues = clicksLabels.map(label => clicksData[label]);

        if (clicksChartInstance) clicksChartInstance.destroy();
        const ctxClicks = document.getElementById("clicksChart").getContext("2d");
        
        // Handle empty charts gracefully
        const displayLabels = clicksLabels.length > 0 ? clicksLabels : ["No Data"];
        const displayValues = clicksValues.length > 0 ? clicksValues : [0];

        clicksChartInstance = new Chart(ctxClicks, {
            type: "line",
            data: {
                labels: displayLabels,
                datasets: [{
                    label: "Redirections",
                    data: displayValues,
                    borderColor: "#3b82f6",
                    backgroundColor: "rgba(59, 130, 246, 0.15)",
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: "#8b5cf6",
                    pointBorderColor: "#ffffff"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        grid: { color: "rgba(255, 255, 255, 0.05)" },
                        ticks: { color: "#9f9bbd", stepSize: 1 }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: "#9f9bbd" }
                    }
                }
            }
        });

        // 2. Browser Doughnut
        const browserData = data.clicks_by_browser || {};
        const browserLabels = Object.keys(browserData);
        const browserValues = browserLabels.map(l => browserData[l]);
        
        if (browsersChartInstance) browsersChartInstance.destroy();
        const ctxBrowsers = document.getElementById("browsersChart").getContext("2d");
        browsersChartInstance = new Chart(ctxBrowsers, {
            type: "doughnut",
            data: {
                labels: browserLabels.length > 0 ? browserLabels : ["No Clicks"],
                datasets: [{
                    data: browserValues.length > 0 ? browserValues : [1],
                    backgroundColor: ["#3b82f6", "#8b5cf6", "#ec4899", "#10b981", "#f59e0b", "#6b7280"],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "right",
                        labels: { color: "#9f9bbd", boxWidth: 12, font: { size: 10 } }
                    }
                }
            }
        });

        // 3. OS Doughnut
        const osData = data.clicks_by_os || {};
        const osLabels = Object.keys(osData);
        const osValues = osLabels.map(l => osData[l]);

        if (osChartInstance) osChartInstance.destroy();
        const ctxOS = document.getElementById("osChart").getContext("2d");
        osChartInstance = new Chart(ctxOS, {
            type: "doughnut",
            data: {
                labels: osLabels.length > 0 ? osLabels : ["No Clicks"],
                datasets: [{
                    data: osValues.length > 0 ? osValues : [1],
                    backgroundColor: ["#10b981", "#ec4899", "#8b5cf6", "#3b82f6", "#f59e0b", "#6b7280"],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "right",
                        labels: { color: "#9f9bbd", boxWidth: 12, font: { size: 10 } }
                    }
                }
            }
        });

        // 4. Referrers Horizontal Bar Chart
        const refData = data.clicks_by_referrer || {};
        const refLabels = Object.keys(refData);
        const refValues = refLabels.map(l => refData[l]);

        if (referrersChartInstance) referrersChartInstance.destroy();
        const ctxRefs = document.getElementById("referrersChart").getContext("2d");
        referrersChartInstance = new Chart(ctxRefs, {
            type: "bar",
            data: {
                labels: refLabels.length > 0 ? refLabels : ["None"],
                datasets: [{
                    label: "Clicks",
                    data: refValues.length > 0 ? refValues : [0],
                    backgroundColor: "#8b5cf6",
                    borderRadius: 6
                }]
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { color: "rgba(255, 255, 255, 0.05)" },
                        ticks: { color: "#9f9bbd", stepSize: 1 }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: "#9f9bbd" }
                    }
                }
            }
        });
    }

    // Show details for a specific key
    async function showLinkAnalytics(key) {
        try {
            const res = await fetch(`/api/stats/${key}`);
            if (!res.ok) throw new Error("Failed to load details");
            const data = await res.json();
            
            modalKey.textContent = data.short_key;
            modalLongUrl.textContent = data.long_url;
            modalLongUrl.href = data.long_url;
            modalClicksCount.textContent = data.clicks_count;

            if (!data.clicks || data.clicks.length === 0) {
                modalLogsList.innerHTML = `
                    <tr>
                        <td colspan="5" class="p-8 text-center text-on-surface-variant">No clicks logged for this URL.</td>
                    </tr>
                `;
            } else {
                modalLogsList.innerHTML = data.clicks.map(log => {
                    const time = new Date(log.timestamp).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    });
                    return `
                        <tr class="border-b border-border-glass/20 hover:bg-white/[0.01]">
                            <td class="p-3 text-on-surface-variant">${time}</td>
                            <td class="p-3 text-on-surface font-mono">${log.ip_address || "Unknown"}</td>
                            <td class="p-3 text-on-surface-variant">${log.browser || "Unknown"}</td>
                            <td class="p-3 text-on-surface-variant">${log.os || "Unknown"}</td>
                            <td class="p-3 text-primary">${log.referrer || "Direct"}</td>
                        </tr>
                    `;
                }).join("");
            }

            // Display modal
            analyticsModal.classList.remove("hidden");
        } catch (err) {
            console.error(err);
        }
    }

    // Modal closer
    btnCloseModal.addEventListener("click", () => {
        analyticsModal.classList.add("hidden");
    });
    
    // Close modal if clicking overlay
    window.addEventListener("click", (e) => {
        if (e.target === analyticsModal) {
            analyticsModal.classList.add("hidden");
        }
    });

    // Shorten Form Submit Handler
    shortenForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `<span>Processing...</span>`;

        const requestBody = {
            long_url: longUrlInput.value.trim()
        };

        if (customAliasInput.value.trim()) {
            requestBody.custom_alias = customAliasInput.value.trim();
        }

        if (expiryHoursInput.value.trim()) {
            requestBody.expiry_hours = parseInt(expiryHoursInput.value.trim(), 10);
        }

        try {
            const res = await fetch("/api/shorten", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(requestBody)
            });

            const data = await res.json();
            
            if (!res.ok) {
                alert(data.detail || "Error generating short URL.");
                return;
            }

            // Show result panel
            shortenedUrlDisplay.value = data.short_url;
            resKey.textContent = data.short_key;
            
            if (data.expiry_date) {
                const exp = new Date(data.expiry_date).toLocaleDateString();
                resTtl.textContent = exp;
            } else {
                resTtl.textContent = "Never";
            }

            resultCard.classList.remove("hidden");
            
            // Clean up inputs
            longUrlInput.value = "";
            customAliasInput.value = "";
            expiryHoursInput.value = "";

            // Refresh table & stats
            fetchDashboardStats();
        } catch (err) {
            console.error(err);
            alert("Network error. Please check if backend is running.");
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = `<span>Shorten Link</span><span class="material-symbols-outlined text-[18px]">arrow_right_alt</span>`;
        }
    });

    // Copy to clipboard helper
    btnCopy.addEventListener("click", () => {
        shortenedUrlDisplay.select();
        navigator.clipboard.writeText(shortenedUrlDisplay.value)
            .then(() => {
                copyText.textContent = "Copied!";
                btnCopy.style.background = "rgba(16, 185, 129, 0.15)";
                btnCopy.style.borderColor = "rgba(16, 185, 129, 0.3)";
                btnCopy.style.color = "#10b981";
                
                setTimeout(() => {
                    copyText.textContent = "Copy";
                    btnCopy.style.background = "";
                    btnCopy.style.borderColor = "";
                    btnCopy.style.color = "";
                }, 2000);
            })
            .catch(err => {
                console.error("Could not copy link: ", err);
            });
    });

    // Refresh Registry Manual Handler
    btnRefreshRegistry.addEventListener("click", () => {
        btnRefreshRegistry.classList.add("rotating");
        fetchDashboardStats().then(() => {
            setTimeout(() => btnRefreshRegistry.classList.remove("rotating"), 800);
        });
    });

    // Initial Load
    fetchDashboardStats();
});
