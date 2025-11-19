/**
 * js/interventionPlanService.js
 *
 * Handles intervention plan management for clients
 */

import { calendarState } from './calendarState.js';
import * as api from './apiService.js';
import { showCustomAlert, showCustomConfirm } from './uiService.js';

const $ = (id) => document.getElementById(id);

// DOM Elements
const dom = {
    modal: $('interventionPlanModal'),
    form: $('interventionPlanForm'),
    closeBtn: $('closeInterventionPlanModal'),
    cancelBtn: $('cancelInterventionPlanBtn'),
    deleteBtn: $('deleteInterventionPlanBtn'),

    clientId: $('interventionPlanClientId'),
    clientName: $('interventionPlanClientName'),
    startDate: $('interventionPlanStartDate'),
    endDate: $('interventionPlanEndDate'),
    programsList: $('interventionPlanProgramsList'),
    notes: $('interventionPlanNotes'),

    info: $('interventionPlanInfo'),
    createdAt: $('interventionPlanCreatedAt'),
    updatedAt: $('interventionPlanUpdatedAt'),
};

/**
 * Initialize intervention plan modal listeners
 */
export function init() {
    if (!dom.modal) return;

    dom.closeBtn.addEventListener('click', closeModal);
    dom.cancelBtn.addEventListener('click', closeModal);
    dom.modal.addEventListener('click', (e) => {
        if (e.target === dom.modal) closeModal();
    });
    dom.form.addEventListener('submit', handleSavePlan);
    dom.deleteBtn.addEventListener('click', handleDeletePlan);
}

/**
 * Open intervention plan modal for a client
 */
export function openModal(clientId) {
    const { clients, programs, interventionPlans } = calendarState.getState();
    const client = clients.find(c => c.id === clientId);
    const plan = interventionPlans[clientId];

    if (!client) {
        showCustomAlert('Client nu a fost găsit.', 'Eroare');
        return;
    }

    // Reset form
    dom.form.reset();
    dom.clientId.value = clientId;
    dom.clientName.value = client.name;

    // Populate programs checklist
    populateProgramsList(programs, plan?.programIds || []);

    // If plan exists, populate the form
    if (plan) {
        dom.startDate.value = plan.startDate;
        dom.endDate.value = plan.endDate;
        dom.notes.value = plan.notes || '';

        // Show plan info
        dom.info.style.display = 'block';
        dom.createdAt.textContent = new Date(plan.createdAt).toLocaleString('ro-RO');
        dom.updatedAt.textContent = new Date(plan.updatedAt).toLocaleString('ro-RO');
        dom.deleteBtn.style.display = 'inline-block';
    } else {
        // Set default dates (today and 3 months from now)
        const today = new Date();
        const threeMonthsLater = new Date(today);
        threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);

        dom.startDate.value = today.toISOString().split('T')[0];
        dom.endDate.value = threeMonthsLater.toISOString().split('T')[0];

        dom.info.style.display = 'none';
        dom.deleteBtn.style.display = 'none';
    }

    dom.modal.style.display = 'flex';
    dom.startDate.focus();
}

/**
 * Close the modal
 */
function closeModal() {
    dom.modal.style.display = 'none';
    dom.form.reset();
}

/**
 * Populate programs checklist
 */
function populateProgramsList(programs, selectedProgramIds) {
    dom.programsList.innerHTML = '';

    if (!programs || programs.length === 0) {
        dom.programsList.innerHTML = '<p style="color: #999;">Nu există programe disponibile.</p>';
        return;
    }

    programs.forEach(program => {
        const isChecked = selectedProgramIds.includes(program.id);
        const checkbox = document.createElement('div');
        checkbox.className = 'program-checkbox-item';
        checkbox.innerHTML = `
            <label class="checkbox-label">
                <input type="checkbox"
                       name="program"
                       value="${program.id}"
                       ${isChecked ? 'checked' : ''}>
                <span>${program.name}</span>
            </label>
        `;
        dom.programsList.appendChild(checkbox);
    });
}

/**
 * Handle save plan
 */
async function handleSavePlan(e) {
    e.preventDefault();

    const clientId = dom.clientId.value;
    const startDate = dom.startDate.value;
    const endDate = dom.endDate.value;
    const notes = dom.notes.value;

    // Get selected programs
    const programCheckboxes = dom.programsList.querySelectorAll('input[type="checkbox"]:checked');
    const programIds = Array.from(programCheckboxes).map(cb => cb.value);

    if (!clientId || !startDate || !endDate) {
        showCustomAlert('Vă rugăm completați toate câmpurile obligatorii.', 'Eroare');
        return;
    }

    // Validate dates
    if (new Date(endDate) < new Date(startDate)) {
        showCustomAlert('Data de sfârșit trebuie să fie după data de început.', 'Eroare');
        return;
    }

    try {
        await api.saveInterventionPlan({
            clientId,
            startDate,
            endDate,
            notes,
            programIds
        });

        // Reload intervention plans
        const plans = await api.loadInterventionPlans();
        calendarState.setInterventionPlans(plans);

        closeModal();
    } catch (err) {
        console.error('Eroare la salvarea planului de intervenție:', err);
        showCustomAlert('Nu s-a putut salva planul de intervenție.', 'Eroare API');
    }
}

/**
 * Handle delete plan
 */
async function handleDeletePlan() {
    const clientId = dom.clientId.value;

    const confirmed = await showCustomConfirm(
        'Sunteți sigur că doriți să ștergeți acest plan de intervenție?',
        'Confirmare Ștergere'
    );

    if (!confirmed) return;

    try {
        await api.deleteInterventionPlan(clientId);

        // Reload intervention plans
        const plans = await api.loadInterventionPlans();
        calendarState.setInterventionPlans(plans);

        closeModal();
    } catch (err) {
        console.error('Eroare la ștergerea planului de intervenție:', err);
        showCustomAlert('Nu s-a putut șterge planul de intervenție.', 'Eroare API');
    }
}
