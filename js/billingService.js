/**
 * js/billingService.js
 *
 * Gestionează logica pentru noua secțiune de Facturare.
 * Calculează orele, totalurile și gestionează încasările.
 */

import { calendarState } from './calendarState.js';
import * as api from './apiService.js';
import { showCustomAlert, showCustomConfirm } from './uiService.js';

// --- Constante ---

const $ = (id) => document.getElementById(id);

// --- Stare locală ---
let currentBillingDate = new Date(); // Începe cu luna curentă

// --- Elemente DOM ---
const dom = {
    section: $('billingSection'),
    clientList: $('billingClientList'),
    prevBtn: $('billingPrevMonth'),
    nextBtn: $('billingNextMonth'),
    currentMonthLabel: $('billingCurrentMonth'),
    billingSearchBar: $('billingSearchBar'),

    // Discount Thresholds
    discountThresholdsHeader: $('discountThresholdsHeader'),
    discountThresholdsContent: $('discountThresholdsContent'),
    discountThresholdsToggleIcon: $('discountThresholdsToggleIcon'),
    discountThresholdsList: $('discountThresholdsList'),
    addDiscountThresholdBtn: $('addDiscountThresholdBtn'),
    saveDiscountThresholdsBtn: $('saveDiscountThresholdsBtn'),

    // Modal Plată
    paymentModal: $('paymentModal'),
    paymentForm: $('paymentForm'),
    closePaymentModalBtn: $('closePaymentModal'),
    cancelPaymentBtn: $('cancelPaymentBtn'),
    paymentClientId: $('paymentClientId'),
    paymentMonthKey: $('paymentMonthKey'),
    paymentDate: $('paymentDate'),
    paymentAmount: $('paymentAmount'),
    paymentNotes: $('paymentNotes'),
    paymentModalTitle: $('paymentModalTitle'),

    // Modal Abonament
    subscriptionModal: $('subscriptionModal'),
    subscriptionForm: $('subscriptionForm'),
    closeSubscriptionModalBtn: $('closeSubscriptionModal'),
    cancelSubscriptionBtn: $('cancelSubscriptionBtn'),
    subscriptionClientId: $('subscriptionClientId'),
    subscriptionAmount: $('subscriptionAmount'),
    activateSubscriptionBtn: $('activateSubscriptionBtn'),
    deactivateSubscriptionBtn: $('deactivateSubscriptionBtn'),
    subscriptionStatus: $('subscriptionStatus'),
};

/**
 * Inițializează ascultătorii de evenimente pentru secțiunea de facturare.
 * Chemată din main.js.
 */
export function init() {
    if (!dom.section) return; // Nu inițializa dacă secțiunea nu există

    dom.prevBtn.addEventListener('click', () => navigateBillingMonth(-1));
    dom.nextBtn.addEventListener('click', () => navigateBillingMonth(1));
    dom.billingSearchBar.addEventListener('input', () => renderBillingView());

    // Discount thresholds listeners
    dom.discountThresholdsHeader.addEventListener('click', toggleDiscountThresholdsSection);
    dom.addDiscountThresholdBtn.addEventListener('click', handleAddThreshold);
    dom.saveDiscountThresholdsBtn.addEventListener('click', handleSaveThresholds);

    // Render initial discount thresholds
    renderDiscountThresholds();

    // Ascultători pentru modalul de plată
    dom.closePaymentModalBtn.addEventListener('click', closePaymentModal);
    dom.cancelPaymentBtn.addEventListener('click', closePaymentModal);
    dom.paymentModal.addEventListener('click', (e) => {
        if (e.target === dom.paymentModal) closePaymentModal();
    });
    dom.paymentForm.addEventListener('submit', handleSavePayment);

    // Ascultători pentru modalul de abonament
    dom.closeSubscriptionModalBtn.addEventListener('click', closeSubscriptionModal);
    dom.cancelSubscriptionBtn.addEventListener('click', closeSubscriptionModal);
    dom.subscriptionModal.addEventListener('click', (e) => {
        if (e.target === dom.subscriptionModal) closeSubscriptionModal();
    });
    dom.subscriptionForm.addEventListener('submit', handleActivateSubscription);
    dom.deactivateSubscriptionBtn.addEventListener('click', handleDeactivateSubscription);

    // Ascultător principal pentru acțiunile din listă (delegare evenimente)
    dom.clientList.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('[data-action]');
        if (!actionBtn) return;

        const action = actionBtn.dataset.action;
        const card = actionBtn.closest('.billing-card');
        const clientId = card.dataset.clientId;
        const monthKey = card.dataset.monthKey;

        if (action === 'add-payment') {
            openPaymentModal(clientId, monthKey);
        } else if (action === 'delete-payment') {
            const paymentId = actionBtn.dataset.paymentId;
            handleDeletePayment(clientId, monthKey, paymentId);
        } else if (action === 'manage-subscription') {
            openSubscriptionModal(clientId);
        }
    });
}


/**
 * Randează întreaga vizualizare de facturare pentru luna selectată.
 */
export function renderBillingView() {
    const { clients, events } = calendarState.getState();
    const year = currentBillingDate.getFullYear();
    const month = currentBillingDate.getMonth();
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

    // Actualizează eticheta lunii
    dom.currentMonthLabel.textContent = currentBillingDate.toLocaleString('ro-RO', {
        month: 'long',
        year: 'numeric'
    });
    
    dom.clientList.innerHTML = ''; // Curăță lista

    // Obține termenul de căutare
    const searchTerm = dom.billingSearchBar.value.toLowerCase();
    
    // Filtrează clienții
    const filteredClients = clients.filter(client => {
        // 1. Filtrează după nume
        const nameMatch = client.name.toLowerCase().includes(searchTerm);
        // 2. Nu afișa clienți "speciali" (ex: Pauza, Sedinta)
        const isSpecial = ['Pauza de masa', 'Sedinta', 'Concediu'].includes(client.name);
        
        return nameMatch && !isSpecial;
    });

    if (filteredClients.length === 0) {
        if (searchTerm) {
            dom.clientList.innerHTML = `<p class="empty-list-message">Niciun client nu corespunde termenului "${dom.billingSearchBar.value}".</p>`;
        } else {
            dom.clientList.innerHTML = '<p class="empty-list-message">Nu există clienți în sistem.</p>';
        }
        return;
    }

    filteredClients.forEach(client => {
        const { subscriptions } = calendarState.getState();
        const subscription = subscriptions[client.id];
        const hasActiveSubscription = subscription?.isActive;

        let hoursData, totalBeforeDiscount, discountPercent, discountAmount, totalDue;

        if (!hasActiveSubscription) {
            // Calculate regular billing with discounts
            hoursData = calculateClientHoursForMonth(client.id, year, month, events);
            totalBeforeDiscount = hoursData.totalDue;
            discountPercent = calculateDiscount(hoursData.billableHours);
            discountAmount = totalBeforeDiscount * (discountPercent / 100);
            totalDue = totalBeforeDiscount - discountAmount;
        } else {
            // Use subscription amount, no discounts applied
            hoursData = { billableHours: 0 };
            totalDue = subscription.amount;
            totalBeforeDiscount = totalDue;
            discountPercent = 0;
            discountAmount = 0;
        }

        const card = document.createElement('div');
        card.className = 'billing-card';
        card.dataset.clientId = client.id;
        card.dataset.monthKey = monthKey;

        const hoursDisplay = hasActiveSubscription
            ? '<span class="subscription-badge">Abonament Activ</span>'
            : `<span class="client-hours">${hoursData.billableHours.toFixed(1)} ore</span>`;

        card.innerHTML = `
            <div class="billing-header">
                <span class="client-name">${client.name}</span>
                ${hoursDisplay}
            </div>
            <div class="billing-body">
                ${generatePaymentSummary(client.id, monthKey, totalDue, totalBeforeDiscount, discountPercent, discountAmount, hasActiveSubscription)}
            </div>
            <div class="billing-actions">
                <button class="btn btn-secondary btn-sm" data-action="manage-subscription">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
                        <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286m1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94"/>
                    </svg>
                    Adaugă/Modifică Abonament
                </button>
                <button class="btn btn-primary btn-sm" data-action="add-payment">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" class="bi bi-cash-coin" viewBox="0 0 16 16">
  <path fill-rule="evenodd" d="M11 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8m5-4a5 5 0 1 1-10 0 5 5 0 0 1 10 0"/>
  <path d="M9.438 11.944c.047.596.518 1.06 1.363 1.116v.44h.375v-.443c.875-.061 1.386-.529 1.386-1.207 0-.618-.39-.936-1.09-1.1l-.296-.07v-1.2c.376.043.614.248.671.532h.658c-.047-.575-.54-1.024-1.329-1.073V8.5h-.375v.45c-.747.073-1.255.522-1.255 1.158 0 .562.378.92 1.007 1.066l.248.061v1.272c-.384-.058-.639-.27-.696-.563h-.668zm1.36-1.354c-.369-.085-.569-.26-.569-.522 0-.294.216-.514.572-.578v1.1zm.432.746c.449.104.655.272.655.569 0 .339-.257.571-.709.614v-1.195z"/>
  <path d="M1 0a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h4.083q.088-.517.258-1H3a2 2 0 0 0-2-2V3a2 2 0 0 0 2-2h10a2 2 0 0 0 2 2v3.528c.38.34.717.728 1 1.154V1a1 1 0 0 0-1-1z"/>
  <path d="M9.998 5.083 10 5a2 2 0 1 0-3.132 1.65 6 6 0 0 1 3.13-1.567"/>
</svg>
                    Adaugă Încasare
                </button>
            </div>
        `;
        dom.clientList.appendChild(card);
    });
}

/**
 * Generează HTML pentru rezumatul financiar (Total, Achitat, Restant) și lista plăților.
 */
function generatePaymentSummary(clientId, monthKey, totalDue, totalBeforeDiscount = totalDue, discountPercent = 0, discountAmount = 0, isSubscription = false) {
    const { billingsData } = calendarState.getState();
    const payments = billingsData[clientId]?.[monthKey] || [];

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const balance = totalDue - totalPaid;

    let paymentsHtml = '<p class="no-payments">Nicio încasare înregistrată.</p>';
    if (payments.length > 0) {
        paymentsHtml = payments.map(p => `
            <div class="payment-item">
                <span>📅 ${new Date(p.date).toLocaleDateString('ro-RO')}</span>
                <span class="payment-note">${p.notes || ''}</span>
                <span class="payment-amount">${p.amount.toFixed(2)} RON</span>
                <button class="btn-icon btn-delete-payment" data-action="delete-payment" data-payment-id="${p.id}" title="Șterge încasarea">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>
                </button>
            </div>
        `).join('');
    }

    // For subscription mode, show simplified summary
    let summaryHtml;
    if (isSubscription) {
        summaryHtml = `
            <div class="summary-item total-due">
                <span class="label">Valoare Abonament</span>
                <span class="value">${totalDue.toFixed(2)} RON</span>
            </div>
        `;
    } else {
        // Show discount info if applicable
        let discountHtml = '';
        if (discountPercent > 0) {
            discountHtml = `
                <div class="summary-item bg-green-50 dark:bg-green-900/20 border-l-4 border-green-600">
                    <span class="label text-green-800 dark:text-green-300">💰 Discount Aplicat (${discountPercent}%)</span>
                    <span class="value text-green-800 dark:text-green-300">-${discountAmount.toFixed(2)} RON</span>
                </div>
            `;
        }

        summaryHtml = `
            ${discountPercent > 0 ? `
                <div class="summary-item opacity-70">
                    <span class="label">Subtotal (înainte de discount)</span>
                    <span class="value line-through">${totalBeforeDiscount.toFixed(2)} RON</span>
                </div>
            ` : ''}
            ${discountHtml}
            <div class="summary-item total-due">
                <span class="label">Total de Plată</span>
                <span class="value">${totalDue.toFixed(2)} RON</span>
            </div>
        `;
    }

    return `
        <div class="financial-summary">
            ${summaryHtml}
            <div class="summary-item total-paid">
                <span class="label">Total Achitat</span>
                <span class="value">${totalPaid.toFixed(2)} RON</span>
            </div>
            <div class="summary-item balance ${balance > 0 ? 'due' : (balance <= 0 && totalDue > 0 ? 'paid' : '')}">
                <span class="label">Restant</span>
                <span class="value">${balance.toFixed(2)} RON</span>
            </div>
        </div>
        <div class="payments-list">
            <h4>Istoric Încasări</h4>
            ${paymentsHtml}
        </div>
    `;
}



/**
 * Calculează orele facturabile ȘI totalul de plată pentru un client într-o lună specificată.
 */
function calculateClientHoursForMonth(clientId, year, month, allEvents) {
    // Get eventTypes from state
    const { eventTypes } = calendarState.getState(); // <-- NEW

    const monthEvents = allEvents.filter(event => {
        const clientIds = event.clientIds || (event.clientId ? [event.clientId] : []);
        if (!clientIds.includes(clientId)) return false;
        
        const eventDate = new Date(event.date);
        return eventDate.getFullYear() === year && eventDate.getMonth() === month;
    });

    let billableMinutes = 0;
    let totalDue = 0; // <-- NEW

    monthEvents.forEach(event => {
        
        const attendance = (event.attendance && event.attendance[clientId]) || 'present';
        // Este facturabil ȘI clientul a fost prezent sau absent (dar nu absent motivat)
        const isBillableAttendance = (attendance === 'present' || attendance === 'absent');
        
        if (event.isBillable !== false && isBillableAttendance) {
            
            // 1. Calculează orele (pentru afișare)
            if (event.duration) {
              billableMinutes += (Number(event.duration) || 0);
            }

            // 2. Calculează totalul de plată (pentru calcul)
            const eventType = eventTypes.find(t => t.id === event.type); // <-- NEW
            if (eventType && eventType.base_price > 0) { // <-- NEW
                totalDue += (eventType.base_price * (Number(event.duration) / 60));
            }
            // Dacă nu se găsește tipul sau prețul e 0, se adaugă 0, ceea ce e corect.
        }
    });
    
    return {
        billableHours: billableMinutes / 60,
        totalDue: totalDue // <-- NEW
    };
}

// --- Navigare Lunară ---

function navigateBillingMonth(direction) {
    currentBillingDate.setMonth(currentBillingDate.getMonth() + direction);
    renderBillingView();
}

// --- Management Plăți ---

function openPaymentModal(clientId, monthKey) {
    dom.paymentModalTitle.textContent = `Adaugă Încasare (${monthKey})`;
    dom.paymentForm.reset();
    dom.paymentClientId.value = clientId;
    dom.paymentMonthKey.value = monthKey;
    dom.paymentDate.valueAsDate = new Date(); // Setează data la ziua de azi
    dom.paymentModal.style.display = 'flex';
    dom.paymentAmount.focus();
}

function closePaymentModal() {
    dom.paymentModal.style.display = 'none';
    dom.paymentForm.reset();
}

async function handleSavePayment(e) {
    e.preventDefault();
    const clientId = dom.paymentClientId.value;
    const monthKey = dom.paymentMonthKey.value;
    const amount = parseFloat(dom.paymentAmount.value);
    const date = dom.paymentDate.value;
    const notes = dom.paymentNotes.value || '';

    if (!clientId || !monthKey || isNaN(amount) || !date) {
        showCustomAlert('Vă rugăm completați toate câmpurile corect.', 'Eroare');
        return;
    }

    const { billingsData } = calendarState.getState();

    // Asigură că structura există
    if (!billingsData[clientId]) {
        billingsData[clientId] = {};
    }
    if (!billingsData[clientId][monthKey]) {
        billingsData[clientId][monthKey] = [];
    }

    // Adaugă noua plată
    billingsData[clientId][monthKey].push({
        id: `pay_${Date.now()}`,
        date: date,
        amount: amount,
        notes: notes
    });

    // Sortează plățile după dată
    billingsData[clientId][monthKey].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Salvează și rerandează
    try {
        await api.saveBillingsData(billingsData);
        calendarState.setBillingsData(billingsData); // Actualizează starea
        renderBillingView(); // Rerandează lista de facturare
        closePaymentModal();
    } catch (err) {
        console.error('Eroare la salvarea încasării:', err);
        showCustomAlert('Nu s-a putut salva încasarea.', 'Eroare API');
    }
}

async function handleDeletePayment(clientId, monthKey, paymentId) {
    const confirmed = await showCustomConfirm('Sunteți sigur că doriți să ștergeți această încasare?', 'Confirmare Ștergere');
    if (!confirmed) return;

    const { billingsData } = calendarState.getState();

    if (!billingsData[clientId] || !billingsData[clientId][monthKey]) return;

    // Filtrează plata
    billingsData[clientId][monthKey] = billingsData[clientId][monthKey].filter(p => p.id !== paymentId);

    // Salvează și rerandează
    try {
        await api.saveBillingsData(billingsData);
        calendarState.setBillingsData(billingsData);
        renderBillingView();
    } catch (err) {
        console.error('Eroare la ștergerea încasării:', err);
        showCustomAlert('Nu s-a putut șterge încasarea.', 'Eroare API');
    }
}

// --- Management Abonamente ---

function openSubscriptionModal(clientId) {
    const { clients, subscriptions } = calendarState.getState();
    const client = clients.find(c => c.id === clientId);
    const subscription = subscriptions[clientId];

    dom.subscriptionClientId.value = clientId;
    dom.subscriptionForm.reset();

    // If subscription exists, populate the form
    if (subscription) {
        dom.subscriptionAmount.value = subscription.amount;

        // Show/hide buttons based on subscription status
        if (subscription.isActive) {
            dom.activateSubscriptionBtn.textContent = 'Actualizează';
            dom.deactivateSubscriptionBtn.style.display = 'inline-block';
            dom.subscriptionStatus.style.display = 'block';
            dom.subscriptionStatus.innerHTML = '<span class="status-badge status-active">Abonament Activ</span>';
        } else {
            dom.activateSubscriptionBtn.textContent = 'Activează';
            dom.deactivateSubscriptionBtn.style.display = 'none';
            dom.subscriptionStatus.style.display = 'block';
            dom.subscriptionStatus.innerHTML = '<span class="status-badge status-inactive">Abonament Inactiv</span>';
        }
    } else {
        dom.activateSubscriptionBtn.textContent = 'Activează';
        dom.deactivateSubscriptionBtn.style.display = 'none';
        dom.subscriptionStatus.style.display = 'none';
    }

    dom.subscriptionModal.style.display = 'flex';
    dom.subscriptionAmount.focus();
}

function closeSubscriptionModal() {
    dom.subscriptionModal.style.display = 'none';
    dom.subscriptionForm.reset();
}

async function handleActivateSubscription(e) {
    e.preventDefault();
    const clientId = dom.subscriptionClientId.value;
    const amount = parseFloat(dom.subscriptionAmount.value);

    if (!clientId || isNaN(amount) || amount < 0) {
        showCustomAlert('Vă rugăm introduceți o valoare validă pentru abonament.', 'Eroare');
        return;
    }

    try {
        // Save subscription with active status
        await api.saveSubscription({
            clientId: clientId,
            amount: amount,
            isActive: true
        });

        // Reload subscriptions
        const subscriptions = await api.loadSubscriptions();
        calendarState.setSubscriptions(subscriptions);

        renderBillingView();
        closeSubscriptionModal();
    } catch (err) {
        console.error('Eroare la salvarea abonamentului:', err);
        showCustomAlert('Nu s-a putut salva abonamentul.', 'Eroare API');
    }
}

async function handleDeactivateSubscription() {
    const clientId = dom.subscriptionClientId.value;
    const amount = parseFloat(dom.subscriptionAmount.value);

    if (!clientId) {
        showCustomAlert('ID client invalid.', 'Eroare');
        return;
    }

    const confirmed = await showCustomConfirm(
        'Sunteți sigur că doriți să dezactivați abonamentul? Clientul va reveni la facturarea pe bază de ore.',
        'Confirmare Dezactivare'
    );

    if (!confirmed) return;

    try {
        // Save subscription with inactive status
        await api.saveSubscription({
            clientId: clientId,
            amount: amount || 0,
            isActive: false
        });

        // Reload subscriptions
        const subscriptions = await api.loadSubscriptions();
        calendarState.setSubscriptions(subscriptions);

        renderBillingView();
        closeSubscriptionModal();
    } catch (err) {
        console.error('Eroare la dezactivarea abonamentului:', err);
        showCustomAlert('Nu s-a putut dezactiva abonamentul.', 'Eroare API');
    }
}

// --- Discount Thresholds Management ---

/**
 * Toggle discount thresholds section visibility
 */
function toggleDiscountThresholdsSection() {
    const content = dom.discountThresholdsContent;
    const icon = dom.discountThresholdsToggleIcon;
    const saveBtn = dom.saveDiscountThresholdsBtn;

    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        icon.style.transform = 'rotate(90deg)';
        saveBtn.classList.remove('hidden');
    } else {
        content.classList.add('hidden');
        icon.style.transform = 'rotate(0deg)';
        saveBtn.classList.add('hidden');
    }
}

/**
 * Randează lista de praguri de discount
 */
function renderDiscountThresholds() {
    const { discountThresholds } = calendarState.getState();

    if (!dom.discountThresholdsList) return;

    dom.discountThresholdsList.innerHTML = '';

    // Sort thresholds by hours ascending
    const sortedThresholds = [...discountThresholds].sort((a, b) => a.hours - b.hours);

    sortedThresholds.forEach((threshold, index) => {
        const thresholdItem = document.createElement('div');
        thresholdItem.className = 'flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 bg-gray-50 dark:bg-gray-700 p-3 rounded-lg';
        thresholdItem.innerHTML = `
            <div class="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2">
                <label class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap font-medium">Ore minime:</label>
                <input type="number"
                    class="form-input w-full sm:w-20 py-1.5 px-2 text-sm"
                    value="${threshold.hours}"
                    data-index="${index}"
                    data-field="hours"
                    min="1"
                    step="1">
            </div>
            <div class="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-2">
                <label class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap font-medium">Discount (%):</label>
                <input type="number"
                    class="form-input w-full sm:w-20 py-1.5 px-2 text-sm"
                    value="${threshold.discount}"
                    data-index="${index}"
                    data-field="discount"
                    min="0"
                    max="100"
                    step="1">
            </div>
            <button class="btn-icon btn-delete-payment self-end sm:self-auto" data-action="delete-threshold" data-index="${index}" title="Șterge prag">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>
            </button>
        `;
        dom.discountThresholdsList.appendChild(thresholdItem);
    });

    // Add event listeners for threshold input changes
    dom.discountThresholdsList.querySelectorAll('input').forEach(input => {
        input.addEventListener('change', handleThresholdChange);
    });

    // Add event listeners for delete buttons
    dom.discountThresholdsList.querySelectorAll('[data-action="delete-threshold"]').forEach(btn => {
        btn.addEventListener('click', handleDeleteThreshold);
    });
}

/**
 * Modifică un prag existent
 */
function handleThresholdChange(e) {
    const index = parseInt(e.target.dataset.index);
    const field = e.target.dataset.field;
    const value = parseFloat(e.target.value);

    const { discountThresholds } = calendarState.getState();

    if (field === 'hours') {
        discountThresholds[index].hours = Math.max(1, value);
    } else if (field === 'discount') {
        discountThresholds[index].discount = Math.max(0, Math.min(100, value));
    }

    calendarState.setDiscountThresholds(discountThresholds);
}

/**
 * Adaugă un prag nou
 */
function handleAddThreshold() {
    const { discountThresholds } = calendarState.getState();

    // Find the next logical threshold
    let nextHours = 10;
    let nextDiscount = 10;

    if (discountThresholds.length > 0) {
        const maxHours = Math.max(...discountThresholds.map(t => t.hours));
        const maxDiscount = Math.max(...discountThresholds.map(t => t.discount));
        nextHours = maxHours + 10;
        nextDiscount = Math.min(maxDiscount + 5, 100);
    }

    discountThresholds.push({
        hours: nextHours,
        discount: nextDiscount
    });

    calendarState.setDiscountThresholds(discountThresholds);
    renderDiscountThresholds();
}

/**
 * Șterge un prag
 */
async function handleDeleteThreshold(e) {
    const index = parseInt(e.currentTarget.dataset.index);

    const confirmed = await showCustomConfirm('Sigur doriți să ștergeți acest prag de discount?', 'Confirmare Ștergere');
    if (!confirmed) return;

    const { discountThresholds } = calendarState.getState();
    discountThresholds.splice(index, 1);

    calendarState.setDiscountThresholds(discountThresholds);
    renderDiscountThresholds();
}

/**
 * Salvează pragurile de discount
 */
async function handleSaveThresholds() {
    const { discountThresholds } = calendarState.getState();

    // Validate thresholds
    for (const threshold of discountThresholds) {
        if (!threshold.hours || threshold.hours < 1) {
            showCustomAlert('Orele minime trebuie să fie cel puțin 1.', 'Date Invalide');
            return;
        }
        if (threshold.discount < 0 || threshold.discount > 100) {
            showCustomAlert('Discountul trebuie să fie între 0 și 100%.', 'Date Invalide');
            return;
        }
    }

    try {
        await api.saveDiscountThresholds(discountThresholds);
        showCustomAlert('Pragurile de discount au fost salvate cu succes!', 'Succes');
        renderBillingView(); // Re-render to apply new discounts
    } catch (err) {
        console.error('Eroare la salvarea pragurilor de discount:', err);
        showCustomAlert('Nu s-au putut salva pragurile de discount.', 'Eroare API');
    }
}

/**
 * Calculează discountul pentru un număr de ore
 */
function calculateDiscount(hours) {
    const { discountThresholds } = calendarState.getState();

    // Sort thresholds by hours descending to find the highest applicable discount
    const sortedThresholds = [...discountThresholds].sort((a, b) => b.hours - a.hours);

    for (const threshold of sortedThresholds) {
        if (hours >= threshold.hours) {
            return threshold.discount;
        }
    }

    return 0; // No discount
}