/**
 * js/evolutionService.js
 *
 * Gestionează toată logica pentru modalele de Evoluție și Evaluare (Portage).
 * Include desenarea graficelor, randarea tabelelor și salvarea datelor.
 */

import { calendarState } from './calendarState.js';
import * as api from './apiService.js';
// MODIFICAT: Am adăugat showCustomConfirm
import { showCustomAlert, showCustomConfirm } from './uiService.js';



let portrigeData = null; // Cache pentru datele Portage
let abllsData = null; // Cache pentru datele ABLLS-R
let currentClientId = null; // Clientul selectat curent
let currentEvaluationType = 'portage'; // Current evaluation type for charts/summary

// Queue to prevent race conditions when saving evolution data
let saveQueue = Promise.resolve();
let pendingSaveTimeout = null;

/**
 * Queued save wrapper to prevent race conditions
 */
async function queuedSaveEvolutionData(evolutionData) {
    // Clear any pending debounced save
    if (pendingSaveTimeout) {
        clearTimeout(pendingSaveTimeout);
    }
    
    // Add to queue
    saveQueue = saveQueue.then(async () => {
        try {
            await api.saveEvolutionData(evolutionData);
        } catch (err) {
            console.error('Error in queued save:', err);
            throw err; // Re-throw so caller can handle
        }
    });
    
    return saveQueue;
}

let evolutionChartInstance = null; // Instanța graficului Chart.js

// --- Elemente DOM ---
const $ = (id) => document.getElementById(id);
const evolutionModal = $('evolutionModal');
const addEvaluationModal = $('addEvaluationModal');


/**
 * Funcție Helper (ACTUALIZATĂ)
 * Generează HTML-ul pentru afișarea scorurilor (folosind stilul .score-btn)
 * @param {object | string} scoreData - Obiectul de scoruri (ex: {P: 1, +: 3}) sau un string (format vechi).
 */
function generateScoreHTML(scoreData) {
    let scores = scoreData;

    // 1. Verifică dacă datele sunt în formatul vechi (string) și convertește-le
    if (typeof scores === 'string') {
        // Convertește "P" în { P: 1 } sau "P (1), + (3)" în { P: 1, +: 3 }
        const convertedScores = { "0": 0, "-": 0, "P": 0, "+": 0 };
        if (scores.includes('(')) {
            // Format "P (1), + (3)"
            scores.split(',').forEach(part => {
                const match = part.match(/([0\-P+])\s*\((\d+)\)/);
                if (match && match[1] in convertedScores) {
                    convertedScores[match[1]] = parseInt(match[2], 10);
                }
            });
        } else if (scores.length > 0 && scores in convertedScores) {
            // Format vechi "P"
            convertedScores[scores] = 1;
        }
        scores = convertedScores;
    }

    // 2. Asigură-te că este un obiect valid, altfel creează unul gol
    if (typeof scores !== 'object' || scores === null) {
        scores = { "0": 0, "-": 0, "P": 0, "+": 0 };
    }

    // --- MODIFICARE AICI ---
    // Folosim clasa .program-score-display pentru aliniere (flex)
    // și .program-score-buttons pentru a prelua spațierea (gap)
    let html = '<div class="program-score-display program-score-buttons">';
    
    const scoreOrder = ['0', '-', 'P', '+'];
    
    scoreOrder.forEach(key => {
        const count = scores[key] || 0;
        if (count > 0) {
            // Folosim clasa .score-btn pentru a prelua stilul
            // dar folosim un <div> în loc de <button> și adăugăm cursor: default
            html += `
                <div class="score-btn" data-score="${key}" style="cursor: default;">
                    <span class="score-badge">${count}</span>
                    <span class="score-label">${key}</span>
                </div>
            `;
        }
    });

    html += '</div>';
    
    // Dacă nu există niciun scor, returnează un placeholder
    if (html === '<div class="program-score-display program-score-buttons"></div>') {
        return '<span class="note-program-no-score" style="font-weight: 600; color: #6b7280;">—</span>';
    }
    
    return html;
}


/**
 * Inițializează și afișează modalul de evoluție pentru un client.
 * @param {string} clientId
 */
export async function showEvolutionModal(clientId, activeTabId = 'tabGrafice') {
    currentClientId = clientId;
    const { clients, evolutionData } = calendarState.getState();
    const client = calendarState.getClientById(clientId);

    // 1. Verificăm DOAR dacă clientul există
    if (!client) {
        showCustomAlert('Clientul nu a fost găsit.', 'Eroare');
        return;
    }

    // 2. Creăm un obiect gol dacă nu există date, ÎN LOC SĂ AFIȘĂM ALERTA
    const clientData = evolutionData[clientId] ||
                     evolutionData[`client_${clientId}`] ||
                     { name: client.name, evaluations: {}, programHistory: [] };

    // Continuăm cu deschiderea modalului
    $('evolutionTitle').textContent = `Evoluție - ${client.name}`;
    evolutionModal.style.display = 'flex';



    // Activate the specified tab (default to charts)
    activateTab(activeTabId);

    // Check if there's any evaluation data for any type
    const hasPortageData = clientData.evaluations && Object.keys(clientData.evaluations).length > 0;
    const hasABLLSData = clientData.evaluationsABLLS && Object.keys(clientData.evaluationsABLLS).length > 0;
    const hasVBMAPPData = clientData.evaluationsVBMAPP && Object.keys(clientData.evaluationsVBMAPP).length > 0;
    const hasAnyEvaluationData = hasPortageData || hasABLLSData || hasVBMAPPData;

    // If no evaluation data exists for any type, show a general message
    if (!hasAnyEvaluationData) {
        const chartCanvas = $('evolutionChart');
        const summaryDiv = $('evolutionSummary');
        if (chartCanvas) chartCanvas.style.display = 'none';
        if (summaryDiv) {
            summaryDiv.innerHTML = '<p class="no-data">Nu există evaluări salvate pentru acest client. Adăugați o evaluare pentru a vizualiza progresul.</p>';
        }
    } else {
        // Render the default chart (Portage)
        renderEvolutionChart(clientData);
        renderEvaluationReportsList(clientData, client);
    }

    renderProgramHistory(clientData);
    renderPrivateNotes(client.id);
    renderMonthlyThemeHistory(clientData);

    // Pregătește modalul de evaluare
    await setupEvaluationTab(client);
    setupMonthlyThemeTab();
}

/**
 * Închide modalul principal de evoluție.
 */
function closeEvolutionModal() {
    evolutionModal.style.display = 'none';
    if (evolutionChartInstance) {
        evolutionChartInstance.destroy();
        evolutionChartInstance = null;
    }
    currentClientId = null;
}

/**
 * Închide modalul de adăugare a evaluării.
 */
function closeEvaluationModal() {
    addEvaluationModal.style.display = 'none';
}

/**
 * Activează un tab specific în modalul de evoluție.
 * @param {string} tabId - ID-ul tab-ului de activat
 */
// Track if we're in edit mode
let isEditingEvaluation = false;

function activateTab(tabId) {
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });

    // When switching to the Evaluation tab without being in edit mode, reset the form
    if (tabId === 'tabEvaluare' && !isEditingEvaluation) {
        const evalDateInput = $('evaluationDateInput');
        if (evalDateInput) {
            // Set to today's date to start a fresh evaluation
            const today = new Date().toISOString().split('T')[0];
            evalDateInput.value = today;
        }
    }

    // Clear edit mode flag after activating any tab
    if (tabId !== 'tabEvaluare') {
        isEditingEvaluation = false;
    }
}

// --- Secțiunea Grafice ---

function renderEvolutionChart(clientData) {
    const chartCanvas = $('evolutionChart');
    if (!chartCanvas) return;

    // Destroy existing chart first
    if (window.evolutionChartInstance) {
        window.evolutionChartInstance.destroy();
        window.evolutionChartInstance = null;
    }

    // Add null/undefined check for clientData
    if (!clientData || !clientData.evaluations || Object.keys(clientData.evaluations).length === 0) {
        console.warn('renderEvolutionChart: No Portage data available');
        chartCanvas.style.display = 'none';
        $('evolutionSummary').innerHTML = '<p class="no-data">Nu există evaluări Portage salvate pentru acest client.</p>';
        return;
    }

    chartCanvas.style.display = 'block';
    const ctx = chartCanvas.getContext('2d');

    const colors = ['#4A90E2', '#FF6B6B', '#12C4D9', '#9B59B6', '#1DD75B', '#FFA500', '#E91E63'];
    const datasets = [];
    const allDates = new Set();

    // Ensure evaluations object exists
    if (!clientData.evaluations) {
        clientData.evaluations = {};
    }

    // Safely iterate through evaluations with additional null checks
    if (clientData.evaluations && typeof clientData.evaluations === 'object') {
        Object.values(clientData.evaluations).forEach(values => {
            if (values && typeof values === 'object') {
                Object.keys(values).forEach(date => allDates.add(date));
            }
        });
    }

    const sortedDates = Array.from(allDates).sort((a, b) => new Date(a) - new Date(b));

    // Build datasets with proper null checks
    if (clientData.evaluations && typeof clientData.evaluations === 'object') {
        Object.entries(clientData.evaluations).forEach(([test, values], i) => {
            // Only add dataset if values exist and is an object
            if (values && typeof values === 'object') {
                const color = colors[i % colors.length];
                datasets.push({
                    label: test,
                    data: sortedDates.map(date => values[date] ?? null),
                    borderColor: color,
                    backgroundColor: color,
                    borderWidth: 2,
                    fill: false,
                    tension: 0.3,
                    pointRadius: 4,
                    pointHoverRadius: 6
                });
            }
        });
    }

    window.evolutionChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: sortedDates, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'bottom', labels: { padding: 10, boxWidth: 12 } },
                title: { display: true, text: `Evoluție Scoruri Portage`, font: { size: 14 } }
            },
            scales: {
                y: { beginAtZero: true, max: 100 }
            }
        }
    });
}

/**
 * Renders ABLLS-R evolution chart
 */
function renderABLLSChart(clientData) {
    const chartCanvas = $('evolutionChart');
    if (!chartCanvas) return;

    // Destroy existing chart first
    if (window.evolutionChartInstance) {
        window.evolutionChartInstance.destroy();
        window.evolutionChartInstance = null;
    }

    if (!clientData || !clientData.evaluationsABLLS || Object.keys(clientData.evaluationsABLLS).length === 0) {
        console.warn('renderABLLSChart: No ABLLS data available');
        chartCanvas.style.display = 'none';
        $('evolutionSummary').innerHTML = '<p class="no-data">Nu există evaluări ABLLS-R salvate pentru acest client.</p>';
        return;
    }

    chartCanvas.style.display = 'block';
    const ctx = chartCanvas.getContext('2d');

    const colors = ['#4A90E2', '#FF6B6B', '#12C4D9', '#9B59B6', '#1DD75B', '#FFA500', '#E91E63'];
    const datasets = [];
    const allDates = new Set();

    // Collect all dates
    Object.values(clientData.evaluationsABLLS).forEach(domainData => {
        if (domainData && typeof domainData === 'object') {
            Object.keys(domainData).forEach(date => allDates.add(date));
        }
    });

    const sortedDates = Array.from(allDates).sort((a, b) => new Date(a) - new Date(b));

    // Build datasets - each domain is a line
    Object.entries(clientData.evaluationsABLLS).forEach(([domain, dates], i) => {
        if (dates && typeof dates === 'object') {
            const color = colors[i % colors.length];
            datasets.push({
                label: domain,
                data: sortedDates.map(date => {
                    const items = dates[date];
                    // Count checked items (items is an array of checked IDs)
                    return Array.isArray(items) ? items.length : null;
                }),
                borderColor: color,
                backgroundColor: color,
                borderWidth: 2,
                fill: false,
                tension: 0.3,
                pointRadius: 4,
                pointHoverRadius: 6
            });
        }
    });

    window.evolutionChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: sortedDates, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'bottom', labels: { padding: 10, boxWidth: 12 } },
                title: { display: true, text: `Evoluție Scoruri ABLLS-R`, font: { size: 14 } }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Număr Itemi Reușiți'
                    }
                }
            }
        }
    });
}

/**
 * Generates ABLLS-R summary HTML table
 */
function generateABLLSSummaryHTML(clientData) {
    // Check if ABLLS data exists
    if (!clientData.evaluationsABLLS || Object.keys(clientData.evaluationsABLLS).length === 0) {
        return ''; // No data available
    }

    // Collect all unique dates
    const allDates = new Set();
    Object.values(clientData.evaluationsABLLS).forEach(domain => {
        Object.keys(domain).forEach(date => allDates.add(date));
    });

    const sortedDates = Array.from(allDates).sort((a, b) => new Date(a) - new Date(b));

    if (sortedDates.length === 0) {
        return '';
    }

    // Build results for each date
    const results = [];
    sortedDates.forEach(date => {
        let totalItems = 0;
        let domainCount = 0;

        Object.entries(clientData.evaluationsABLLS).forEach(([domain, dates]) => {
            if (dates[date]) {
                const checkedItems = dates[date];
                if (Array.isArray(checkedItems)) {
                    totalItems += checkedItems.length;
                    domainCount++;
                }
            }
        });

        if (domainCount > 0) {
            const avgScore = totalItems / domainCount;
            results.push({ date, totalItems, domainCount, avgScore });
        }
    });

    if (results.length === 0) {
        return '';
    }

    // Generate table rows
    const tableRows = results.map(r => {
        return `<tr>
            <td data-label="Data">${new Date(r.date).toLocaleDateString('ro-RO')}</td>
            <td data-label="Total Itemi">${r.totalItems}</td>
            <td data-label="Domenii Evaluate">${r.domainCount}</td>
            <td data-label="Medie/Domeniu">${r.avgScore.toFixed(1)}</td>
        </tr>`;
    }).join('');

    return `
        <h3 class="evolution-summary-title">Evoluție Generală ABLLS-R</h3>
        <div class="evolution-table-container" style="margin-top: 0; padding-top: 0;">
            <table class="evolution-table">
                <thead>
                    <tr>
                        <th>Data Evaluării</th>
                        <th>Total Itemi Reușiți</th>
                        <th>Domenii Evaluate</th>
                        <th>Medie Itemi/Domeniu</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    `;
}

// În fișierul: js/evolutionService.js

/**
 * NOU: Randează lista de butoane pentru rapoartele de evaluare (înlocuiește renderPortageSummary)
 */
function renderEvaluationReportsList(clientData, client) {
    const container = $('evolutionSummary');
    if (!container) return;

    // Add null/undefined check for clientData
    if (!clientData) {
        console.warn('renderEvaluationReportsList: clientData is undefined');
        container.innerHTML = '<p class="text-gray-500">Nu există date de evaluare disponibile.</p>';
        return;
    }

    // --- MODIFICARE: Apelăm funcția de generare a sumarului bazat pe tipul curent ---
    let summaryTableHTML = '';
    if (currentEvaluationType === 'ablls') {
        summaryTableHTML = generateABLLSSummaryHTML(clientData);
    } else if (currentEvaluationType === 'vbmapp') {
        // VB-MAPP summary is handled by renderVBMAPPSummary in renderVBMAPPChart
        summaryTableHTML = '';
    } else {
        summaryTableHTML = generatePortageSummaryHTML(clientData, client);
    }

    const allEvaluations = [];

    // 1. Adaugă evaluările Portage
    // Grupăm după dată, deoarece o evaluare Portage conține mai multe domenii la aceeași dată
    if (clientData.evaluations) {
        Object.keys(clientData.evaluations).forEach(domain => {
            Object.keys(clientData.evaluations[domain]).forEach(date => {
                // Adăugăm data doar o singură dată
                if (!allEvaluations.some(e => e.type === 'portage' && e.date === date)) {
                    allEvaluations.push({
                        type: 'portage',
                        date: date,
                        title: 'Evaluare Portage'
                    });
                }
            });
        });
    }

    // 2. Adaugă evaluările Logopedice
    if (clientData.evaluationsLogopedica) {
        Object.keys(clientData.evaluationsLogopedica).forEach(date => {
            allEvaluations.push({
                type: 'logopedica',
                date: date,
                title: 'Evaluare Logopedică'
            });
        });
    }

    // 2.5. Adaugă evaluările ABLLS-R
    if (clientData.evaluationsABLLS) {
        // Colectăm toate datele unice din toate domeniile ABLLS
        const abllsDates = new Set();
        Object.keys(clientData.evaluationsABLLS).forEach(domain => {
            Object.keys(clientData.evaluationsABLLS[domain]).forEach(date => {
                abllsDates.add(date);
            });
        });

        // Adăugăm fiecare dată unică ca o evaluare ABLLS-R
        abllsDates.forEach(date => {
            allEvaluations.push({
                type: 'ablls',
                date: date,
                title: 'Evaluare ABLLS-R'
            });
        });
    }

    // 2.6. Adaugă evaluările VB-MAPP
    if (clientData.evaluationsVBMAPP) {
        Object.keys(clientData.evaluationsVBMAPP).forEach(date => {
            allEvaluations.push({
                type: 'vbmapp',
                date: date,
                title: 'Evaluare VB-MAPP'
            });
        });
    }

    // 3. Sortează evaluările (cele mai noi primele)
    allEvaluations.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 4. Generează HTML
    if (allEvaluations.length === 0) {
        container.innerHTML = `
            ${summaryTableHTML} 
            <h3 class="evolution-summary-title">Rapoarte Evaluări Salvate</h3>
            <p class="empty-list-message" style="margin-top: 1rem; text-align: center;">Nu există evaluări salvate pentru acest client.</p>
        `;
        return;
    }

    const buttonsHTML = allEvaluations.map(ev => {
        const formattedDate = new Date(ev.date).toLocaleDateString('ro-RO', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        });
        // Pictograme diferite pentru fiecare tip de raport
        let icon;
        if (ev.type === 'portage') {
            // Chart icon for Portage
            icon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9l-5 5-4-4-6 6"/></svg>';
        } else if (ev.type === 'ablls') {
            // Checklist icon for ABLLS-R
            icon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
        } else if (ev.type === 'vbmapp') {
            // Target/milestone icon for VB-MAPP
            icon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>';
        } else {
            // Megaphone icon for Logopedic
            icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-megaphone" viewBox="0 0 16 16"><path d="M13 2.5a1.5 1.5 0 0 1 3 0v11a1.5 1.5 0 0 1-3 0v-.214c-2.162-1.241-4.49-1.843-6.912-2.083l.405 2.712A1 1 0 0 1 5.51 15.1h-.548a1 1 0 0 1-.916-.599l-1.85-3.49-.202-.003A2.014 2.014 0 0 1 0 9V7a2.02 2.02 0 0 1 1.992-2.013 75 75 0 0 0 2.483-.075c3.043-.154 6.148-.849 8.525-2.199zm1 0v11a.5.5 0 0 0 1 0v-11a.5.5 0 0 0-1 0m-1 1.35c-2.344 1.205-5.209 1.842-8 2.033v4.233q.27.015.537.036c2.568.189 5.093.744 7.463 1.993zm-9 6.215v-4.13a95 95 0 0 1-1.992.052A1.02 1.02 0 0 0 1 7v2c0 .55.448 1.002 1.006 1.009A61 61 0 0 1 4 10.065m-.657.975 1.609 3.037.01.024h.548l-.002-.014-.443-2.966a68 68 0 0 0-1.722-.082z"/></svg>';
        }

        return `
            <div class="evaluation-report-item">
                <button class="btn btn-action-text evaluation-report-button" data-type="${ev.type}" data-date="${ev.date}">
                    ${icon}
                    <span>${ev.title} - ${formattedDate}</span>
                </button>
                <div class="evaluation-report-actions">
                    <button class="btn-icon-small evaluation-edit-btn" data-type="${ev.type}" data-date="${ev.date}" title="Editează evaluarea">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn-icon-small evaluation-remove-btn" data-type="${ev.type}" data-date="${ev.date}" title="Șterge evaluarea">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // --- MODIFICARE: Adăugăm sumarul HTML înaintea listei de butoane ---
    container.innerHTML = `
        ${summaryTableHTML} 
        <h3 class="evolution-summary-title">Rapoarte Evaluări Salvate</h3>
        <div class="evaluation-report-list">
            ${buttonsHTML}
        </div>
    `;

    // 5. Adaugă event listeners (delegare)
    // Asigură-te că nu adaugi listeneri multipli
    container.removeEventListener('click', handleEvaluationReportClick);
    container.addEventListener('click', handleEvaluationReportClick);
}

/**
 * Handler centralizat pentru toate acțiunile pe rapoartele de evaluare
 */
async function handleEvaluationReportClick(e) {
    // Check for edit button click
    const editBtn = e.target.closest('.evaluation-edit-btn');
    if (editBtn) {
        e.stopPropagation();
        await handleEvaluationEdit(editBtn.dataset.type, editBtn.dataset.date);
        return;
    }

    // Check for remove button click
    const removeBtn = e.target.closest('.evaluation-remove-btn');
    if (removeBtn) {
        e.stopPropagation();
        await handleEvaluationRemove(removeBtn.dataset.type, removeBtn.dataset.date);
        return;
    }

    // Check for download button click
    const button = e.target.closest('.evaluation-report-button');
    if (!button) return;

    // Dezactivează butonul temporar pentru a preveni click-uri duble
    button.disabled = true;
    button.querySelector('span').textContent = 'Se generează...';

    const type = button.dataset.type;
    const date = button.dataset.date;
    
    const { evolutionData } = calendarState.getState();
    const client = calendarState.getClientById(currentClientId);
    const clientData = evolutionData[currentClientId];

    if (!client || !clientData) {
        showCustomAlert('Eroare: Datele clientului nu au fost găsite.', 'Eroare');
        button.disabled = false; // Reactivează butonul
        return;
    }

    let htmlContent = '';
    let fileName = `Raport_${client.name.replace(/\s+/g, '_')}_${date}.html`;

    try {
        if (type === 'portage') {
            htmlContent = generatePortageReportHTML(client, clientData, date);
            fileName = `Raport_Portage_${fileName}`;
        } else if (type === 'logopedica') {
            htmlContent = generateLogopedicaReportHTML(client, clientData, date);
            fileName = `Raport_Logopedic_${fileName}`;
        } else if (type === 'ablls') {
            htmlContent = await generateABLLSReportHTML(client, clientData, date);
            fileName = `Raport_ABLLS-R_${fileName}`;
        } else if (type === 'vbmapp') {
            htmlContent = await generateVBMAPPReportHTML(client, clientData, date);
            fileName = `Raport_VB-MAPP_${fileName}`;
        } else {
            return;
        }

        // Generează și descarcă fișierul
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    } catch (err) {
        console.error('Eroare la generarea raportului:', err);
        showCustomAlert('A apărut o eroare la generarea fișierului HTML.', 'Eroare');
    } finally {
        // Reactivează butonul
        button.disabled = false;
        const formattedDate = new Date(date).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const titleMap = {
            'portage': 'Evaluare Portage',
            'logopedica': 'Evaluare Logopedică',
            'ablls': 'Evaluare ABLLS-R',
            'vbmapp': 'Evaluare VB-MAPP'
        };
        button.querySelector('span').textContent = `${titleMap[type] || 'Evaluare'} - ${formattedDate}`;
    }
}

/**
 * Handler pentru ștergerea unei evaluări
 */
async function handleEvaluationRemove(type, date) {
    const client = calendarState.getClientById(currentClientId);
    if (!client) {
        showCustomAlert('Clientul nu a fost găsit.', 'Eroare');
        return;
    }

    const formattedDate = new Date(date).toLocaleDateString('ro-RO', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });

    const typeMap = {
        'portage': 'Portage',
        'ablls': 'ABLLS-R',
        'logopedica': 'Logopedică'
    };

    const evaluationName = typeMap[type] || 'Evaluare';

    // Show confirmation dialog
    const confirmed = await showCustomConfirm(
        `Sigur doriți să ștergeți evaluarea ${evaluationName} din data ${formattedDate}?`,
        'Confirmare ștergere'
    );

    if (!confirmed) return;

    try {
        // Call API to delete evaluation
        const response = await fetch('api.php?path=delete-evaluation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                clientId: currentClientId,
                evaluationType: type,
                date: date
            })
        });

        const result = await response.json();

        if (result.success) {
            // Remove from local state
            const { evolutionData } = calendarState.getState();
            const clientData = evolutionData[currentClientId];

            if (clientData) {
                if (type === 'portage' && clientData.evaluations) {
                    // Remove all domains for this date
                    Object.keys(clientData.evaluations).forEach(domain => {
                        if (clientData.evaluations[domain] && clientData.evaluations[domain][date]) {
                            delete clientData.evaluations[domain][date];
                        }
                    });
                } else if (type === 'ablls' && clientData.evaluationsABLLS) {
                    // Remove all domains for this date
                    Object.keys(clientData.evaluationsABLLS).forEach(domain => {
                        if (clientData.evaluationsABLLS[domain] && clientData.evaluationsABLLS[domain][date]) {
                            delete clientData.evaluationsABLLS[domain][date];
                        }
                    });
                } else if (type === 'logopedica' && clientData.evaluationsLogopedica) {
                    // Remove the logopedic evaluation for this date
                    if (clientData.evaluationsLogopedica[date]) {
                        delete clientData.evaluationsLogopedica[date];
                    }
                }

                // Update state - directly update the evolutionData object and then set it back
                evolutionData[currentClientId] = clientData;
                calendarState.setEvolutionData(evolutionData);
            }

            // Re-render the reports list
            renderEvaluationReportsList(clientData, client);

            // Show success message
            showCustomAlert(`Evaluarea ${evaluationName} a fost ștearsă cu succes.`, 'Succes');

            // Re-render the chart if it's currently visible
            renderEvolutionChart(clientData);

        } else {
            showCustomAlert(result.error || 'A apărut o eroare la ștergerea evaluării.', 'Eroare');
        }

    } catch (err) {
        console.error('Error removing evaluation:', err);
        showCustomAlert('A apărut o eroare la ștergerea evaluării.', 'Eroare');
    }
}

/**
 * Handler pentru editarea unei evaluări
 */
async function handleEvaluationEdit(type, date) {
    const client = calendarState.getClientById(currentClientId);
    if (!client) {
        showCustomAlert('Clientul nu a fost găsit.', 'Eroare');
        return;
    }

    const { evolutionData } = calendarState.getState();
    const clientData = evolutionData[currentClientId];

    if (!clientData) {
        showCustomAlert('Nu există date de evaluare pentru acest client.', 'Eroare');
        return;
    }

    // Set edit mode flag before switching tabs
    isEditingEvaluation = true;

    // Switch to Add Evaluation tab
    activateTab('tabEvaluare');

    // Wait a bit for the tab to render
    await new Promise(resolve => setTimeout(resolve, 100));

    // Load data based on evaluation type
    if (type === 'portage') {
        // Set the evaluation type selector
        const evalTypeSelect = $('evaluationTypeSelect');
        if (evalTypeSelect) {
            evalTypeSelect.value = 'portage';
            evalTypeSelect.dispatchEvent(new Event('change'));
        }

        // Load Portage data - set the evaluation date first
        const evalDateInput = $('evaluationDateInput');
        if (evalDateInput) {
            evalDateInput.value = date;
        }

        // Set birth date if available
        const birthDateInput = $('childBirthDateInput');
        if (birthDateInput && client.birthDate) {
            birthDateInput.value = client.birthDate;
            updateChildAgeDisplay(client.birthDate);
        }

        // Trigger evaluation date change to re-render portage domains
        if (evalDateInput) {
            evalDateInput.dispatchEvent(new Event('change'));
        }

        // Wait for domains to render
        await new Promise(resolve => setTimeout(resolve, 200));

        // Restore checked items from saved data
        if (clientData.portageCheckedItems) {
            Object.keys(clientData.portageCheckedItems).forEach(domain => {
                if (clientData.portageCheckedItems[domain] && clientData.portageCheckedItems[domain][date]) {
                    const checkedItemIds = clientData.portageCheckedItems[domain][date];

                    // Check the corresponding checkboxes
                    if (Array.isArray(checkedItemIds)) {
                        checkedItemIds.forEach(itemId => {
                            const checkbox = document.querySelector(`input[data-id="${itemId}"]`);
                            if (checkbox) {
                                checkbox.checked = true;
                                // Also add the visual 'checked' class to the parent item
                                const parentItem = checkbox.closest('.portage-item');
                                if (parentItem) {
                                    parentItem.classList.add('checked');
                                }
                            }
                        });
                    }
                }
            });
        }
    } else if (type === 'ablls') {
        // Set the evaluation type selector to ABLLS
        const evalTypeSelect = $('evaluationTypeSelect');
        if (evalTypeSelect) {
            evalTypeSelect.value = 'ablls';
            evalTypeSelect.dispatchEvent(new Event('change'));
        }

        // Wait for the form to render
        await new Promise(resolve => setTimeout(resolve, 200));

        // Load ABLLS data
        if (clientData.evaluationsABLLS) {
            Object.keys(clientData.evaluationsABLLS).forEach(domain => {
                if (clientData.evaluationsABLLS[domain] && clientData.evaluationsABLLS[domain][date]) {
                    const checkedItems = clientData.evaluationsABLLS[domain][date];

                    // If it's an array (new format), check the corresponding checkboxes
                    if (Array.isArray(checkedItems)) {
                        checkedItems.forEach(itemId => {
                            const checkbox = document.querySelector(`input[data-domain="${domain}"][data-id="${itemId}"]`);
                            if (checkbox) {
                                checkbox.checked = true;
                                // Also add the visual 'checked' class to the parent item
                                const parentItem = checkbox.closest('.ablls-item');
                                if (parentItem) {
                                    parentItem.classList.add('checked');
                                }
                            }
                        });
                    }
                    // Old format (numeric score) - we can't restore checkboxes from this
                }
            });
        }
    } else if (type === 'logopedica') {
        // Set the evaluation type selector to logopedic
        const evalTypeSelect = $('evaluationTypeSelect');
        if (evalTypeSelect) {
            evalTypeSelect.value = 'logopedica';
            evalTypeSelect.dispatchEvent(new Event('change'));
        }

        // Wait for the form to render
        await new Promise(resolve => setTimeout(resolve, 200));

        // Load Logopedic data
        if (clientData.evaluationsLogopedica && clientData.evaluationsLogopedica[date]) {
            const evalData = clientData.evaluationsLogopedica[date];

            // Load scores
            if (evalData.scores) {
                Object.keys(evalData.scores).forEach(category => {
                    const input = document.querySelector(`input[name="logopedica-${category}"]`);
                    if (input) {
                        input.value = evalData.scores[category];
                    }
                });
            }

            // Load comments
            if (evalData.comments) {
                const commentsTextarea = $('logopedicaComments');
                if (commentsTextarea) {
                    commentsTextarea.value = evalData.comments;
                }
            }
        }
    } else if (type === 'vbmapp') {
        // Set the evaluation type selector to VB-MAPP
        const evalTypeSelect = $('evaluationTypeSelect');
        if (evalTypeSelect) {
            evalTypeSelect.value = 'vbmapp';
            evalTypeSelect.dispatchEvent(new Event('change'));
        }

        // Set the evaluation date
        const evalDateInput = $('evaluationDateInput');
        if (evalDateInput) {
            evalDateInput.value = date;
        }

        // Set birth date if available
        const birthDateInput = $('childBirthDateInput');
        if (birthDateInput && client.birthDate) {
            birthDateInput.value = client.birthDate;
            updateChildAgeDisplay(client.birthDate);
        }

        // Wait for the form to render
        await new Promise(resolve => setTimeout(resolve, 200));

        // Render VB-MAPP components with existing data
        // The renderVBMAPPComponents function will automatically load the scores
        // for the selected date from clientData.evaluationsVBMAPP[date]
        await renderVBMAPPComponents();
    }

    showCustomAlert('Evaluarea a fost încărcată pentru editare. Modificați datele și salvați din nou.', 'Editare Evaluare');
}

/**
 * NOU: Generator HTML pentru Raport Portage Individual (printabil)
 */
function generatePortageReportHTML(client, clientData, date) {
    const birthDate = new Date(client.birthDate);
    const evalDate = new Date(date);
    const chronoAge = getAgeInMonths(birthDate, evalDate);
    const domains = clientData.evaluations;

    let domainRows = '';
    let totalDA = 0;
    let domainCount = 0;

    // Iterăm doar domeniile care au o intrare pentru data respectivă
    Object.keys(domains).forEach(domainName => {
        if (domains[domainName] && domains[domainName][date] !== undefined) {
            const da = domains[domainName][date];
            const dq = chronoAge > 0 ? (da / chronoAge) * 100 : 0;
            const color = dq < 70 ? '#e74c3c' : dq < 85 ? '#f39c12' : '#27ae60';
            
            domainRows += `
                <tr>
                    <td>${domainName.replace('Portrige - ', '')}</td>
                    <td style="text-align: right;">${da.toFixed(1)} luni</td>
                    <td style="text-align: right; color: ${color}; font-weight: 600;">${dq.toFixed(1)}</td>
                </tr>
            `;
            totalDA += da;
            domainCount++;
        }
    });

    const avgDA = domainCount > 0 ? totalDA / domainCount : 0;
    const avgDQ = chronoAge > 0 ? (avgDA / chronoAge) * 100 : 0;
    const avgColor = avgDQ < 70 ? '#e74c3c' : avgDQ < 85 ? '#f39c12' : '#27ae60';

    return `
        <!DOCTYPE html>
        <html lang="ro">
        <head>
            <meta charset="UTF-8">
            <title>Raport Portage - ${client.name}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 2rem; color: #333; line-height: 1.5; }
                .container { max-width: 800px; margin: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
                .header { background: #4A90E2; color: white; padding: 1.5rem; border-radius: 8px 8px 0 0; }
                .header h1 { margin: 0; font-size: 1.8rem; }
                .header p { margin: 0.25rem 0 0; font-size: 1rem; opacity: 0.9; }
                .content { padding: 1.5rem; }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; background: #f9f9f9; padding: 1rem; border-radius: 8px; }
                .info-item { display: flex; flex-direction: column; }
                .info-label { font-size: 0.8rem; color: #666; text-transform: uppercase; font-weight: 600; }
                .info-value { font-size: 1.1rem; font-weight: 500; }
                h2 { font-size: 1.3rem; color: #4A90E2; border-bottom: 2px solid #eee; padding-bottom: 0.5rem; margin-top: 2rem; }
                table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
                th, td { padding: 0.75rem 1rem; border-bottom: 1px solid #eee; text-align: left; }
                th { background: #f4f4f4; font-weight: 600; }
                tr:last-child td { border: 0; }
                tfoot td { font-weight: 700; font-size: 1.1rem; background: #f9f9f9; border-top: 2px solid #ddd; }
                @media print {
                    body { padding: 0; }
                    .container { border: 0; box-shadow: none; max-width: 100%; }
                    .header { background: #4A90E2 !important; color: white !important; -webkit-print-color-adjust: exact; }
                    th, tfoot td, .info-grid { background: #f9f9f9 !important; -webkit-print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Raport Evaluare Portage</h1>
                    <p>Client: ${client.name}</p>
                </div>
                <div class="content">
                    <div class="info-grid">
                        <div class="info-item">
                            <span class="info-label">Data Evaluării</span>
                            <span class="info-value">${evalDate.toLocaleDateString('ro-RO')}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Data Nașterii</span>
                            <span class="info-value">${birthDate.toLocaleDateString('ro-RO')}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Vârstă Cronologică (CA)</span>
                            <span class="info-value">${chronoAge.toFixed(1)} luni</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Vârstă Mentală (Medie DA)</span>
                            <span class="info-value">${avgDA.toFixed(1)} luni</span>
                        </div>
                    </div>
                    
                    <h2>Rezultate pe Domenii</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>Domeniu</th>
                                <th style="text-align: right;">Vârstă Dezvoltare (DA)</th>
                                <th style="text-align: right;">Indice Dezvoltare (DQ)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${domainRows}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td>Total (Medie)</td>
                                <td style="text-align: right;">${avgDA.toFixed(1)} luni</td>
                                <td style="text-align: right; color: ${avgColor};">${avgDQ.toFixed(1)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </body>
        </html>
    `;
}

/**
 * Generator HTML pentru Raport VB-MAPP Individual (printabil)
 */
async function generateVBMAPPReportHTML(client, clientData, date) {
    const evalData = clientData.evaluationsVBMAPP?.[date];
    if (!evalData) return '<h1>Eroare: Evaluarea VB-MAPP nu a fost găsită.</h1>';

    // Load VB-MAPP data to get full item descriptions
    const vbmappData = await loadVBMAPPData();
    if (!vbmappData) return '<h1>Eroare: Nu s-au putut încărca datele VB-MAPP.</h1>';

    const formattedDate = new Date(date).toLocaleDateString('ro-RO', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });

    // Calculate statistics for Milestones
    let milestonesTotal = 0;
    let milestonesCount = 0;
    let milestonesMaxScore = 0;
    let milestoneRows = '';

    ['level1', 'level2', 'level3'].forEach(level => {
        const levelData = vbmappData.milestones[level];
        if (evalData.milestones?.[level]) {
            Object.entries(levelData.areas).forEach(([areaKey, areaData]) => {
                const areaScores = evalData.milestones[level][areaKey] || {};
                let areaTotal = 0;
                let areaCount = 0;

                areaData.items.forEach(item => {
                    const score = areaScores[item.id] || 0;
                    areaTotal += score;
                    areaCount++;
                    milestonesMaxScore += 5; // Max score per item is 5
                });

                milestonesTotal += areaTotal;
                milestonesCount += areaCount;

                const areaAverage = areaCount > 0 ? (areaTotal / areaCount).toFixed(2) : '0.00';
                const areaPercentage = areaCount > 0 ? Math.round((areaTotal / (areaCount * 5)) * 100) : 0;

                milestoneRows += `
                    <tr>
                        <td style="font-weight: 600;">${areaData.name}</td>
                        <td style="text-align: center;">${areaTotal} / ${areaCount * 5}</td>
                        <td style="text-align: center;">${areaAverage}</td>
                        <td style="text-align: center;">${areaPercentage}%</td>
                    </tr>
                `;
            });
        }
    });

    const milestonesAverage = milestonesCount > 0 ? (milestonesTotal / milestonesCount).toFixed(2) : '0.00';
    const milestonesPercentage = milestonesMaxScore > 0 ? Math.round((milestonesTotal / milestonesMaxScore) * 100) : 0;

    // Calculate statistics for Barriers
    let barriersTotal = 0;
    let barriersCount = vbmappData.barriers.items.length;
    let barriersMaxScore = barriersCount * 5;

    if (evalData.barriers) {
        Object.values(evalData.barriers).forEach(score => {
            barriersTotal += score;
        });
    }

    const barriersAverage = barriersCount > 0 ? (barriersTotal / barriersCount).toFixed(2) : '0.00';
    const barriersPercentage = barriersMaxScore > 0 ? Math.round((barriersTotal / barriersMaxScore) * 100) : 0;

    // Calculate statistics for Transition
    let transitionTotal = 0;
    let transitionCount = vbmappData.transition.items.length;
    let transitionMaxScore = transitionCount * 5;

    if (evalData.transition) {
        Object.values(evalData.transition).forEach(score => {
            transitionTotal += score;
        });
    }

    const transitionAverage = transitionCount > 0 ? (transitionTotal / transitionCount).toFixed(2) : '0.00';
    const transitionPercentage = transitionMaxScore > 0 ? Math.round((transitionTotal / transitionMaxScore) * 100) : 0;

    // Calculate statistics for Task Analysis
    let taskAnalysisTotal = 0;
    let taskAnalysisCount = vbmappData.taskAnalysis.items.length;
    let taskAnalysisMaxScore = taskAnalysisCount * 5;

    if (evalData.taskAnalysis) {
        Object.values(evalData.taskAnalysis).forEach(score => {
            taskAnalysisTotal += score;
        });
    }

    const taskAnalysisAverage = taskAnalysisCount > 0 ? (taskAnalysisTotal / taskAnalysisCount).toFixed(2) : '0.00';
    const taskAnalysisPercentage = taskAnalysisMaxScore > 0 ? Math.round((taskAnalysisTotal / taskAnalysisMaxScore) * 100) : 0;

    // Calculate statistics for IEP Objectives
    let iepObjectivesTotal = 0;
    let iepObjectivesCount = vbmappData.iepObjectives.items.length;
    let iepObjectivesMaxScore = iepObjectivesCount * 5;

    if (evalData.iepObjectives) {
        Object.values(evalData.iepObjectives).forEach(score => {
            iepObjectivesTotal += score;
        });
    }

    const iepObjectivesAverage = iepObjectivesCount > 0 ? (iepObjectivesTotal / iepObjectivesCount).toFixed(2) : '0.00';
    const iepObjectivesPercentage = iepObjectivesMaxScore > 0 ? Math.round((iepObjectivesTotal / iepObjectivesMaxScore) * 100) : 0;

    // Overall statistics
    const overallTotal = milestonesTotal + barriersTotal + transitionTotal + taskAnalysisTotal + iepObjectivesTotal;
    const overallMaxScore = milestonesMaxScore + barriersMaxScore + transitionMaxScore + taskAnalysisMaxScore + iepObjectivesMaxScore;
    const overallAverage = ((milestonesAverage * milestonesCount) + (barriersAverage * barriersCount) + (transitionAverage * transitionCount) + (taskAnalysisAverage * taskAnalysisCount) + (iepObjectivesAverage * iepObjectivesCount)) / (milestonesCount + barriersCount + transitionCount + taskAnalysisCount + iepObjectivesCount);
    const overallPercentage = overallMaxScore > 0 ? Math.round((overallTotal / overallMaxScore) * 100) : 0;

    return `
        <!DOCTYPE html>
        <html lang="ro">
        <head>
            <meta charset="UTF-8">
            <title>Raport VB-MAPP - ${client.name}</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: 'Arial', 'Helvetica', sans-serif;
                    padding: 2cm;
                    background: white;
                    color: #333;
                    line-height: 1.6;
                }
                .header {
                    text-align: center;
                    margin-bottom: 2rem;
                    border-bottom: 3px solid #4CAF50;
                    padding-bottom: 1rem;
                }
                .header h1 {
                    font-size: 2rem;
                    color: #2e7d32;
                    margin-bottom: 0.5rem;
                }
                .header .subtitle {
                    font-size: 1.2rem;
                    color: #64748b;
                    font-style: italic;
                }
                .client-info {
                    background: #f1f5f9;
                    padding: 1.5rem;
                    border-radius: 8px;
                    margin-bottom: 2rem;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 1rem;
                }
                .info-item {
                    display: flex;
                    gap: 0.5rem;
                }
                .info-label {
                    font-weight: 600;
                    color: #475569;
                }
                .info-value {
                    color: #1e293b;
                }
                .summary-box {
                    background: #e8f5e9;
                    border: 2px solid #4CAF50;
                    border-radius: 8px;
                    padding: 1.5rem;
                    margin-bottom: 2rem;
                    text-align: center;
                }
                .summary-box h2 {
                    color: #2e7d32;
                    margin-bottom: 1rem;
                    font-size: 1.5rem;
                }
                .summary-stats {
                    display: flex;
                    justify-content: center;
                    gap: 2rem;
                    font-size: 1.1rem;
                    flex-wrap: wrap;
                }
                .stat {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                .stat-value {
                    font-size: 2rem;
                    font-weight: 700;
                    color: #2e7d32;
                }
                .stat-label {
                    color: #64748b;
                    font-size: 0.9rem;
                }
                .section {
                    margin-top: 2rem;
                    page-break-inside: avoid;
                }
                .section h2 {
                    color: #2e7d32;
                    margin-bottom: 1rem;
                    font-size: 1.5rem;
                    border-bottom: 2px solid #4CAF50;
                    padding-bottom: 0.5rem;
                }
                .component-summary {
                    background: #f8f9fa;
                    padding: 1rem;
                    border-radius: 6px;
                    margin-bottom: 1rem;
                    display: flex;
                    justify-content: space-around;
                    flex-wrap: wrap;
                    gap: 1rem;
                }
                .component-stat {
                    text-align: center;
                }
                .component-stat-value {
                    font-size: 1.5rem;
                    font-weight: 600;
                    color: #2e7d32;
                }
                .component-stat-label {
                    font-size: 0.85rem;
                    color: #64748b;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 1rem;
                }
                thead {
                    background: #2e7d32;
                    color: white;
                }
                th {
                    padding: 1rem;
                    text-align: left;
                    font-weight: 600;
                }
                td {
                    padding: 0.75rem 1rem;
                    border-bottom: 1px solid #e2e8f0;
                }
                tbody tr:nth-child(even) {
                    background: #f8fafc;
                }
                tbody tr:hover {
                    background: #f1f5f9;
                }
                .footer {
                    margin-top: 3rem;
                    padding-top: 1.5rem;
                    border-top: 2px solid #e2e8f0;
                    text-align: center;
                    color: #64748b;
                    font-size: 0.9rem;
                }
                @media print {
                    body { padding: 1cm; }
                    .no-print { display: none; }
                    .section { page-break-inside: avoid; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Raport Evaluare VB-MAPP</h1>
                <div class="subtitle">Verbal Behavior Milestones Assessment and Placement Program</div>
            </div>

            <div class="client-info">
                <div class="info-item">
                    <span class="info-label">Nume client:</span>
                    <span class="info-value">${client.name}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Data evaluării:</span>
                    <span class="info-value">${formattedDate}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">ID client:</span>
                    <span class="info-value">${client.id}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Data nașterii:</span>
                    <span class="info-value">${client.birthDate ? new Date(client.birthDate).toLocaleDateString('ro-RO') : 'N/A'}</span>
                </div>
            </div>

            <div class="summary-box">
                <h2>Scor General</h2>
                <div class="summary-stats">
                    <div class="stat">
                        <div class="stat-value">${overallTotal}</div>
                        <div class="stat-label">Puncte obținute</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${overallMaxScore}</div>
                        <div class="stat-label">Puncte posibile</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${overallAverage.toFixed(2)}</div>
                        <div class="stat-label">Scor mediu (0-5)</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${overallPercentage}%</div>
                        <div class="stat-label">Procent finalizare</div>
                    </div>
                </div>
            </div>

            <div class="section">
                <h2>Jaloane (Milestones)</h2>
                <div class="component-summary">
                    <div class="component-stat">
                        <div class="component-stat-value">${milestonesTotal} / ${milestonesMaxScore}</div>
                        <div class="component-stat-label">Scor Total</div>
                    </div>
                    <div class="component-stat">
                        <div class="component-stat-value">${milestonesAverage}</div>
                        <div class="component-stat-label">Scor Mediu</div>
                    </div>
                    <div class="component-stat">
                        <div class="component-stat-value">${milestonesPercentage}%</div>
                        <div class="component-stat-label">Procent</div>
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Aria de Dezvoltare</th>
                            <th style="text-align: center;">Scor Total</th>
                            <th style="text-align: center;">Scor Mediu</th>
                            <th style="text-align: center;">Procent</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${milestoneRows}
                    </tbody>
                </table>
            </div>

            <div class="section">
                <h2>Bariere în Învățare (Barriers)</h2>
                <div class="component-summary">
                    <div class="component-stat">
                        <div class="component-stat-value">${barriersTotal} / ${barriersMaxScore}</div>
                        <div class="component-stat-label">Scor Total</div>
                    </div>
                    <div class="component-stat">
                        <div class="component-stat-value">${barriersAverage}</div>
                        <div class="component-stat-label">Scor Mediu</div>
                    </div>
                    <div class="component-stat">
                        <div class="component-stat-value">${barriersPercentage}%</div>
                        <div class="component-stat-label">Procent</div>
                    </div>
                </div>
                <p style="margin-top: 1rem; color: #64748b;">Total itemi bariere evaluați: ${barriersCount}</p>
            </div>

            <div class="section">
                <h2>Tranziție (Transition Assessment)</h2>
                <div class="component-summary">
                    <div class="component-stat">
                        <div class="component-stat-value">${transitionTotal} / ${transitionMaxScore}</div>
                        <div class="component-stat-label">Scor Total</div>
                    </div>
                    <div class="component-stat">
                        <div class="component-stat-value">${transitionAverage}</div>
                        <div class="component-stat-label">Scor Mediu</div>
                    </div>
                    <div class="component-stat">
                        <div class="component-stat-value">${transitionPercentage}%</div>
                        <div class="component-stat-label">Procent</div>
                    </div>
                </div>
                <p style="margin-top: 1rem; color: #64748b;">Total itemi tranziție evaluați: ${transitionCount}</p>
            </div>

            <div class="section">
                <h2>Analiză Sarcină (Task Analysis)</h2>
                <div class="component-summary">
                    <div class="component-stat">
                        <div class="component-stat-value">${taskAnalysisTotal} / ${taskAnalysisMaxScore}</div>
                        <div class="component-stat-label">Scor Total</div>
                    </div>
                    <div class="component-stat">
                        <div class="component-stat-value">${taskAnalysisAverage}</div>
                        <div class="component-stat-label">Scor Mediu</div>
                    </div>
                    <div class="component-stat">
                        <div class="component-stat-value">${taskAnalysisPercentage}%</div>
                        <div class="component-stat-label">Procent</div>
                    </div>
                </div>
                <p style="margin-top: 1rem; color: #64748b;">Total itemi analiză sarcină evaluați: ${taskAnalysisCount}</p>
            </div>

            <div class="section">
                <h2>Obiective IEP</h2>
                <div class="component-summary">
                    <div class="component-stat">
                        <div class="component-stat-value">${iepObjectivesTotal} / ${iepObjectivesMaxScore}</div>
                        <div class="component-stat-label">Scor Total</div>
                    </div>
                    <div class="component-stat">
                        <div class="component-stat-value">${iepObjectivesAverage}</div>
                        <div class="component-stat-label">Scor Mediu</div>
                    </div>
                    <div class="component-stat">
                        <div class="component-stat-value">${iepObjectivesPercentage}%</div>
                        <div class="component-stat-label">Procent</div>
                    </div>
                </div>
                <p style="margin-top: 1rem; color: #64748b;">Total obiective IEP evaluate: ${iepObjectivesCount}</p>
            </div>

            <div class="footer">
                <p>Document generat automat din sistemul Tempo App</p>
                <p>Data generării: ${new Date().toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
            </div>
        </body>
        </html>
    `;
}

/**
 * NOU: Generator HTML pentru Raport Logopedic Individual (printabil)
 */
function generateLogopedicaReportHTML(client, clientData, date) {
    const evalData = clientData.evaluationsLogopedica?.[date];
    if (!evalData) return '<h1>Eroare: Evaluarea logopedică nu a fost găsită.</h1>';

    const scores = evalData.scores || {};
    const comments = evalData.comments || 'Niciun comentariu.';
    
    // Funcție helper pentru a obține scorul
    const getScore = (id) => {
        const score = scores[id];
        return score ? `<span class="logo-score">${score}</span>` : '—';
    };

    return `
        <!DOCTYPE html>
        <html lang="ro">
        <head>
            <meta charset="UTF-8">
            <title>Evaluare Logopedică - ${client.name}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 2rem; color: #333; line-height: 1.5; }
                .container { max-width: 800px; margin: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
                .header { background: #9B59B6; color: white; padding: 1.5rem; border-radius: 8px 8px 0 0; }
                .header h1 { margin: 0; font-size: 1.8rem; }
                .header p { margin: 0.25rem 0 0; font-size: 1rem; opacity: 0.9; }
                .content { padding: 1.5rem; }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; background: #f9f9f9; padding: 1rem; border-radius: 8px; }
                .info-item { display: flex; flex-direction: column; }
                .info-label { font-size: 0.8rem; color: #666; text-transform: uppercase; font-weight: 600; }
                .info-value { font-size: 1.1rem; font-weight: 500; }
                h2 { font-size: 1.3rem; color: #9B59B6; border-bottom: 2px solid #eee; padding-bottom: 0.5rem; margin-top: 2rem; }
                .comments-section p { white-space: pre-wrap; background: #f9f9f9; padding: 1rem; border-radius: 8px; line-height: 1.6; }
                .logopedica-table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.9rem; }
                .logopedica-table th, .logopedica-table td { padding: 0.5rem; border: 1px solid #ddd; text-align: center; vertical-align: middle; }
                .logopedica-table th { background: #f4f4f4; font-weight: 600; }
                .logopedica-table td:first-child { font-weight: 700; font-size: 1.25rem; width: 80px; }
                .logo-example-text { display: block; font-size: 0.75rem; color: #777; font-style: italic; }
                .logo-score { font-weight: 600; font-size: 1rem; color: #4A90E2; }
                @media print {
                    body { padding: 0; }
                    .container { border: 0; box-shadow: none; max-width: 100%; }
                    .header { background: #9B59B6 !important; color: white !important; -webkit-print-color-adjust: exact; }
                    th, .info-grid, .comments-section p { background: #f9f9f9 !important; -webkit-print-color-adjust: exact; }
                    .logopedica-table th, .logopedica-table td { border: 1px solid #ccc; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Evaluare Logopedică</h1>
                    <p>Client: ${client.name}</p>
                </div>
                <div class="content">
                    <div class="info-grid">
                        <div class="info-item">
                            <span class="info-label">Data Evaluării</span>
                            <span class="info-value">${new Date(date).toLocaleDateString('ro-RO')}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Data Nașterii</span>
                            <span class="info-value">${client.birthDate ? new Date(client.birthDate).toLocaleDateString('ro-RO') : 'N/A'}</span>
                        </div>
                    </div>

                    <h2>Rezultate Evaluare</h2>
                    <div class="logopedica-table-container">
                        <table class="logopedica-table">
                            <thead>
                                <tr>
                                    <th>Sunet</th>
                                    <th>Poziție Inițială</th>
                                    <th>Poziție Mediană</th>
                                    <th>Poziție Finală</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>A</td>
                                    <td><span class="logo-example-text">arici</span>${getScore('logo_A_init')}</td>
                                    <td><span class="logo-example-text">vaca</span>${getScore('logo_A_med')}</td>
                                    <td><span class="logo-example-text">perdea</span>${getScore('logo_A_fin')}</td>
                                </tr>
                                <tr>
                                    <td>O</td>
                                    <td><span class="logo-example-text">olita</span>${getScore('logo_O_init')}</td>
                                    <td><span class="logo-example-text">foc</span>${getScore('logo_O_med')}</td>
                                    <td><span class="logo-example-text">radio</span>${getScore('logo_O_fin')}</td>
                                </tr>
                                <tr>
                                    <td>U</td>
                                    <td><span class="logo-example-text">umbrela</span>${getScore('logo_U_init')}</td>
                                    <td><span class="logo-example-text">pui</span>${getScore('logo_U_med')}</td>
                                    <td><span class="logo-example-text">cadou</span>${getScore('logo_U_fin')}</td>
                                </tr>
                                <tr>
                                    <td>E</td>
                                    <td><span class="logo-example-text">elefant</span>${getScore('logo_E_init')}</td>
                                    <td><span class="logo-example-text">peste</span>${getScore('logo_E_med')}</td>
                                    <td><span class="logo-example-text">rosie</span>${getScore('logo_E_fin')}</td>
                                </tr>
                                <tr>
                                    <td>I</td>
                                    <td><span class="logo-example-text">iepure</span>${getScore('logo_I_init')}</td>
                                    <td><span class="logo-example-text">lingura</span>${getScore('logo_I_med')}</td>
                                    <td><span class="logo-example-text">ardei</span>${getScore('logo_I_fin')}</td>
                                </tr>
                                <tr>
                                    <td>Ă</td>
                                    <td><span class="logo-example-text">ăla</span>${getScore('logo_A2_init')}</td>
                                    <td><span class="logo-example-text">mănuși</span>${getScore('logo_A2_med')}</td>
                                    <td><span class="logo-example-text">casă</span>${getScore('logo_A2_fin')}</td>
                                </tr>
                                <tr>
                                    <td>Â/Î</td>
                                    <td><span class="logo-example-text">îngeraș</span>${getScore('logo_A3_init')}</td>
                                    <td><span class="logo-example-text">pâine</span>${getScore('logo_A3_med')}</td>
                                    <td><span class="logo-example-text">a coborî</span>${getScore('logo_A3_fin')}</td>
                                </tr>
                                <tr>
                                    <td>P</td>
                                    <td><span class="logo-example-text">pară</span>${getScore('logo_P_init')}</td>
                                    <td><span class="logo-example-text">șarpe</span>${getScore('logo_P_med')}</td>
                                    <td><span class="logo-example-text">dulap</span>${getScore('logo_P_fin')}</td>
                                </tr>
                                <tr>
                                    <td>B</td>
                                    <td><span class="logo-example-text">balon</span>${getScore('logo_B_init')}</td>
                                    <td><span class="logo-example-text">albină</span>${getScore('logo_B_med')}</td>
                                    <td><span class="logo-example-text">cerb</span>${getScore('logo_B_fin')}</td>
                                </tr>
                                <tr>
                                    <td>M</td>
                                    <td><span class="logo-example-text">mașină</span>${getScore('logo_M_init')}</td>
                                    <td><span class="logo-example-text">bomboană</span>${getScore('logo_M_med')}</td>
                                    <td><span class="logo-example-text">pom</span>${getScore('logo_M_fin')}</td>
                                </tr>
                                <tr>
                                    <td>T</td>
                                    <td><span class="logo-example-text">tobă</span>${getScore('logo_T_init')}</td>
                                    <td><span class="logo-example-text">autobuz</span>${getScore('logo_T_med')}</td>
                                    <td><span class="logo-example-text">pat</span>${getScore('logo_T_fin')}</td>
                                </tr>
                                <tr>
                                    <td>D</td>
                                    <td><span class="logo-example-text">dinozaur</span>${getScore('logo_D_init')}</td>
                                    <td><span class="logo-example-text">crocodil</span>${getScore('logo_D_med')}</td>
                                    <td><span class="logo-example-text">brad</span>${getScore('logo_D_fin')}</td>
                                </tr>
                                <tr>
                                    <td>N</td>
                                    <td><span class="logo-example-text">nor</span>${getScore('logo_N_init')}</td>
                                    <td><span class="logo-example-text">cană</span>${getScore('logo_N_med')}</td>
                                    <td><span class="logo-example-text">scaun</span>${getScore('logo_N_fin')}</td>
                                </tr>
                                <tr>
                                    <td>L</td>
                                    <td><span class="logo-example-text">leu</span>${getScore('logo_L_init')}</td>
                                    <td><span class="logo-example-text">melc</span>${getScore('logo_L_med')}</td>
                                    <td><span class="logo-example-text">cal</span>${getScore('logo_L_fin')}</td>
                                </tr>
                                <tr>
                                    <td>F</td>
                                    <td><span class="logo-example-text">floare</span>${getScore('logo_F_init')}</td>
                                    <td><span class="logo-example-text">telefon</span>${getScore('logo_F_med')}</td>
                                    <td><span class="logo-example-text">cartof</span>${getScore('logo_F_fin')}</td>
                                </tr>
                                <tr>
                                    <td>V</td>
                                    <td><span class="logo-example-text">vapor</span>${getScore('logo_V_init')}</td>
                                    <td><span class="logo-example-text">avion</span>${getScore('logo_V_med')}</td>
                                    <td><span class="logo-example-text">morcov</span>${getScore('logo_V_fin')}</td>
                                </tr>
                                <tr>
                                    <td>S</td>
                                    <td><span class="logo-example-text">sanie</span>${getScore('logo_S_init')}</td>
                                    <td><span class="logo-example-text">pisică</span>${getScore('logo_S_med')}</td>
                                    <td><span class="logo-example-text">urs</span>${getScore('logo_S_fin')}</td>
                                </tr>
                                <tr>
                                    <td>Z</td>
                                    <td><span class="logo-example-text">zebră</span>${getScore('logo_Z_init')}</td>
                                    <td><span class="logo-example-text">frunză</span>${getScore('logo_Z_med')}</td>
                                    <td><span class="logo-example-text">autobuz</span>${getScore('logo_Z_fin')}</td>
                                </tr>
                                <tr>
                                    <td>Ț</td>
                                    <td><span class="logo-example-text">țap</span>${getScore('logo_T2_init')}</td>
                                    <td><span class="logo-example-text">maimuță</span>${getScore('logo_T2_med')}</td>
                                    <td><span class="logo-example-text">căluț</span>${getScore('logo_T2_fin')}</td>
                                </tr>
                                <tr>
                                    <td>Ș</td>
                                    <td><span class="logo-example-text">șervețel</span>${getScore('logo_S2_init')}</td>
                                    <td><span class="logo-example-text">ușă</span>${getScore('logo_S2_med')}</td>
                                    <td><span class="logo-example-text">cocoș</span>${getScore('logo_S2_fin')}</td>
                                </tr>
                                <tr>
                                    <td>J</td>
                                    <td><span class="logo-example-text">jucării</span>${getScore('logo_J_init')}</td>
                                    <td><span class="logo-example-text">păianjen</span>${getScore('logo_J_med')}</td>
                                    <td><span class="logo-example-text">ruj</span>${getScore('logo_J_fin')}</td>
                                </tr>
                                <tr>
                                    <td>C</td>
                                    <td><span class="logo-example-text">câine</span>${getScore('logo_C_init')}</td>
                                    <td><span class="logo-example-text">muscă</span>${getScore('logo_C_med')}</td>
                                    <td><span class="logo-example-text">porc</span>${getScore('logo_C_fin')}</td>
                                </tr>
                                <tr>
                                    <td>G</td>
                                    <td><span class="logo-example-text">găină</span>${getScore('logo_G_init')}</td>
                                    <td><span class="logo-example-text">papagal</span>${getScore('logo_G_med')}</td>
                                    <td><span class="logo-example-text">steag</span>${getScore('logo_G_fin')}</td>
                                </tr>
                                <tr>
                                    <td>H</td>
                                    <td><span class="logo-example-text">hipopotam</span>${getScore('logo_H_init')}</td>
                                    <td><span class="logo-example-text">pahar</span>${getScore('logo_H_med')}</td>
                                    <td><span class="logo-example-text">șah</span>${getScore('logo_H_fin')}</td>
                                </tr>
                                <tr>
                                    <td>R</td>
                                    <td><span class="logo-example-text">rață</span>${getScore('logo_R_init')}</td>
                                    <td><span class="logo-example-text">carte</span>${getScore('logo_R_med')}</td>
                                    <td><span class="logo-example-text">fular</span>${getScore('logo_R_fin')}</td>
                                </tr>
                                <tr>
                                    <td>X</td>
                                    <td><span class="logo-example-text">xilofon</span>${getScore('logo_X_init')}</td>
                                    <td><span class="logo-example-text">boxer</span>${getScore('logo_X_med')}</td>
                                    <td><span class="logo-example-text">pix</span>${getScore('logo_X_fin')}</td>
                                </tr>
                                <tr>
                                    <td>ce</td>
                                    <td><span class="logo-example-text">ceas</span>${getScore('logo_CE_init')}</td>
                                    <td><span class="logo-example-text">rinocer</span>${getScore('logo_CE_med')}</td>
                                    <td><span class="logo-example-text">șoarece</span>${getScore('logo_CE_fin')}</td>
                                </tr>
                                <tr>
                                    <td>ci</td>
                                    <td><span class="logo-example-text">citește</span>${getScore('logo_CI_init')}</td>
                                    <td><span class="logo-example-text">bicicletă</span>${getScore('logo_CI_med')}</td>
                                    <td><span class="logo-example-text">papuci</span>${getScore('logo_CI_fin')}</td>
                                </tr>
                                <tr>
                                    <td>ge</td>
                                    <td><span class="logo-example-text">geam</span>${getScore('logo_GE_init')}</td>
                                    <td><span class="logo-example-text">deget</span>${getScore('logo_GE_med')}</td>
                                    <td><span class="logo-example-text">minge</span>${getScore('logo_GE_fin')}</td>
                                </tr>
                                <tr>
                                    <td>gi</td>
                                    <td><span class="logo-example-text">girafă</span>${getScore('logo_GI_init')}</td>
                                    <td><span class="logo-example-text">frigider</span>${getScore('logo_GI_med')}</td>
                                    <td><span class="logo-example-text">covrigi</span>${getScore('logo_GI_fin')}</td>
                                </tr>
                                <tr>
                                    <td>che</td>
                                    <td><span class="logo-example-text">cheie</span>${getScore('logo_CHE_init')}</td>
                                    <td><span class="logo-example-text">ochelari</span>${getScore('logo_CHE_med')}</td>
                                    <td><span class="logo-example-text">ridiche</span>${getScore('logo_CHE_fin')}</td>
                                </tr>
                                <tr>
                                    <td>chi</td>
                                    <td><span class="logo-example-text">chibrituri</span>${getScore('logo_CHI_init')}</td>
                                    <td><span class="logo-example-text">rochie</span>${getScore('logo_CHI_med')}</td>
                                    <td><span class="logo-example-text">ochi</span>${getScore('logo_CHI_fin')}</td>
                                </tr>
                                <tr>
                                    <td>ghe</td>
                                    <td><span class="logo-example-text">ghete</span>${getScore('logo_GHE_init')}</td>
                                    <td><span class="logo-example-text">înghețată</span>${getScore('logo_GHE_med')}</td>
                                    <td><span class="logo-example-text">Gheorghe</span>${getScore('logo_GHE_fin')}</td>
                                </tr>
                                <tr>
                                    <td>ghi</td>
                                    <td><span class="logo-example-text">ghiozdan</span>${getScore('logo_GHI_init')}</td>
                                    <td><span class="logo-example-text">unghie</span>${getScore('logo_GHI_med')}</td>
                                    <td><span class="logo-example-text">triunghi</span>${getScore('logo_GHI_fin')}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                        
                    <div class="comments-section">
                        <h2>Comentarii Evaluare Logopedică</h2>
                        <p>${comments}</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;
}


/**
 * Generator HTML pentru Raport ABLLS-R Individual (printabil)
 */
async function generateABLLSReportHTML(client, clientData, date) {
    const evalData = clientData.evaluationsABLLS;
    if (!evalData) return '<h1>Eroare: Evaluarea ABLLS-R nu a fost găsită.</h1>';

    // Load ABLLS data to get full item descriptions
    const abllsData = await loadABLLSData();
    if (!abllsData) return '<h1>Eroare: Nu s-au putut încărca datele ABLLS-R.</h1>';

    // Collect checked items for this date across all domains
    const domainData = {};
    Object.keys(evalData).forEach(domain => {
        if (evalData[domain][date] !== undefined) {
            domainData[domain] = evalData[domain][date];
        }
    });

    if (Object.keys(domainData).length === 0) {
        return '<h1>Eroare: Nu există date pentru această dată.</h1>';
    }

    const formattedDate = new Date(date).toLocaleDateString('ro-RO', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });

    // Generate domain rows
    let domainRows = '';
    let totalScore = 0;
    let totalPossible = 0;

    Object.keys(domainData).forEach(domainKey => {
        const checkedItems = domainData[domainKey];
        const domainName = domainKey.replace('ABLLS - ', '');
        const items = abllsData[domainName] || [];
        const maxScore = items.length;

        // Calculate score based on checked items (array) or legacy numeric score
        const score = Array.isArray(checkedItems) ? checkedItems.length : (checkedItems || 0);

        totalScore += score;
        totalPossible += maxScore;

        const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

        domainRows += `
            <tr>
                <td style="font-weight: 600;">${domainName}</td>
                <td style="text-align: center;">${score} / ${maxScore}</td>
                <td style="text-align: center;">${percentage}%</td>
            </tr>
        `;
    });

    const overallPercentage = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0;

    return `
        <!DOCTYPE html>
        <html lang="ro">
        <head>
            <meta charset="UTF-8">
            <title>Raport ABLLS-R - ${client.name}</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: 'Arial', 'Helvetica', sans-serif;
                    padding: 2cm;
                    background: white;
                    color: #333;
                    line-height: 1.6;
                }
                .header {
                    text-align: center;
                    margin-bottom: 2rem;
                    border-bottom: 3px solid #2563eb;
                    padding-bottom: 1rem;
                }
                .header h1 {
                    font-size: 2rem;
                    color: #1e40af;
                    margin-bottom: 0.5rem;
                }
                .header .subtitle {
                    font-size: 1.2rem;
                    color: #64748b;
                    font-style: italic;
                }
                .client-info {
                    background: #f1f5f9;
                    padding: 1.5rem;
                    border-radius: 8px;
                    margin-bottom: 2rem;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 1rem;
                }
                .info-item {
                    display: flex;
                    gap: 0.5rem;
                }
                .info-label {
                    font-weight: 600;
                    color: #475569;
                }
                .info-value {
                    color: #1e293b;
                }
                .summary-box {
                    background: #eff6ff;
                    border: 2px solid #3b82f6;
                    border-radius: 8px;
                    padding: 1.5rem;
                    margin-bottom: 2rem;
                    text-align: center;
                }
                .summary-box h2 {
                    color: #1e40af;
                    margin-bottom: 1rem;
                    font-size: 1.5rem;
                }
                .summary-stats {
                    display: flex;
                    justify-content: center;
                    gap: 3rem;
                    font-size: 1.1rem;
                }
                .stat {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                .stat-value {
                    font-size: 2rem;
                    font-weight: 700;
                    color: #2563eb;
                }
                .stat-label {
                    color: #64748b;
                    font-size: 0.9rem;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 1.5rem;
                }
                thead {
                    background: #1e40af;
                    color: white;
                }
                th {
                    padding: 1rem;
                    text-align: left;
                    font-weight: 600;
                }
                td {
                    padding: 0.75rem 1rem;
                    border-bottom: 1px solid #e2e8f0;
                }
                tbody tr:nth-child(even) {
                    background: #f8fafc;
                }
                tbody tr:hover {
                    background: #f1f5f9;
                }
                .footer {
                    margin-top: 3rem;
                    padding-top: 1.5rem;
                    border-top: 2px solid #e2e8f0;
                    text-align: center;
                    color: #64748b;
                    font-size: 0.9rem;
                }
                @media print {
                    body { padding: 0; }
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Raport Evaluare ABLLS-R</h1>
                <div class="subtitle">Assessment of Basic Language and Learning Skills - Revised</div>
            </div>

            <div class="client-info">
                <div class="info-item">
                    <span class="info-label">Nume client:</span>
                    <span class="info-value">${client.name}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Data evaluării:</span>
                    <span class="info-value">${formattedDate}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">ID client:</span>
                    <span class="info-value">${client.id}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Data nașterii:</span>
                    <span class="info-value">${client.birthDate ? new Date(client.birthDate).toLocaleDateString('ro-RO') : 'N/A'}</span>
                </div>
            </div>

            <div class="summary-box">
                <h2>Scor Total</h2>
                <div class="summary-stats">
                    <div class="stat">
                        <div class="stat-value">${totalScore}</div>
                        <div class="stat-label">Puncte obținute</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${totalPossible}</div>
                        <div class="stat-label">Puncte posibile</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value">${overallPercentage}%</div>
                        <div class="stat-label">Procent finalizare</div>
                    </div>
                </div>
            </div>

            <h2 style="color: #1e40af; margin-bottom: 1rem; font-size: 1.5rem;">Rezultate pe Domenii</h2>
            <table>
                <thead>
                    <tr>
                        <th>Domeniu ABLLS-R</th>
                        <th style="text-align: center;">Scor</th>
                        <th style="text-align: center;">Procent</th>
                    </tr>
                </thead>
                <tbody>
                    ${domainRows}
                </tbody>
            </table>

            <div class="footer">
                <p>Document generat automat din sistemul Tempo App</p>
                <p>Data generării: ${new Date().toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
            </div>
        </body>
        </html>
    `;
}


// --- Secțiunea Istoric Programe ---

// În: js/evolutionService.js

// ... (adaugă funcția generateScoreHTML de mai sus aici) ...

// În: js/evolutionService.js
// ROL: Afișează istoricul în modalul "Evoluție" (Tab-ul "Istoric Programe")

function renderProgramHistory(clientData) {
    const container = $('programHistoryContainer');
    if (!container) return;

    const programHistory = clientData.programHistory || [];
    if (programHistory.length === 0) {
        container.innerHTML = '<div class="program-history-empty">Nu există istoric de programe pentru acest client.</div>';
        return;
    }

    // Sortare și grupare
    programHistory.sort((a, b) => new Date(b.date) - new Date(a.date));
    const grouped = {};
    programHistory.forEach(entry => {
        if (!grouped[entry.programTitle]) grouped[entry.programTitle] = [];
        grouped[entry.programTitle].push(entry);
    });

    let html = `
        <table class="program-history-table">
            <thead><tr><th>Program</th><th>Data</th><th style="text-align: left;">Scor</th></tr></thead>
            <tbody>
    `;
    
    Object.entries(grouped).forEach(([programTitle, entries]) => {
        entries.slice(0, 10).forEach((entry, index) => { // Limitează la ultimele 10
            const formattedDate = new Date(entry.date).toLocaleDateString('ro-RO');
            
            // --- MODIFICARE AICI ---
            const scoreHtml = generateScoreHTML(entry.score); // Folosim noul helper
            // --- SFÂRȘIT MODIFICARE ---
            
            html += `<tr>`;
            if (index === 0) {
                html += `<td rowspan="${Math.min(entries.length, 10)}">${programTitle}</td>`;
            }
            html += `<td>${formattedDate}</td>`;
            
            // --- MODIFICARE AICI ---
            html += `<td style="text-align: left;">${scoreHtml}</td>`; // Afișăm HTML-ul generat
            // --- SFÂRȘIT MODIFICARE ---
            html += `</tr>`;
        });
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

/**
 * NOU: Funcție copiată din reportService.js pentru a genera sumarul DQ.
 * Generează HTML pentru tabelul sumar Portage DQ.
 */
function generatePortageSummaryHTML(clientData, client) {
    // Verifică dacă există datele necesare
    if (!client.birthDate || !clientData.evaluations || Object.keys(clientData.evaluations).length === 0) {
        return ''; // Nu afișa nimic dacă nu există date
    }

    const birthDate = new Date(client.birthDate);
    const allDates = new Set();
    // Adună toate datele de evaluare unice
    Object.values(clientData.evaluations).forEach(domain => {
        Object.keys(domain).forEach(date => allDates.add(date));
    });
    // Sortează datele cronologic
    const sortedDates = Array.from(allDates).sort((a, b) => new Date(a) - new Date(b));
    
    const results = [];
    sortedDates.forEach(date => {
        // Obține toate scorurile (DA) pentru o anumită dată
        const evalValues = Object.values(clientData.evaluations)
            .map(domain => domain[date])
            .filter(v => typeof v === 'number' && !isNaN(v));
        
        if (evalValues.length === 0) return; // Continuă dacă nu există scoruri pentru această dată

        // Calculează media DA (Vârsta Dezvoltării)
        const avgDevAge = evalValues.reduce((a, b) => a + b, 0) / evalValues.length;
        // Calculează CA (Vârsta Cronologică) în luni la data evaluării
        const chronoAge = getAgeInMonths(birthDate, date); 
        
        if (chronoAge === 0) return; // Evită împărțirea la zero
        
        // Calculează DQ (Coeficientul de Dezvoltare)
        const dq = (avgDevAge / chronoAge) * 100;
        results.push({ date, avgDevAge, chronoAge, dq });
    });

    if (results.length === 0) {
        return ''; // Nu s-au putut calcula rezultate
    }

    // Generează rândurile tabelului
    // Folosim clasa 'evolution-table' pentru a prelua stilurile
    const tableRows = results.map(r => {
        const color = r.dq < 70 ? '#e74c3c' : r.dq < 85 ? '#f39c12' : '#27ae60'; // Roșu, Galben, Verde
        // Adăugăm atributele data-label pentru responsivitate (preluat din styles.css)
        return `<tr>
            <td data-label="Data">${new Date(r.date).toLocaleDateString('ro-RO')}</td>
            <td data-label="Vârstă Cronologică">${r.chronoAge.toFixed(1)} luni</td>
            <td data-label="Vârstă Mentală">${r.avgDevAge.toFixed(1)} luni</td>
            <td data-label="Indice Dezvoltare (DQ)" style="font-weight:600;color:${color};">${r.dq.toFixed(1)}</td>
        </tr>`;
    }).join('');

    // Returnează HTML-ul complet al tabelului
    // Folosim clasele CSS existente
    return `
        <h3 class="evolution-summary-title">Evoluție Generală Portage (DQ)</h3>
        <div class="evolution-table-container" style="margin-top: 0; padding-top: 0;">
            <table class="evolution-table">
                <thead>
                    <tr>
                        <th>Data Evaluării</th>
                        <th>Vârstă Cronologică (CA)</th>
                        <th>Vârstă Mentală (DA)</th>
                        <th>Indice Dezvoltare (DQ)</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    `;
}

// În: js/evolutionService.js
// ROL: Afișează notițele private (inclusiv scorurile) în modalul "Evoluție"

/**
 * Reconstructs event.programScores from programHistory in evolutionData
 * This fixes the bug where program scores disappear after page refresh
 * @param {object} event - The event object to reconstruct scores for
 */
function reconstructProgramScoresFromHistory(event) {
    const { evolutionData } = calendarState.getState();

    // Initialize programScores if it doesn't exist
    if (!event.programScores) {
        event.programScores = {};
    }

    // Get all clients for this event
    const clientIds = event.clientIds || (event.clientId ? [event.clientId] : []);

    // For each client, find programHistory entries for this event
    clientIds.forEach(clientId => {
        const clientData = evolutionData[clientId];
        if (!clientData || !Array.isArray(clientData.programHistory)) return;

        // Find all program history entries for this specific event
        const eventEntries = clientData.programHistory.filter(entry => entry.eventId === event.id);

        // Reconstruct programScores from history entries
        eventEntries.forEach(entry => {
            const programId = entry.programId;
            const scoreString = entry.score; // e.g., "P (2), + (1)"

            if (!scoreString) return;

            // Parse the score string back into the counter object
            // Example: "P (2), + (1)" -> { "P": 2, "+": 1, "0": 0, "-": 0 }
            const scoreObj = { "0": 0, "-": 0, "P": 0, "+": 0 };

            // Match patterns like "P (2)" or "+ (1)"
            const matches = scoreString.matchAll(/([0\-P\+])\s*\((\d+)\)/g);
            for (const match of matches) {
                const key = match[1];
                const count = parseInt(match[2], 10);
                if (key in scoreObj) {
                    scoreObj[key] = count;
                }
            }

            // Only set if we found valid scores
            const hasScores = Object.values(scoreObj).some(val => val > 0);
            if (hasScores) {
                event.programScores[programId] = scoreObj;
            }
        });
    });
}

function renderPrivateNotes(clientId) {
    const container = $('privateNotesContainer');
    if (!container) return;

    const { events } = calendarState.getState();

    // 1. Filtrează evenimentele care au comentarii pentru acest client
    const eventsWithComments = events.filter(event => {
        const clientIds = event.clientIds || (event.clientId ? [event.clientId] : []);
        const hasClient = clientIds.includes(clientId);
        const hasComment = event.comments && event.comments.trim() !== '';
        return hasClient && hasComment;
    });

    // 2. Sortează (cele mai noi primele)
    eventsWithComments.sort((a, b) => {
        const dateA = new Date(`${a.date}T${a.startTime || '00:00'}`);
        const dateB = new Date(`${b.date}T${b.startTime || '00:00'}`);
        return dateB - dateA; // Sortare descrescătoare
    });

    // 🔧 FIX: Reconstruct programScores from programHistory for each event
    // This ensures scores display correctly after page refresh
    eventsWithComments.forEach(event => {
        reconstructProgramScoresFromHistory(event);
    });

    // 3. Randează HTML-ul
    if (eventsWithComments.length === 0) {
        container.innerHTML = '<p class="private-notes-empty">Nu există notițe private salvate pentru acest client.</p>';
        return;
    }

    container.innerHTML = eventsWithComments.map(event => {
        // Găsește terapeuții
        const memberIds = event.teamMemberIds || (event.teamMemberId ? [event.teamMemberId] : []);
        const members = memberIds
            .map(id => calendarState.getTeamMemberById(id))
            .filter(Boolean) // Elimină membrii negăsiți
            .map(m => m.name)
            .join(', ');

        // Formatează data și ora
        const formattedDate = new Date(event.date).toLocaleDateString('ro-RO', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        });
        const time = event.startTime || 'N/A';

        // --- AICI E MODIFICAREA ---
        let scoresHtml = '';
        const programIds = event.programIds || [];
        const programScores = event.programScores || {}; // Acesta conține obiectele de scor

        if (programIds.length > 0) {
            let scoreItemsHtml = '';
            programIds.forEach(pId => {
                const program = calendarState.getProgramById(pId);
                const scoreData = programScores[pId]; // Acesta este {P: 1, +: 3} etc.
                
                if (program) { // Afișăm doar dacă programul există
                    scoreItemsHtml += `
                        <div class="note-score-item">
                            <span class="note-program-title">${program.title}</span>
                            ${generateScoreHTML(scoreData)} 
                        </div>
                    `;
                }
            });

            if (scoreItemsHtml) {
                 scoresHtml = `<div class="private-note-scores">${scoreItemsHtml}</div>`;
            }
        }
        // --- SFÂRȘIT MODIFICARE ---

        return `
            <div class="private-note-item">
                <div class="private-note-header">
                    <span class="note-meta-item">
                        Terapeut: <strong>${members || 'Nespecificat'}</strong>
                    </span>
                    <span class="note-meta-item">
                        Data: <strong>${formattedDate}</strong>
                    </span>
                    <span class="note-meta-item">
                        Ora: <strong>${time}</strong>
                    </span>
                </div>
                <div class="private-note-body">
                    ${scoresHtml} 
                    ${event.comments || ''}
                </div>
            </div>
        `;
    }).join('');
}

    // --- Secțiunea Temă Lunară ---

/**
 * NOU: Randează istoricul temelor lunare în tab-ul corespunzător.
 * @param {object} clientData Datele de evoluție complete ale clientului.
 */
function renderMonthlyThemeHistory(clientData) {
    const container = $('monthlyThemeHistoryContainer');
    if (!container) return;

    const themes = clientData.monthlyThemes || {};
    // Sortează lunile în ordine cronologică inversă (cele mai noi primele)
    const sortedMonths = Object.keys(themes).sort((a, b) => b.localeCompare(a));

    if (sortedMonths.length === 0) {
        container.innerHTML = '<p class="empty-list-message" style="text-align: center; margin-top: 1rem;">Nu există teme lunare salvate.</p>';
        return;
    }

    // Helper pentru a formata "YYYY-MM" în "Luna An" (ex: "Noiembrie 2025")
    const formatMonth = (monthKey) => {
        const [year, month] = monthKey.split('-');
        // Creăm o dată sigură (folosind ziua 1)
        const date = new Date(year, month - 1, 1);
        return date.toLocaleDateString('ro-RO', { 
            month: 'long', 
            year: 'numeric' 
        });
    };

    // MODIFICAT: Adăugat buton de editare
    container.innerHTML = sortedMonths.map(monthKey => {
        const themeText = themes[monthKey]
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
            
        return `
            <div class="monthly-theme-item">
                <div class="monthly-theme-header">
                    <span class="monthly-theme-month">${formatMonth(monthKey)}</span>
                    <button 
                        class="btn btn-secondary btn-sm monthly-theme-edit-btn" 
                        data-month-key="${monthKey}"
                        style="padding: 0.25rem 0.75rem; font-size: 0.75rem;"
                    >
                        Editează
                    </button>
                </div>
                <p class="monthly-theme-text">${themeText}</p>
            </div>
        `;
    }).join('');

    // NOU: Adaugă event listener pentru butoanele de editare
    const handleEditThemeClick = (e) => {
        const button = e.target.closest('.monthly-theme-edit-btn');
        if (!button) return;

        const monthKey = button.dataset.monthKey;
        const { evolutionData } = calendarState.getState();
        const themeText = evolutionData[currentClientId]?.monthlyThemes?.[monthKey];

        if (themeText) {
            $('monthlyThemeMonth').value = monthKey;
            $('monthlyThemeText').value = themeText;
            $('monthlyThemeText').focus(); // Focus pe text
        }
    };
    
    container.removeEventListener('click', handleEditThemeClick); // Previne listeneri multipli
    container.addEventListener('click', handleEditThemeClick);
}


/**
 * NOU: Inițializează valorile implicite pentru tab-ul "Temă Lunară".
 * Setează luna curentă în input și golește câmpul de text.
 */
function setupMonthlyThemeTab() {
    const monthInput = $('monthlyThemeMonth');
    if (monthInput) {
        const now = new Date();
        const year = now.getFullYear();
        // Adaugă '0' la început pentru lunile 1-9
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        monthInput.value = `${year}-${month}`;
    }
    
    const textInput = $('monthlyThemeText');
    if (textInput) {
        textInput.value = ''; // Golește textul la deschiderea modalului
    }
}

/**
 * NOU: Salvează tema lunara pentru clientul curent.
 * MODIFICAT: Adăugată verificare de suprascriere.
 */
async function saveMonthlyTheme() {
    const month = $('monthlyThemeMonth').value;
    const text = $('monthlyThemeText').value;

    if (!currentClientId) {
        showCustomAlert('Eroare: Niciun client selectat.', 'Eroare');
        return;
    }
    if (!month) {
        showCustomAlert('Selectați luna pentru care doriți să salvați tema.', 'Atenție');
        return;
    }
    if (!text.trim()) {
        showCustomAlert('Introduceți textul temei.', 'Atenție');
        return;
    }

    const { evolutionData } = calendarState.getState();
    const client = calendarState.getClientById(currentClientId);

    // Asigură-te că structura de bază există în obiectul evolutionData
    if (!evolutionData[currentClientId]) {
        evolutionData[currentClientId] = { 
            name: client.name, 
            evaluations: {}, 
            programHistory: [], 
            monthlyThemes: {} 
        };
    }
    if (!evolutionData[currentClientId].monthlyThemes) {
        evolutionData[currentClientId].monthlyThemes = {};
    }

    // --- NOU: VERIFICARE SUPRASCRIERE ---
    const existingTheme = evolutionData[currentClientId].monthlyThemes[month];
    const newText = text.trim();
    
    // Verificăm dacă există o temă ȘI dacă textul nou este DIFERIT de cel vechi
    if (existingTheme && existingTheme !== newText) {
        const confirmed = await showCustomConfirm(
            "O temă pentru această lună există deja. Ești sigur că vrei să suprascrii tema curentă?",
            "Confirmare Suprascriere"
        );
        
        // Dacă utilizatorul anulează, oprim funcția
        if (!confirmed) {
            return; 
        }
    }
    // --- SFÂRȘIT VERIFICARE ---

    // Salvează sau actualizează tema pentru luna respectivă
    evolutionData[currentClientId].monthlyThemes[month] = newText;

    // Actualizează starea locală
    calendarState.setEvolutionData(evolutionData);

   try {
    await queuedSaveEvolutionData(evolutionData);
    showCustomAlert('Tema lunară a fost salvată cu succes!', 'Succes');

    renderMonthlyThemeHistory(evolutionData[currentClientId]);
    $('monthlyThemeText').value = '';
    setupMonthlyThemeTab();

    if (window.logActivity) {
        window.logActivity("Temă lunară salvată", client.name, 'evaluation', currentClientId);
    }

} catch (err) {
    console.error('Eroare la salvarea temei lunare:', err);
    showCustomAlert('Nu s-a putut salva tema lunară pe server.', 'Eroare');
}
}

// --- Secțiunea Evaluare (Portage) ---

/**
 * Pregătește tab-ul de adăugare a evaluării.
 */
async function setupEvaluationTab(client) {
    if (client.birthDate) {
        $('childBirthDateInput').value = client.birthDate;
        updateChildAgeDisplay(client.birthDate);
    }
    $('evaluationDateInput').valueAsDate = new Date();
    
    // Încarcă datele Portage (dacă nu sunt deja încărcate)
    if (!portrigeData) {
        try {
            portrigeData = await api.loadPortrigeData();
        } catch (e) {
            console.error("Eroare la încărcarea datelor Portage:", e);
            $('portageDomainsContainer').innerHTML = '<p>Eroare la încărcarea datelor Portage.</p>';
            return;
        }
    }
    
    // Randează domeniile
    renderPortageDomains();
}

/**
 * Calculează vârsta în luni.
 */
function getAgeInMonths(birthDate, evalDate) {
    const birth = new Date(birthDate);
    const evalD = evalDate ? new Date(evalDate) : new Date();
    let months = (evalD.getFullYear() - birth.getFullYear()) * 12;
    months -= birth.getMonth();
    months += evalD.getMonth();
    return months <= 0 ? 0 : months;
}

function updateChildAgeDisplay(birthDate) {
    const span = $('childAgeDisplay');
    const evalDate = $('evaluationDateInput').value;
    if (!birthDate) {
        span.textContent = '–';
        return;
    }
    const months = getAgeInMonths(birthDate, evalDate);
    const years = Math.floor(months / 12);
    const rem = months % 12;
    span.textContent = `${years} ani și ${rem} luni (${months} luni)`;
}

/**
 * Randează domeniile și itemii Portage în container.
 */
/**
 * Randează domeniile și itemii Portage în container.
 */
function renderPortageDomains() {
    const container = $('portageDomainsContainer');
    container.innerHTML = '';
    const birthDate = $('childBirthDateInput').value;
    const evalDate = $('evaluationDateInput').value;

    if (!birthDate) {
        container.innerHTML = '<p>Introduceți data nașterii pentru a afișa itemii.</p>';
        return;
    }
    if (!portrigeData || Object.keys(portrigeData).length === 0) {
        container.innerHTML = '<p>Datele Portage nu sunt disponibile.</p>';
        return;
    }

    const ageMonths = getAgeInMonths(birthDate, evalDate);

    Object.keys(portrigeData).forEach(domain => {
        const items = portrigeData[domain];
        const block = document.createElement('div');
        block.className = 'domain-block';
        
        // Group items by age range
        const ageGroups = {};
        items.forEach(item => {
            const ageKey = item.age; // e.g., "0–3 luni", "13–15 luni"
            if (!ageGroups[ageKey]) {
                ageGroups[ageKey] = [];
            }
            ageGroups[ageKey].push(item);
        });

        // Check if there are any future items
        const hasFutureItems = items.some(item => item.months > ageMonths);
        const firstFutureMonth = items.find(item => item.months > ageMonths)?.months;

        // Build items HTML with age separators
        let itemsHtml = '';
        let showFutureButton = false;
        let futureItemsHtml = '';
        
        Object.entries(ageGroups).forEach(([ageRange, groupItems]) => {
            const firstItemInGroup = groupItems[0];
            const isFutureGroup = firstItemInGroup.months > ageMonths;
            
            // --- MODIFICARE: Creare groupKey unic ---
            const groupKey = `${domain}_${ageRange.replace(/[^a-z0-9]/gi, '_')}`;
            
            // Format age separator
            let separatorText = formatAgeRange(ageRange, firstItemInGroup.months);
            
            // --- MODIFICARE: Adăugare checkbox la separator ---
            const groupHtml = `
                <div class="portage-age-separator">
                    <input type="checkbox" class="portage-group-toggle" data-group-key="${groupKey}" id="toggle_${groupKey}">
                    <label for="toggle_${groupKey}">${separatorText}</label>
                </div>
            `;
            
            // Build items for this group
            let groupItemsHtml = '';
            groupItems.forEach(item => {
                const isFuture = item.months > ageMonths;

                // --- START CORECȚIE 1: Logica pentru tag-ul [fin] ---
                let ageText = `(${item.age})`;
                if (ageText.includes('(fin)')) {
                    ageText = ageText.replace(/\(fin\)/gi, '<span class="portage-fin-tag">fin</span>');
                }
                // --- END CORECȚIE 1 ---

                // --- MODIFICARE: Adăugare data-group-key la item ---
                groupItemsHtml += `
                    <div class="portage-item ${isFuture ? 'disabled' : ''}" data-months="${item.months}" data-group-key="${groupKey}">
                        <input type="checkbox" data-domain="${domain}" data-id="${item.id}" ${isFuture ? 'disabled' : ''}>
                        <label>${item.text} <i>${ageText}</i></label>
                    </div>
                `;
            });
            
            if (isFutureGroup && !showFutureButton) {
                // This is the first future group - add warning and button
                showFutureButton = true;
                const ageYearsMonths = formatAgeInYearsMonths(ageMonths);
                futureItemsHtml = `
                    <div class="portage-future-warning">
                        <p>Unele iteme din secțiunile următoare sunt pentru vârste mai mari decât ${ageYearsMonths}.</p>
                        <button type="button" class="domain-toggle-btn portage-future-toggle">Arată iteme viitoare</button>
                    </div>
                    <div class="portage-future-items collapsed">
                        ${groupHtml}
                        ${groupItemsHtml}
                `;
            } else if (isFutureGroup) {
                // Continue adding to future items
                futureItemsHtml += groupHtml + groupItemsHtml;
            } else {
                // Current/past items
                itemsHtml += groupHtml + groupItemsHtml;
            }
        });
        
        if (showFutureButton) {
            futureItemsHtml += '</div>'; // Close portage-future-items
            itemsHtml += futureItemsHtml;
        }

        block.innerHTML = `
            <div class="domain-header">
                <span>${domain}</span>
                <button type="button" class="domain-toggle-btn">Arată</button>
            </div>
            <div class="checkbox-grid collapsed">${itemsHtml}</div>
        `;
        
        // Toggle domain visibility
        const grid = block.querySelector('.checkbox-grid');
        const toggleBtn = block.querySelector('.domain-header .domain-toggle-btn');
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            grid.classList.toggle('collapsed');
            toggleBtn.textContent = grid.classList.contains('collapsed') ? 'Arată' : 'Ascunde';
        });
        
        // Make entire header clickable
        block.querySelector('.domain-header').addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON') {
                grid.classList.toggle('collapsed');
                toggleBtn.textContent = grid.classList.contains('collapsed') ? 'Arată' : 'Ascunde';
            }
        });
        
        // Toggle future items visibility
        const futureToggle = block.querySelector('.portage-future-toggle');
        if (futureToggle) {
            futureToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const futureItems = block.querySelector('.portage-future-items');
                futureItems.classList.toggle('collapsed');
                futureToggle.textContent = futureItems.classList.contains('collapsed') 
                    ? 'Arată iteme viitoare' 
                    : 'Ascunde iteme viitoare';
            });
        }

        // --- START CORECȚIE 2: Click pe întregul rând ---
        block.querySelectorAll('.portage-item').forEach(item => {
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (!checkbox) return;

            // 1. Listener pe tot item-ul (div)
            item.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT' || checkbox.disabled) {
                    // Dacă s-a dat click direct pe checkbox, lasă-l să-și facă treaba
                    // Sau dacă e dezactivat, nu face nimic
                    return; 
                }
                
                // Comută manual starea checkbox-ului pentru click pe label/padding/etc.
                checkbox.checked = !checkbox.checked;
                // Comută și clasa vizuală
                item.classList.toggle('checked', checkbox.checked);
            });

            // 2. Listener direct pe checkbox (pentru a prinde și click-ul pe el)
            checkbox.addEventListener('change', (e) => {
                // Sincronizează clasa vizuală când checkbox-ul se change
                item.classList.toggle('checked', e.target.checked);
            });
        });
        // --- END CORECȚIE 2 ---

        // --- NOU: Adaugă listener pentru toggle-ul de grup de vârstă ---
        block.querySelectorAll('.portage-group-toggle').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                const groupKey = e.target.dataset.groupKey;
                const isChecked = e.target.checked;

                // Găsește toate item-urile care aparțin acestui grup *în interiorul* blocului de domeniu
                const itemsInGroup = block.querySelectorAll(`.portage-item[data-group-key="${groupKey}"]`);
                
                itemsInGroup.forEach(item => {
                    const itemCheckbox = item.querySelector('input[type="checkbox"]');
                    // Bifează/debifează doar item-urile care nu sunt dezactivate (nu sunt din viitor)
                    if (itemCheckbox && !itemCheckbox.disabled) {
                        itemCheckbox.checked = isChecked;
                        // Sincronizează și clasa vizuală 'checked'
                        item.classList.toggle('checked', isChecked);
                    }
                });
            });
        });
        // --- SFÂRȘIT NOU ---

        container.appendChild(block);
    });
}

/**
 * Format age range with years and months for ranges > 10-12 months
 */
function formatAgeRange(ageRange, monthsValue) {
    // Extract month values from range like "13–15 luni"
    const match = ageRange.match(/(\d+)–(\d+)/);
    if (!match) return ageRange;
    
    const startMonth = parseInt(match[1]);
    const endMonth = parseInt(match[2]);
    
    if (startMonth <= 12) {
        return ageRange;
    }
    
    // Calculate years and months
    const startYears = Math.floor(startMonth / 12);
    const startRemMonths = startMonth % 12;
    const endYears = Math.floor(endMonth / 12);
    const endRemMonths = endMonth % 12;
    
    const startText = formatYearsMonths(startYears, startRemMonths);
    const endText = formatYearsMonths(endYears, endRemMonths);
    
    return `${ageRange} (${startText} - ${endText})`;
}

/**
 * Format years and months in Romanian
 */
function formatYearsMonths(years, months) {
    if (years === 0) {
        return `${months} ${months === 1 ? 'luna' : 'luni'}`;
    }
    if (months === 0) {
        return `${years} ${years === 1 ? 'an' : 'ani'}`;
    }
    const yearText = years === 1 ? 'an' : 'ani';
    const monthText = months === 1 ? 'luna' : 'luni';
    return `${years} ${yearText} si ${months} ${monthText}`;
}

/**
 * Format age in years and months (e.g., "4 ani și 9 luni")
 */
function formatAgeInYearsMonths(totalMonths) {
    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;
    return formatYearsMonths(years, months);
}

/**
 * Salvează datele evaluării Portage.
 */
/**
 * Salvează datele evaluării Portage.
 */
async function savePortageEvaluation() {
    const { evolutionData } = calendarState.getState();
    const birthDate = $('childBirthDateInput').value;
    const evalDate = $('evaluationDateInput').value;
    const client = calendarState.getClientById(currentClientId);

    if (!client || !birthDate || !evalDate) {
        showCustomAlert('Completați data nașterii și data evaluării.', 'Eroare');
        return;
    }

    const ageMonths = getAgeInMonths(birthDate, evalDate);
    
    // Calculează scorurile
    const domainScores = {};
    const domainItems = {};
    
    // Adună toate itemele relevante (nu viitoare)
    $('portageDomainsContainer').querySelectorAll('.portage-item:not(.disabled) input').forEach(cb => {
        const domain = cb.dataset.domain;
        if (!domainScores[domain]) {
            domainScores[domain] = { checked: 0 };
            domainItems[domain] = [];
        }
        domainItems[domain].push(cb);
        if (cb.checked) {
            domainScores[domain].checked++;
        }
    });

    // --- START CORECȚIE BUG SUPRASCRIERE ---
    // Ne asigurăm că întreaga structură de date există ÎNAINTE de a crea referința
    
    // 1. Asigură-te că obiectul clientului există în evolutionData
    if (!evolutionData[currentClientId]) {
        evolutionData[currentClientId] = { name: client.name, evaluations: {}, programHistory: [] };
    }
    // 2. Asigură-te că sub-obiectul `evaluations` există
    if (!evolutionData[currentClientId].evaluations) {
        evolutionData[currentClientId].evaluations = {};
    }

    // 3. Acum `clientEvals` este o referință SIGURĂ la obiectul din state care trebuie modificat
    const clientEvals = evolutionData[currentClientId].evaluations;
    
    // --- START: Asigură-te că există și structura pentru checkedItems ---
    if (!evolutionData[currentClientId].portageCheckedItems) {
        evolutionData[currentClientId].portageCheckedItems = {};
    }
    // --- END ---

    // Calculează vârsta de dezvoltare și salvează scorul
    for (const domain in domainScores) {
        const items = portrigeData[domain].filter(item => item.months <= ageMonths);
        let developmentalAge = 0;
        const checkedItemIds = []; // Array to store checked item IDs

        if (items.length > 0) {
            // (logica de calculare a vârstei rămâne neschimbată)
            const checkedItems = domainItems[domain].filter(cb => cb.checked).map(cb => cb.closest('.portage-item'));
            if(checkedItems.length > 0) {
                const lastCheckedItem = checkedItems[checkedItems.length-1];
                developmentalAge = parseInt(lastCheckedItem.dataset.months) || 0;
            }
        }

        // Collect IDs of all checked items for this domain
        domainItems[domain].forEach(cb => {
            if (cb.checked) {
                checkedItemIds.push(cb.dataset.id);
            }
        });

        const key = `Portrige - ${domain}`; // Cheia pentru grafic

        // 4. Asigură-te că domeniul (ex: "Portrige - Limbaj") există
        if (!clientEvals[key]) {
            clientEvals[key] = {};
        }

        // 5. Adaugă/Actualizează data evaluării FĂRĂ a suprascrie întregul domeniu
        clientEvals[key][evalDate] = developmentalAge;

        // --- NEW: Save the checked item IDs ---
        if (!evolutionData[currentClientId].portageCheckedItems[key]) {
            evolutionData[currentClientId].portageCheckedItems[key] = {};
        }
        evolutionData[currentClientId].portageCheckedItems[key][evalDate] = checkedItemIds;
        // --- END NEW ---
    }
    
    // `evolutionData` a fost deja modificat prin referință
    calendarState.setEvolutionData(evolutionData);
    
    // --- SFÂRȘIT CORECȚIE BUG SUPRASCRIERE ---
    
    // Salvează pe server
   try {
    await queuedSaveEvolutionData(evolutionData);
    showCustomAlert('Evaluarea Portage a fost salvată cu succes!', 'Succes');
    
    if (window.logActivity) {
        window.logActivity("Evaluare salvată", client.name, 'evaluation', currentClientId);
    }
    
    renderEvaluationReportsList(evolutionData[currentClientId], client);
    activateTab('tabGrafice');

} catch (err) {
    console.error('Eroare la salvarea evaluării:', err);
    showCustomAlert('Nu s-a putut salva evaluarea pe server.', 'Eroare');
}
}

/**
 * NOU: Salvează datele evaluării Logopedice.
 */
/**
 * Salvează datele evaluării Logopedice.
 */
async function saveLogopedicaEvaluation() {
    const { evolutionData } = calendarState.getState();
    const evalDate = $('evaluationDateInput').value;
    const client = calendarState.getClientById(currentClientId);

    if (!client || !evalDate) {
        showCustomAlert('Completați data nașterii și data evaluării.', 'Eroare');
        return;
    }

    // 1. Colectează datele din inputuri
    const scores = {};
    const inputs = document.querySelectorAll('#logopedicaFormContainer .logo-input');
    inputs.forEach(input => {
        // Salvăm doar dacă există o valoare
        if (input.value.trim() !== '') {
            scores[input.id] = input.value.trim();
        }
    });

    // 2. Colectează comentariile
    const comments = $('logoComentarii').value || '';

    // 3. Verifică dacă există date de salvat
    if (Object.keys(scores).length === 0 && comments.trim() === '') {
        showCustomAlert('Nu a fost introdusă nicio dată pentru evaluarea logopedică.', 'Atenție');
        return;
    }

    // 4. Pregătește structura de date
    if (!evolutionData[currentClientId]) {
        evolutionData[currentClientId] = { name: client.name, evaluations: {}, programHistory: [], evaluationsLogopedica: {} };
    }
    if (!evolutionData[currentClientId].evaluationsLogopedica) {
        evolutionData[currentClientId].evaluationsLogopedica = {};
    }

    // 5. Adaugă/Actualizează datele pentru data evaluării
    // Vom salva datele logopedice într-un câmp separat 'evaluationsLogopedica'
    // pentru a nu le amesteca cu datele Portage folosite pentru grafic.
    evolutionData[currentClientId].evaluationsLogopedica[evalDate] = {
        scores: scores,
        comments: comments
    };

    // 6. Actualizează starea locală
    calendarState.setEvolutionData(evolutionData);
    
    // 7. Salvează pe server
    try {
    await queuedSaveEvolutionData(evolutionData);
    showCustomAlert('Evaluarea logopedică a fost salvată cu succes!', 'Succes');

    if (window.logActivity) {
        window.logActivity("Evaluare Logopedică salvată", client.name, 'evaluation', currentClientId);
    }
    
    renderEvaluationReportsList(evolutionData[currentClientId], client);
    activateTab('tabGrafice');

} catch (err) {
    console.error('Eroare la salvarea evaluării logopedice:', err);
    showCustomAlert('Nu s-a putut salva evaluarea logopedică pe server.', 'Eroare');
}
}

// ==========================================================
// ABLLS-R EVALUATION FUNCTIONS
// ==========================================================

/**
 * Load ABLLS-R data from JSON file
 */
async function loadABLLSData() {
    if (abllsData) return abllsData;

    try {
        const response = await fetch('ablls.json');
        if (!response.ok) throw new Error('Failed to load ABLLS data');
        abllsData = await response.json();
        return abllsData;
    } catch (error) {
        console.error('Error loading ABLLS data:', error);
        showCustomAlert('Nu s-au putut încărca datele ABLLS-R', 'Eroare');
        return null;
    }
}

/**
 * Render ABLLS-R domains and items
 */
async function renderABLLSDomains() {
    const container = $('abllsDomainsContainer');
    if (!container) return;

    container.innerHTML = '<p style="text-align: center; padding: 1rem;">Se încarcă datele ABLLS-R...</p>';

    const data = await loadABLLSData();
    if (!data) {
        container.innerHTML = '<p style="text-align: center; padding: 1rem; color: red;">Eroare la încărcarea datelor ABLLS-R</p>';
        return;
    }

    const evalDate = $('evaluationDateInput').value;
    if (!evalDate) {
        container.innerHTML = '<p style="text-align: center; padding: 1rem; color: #f59e0b;">Vă rugăm selectați o dată de evaluare.</p>';
        return;
    }

    const { evolutionData } = calendarState.getState();
    const existingData = evolutionData?.[currentClientId]?.evaluationsABLLS || {};

    container.innerHTML = '';

    // Render each domain
    Object.keys(data).forEach(domainName => {
        const items = data[domainName];
        const domainKey = `ABLLS - ${domainName}`;

        // Get existing checked items for this domain and date
        const existingData_raw = existingData?.[domainKey]?.[evalDate] || [];

        // Handle backward compatibility: convert old numeric format to array
        const existingCheckedItems = Array.isArray(existingData_raw)
            ? existingData_raw
            : [];

        const block = document.createElement('div');
        block.className = 'domain-block';

        // Build items HTML with checkboxes
        let itemsHtml = '';
        items.forEach(item => {
            const isChecked = existingCheckedItems.includes(item.id);
            itemsHtml += `
                <div class="ablls-item" data-domain="${domainKey}" data-item-id="${item.id}">
                    <input type="checkbox" data-domain="${domainKey}" data-id="${item.id}" ${isChecked ? 'checked' : ''}>
                    <label><strong>${item.id}</strong> - ${item.text}</label>
                </div>
            `;
        });

        // Calculate initial score
        const initialScore = existingCheckedItems.length;

        block.innerHTML = `
            <div class="domain-header">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <input type="checkbox" class="ablls-domain-toggle" data-domain="${domainKey}" ${initialScore === items.length ? 'checked' : ''}>
                    <span>${domainName}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <span class="ablls-domain-score" data-domain="${domainKey}" style="font-weight: 600; color: var(--primary-color);">${initialScore} / ${items.length}</span>
                    <button type="button" class="domain-toggle-btn">Arată</button>
                </div>
            </div>
            <div class="checkbox-grid collapsed">${itemsHtml}</div>
        `;

        // Toggle domain visibility
        const grid = block.querySelector('.checkbox-grid');
        const toggleBtn = block.querySelector('.domain-header .domain-toggle-btn');
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            grid.classList.toggle('collapsed');
            toggleBtn.textContent = grid.classList.contains('collapsed') ? 'Arată' : 'Ascunde';
        });

        // Make entire header clickable (except checkbox and button)
        block.querySelector('.domain-header').addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
                grid.classList.toggle('collapsed');
                toggleBtn.textContent = grid.classList.contains('collapsed') ? 'Arată' : 'Ascunde';
            }
        });

        // Domain checkbox toggle - checks/unchecks all items
        const domainCheckbox = block.querySelector('.ablls-domain-toggle');
        domainCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const itemCheckboxes = block.querySelectorAll('.ablls-item input[type="checkbox"]');

            itemCheckboxes.forEach(cb => {
                cb.checked = isChecked;
                cb.closest('.ablls-item').classList.toggle('checked', isChecked);
            });

            updateABLLSDomainScore(domainKey, block);
        });

        // Individual item checkbox handlers
        block.querySelectorAll('.ablls-item').forEach(item => {
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (!checkbox) return;

            // Click on entire row toggles checkbox
            item.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT') {
                    return; // Let the checkbox handle its own click
                }
                checkbox.checked = !checkbox.checked;
                item.classList.toggle('checked', checkbox.checked);
                updateABLLSDomainScore(domainKey, block);
                updateABLLSDomainCheckbox(domainKey, block);
            });

            // Checkbox change handler
            checkbox.addEventListener('change', (e) => {
                item.classList.toggle('checked', e.target.checked);
                updateABLLSDomainScore(domainKey, block);
                updateABLLSDomainCheckbox(domainKey, block);
            });

            // Initialize checked class
            if (checkbox.checked) {
                item.classList.add('checked');
            }
        });

        container.appendChild(block);
    });
}

/**
 * Update the score display for an ABLLS domain
 */
function updateABLLSDomainScore(domainKey, block) {
    const checkboxes = block.querySelectorAll('.ablls-item input[type="checkbox"]');
    const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
    const totalCount = checkboxes.length;

    const scoreDisplay = block.querySelector(`.ablls-domain-score[data-domain="${domainKey}"]`);
    if (scoreDisplay) {
        scoreDisplay.textContent = `${checkedCount} / ${totalCount}`;
    }
}

/**
 * Update the domain checkbox state based on individual items
 */
function updateABLLSDomainCheckbox(domainKey, block) {
    const domainCheckbox = block.querySelector('.ablls-domain-toggle');
    const itemCheckboxes = block.querySelectorAll('.ablls-item input[type="checkbox"]');

    const allChecked = Array.from(itemCheckboxes).every(cb => cb.checked);
    const noneChecked = Array.from(itemCheckboxes).every(cb => !cb.checked);

    if (allChecked) {
        domainCheckbox.checked = true;
        domainCheckbox.indeterminate = false;
    } else if (noneChecked) {
        domainCheckbox.checked = false;
        domainCheckbox.indeterminate = false;
    } else {
        domainCheckbox.checked = false;
        domainCheckbox.indeterminate = true;
    }
}

/**
 * Save ABLLS-R evaluation
 */
async function saveABLLSEvaluation() {
    const { evolutionData, clients } = calendarState.getState();
    const evalDate = $('evaluationDateInput').value;

    if (!evalDate) {
        showCustomAlert('Vă rugăm selectați o dată de evaluare.', 'Eroare');
        return;
    }

    if (!currentClientId) {
        showCustomAlert('Niciun client selectat.', 'Eroare');
        return;
    }

    const client = clients.find(c => c.id === currentClientId);
    if (!client) {
        showCustomAlert('Clientul nu a fost găsit.', 'Eroare');
        return;
    }

    // Collect checked items for each domain
    const container = $('abllsDomainsContainer');
    const domains = {};

    // Get all domain blocks
    container.querySelectorAll('.domain-block').forEach(block => {
        // Get domain name from the first checkbox
        const firstCheckbox = block.querySelector('.ablls-item input[type="checkbox"]');
        if (!firstCheckbox) return;

        const domainKey = firstCheckbox.dataset.domain;
        const checkedItems = [];

        // Collect all checked item IDs
        block.querySelectorAll('.ablls-item input[type="checkbox"]:checked').forEach(cb => {
            checkedItems.push(cb.dataset.id);
        });

        domains[domainKey] = checkedItems;
    });

    // Initialize structure if needed
    if (!evolutionData[currentClientId]) {
        evolutionData[currentClientId] = {};
    }
    if (!evolutionData[currentClientId].evaluationsABLLS) {
        evolutionData[currentClientId].evaluationsABLLS = {};
    }

    // Save checked items for each domain
    Object.keys(domains).forEach(domain => {
        if (!evolutionData[currentClientId].evaluationsABLLS[domain]) {
            evolutionData[currentClientId].evaluationsABLLS[domain] = {};
        }
        evolutionData[currentClientId].evaluationsABLLS[domain][evalDate] = domains[domain];
    });

    // Update state
    calendarState.setEvolutionData(evolutionData);

    // Save to server
    try {
        await queuedSaveEvolutionData(evolutionData);
        showCustomAlert('Evaluarea ABLLS-R a fost salvată cu succes!', 'Succes');

        if (window.logActivity) {
            window.logActivity("Evaluare ABLLS-R salvată", client.name, 'evaluation', currentClientId);
        }

        renderEvaluationReportsList(evolutionData[currentClientId], client);
        activateTab('tabGrafice');
    } catch (err) {
        console.error('Eroare la salvarea evaluării ABLLS-R:', err);
        showCustomAlert('Nu s-a putut salva evaluarea ABLLS-R pe server.', 'Eroare');
    }
}

// =============================================================================
// VB-MAPP EVALUATION FUNCTIONS
// =============================================================================

/**
 * Load VB-MAPP data from JSON file
 */
let vbmappData = null;
async function loadVBMAPPData() {
    if (vbmappData) return vbmappData;

    try {
        const response = await fetch('vbmapp.json');
        vbmappData = await response.json();
        return vbmappData;
    } catch (error) {
        console.error('Eroare la încărcarea datelor VB-MAPP:', error);
        showCustomAlert('Nu s-au putut încărca datele VB-MAPP.', 'Eroare');
        return null;
    }
}

/**
 * Render VB-MAPP components (Milestones, Barriers, Transition)
 */
async function renderVBMAPPComponents() {
    const container = $('vbmappComponentsContainer');
    if (!container) return;

    const data = await loadVBMAPPData();
    if (!data) return;

    // Get birth date and evaluation date for age filtering
    const birthDate = $('childBirthDateInput')?.value;
    const evalDate = $('evaluationDateInput')?.value;

    if (!birthDate) {
        container.innerHTML = '<p>Introduceți data nașterii pentru a afișa itemii VB-MAPP.</p>';
        return;
    }

    const ageMonths = getAgeInMonths(birthDate, evalDate);

    // Get current client and evaluation data
    // Only load existing scores if we're in edit mode
    const { evolutionData } = calendarState.getState();
    const clientData = evolutionData?.[currentClientId];
    const existingScores = isEditingEvaluation
        ? (clientData?.evaluationsVBMAPP?.[evalDate] || {})
        : {};

    let html = '<div class="vbmapp-container">';

    // =========================
    // MILESTONES ASSESSMENT
    // =========================
    html += '<div class="vbmapp-section">';
    html += '<h3 class="vbmapp-section-title">Jaloane (Milestones)</h3>';

    // Level 1
    html += renderVBMAPPLevel(data.milestones.level1, 'level1', existingScores.milestones?.level1, ageMonths);

    // Level 2
    html += renderVBMAPPLevel(data.milestones.level2, 'level2', existingScores.milestones?.level2, ageMonths);

    // Level 3
    html += renderVBMAPPLevel(data.milestones.level3, 'level3', existingScores.milestones?.level3, ageMonths);

    html += '</div>';

    // =========================
    // BARRIERS ASSESSMENT
    // =========================
    html += '<div class="vbmapp-section">';
    html += '<h3 class="vbmapp-section-title">Bariere (Barriers)</h3>';

    // Collapsible container for barriers
    html += `
        <div class="domain-block">
            <div class="domain-header">
                <span>Bariere în Învățare</span>
                <button type="button" class="domain-toggle-btn">Arată</button>
            </div>
            <div class="vbmapp-items-grid collapsed">
    `;

    data.barriers.items.forEach(item => {
        const score = existingScores.barriers?.[item.id];
        html += `
            <div class="vbmapp-item">
                <div class="vbmapp-item-text">${item.text}</div>
                <div class="vbmapp-score-selector">
                    ${renderScoreButtons(item.id, 'barrier', score)}
                </div>
            </div>
        `;
    });

    html += '</div></div></div>';

    // =========================
    // TRANSITION ASSESSMENT
    // =========================
    html += '<div class="vbmapp-section">';
    html += '<h3 class="vbmapp-section-title">Tranziție (Transition)</h3>';

    // Collapsible container for transition
    html += `
        <div class="domain-block">
            <div class="domain-header">
                <span>Pregătire pentru Tranziție</span>
                <button type="button" class="domain-toggle-btn">Arată</button>
            </div>
            <div class="vbmapp-items-grid collapsed">
    `;

    data.transition.items.forEach(item => {
        const score = existingScores.transition?.[item.id];
        html += `
            <div class="vbmapp-item">
                <div class="vbmapp-item-text">${item.text}</div>
                <div class="vbmapp-score-selector">
                    ${renderScoreButtons(item.id, 'transition', score)}
                </div>
            </div>
        `;
    });

    html += '</div></div></div>';

    // =========================
    // TASK ANALYSIS
    // =========================
    html += '<div class="vbmapp-section">';
    html += '<h3 class="vbmapp-section-title">Analiză Sarcină (Task Analysis)</h3>';

    // Collapsible container for task analysis
    html += `
        <div class="domain-block">
            <div class="domain-header">
                <span>Descompunerea sarcinilor în pași</span>
                <button type="button" class="domain-toggle-btn">Arată</button>
            </div>
            <div class="vbmapp-items-grid collapsed">
    `;

    data.taskAnalysis.items.forEach(item => {
        const score = existingScores.taskAnalysis?.[item.id];
        html += `
            <div class="vbmapp-item">
                <div class="vbmapp-item-text">${item.text}</div>
                <div class="vbmapp-score-selector">
                    ${renderScoreButtons(item.id, 'taskAnalysis', score)}
                </div>
            </div>
        `;
    });

    html += '</div></div></div>';

    // =========================
    // IEP OBJECTIVES
    // =========================
    html += '<div class="vbmapp-section">';
    html += '<h3 class="vbmapp-section-title">Obiective IEP</h3>';

    // Collapsible container for IEP objectives
    html += `
        <div class="domain-block">
            <div class="domain-header">
                <span>Obiective Educaționale Individualizate</span>
                <button type="button" class="domain-toggle-btn">Arată</button>
            </div>
            <div class="vbmapp-items-grid collapsed">
    `;

    data.iepObjectives.items.forEach(item => {
        const score = existingScores.iepObjectives?.[item.id];
        html += `
            <div class="vbmapp-item">
                <div class="vbmapp-item-text">${item.text}</div>
                <div class="vbmapp-score-selector">
                    ${renderScoreButtons(item.id, 'iepObjectives', score)}
                </div>
            </div>
        `;
    });

    html += '</div></div></div>';
    html += '</div>';

    container.innerHTML = html;

    // Add event listeners for score buttons
    container.querySelectorAll('.vbmapp-score-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const itemId = this.dataset.itemId;
            const itemType = this.dataset.itemType;
            const score = parseInt(this.dataset.score);

            // Update button styles
            const parentSelector = this.closest('.vbmapp-score-selector');
            parentSelector.querySelectorAll('.vbmapp-score-btn').forEach(b => b.classList.remove('selected'));
            this.classList.add('selected');
        });
    });

    // Add toggle functionality for collapsible sections
    container.querySelectorAll('.domain-block').forEach(block => {
        const header = block.querySelector('.domain-header');
        const grid = block.querySelector('.vbmapp-items-grid');
        const toggleBtn = block.querySelector('.domain-toggle-btn');

        const toggleSection = () => {
            grid.classList.toggle('collapsed');
            toggleBtn.textContent = grid.classList.contains('collapsed') ? 'Arată' : 'Ascunde';
        };

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSection();
        });

        header.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON') {
                toggleSection();
            }
        });
    });

    // Add toggle functionality for future items
    container.querySelectorAll('.vbmapp-future-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const futureItemsContainer = btn.closest('.vbmapp-items-grid').querySelector('.vbmapp-future-items');
            if (futureItemsContainer) {
                futureItemsContainer.classList.toggle('collapsed');
                btn.textContent = futureItemsContainer.classList.contains('collapsed') ? 'Arată iteme viitoare' : 'Ascunde iteme viitoare';
            }
        });
    });
}

/**
 * Render a VB-MAPP level (helper function)
 */
function renderVBMAPPLevel(levelData, levelKey, existingScores = {}, ageMonths = 999) {
    let html = `<div class="vbmapp-level">`;
    html += `<h4 class="vbmapp-level-title">${levelData.name}</h4>`;

    // Render each area within the level
    for (const [areaKey, areaData] of Object.entries(levelData.areas)) {
        // Check if area has any items within child's age
        const currentAgeItems = areaData.items.filter(item => item.months <= ageMonths);
        const futureItems = areaData.items.filter(item => item.months > ageMonths);
        const hasFutureItems = futureItems.length > 0;

        html += `<div class="domain-block vbmapp-area">`;
        html += `
            <div class="domain-header">
                <span>${areaData.name}</span>
                <button type="button" class="domain-toggle-btn">Arată</button>
            </div>
        `;
        html += `<div class="vbmapp-items-grid collapsed">`;

        // Render current age items
        currentAgeItems.forEach(item => {
            const score = existingScores?.[areaKey]?.[item.id];
            const ageInfo = item.months ? ` <i>(${item.months} luni)</i>` : '';
            html += `
                <div class="vbmapp-item">
                    <div class="vbmapp-item-text">${item.text}${ageInfo}</div>
                    <div class="vbmapp-score-selector">
                        ${renderScoreButtons(item.id, `milestone-${levelKey}-${areaKey}`, score)}
                    </div>
                </div>
            `;
        });

        // Render future items warning and collapsed section
        if (hasFutureItems) {
            const ageYearsMonths = formatAgeInYearsMonths(ageMonths);
            html += `
                <div class="portage-future-warning">
                    <p>Unele iteme sunt pentru vârste mai mari decât ${ageYearsMonths}.</p>
                    <button type="button" class="domain-toggle-btn vbmapp-future-toggle">Arată iteme viitoare</button>
                </div>
                <div class="vbmapp-future-items collapsed">
            `;

            futureItems.forEach(item => {
                const score = existingScores?.[areaKey]?.[item.id];
                const ageInfo = item.months ? ` <i>(${item.months} luni)</i>` : '';
                html += `
                    <div class="vbmapp-item disabled">
                        <div class="vbmapp-item-text">${item.text}${ageInfo}</div>
                        <div class="vbmapp-score-selector">
                            ${renderScoreButtons(item.id, `milestone-${levelKey}-${areaKey}`, score, true)}
                        </div>
                    </div>
                `;
            });

            html += `</div>`; // Close vbmapp-future-items
        }

        html += `</div></div>`; // Close vbmapp-items-grid and domain-block
    }

    html += `</div>`;
    return html;
}

/**
 * Render score buttons (0-5 scale) for an item
 */
function renderScoreButtons(itemId, itemType, currentScore = null, disabled = false) {
    let html = '';
    for (let score = 0; score <= 5; score++) {
        // Only mark as selected if currentScore is explicitly set to this score
        const isSelected = (currentScore !== null && currentScore !== undefined && score === currentScore) ? 'selected' : '';
        const disabledAttr = disabled ? 'disabled' : '';
        html += `<button type="button" class="vbmapp-score-btn ${isSelected}" ${disabledAttr}
                        data-item-id="${itemId}"
                        data-item-type="${itemType}"
                        data-score="${score}">${score}</button>`;
    }
    return html;
}

/**
 * Save VB-MAPP evaluation
 */
async function saveVBMAPPEvaluation() {
    const { evolutionData, clients } = calendarState.getState();
    const evalDate = $('evaluationDateInput').value;
    const client = clients.find(c => c.id === currentClientId);

    if (!client || !evalDate) {
        showCustomAlert('Completați data nașterii și data evaluării.', 'Eroare');
        return;
    }

    // Collect scores from the UI
    const scores = {
        milestones: {
            level1: {},
            level2: {},
            level3: {}
        },
        barriers: {},
        transition: {},
        taskAnalysis: {},
        iepObjectives: {}
    };

    // Collect all selected scores
    const selectedButtons = document.querySelectorAll('.vbmapp-score-btn.selected');
    selectedButtons.forEach(btn => {
        const itemId = btn.dataset.itemId;
        const itemType = btn.dataset.itemType;
        const score = parseInt(btn.dataset.score);

        if (itemType.startsWith('milestone-')) {
            // Parse milestone type: milestone-level1-mand
            const parts = itemType.split('-');
            const level = parts[1]; // level1, level2, level3
            const area = parts[2];  // mand, tact, etc.

            if (!scores.milestones[level][area]) {
                scores.milestones[level][area] = {};
            }
            scores.milestones[level][area][itemId] = score;
        } else if (itemType === 'barrier') {
            scores.barriers[itemId] = score;
        } else if (itemType === 'transition') {
            scores.transition[itemId] = score;
        } else if (itemType === 'taskAnalysis') {
            scores.taskAnalysis[itemId] = score;
        } else if (itemType === 'iepObjectives') {
            scores.iepObjectives[itemId] = score;
        }
    });

    // Initialize evolution data for client if not exists
    if (!evolutionData[currentClientId]) {
        evolutionData[currentClientId] = {
            name: client.name,
            evaluations: {},
            evaluationsABLLS: {},
            evaluationsLogopedica: {},
            evaluationsVBMAPP: {},
            portageCheckedItems: {},
            programHistory: [],
            monthlyThemes: {}
        };
    }

    if (!evolutionData[currentClientId].evaluationsVBMAPP) {
        evolutionData[currentClientId].evaluationsVBMAPP = {};
    }

    // Save the scores
    evolutionData[currentClientId].evaluationsVBMAPP[evalDate] = scores;

    // Update state
    calendarState.setEvolutionData(evolutionData);

    // Save to server
    try {
        await queuedSaveEvolutionData(evolutionData);
        showCustomAlert('Evaluarea VB-MAPP a fost salvată cu succes!', 'Succes');

        if (window.logActivity) {
            window.logActivity("Evaluare VB-MAPP salvată", client.name, 'evaluation', currentClientId);
        }

        // Set current evaluation type to VB-MAPP
        currentEvaluationType = 'vbmapp';

        // Update button states
        $('showPortageChart')?.classList.remove('active');
        $('showABLLSChart')?.classList.remove('active');
        $('showVBMAPPChart')?.classList.add('active');

        // Render VB-MAPP chart with summary
        renderVBMAPPChart(evolutionData[currentClientId]);

        activateTab('tabGrafice');
    } catch (err) {
        console.error('Eroare la salvarea evaluării VB-MAPP:', err);
        showCustomAlert('Nu s-a putut salva evaluarea VB-MAPP pe server.', 'Eroare');
    }
}

/**
 * Render VB-MAPP evolution chart
 */
function renderVBMAPPChart(clientData) {
    const chartCanvas = $('evolutionChart');
    if (!chartCanvas) return;

    const evaluations = clientData.evaluationsVBMAPP || {};

    if (Object.keys(evaluations).length === 0) {
        chartCanvas.style.display = 'none';
        $('evolutionSummary').innerHTML = '<p class="no-data">Nu există evaluări VB-MAPP salvate pentru acest client.</p>';
        return;
    }

    chartCanvas.style.display = 'block';

    // Sort dates
    const dates = Object.keys(evaluations).sort((a, b) => new Date(a) - new Date(b));

    // Calculate total scores for each date
    const datasets = [];

    // Milestones total score
    const milestonesScores = dates.map(date => {
        const evalData = evaluations[date];
        let total = 0;
        let count = 0;

        // Sum up all milestone scores
        ['level1', 'level2', 'level3'].forEach(level => {
            if (evalData.milestones && evalData.milestones[level]) {
                Object.values(evalData.milestones[level]).forEach(area => {
                    Object.values(area).forEach(score => {
                        total += score;
                        count++;
                    });
                });
            }
        });

        return count > 0 ? (total / count).toFixed(2) : 0;
    });

    datasets.push({
        label: 'Milestones (Average)',
        data: milestonesScores,
        borderColor: '#4CAF50',
        backgroundColor: 'rgba(76, 175, 80, 0.1)',
        tension: 0.3
    });

    // Barriers total score
    const barriersScores = dates.map(date => {
        const evalData = evaluations[date];
        if (!evalData.barriers) return 0;

        const scores = Object.values(evalData.barriers);
        const total = scores.reduce((sum, s) => sum + s, 0);
        return scores.length > 0 ? (total / scores.length).toFixed(2) : 0;
    });

    datasets.push({
        label: 'Barriers (Average)',
        data: barriersScores,
        borderColor: '#FF9800',
        backgroundColor: 'rgba(255, 152, 0, 0.1)',
        tension: 0.3
    });

    // Transition total score
    const transitionScores = dates.map(date => {
        const evalData = evaluations[date];
        if (!evalData.transition) return 0;

        const scores = Object.values(evalData.transition);
        const total = scores.reduce((sum, s) => sum + s, 0);
        return scores.length > 0 ? (total / scores.length).toFixed(2) : 0;
    });

    datasets.push({
        label: 'Transition (Average)',
        data: transitionScores,
        borderColor: '#2196F3',
        backgroundColor: 'rgba(33, 150, 243, 0.1)',
        tension: 0.3
    });

    // Task Analysis total score
    const taskAnalysisScores = dates.map(date => {
        const evalData = evaluations[date];
        if (!evalData.taskAnalysis) return 0;

        const scores = Object.values(evalData.taskAnalysis);
        const total = scores.reduce((sum, s) => sum + s, 0);
        return scores.length > 0 ? (total / scores.length).toFixed(2) : 0;
    });

    datasets.push({
        label: 'Task Analysis (Average)',
        data: taskAnalysisScores,
        borderColor: '#9C27B0',
        backgroundColor: 'rgba(156, 39, 176, 0.1)',
        tension: 0.3
    });

    // IEP Objectives total score
    const iepObjectivesScores = dates.map(date => {
        const evalData = evaluations[date];
        if (!evalData.iepObjectives) return 0;

        const scores = Object.values(evalData.iepObjectives);
        const total = scores.reduce((sum, s) => sum + s, 0);
        return scores.length > 0 ? (total / scores.length).toFixed(2) : 0;
    });

    datasets.push({
        label: 'IEP Objectives (Average)',
        data: iepObjectivesScores,
        borderColor: '#E91E63',
        backgroundColor: 'rgba(233, 30, 99, 0.1)',
        tension: 0.3
    });

    // Destroy existing chart
    if (window.evolutionChartInstance) {
        window.evolutionChartInstance.destroy();
    }

    // Create new chart
    const ctx = chartCanvas.getContext('2d');
    window.evolutionChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates.map(d => new Date(d).toLocaleDateString('ro-RO')),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'VB-MAPP - Evoluție Scoruri Medii',
                    font: { size: 16 }
                },
                legend: {
                    display: true,
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 5,
                    title: {
                        display: true,
                        text: 'Scor Mediu (0-5)'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Data Evaluării'
                    }
                }
            }
        }
    });

    // Render summary table and download buttons
    renderVBMAPPSummary(evaluations, dates);

    // Get client for download buttons
    const client = calendarState.getClientById(currentClientId);
    if (client) {
        appendEvaluationDownloadButtons(currentClientId);
    }
}

/**
 * Render VB-MAPP summary table
 */
function renderVBMAPPSummary(evaluations, dates) {
    const summaryDiv = $('evolutionSummary');
    if (!summaryDiv) return;

    let html = '<h3 class="evolution-summary-title">Evoluție Generală VB-MAPP</h3>';
    html += '<div class="evolution-table-container" style="margin-top: 0; padding-top: 0;">';
    html += '<table class="evolution-table">';
    html += '<thead><tr>';
    html += '<th>Data Evaluării</th>';
    html += '<th>Milestones</th>';
    html += '<th>Barriers</th>';
    html += '<th>Transition</th>';
    html += '<th>Task Analysis</th>';
    html += '<th>IEP Objectives</th>';
    html += '</tr></thead><tbody>';

    dates.forEach(date => {
        const evalData = evaluations[date];

        // Calculate averages
        let milestonesAvg = 0, milestonesCount = 0;
        ['level1', 'level2', 'level3'].forEach(level => {
            if (evalData.milestones?.[level]) {
                Object.values(evalData.milestones[level]).forEach(area => {
                    Object.values(area).forEach(score => {
                        milestonesAvg += score;
                        milestonesCount++;
                    });
                });
            }
        });
        milestonesAvg = milestonesCount > 0 ? (milestonesAvg / milestonesCount).toFixed(2) : '-';

        let barriersAvg = 0;
        const barriersScores = evalData.barriers ? Object.values(evalData.barriers) : [];
        if (barriersScores.length > 0) {
            barriersAvg = (barriersScores.reduce((sum, s) => sum + s, 0) / barriersScores.length).toFixed(2);
        } else {
            barriersAvg = '-';
        }

        let transitionAvg = 0;
        const transitionScores = evalData.transition ? Object.values(evalData.transition) : [];
        if (transitionScores.length > 0) {
            transitionAvg = (transitionScores.reduce((sum, s) => sum + s, 0) / transitionScores.length).toFixed(2);
        } else {
            transitionAvg = '-';
        }

        let taskAnalysisAvg = 0;
        const taskAnalysisScores = evalData.taskAnalysis ? Object.values(evalData.taskAnalysis) : [];
        if (taskAnalysisScores.length > 0) {
            taskAnalysisAvg = (taskAnalysisScores.reduce((sum, s) => sum + s, 0) / taskAnalysisScores.length).toFixed(2);
        } else {
            taskAnalysisAvg = '-';
        }

        let iepObjectivesAvg = 0;
        const iepObjectivesScores = evalData.iepObjectives ? Object.values(evalData.iepObjectives) : [];
        if (iepObjectivesScores.length > 0) {
            iepObjectivesAvg = (iepObjectivesScores.reduce((sum, s) => sum + s, 0) / iepObjectivesScores.length).toFixed(2);
        } else {
            iepObjectivesAvg = '-';
        }

        html += `<tr>`;
        html += `<td data-label="Data">${new Date(date).toLocaleDateString('ro-RO')}</td>`;
        html += `<td data-label="Milestones">${milestonesAvg}</td>`;
        html += `<td data-label="Barriers">${barriersAvg}</td>`;
        html += `<td data-label="Transition">${transitionAvg}</td>`;
        html += `<td data-label="Task Analysis">${taskAnalysisAvg}</td>`;
        html += `<td data-label="IEP Objectives">${iepObjectivesAvg}</td>`;
        html += `</tr>`;
    });

    html += '</tbody></table></div>';
    summaryDiv.innerHTML = html;
}

/**
 * Append evaluation download buttons to the evolutionSummary container
 */
function appendEvaluationDownloadButtons(clientId) {
    const summaryDiv = $('evolutionSummary');
    if (!summaryDiv) return;

    const { evolutionData } = calendarState.getState();
    const clientData = evolutionData?.[clientId];
    if (!clientData) return;

    const allEvaluations = [];

    // Collect all evaluations (Portage, Logopedic, ABLLS, VB-MAPP)
    if (clientData.evaluations) {
        Object.keys(clientData.evaluations).forEach(domain => {
            Object.keys(clientData.evaluations[domain]).forEach(date => {
                if (!allEvaluations.some(e => e.type === 'portage' && e.date === date)) {
                    allEvaluations.push({
                        type: 'portage',
                        date: date,
                        title: 'Evaluare Portage'
                    });
                }
            });
        });
    }

    if (clientData.evaluationsLogopedica) {
        Object.keys(clientData.evaluationsLogopedica).forEach(date => {
            allEvaluations.push({
                type: 'logopedica',
                date: date,
                title: 'Evaluare Logopedică'
            });
        });
    }

    if (clientData.evaluationsABLLS) {
        const abllsDates = new Set();
        Object.keys(clientData.evaluationsABLLS).forEach(domain => {
            Object.keys(clientData.evaluationsABLLS[domain]).forEach(date => {
                abllsDates.add(date);
            });
        });
        abllsDates.forEach(date => {
            allEvaluations.push({
                type: 'ablls',
                date: date,
                title: 'Evaluare ABLLS-R'
            });
        });
    }

    if (clientData.evaluationsVBMAPP) {
        Object.keys(clientData.evaluationsVBMAPP).forEach(date => {
            allEvaluations.push({
                type: 'vbmapp',
                date: date,
                title: 'Evaluare VB-MAPP'
            });
        });
    }

    // Sort evaluations (newest first)
    allEvaluations.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (allEvaluations.length === 0) {
        return;
    }

    // Generate buttons HTML
    const buttonsHTML = allEvaluations.map(ev => {
        const formattedDate = new Date(ev.date).toLocaleDateString('ro-RO', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        });

        let icon;
        if (ev.type === 'portage') {
            icon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9l-5 5-4-4-6 6"/></svg>';
        } else if (ev.type === 'ablls') {
            icon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
        } else if (ev.type === 'vbmapp') {
            icon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>';
        } else {
            icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-megaphone" viewBox="0 0 16 16"><path d="M13 2.5a1.5 1.5 0 0 1 3 0v11a1.5 1.5 0 0 1-3 0v-.214c-2.162-1.241-4.49-1.843-6.912-2.083l.405 2.712A1 1 0 0 1 5.51 15.1h-.548a1 1 0 0 1-.916-.599l-1.85-3.49-.202-.003A2.014 2.014 0 0 1 0 9V7a2.02 2.02 0 0 1 1.992-2.013 75 75 0 0 0 2.483-.075c3.043-.154 6.148-.849 8.525-2.199zm1 0v11a.5.5 0 0 0 1 0v-11a.5.5 0 0 0-1 0m-1 1.35c-2.344 1.205-5.209 1.842-8 2.033v4.233q.27.015.537.036c2.568.189 5.093.744 7.463 1.993zm-9 6.215v-4.13a95 95 0 0 1-1.992.052A1.02 1.02 0 0 0 1 7v2c0 .55.448 1.002 1.006 1.009A61 61 0 0 1 4 10.065m-.657.975 1.609 3.037.01.024h.548l-.002-.014-.443-2.966a68 68 0 0 0-1.722-.082z"/></svg>';
        }

        return `
            <div class="evaluation-report-item">
                <button class="btn btn-action-text evaluation-report-button" data-type="${ev.type}" data-date="${ev.date}">
                    ${icon}
                    <span>${ev.title} - ${formattedDate}</span>
                </button>
                <div class="evaluation-report-actions">
                    <button class="btn-icon-small evaluation-edit-btn" data-type="${ev.type}" data-date="${ev.date}" title="Editează evaluarea">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn-icon-small evaluation-remove-btn" data-type="${ev.type}" data-date="${ev.date}" title="Șterge evaluarea">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Append the download buttons section
    const downloadSection = `
        <h3 class="evolution-summary-title">Rapoarte Evaluări Salvate</h3>
        <div class="evaluation-report-list">
            ${buttonsHTML}
        </div>
    `;

    summaryDiv.innerHTML += downloadSection;

    // Re-attach event listeners for the buttons
    summaryDiv.querySelectorAll('.evaluation-report-button, .evaluation-edit-btn, .evaluation-remove-btn').forEach(btn => {
        btn.addEventListener('click', handleEvaluationReportClick);
    });
}


// --- Inițializare Event Listeners ---

// Listeners pentru modalul principal de evoluție
$('closeEvolutionModal')?.addEventListener('click', closeEvolutionModal);
evolutionModal?.addEventListener('click', (e) => {
    if (e.target === evolutionModal) closeEvolutionModal();
});
document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// Listeners pentru switch-ul de tip evaluare în grafice
$('showPortageChart')?.addEventListener('click', () => {
    currentEvaluationType = 'portage';

    // Update button styles
    $('showPortageChart')?.classList.add('active');
    $('showABLLSChart')?.classList.remove('active');
    $('showVBMAPPChart')?.classList.remove('active');

    // Re-render chart and summary
    const { evolutionData } = calendarState.getState();
    const client = calendarState.getClientById(currentClientId);
    if (evolutionData && currentClientId && evolutionData[currentClientId]) {
        renderEvolutionChart(evolutionData[currentClientId]);
        renderEvaluationReportsList(evolutionData[currentClientId], client);
    }
});

$('showABLLSChart')?.addEventListener('click', () => {
    currentEvaluationType = 'ablls';

    // Update button styles
    $('showPortageChart')?.classList.remove('active');
    $('showABLLSChart')?.classList.add('active');
    $('showVBMAPPChart')?.classList.remove('active');

    // Re-render chart and summary
    const { evolutionData } = calendarState.getState();
    const client = calendarState.getClientById(currentClientId);
    if (evolutionData && currentClientId && evolutionData[currentClientId]) {
        renderABLLSChart(evolutionData[currentClientId]);
        renderEvaluationReportsList(evolutionData[currentClientId], client);
    }
});

$('showVBMAPPChart')?.addEventListener('click', () => {
    currentEvaluationType = 'vbmapp';

    // Update button styles
    $('showPortageChart')?.classList.remove('active');
    $('showABLLSChart')?.classList.remove('active');
    $('showVBMAPPChart')?.classList.add('active');

    // Re-render chart and summary
    const { evolutionData } = calendarState.getState();
    const client = calendarState.getClientById(currentClientId);
    if (evolutionData && currentClientId && evolutionData[currentClientId]) {
        // renderVBMAPPChart already handles the summary and download buttons
        renderVBMAPPChart(evolutionData[currentClientId]);
    }
});

// Listeners pentru tab-ul de evaluare
$('childBirthDateInput')?.addEventListener('change', () => {
    updateChildAgeDisplay($('childBirthDateInput').value);
    renderPortageDomains();
});

// Listener pentru salvarea temei lunare
$('saveMonthlyThemeBtn')?.addEventListener('click', saveMonthlyTheme);

$('evaluationDateInput')?.addEventListener('change', () => {
    updateChildAgeDisplay($('childBirthDateInput').value);
    renderPortageDomains();
});
$('saveEvaluationBtn')?.addEventListener('click', (e) => {
    e.preventDefault();

    const selectedType = $('evaluationTypeSelect').value;

    if (selectedType === 'portage') {
        savePortageEvaluation(); // Apelăm funcția existentă pentru Portage
    } else if (selectedType === 'logopedica') {
        saveLogopedicaEvaluation();
    } else if (selectedType === 'ablls') {
        saveABLLSEvaluation();
    } else if (selectedType === 'vbmapp') {
        saveVBMAPPEvaluation();
    }
});
$('cancelEvaluationBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    activateTab('tabGrafice'); // Revino la grafice
});

//Listener pentru dropdown-ul de tip evaluare
const evalTypeSelect = $('evaluationTypeSelect');
if (evalTypeSelect) {
    evalTypeSelect.addEventListener('change', (e) => {
        const selectedType = e.target.value;
        const portageContainer = $('portageFormContainer');
        const logopedicaContainer = $('logopedicaFormContainer');
        const abllsContainer = $('abllsFormContainer');
        const vbmappContainer = $('vbmappFormContainer');

        if (selectedType === 'portage') {
            if (portageContainer) portageContainer.style.display = 'block';
            if (logopedicaContainer) logopedicaContainer.style.display = 'none';
            if (abllsContainer) abllsContainer.style.display = 'none';
            if (vbmappContainer) vbmappContainer.style.display = 'none';
        } else if (selectedType === 'logopedica') {
            if (portageContainer) portageContainer.style.display = 'none';
            if (logopedicaContainer) logopedicaContainer.style.display = 'block';
            if (abllsContainer) abllsContainer.style.display = 'none';
            if (vbmappContainer) vbmappContainer.style.display = 'none';
        } else if (selectedType === 'ablls') {
            if (portageContainer) portageContainer.style.display = 'none';
            if (logopedicaContainer) logopedicaContainer.style.display = 'none';
            if (abllsContainer) abllsContainer.style.display = 'block';
            if (vbmappContainer) vbmappContainer.style.display = 'none';
            renderABLLSDomains();
        } else if (selectedType === 'vbmapp') {
            if (portageContainer) portageContainer.style.display = 'none';
            if (logopedicaContainer) logopedicaContainer.style.display = 'none';
            if (abllsContainer) abllsContainer.style.display = 'none';
            if (vbmappContainer) vbmappContainer.style.display = 'block';
            renderVBMAPPComponents();
        }
    });
}