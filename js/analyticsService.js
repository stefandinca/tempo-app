/**
 * js/analyticsService.js
 *
 * Manages analytics section with financial reports, utilization rates,
 * attendance statistics, and service analytics.
 */

import * as api from './apiService.js';
import { showCustomAlert } from './uiService.js';

// --- Constants ---
const $ = (id) => document.getElementById(id);

// --- Local State ---
let analyticsData = null;
let charts = {
    financials: null,
    utilization: null,
    attendance: null,
    services: null
};

// --- DOM Elements ---
const dom = {
    section: $('analyticsSection'),
    financialsChart: $('financialsChart'),
    utilizationChart: $('utilizationChart'),
    attendanceChart: $('attendanceChart'),
    servicesChart: $('servicesChart'),
    monthsSelector: $('analyticsMonths'),
    refreshBtn: $('refreshAnalyticsBtn'),
    loadingOverlay: $('analyticsLoading')
};

/**
 * Initialize analytics section
 */
export function init() {
    console.log('[Analytics] Initializing analytics service');

    // Event listeners
    if (dom.refreshBtn) {
        dom.refreshBtn.addEventListener('click', () => loadAnalytics());
    }

    if (dom.monthsSelector) {
        dom.monthsSelector.addEventListener('change', () => loadAnalytics());
    }

    // Load analytics on initialization
    loadAnalytics();
}

/**
 * Load analytics data from API
 */
async function loadAnalytics() {
    console.log('[Analytics] Loading analytics data');

    const months = dom.monthsSelector?.value || 6;

    showLoading(true);

    try {
        const data = await api.fetchAnalytics(months);
        analyticsData = data;
        console.log('[Analytics] Data loaded:', data);

        // Render all charts
        renderFinancials(data.financials);
        renderUtilization(data.utilization);
        renderAttendance(data.attendance);
        renderServices(data.services);

    } catch (error) {
        console.error('[Analytics] Error loading analytics:', error);
        showCustomAlert('Eroare la încărcarea analytics: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

/**
 * Render Financial Chart (Facturat vs. Încasat)
 */
function renderFinancials(data) {
    console.log('[Analytics] Rendering financials chart');

    const canvas = dom.financialsChart;
    if (!canvas) {
        console.warn('[Analytics] Financials canvas not found');
        return;
    }

    // Destroy existing chart
    if (charts.financials) {
        charts.financials.destroy();
    }

    const ctx = canvas.getContext('2d');
    const labels = data.map(d => formatMonth(d.month));
    const facturatData = data.map(d => d.facturat);
    const incasatData = data.map(d => d.incasat);

    charts.financials = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Facturat',
                    data: facturatData,
                    backgroundColor: 'rgba(74, 144, 226, 0.7)',
                    borderColor: 'rgba(74, 144, 226, 1)',
                    borderWidth: 2
                },
                {
                    label: 'Încasat',
                    data: incasatData,
                    backgroundColor: 'rgba(52, 211, 153, 0.7)',
                    borderColor: 'rgba(52, 211, 153, 1)',
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                },
                title: {
                    display: true,
                    text: 'Financials: Facturat vs. Încasat (RON)',
                    font: { size: 16, weight: 'bold' }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    }
                }
            }
        }
    });
}

/**
 * Render Therapist Utilization Chart
 */
function renderUtilization(data) {
    console.log('[Analytics] Rendering utilization chart');

    const canvas = dom.utilizationChart;
    if (!canvas) {
        console.warn('[Analytics] Utilization canvas not found');
        return;
    }

    // Destroy existing chart
    if (charts.utilization) {
        charts.utilization.destroy();
    }

    const ctx = canvas.getContext('2d');

    // Get all unique months from data
    const allMonths = new Set();
    data.forEach(therapist => {
        Object.keys(therapist.months).forEach(month => allMonths.add(month));
    });
    const sortedMonths = Array.from(allMonths).sort();
    const labels = sortedMonths.map(m => formatMonth(m));

    // Prepare datasets for each therapist
    const colors = [
        'rgba(74, 144, 226, 0.7)',
        'rgba(236, 72, 153, 0.7)',
        'rgba(251, 146, 60, 0.7)',
        'rgba(168, 85, 247, 0.7)',
        'rgba(14, 165, 233, 0.7)',
        'rgba(34, 197, 94, 0.7)'
    ];

    const datasets = data.map((therapist, index) => {
        const rates = sortedMonths.map(month => {
            return therapist.months[month]?.rate || 0;
        });

        return {
            label: therapist.name,
            data: rates,
            backgroundColor: colors[index % colors.length],
            borderColor: colors[index % colors.length].replace('0.7', '1'),
            borderWidth: 2
        };
    });

    charts.utilization = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                },
                title: {
                    display: true,
                    text: 'Therapist Utilization Rate (%)',
                    font: { size: 16, weight: 'bold' }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const therapist = data[context.datasetIndex];
                            const month = sortedMonths[context.dataIndex];
                            const monthData = therapist.months[month];
                            if (monthData) {
                                return [
                                    context.dataset.label + ': ' + monthData.rate + '%',
                                    'Ore: ' + monthData.hours,
                                    'Sesiuni: ' + monthData.events
                                ];
                            }
                            return context.dataset.label + ': 0%';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                }
            }
        }
    });
}

/**
 * Render Attendance Chart
 */
function renderAttendance(data) {
    console.log('[Analytics] Rendering attendance chart');

    const canvas = dom.attendanceChart;
    if (!canvas) {
        console.warn('[Analytics] Attendance canvas not found');
        return;
    }

    // Destroy existing chart
    if (charts.attendance) {
        charts.attendance.destroy();
    }

    const ctx = canvas.getContext('2d');
    const labels = data.map(d => d.status);
    const counts = data.map(d => d.count);
    const percentages = data.map(d => d.percentage);

    const backgroundColors = [
        'rgba(34, 197, 94, 0.7)',   // Prezent - Green
        'rgba(239, 68, 68, 0.7)',   // Absent - Red
        'rgba(251, 146, 60, 0.7)'   // Absent Motivat - Orange
    ];

    charts.attendance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: counts,
                backgroundColor: backgroundColors,
                borderColor: backgroundColors.map(c => c.replace('0.7', '1')),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'right',
                },
                title: {
                    display: true,
                    text: 'Client Attendance Rate',
                    font: { size: 16, weight: 'bold' }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const count = context.parsed;
                            const percentage = percentages[context.dataIndex];
                            return label + ': ' + count + ' (' + percentage + '%)';
                        }
                    }
                }
            }
        }
    });
}

/**
 * Render Services Pie Chart
 */
function renderServices(data) {
    console.log('[Analytics] Rendering services chart');

    const canvas = dom.servicesChart;
    if (!canvas) {
        console.warn('[Analytics] Services canvas not found');
        return;
    }

    // Destroy existing chart
    if (charts.services) {
        charts.services.destroy();
    }

    const ctx = canvas.getContext('2d');
    const labels = data.map(d => d.label);
    const revenues = data.map(d => d.revenue);

    // Generate distinct colors
    const colors = [
        'rgba(74, 144, 226, 0.7)',
        'rgba(236, 72, 153, 0.7)',
        'rgba(251, 146, 60, 0.7)',
        'rgba(168, 85, 247, 0.7)',
        'rgba(14, 165, 233, 0.7)',
        'rgba(34, 197, 94, 0.7)',
        'rgba(245, 158, 11, 0.7)',
        'rgba(239, 68, 68, 0.7)',
        'rgba(20, 184, 166, 0.7)',
        'rgba(139, 92, 246, 0.7)'
    ];

    charts.services = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: revenues,
                backgroundColor: colors.slice(0, data.length),
                borderColor: colors.slice(0, data.length).map(c => c.replace('0.7', '1')),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'right',
                },
                title: {
                    display: true,
                    text: 'Service Revenue Distribution',
                    font: { size: 16, weight: 'bold' }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const service = data[context.dataIndex];
                            return [
                                context.label,
                                'Revenue: ' + formatCurrency(service.revenue),
                                'Sessions: ' + service.count,
                                'Share: ' + service.percentage + '%'
                            ];
                        }
                    }
                }
            }
        }
    });
}

/**
 * Show/hide loading overlay
 */
function showLoading(show) {
    if (dom.loadingOverlay) {
        dom.loadingOverlay.style.display = show ? 'flex' : 'none';
    }
}

/**
 * Format month from YYYY-MM to readable format
 */
function formatMonth(monthStr) {
    const [year, month] = monthStr.split('-');
    const months = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec'];
    return months[parseInt(month) - 1] + ' ' + year;
}

/**
 * Format currency with RON symbol
 */
function formatCurrency(value) {
    return new Intl.NumberFormat('ro-RO', {
        style: 'currency',
        currency: 'RON',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value);
}

/**
 * Export analytics data to CSV
 */
export function exportToCSV() {
    if (!analyticsData) {
        showCustomAlert('Nu există date pentru export', 'warning');
        return;
    }

    // Create CSV content
    let csv = 'Analytics Report\n\n';

    // Financials
    csv += 'Financials (Facturat vs. Încasat)\n';
    csv += 'Month,Facturat (RON),Încasat (RON)\n';
    analyticsData.financials.forEach(row => {
        csv += `${row.month},${row.facturat},${row.incasat}\n`;
    });

    csv += '\n';

    // Attendance
    csv += 'Attendance Statistics\n';
    csv += 'Status,Count,Percentage\n';
    analyticsData.attendance.forEach(row => {
        csv += `${row.status},${row.count},${row.percentage}%\n`;
    });

    csv += '\n';

    // Services
    csv += 'Service Statistics\n';
    csv += 'Service,Sessions,Revenue (RON),Percentage\n';
    analyticsData.services.forEach(row => {
        csv += `${row.label},${row.count},${row.revenue},${row.percentage}%\n`;
    });

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `analytics_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showCustomAlert('Export CSV realizat cu succes!', 'success');
}
