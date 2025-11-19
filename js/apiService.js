/**
 * js/apiService.js
 *
 * Modul centralizat pentru comunicarea cu backend-ul (api.php).
 * Acesta extrage toată logica 'fetch' din calendar.js.
 */

import {
    showSuccessToast,
    showErrorToast,
    showWarningToast
} from './uiService.js';

// --- Global Loader Functions ---
const $loader = () => document.getElementById('globalLoader');

/**
 * Afișează indicatorul de încărcare global.
 */
function showLoader() {
    const loader = $loader();
    if (loader) loader.classList.add('active');
}

/**
 * Ascunde indicatorul de încărcare global.
 */
function hideLoader() {
    const loader = $loader();
    if (loader) loader.classList.remove('active');
}
// --- End Global Loader ---


/**
 * O funcție helper de bază pentru toate apelurile API.
 * Se ocupă de calea API și de încercarea unei căi de fallback
 * (bazat pe logica originală din calendar.js).
 */
async function apiFetch(path, options = {}) {
    showLoader(); // <-- ARATĂ LOADER-UL
    
    let response;
    // Calea principală, relativă
    const url = `api.php?path=${path}`;

    try {
        try {
            // 1. Încearcă calea relativă
            response = await fetch(url, options);
        } catch (networkError) {
            console.error(`Eroare rețea la apelarea ${url}:`, networkError);
            
            // 2. Încercare fallback (cale absolută, conform logicii din calendar.js)
            const fallbackUrl = `/calendar-app/${url.replace('api.php', 'api.php')}`; // Asigură calea corectă
            console.warn(`Încercare cale fallback: ${fallbackUrl}`);
            
            try {
                response = await fetch(fallbackUrl, options);
            } catch (fallbackError) {
                console.error(`Eroare rețea la calea fallback ${fallbackUrl}:`, fallbackError);
                // Aruncă eroarea originală dacă și fallback-ul eșuează
                throw new Error(`Eroare de rețea: ${networkError.message}`);
            }
        }

        // Verifică dacă răspunsul este OK (ex. 200)
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Eroare API (${response.status}) pentru ${url}:`, errorText);
            throw new Error(`Eroare server: ${response.status}`);
        }

        // Returnează răspunsul ca JSON
        return await response.json();

    } catch (error) {
        // Prinde orice eroare (network, fallback, server status, or json parsing)
        console.error('apiFetch a eșuat:', error);
        throw error; // Aruncă eroarea mai departe pentru a fi prinsă de funcția apelantă
    } finally {
        // Indiferent de succes or eroare, ascunde loader-ul
        hideLoader(); // <-- ASCUNDE LOADER-UL
    }
}

// --- Metode API Publice (Exportate) ---

/**
 * Încarcă datele principale (teamMembers, clients, events).
 * Apel GET la api.php?path=data
 */
export async function loadData() {
    try {
        // Folosim endpoint-ul 'data' din api.php
        return await apiFetch('data');
    } catch (error) {
        showErrorToast('Eroare la încărcare', 'Nu s-au putut încărca datele');
        throw error;
    }
}

/**
 * Create a new event
 * @param {object|array} eventData - Single event or array of events
 */
export async function createEvent(eventData) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData)
    };
    try {
        const result = await apiFetch('events', options);
        const isMultiple = Array.isArray(eventData);
        showSuccessToast(
            'Eveniment creat',
            isMultiple ? `${eventData.length} evenimente create cu succes` : 'Evenimentul a fost creat cu succes'
        );

        // Log activity
        const eventName = isMultiple ? `${eventData.length} evenimente` : (eventData.name || 'Eveniment nou');
        const eventDate = isMultiple ? eventData[0].date : eventData.date;
        await window.logActivity('a creat eveniment', eventName, 'event', eventDate);

        return result;
    } catch (error) {
        showErrorToast('Eroare la creare', 'Nu s-a putut crea evenimentul');
        throw error;
    }
}

/**
 * Update an existing event
 * @param {object} eventData - Event data with id
 */
export async function updateEvent(eventData) {
    const options = {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData)
    };
    try {
        const result = await apiFetch(`events/${eventData.id}`, options);
        showSuccessToast('Eveniment actualizat', 'Modificările au fost salvate cu succes');

        // Log activity
        const eventName = eventData.name || 'Eveniment';
        await window.logActivity('a actualizat eveniment', eventName, 'event', eventData.date);

        return result;
    } catch (error) {
        showErrorToast('Eroare la actualizare', 'Nu s-a putut actualiza evenimentul');
        throw error;
    }
}

/**
 * Delete an event
 * @param {string} eventId - ID of the event
 */
export async function deleteEvent(eventId) {
    const options = { method: 'DELETE' };
    try {
        const result = await apiFetch(`events/${eventId}`, options);
        showSuccessToast('Eveniment șters', 'Evenimentul a fost șters cu succes');

        // Log activity
        await window.logActivity('a șters eveniment', eventId, 'event', null);

        return result;
    } catch (error) {
        showErrorToast('Eroare la ștergere', 'Nu s-a putut șterge evenimentul');
        throw error;
    }
}

/**
 * Create a new client
 */
export async function createClient(clientData) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clientData)
    };
    try {
        const result = await apiFetch('clients', options);
        showSuccessToast('Client creat', `Clientul ${clientData.name} a fost adăugat cu succes`);

        // Log activity
        await window.logActivity('a adăugat client', clientData.name, 'client', clientData.id);

        return result;
    } catch (error) {
        showErrorToast('Eroare la creare', 'Nu s-a putut crea clientul');
        throw error;
    }
}

/**
 * Update a client
 * @param {object} clientData - New client data
 * @param {string} [oldId] - Original client ID (use when ID has changed)
 */
export async function updateClient(clientData, oldId = null) {
    const options = {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clientData)
    };
    // Use oldId if provided (for when ID changes), otherwise use current ID
    const clientIdForUrl = oldId || clientData.id;
    try {
        const result = await apiFetch(`clients/${clientIdForUrl}`, options);
        showSuccessToast('Client actualizat', 'Modificările au fost salvate cu succes');

        // Log activity
        await window.logActivity('a actualizat profil client', clientData.name, 'client', clientData.id);

        return result;
    } catch (error) {
        showErrorToast('Eroare la actualizare', 'Nu s-a putut actualiza clientul');
        throw error;
    }
}

/**
 * Delete a client
 */
export async function deleteClient(clientId) {
    const options = { method: 'DELETE' };
    try {
        const result = await apiFetch(`clients/${clientId}`, options);
        showSuccessToast('Client șters', 'Clientul a fost arhivat cu succes');

        // Log activity
        await window.logActivity('a arhivat client', clientId, 'client', clientId);

        return result;
    } catch (error) {
        showErrorToast('Eroare la arhivare', 'Nu s-a putut arhiva clientul');
        throw error;
    }
}

/**
 * Încarcă programele terapeutice.
 * Apel GET la api.php?path=programs
 */
export async function loadPrograms() {
    // api.php are o regulă care încarcă fișiere .json
    return apiFetch('programs');
}

/**
 * Încarcă datele de evoluție (din evolution.json).
 * Apel GET la api.php?path=evolution
 */
export async function loadEvolutionData() {
    // Folosim api.php pentru a-l încărca
    return apiFetch('evolution');
}

/**
 * Salvează datele de evoluție.
 * Apel POST la api.php?path=evolution
 * @param {object} data - Obiectul cu datele de evoluție
 */
export async function saveEvolutionData(data) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    };
    try {
        const result = await apiFetch('evolution', options);
        showSuccessToast('Evoluție salvată', 'Datele de evoluție au fost salvate cu succes');

        // Note: Activity logging for specific evolution actions (like monthly themes)
        // is handled in evolutionService.js where the specific client context is known

        return result;
    } catch (error) {
        showErrorToast('Eroare la salvare', 'Nu s-au putut salva datele de evoluție');
        throw error;
    }
}

/**
 * Încarcă datele Portrige (din portrige.json).
 * Apel GET la api.php?path=portrige.json
 */
export async function loadPortrigeData() {
    // Logica din calendar.js (linia ~2548) încarcă prin api.php
    return apiFetch('portrige.json');
}

/**
 * Încarcă datele de facturare (din billings.json).
 * Apel GET la api.php?path=billings
 */
export async function loadBillingsData() {
    return apiFetch('billings');
}

/**
 * Salvează datele de facturare.
 * Apel POST la api.php?path=billings
 * @param {object} data - Obiectul cu datele de facturare
 */
export async function saveBillingsData(data) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    };
    try {
        const result = await apiFetch('billings', options);
        showSuccessToast('Facturi salvate', 'Datele de facturare au fost salvate cu succes');
        return result;
    } catch (error) {
        showErrorToast('Eroare la salvare', 'Nu s-au putut salva datele de facturare');
        throw error;
    }
}

/**
 * Încarcă pragurile de discount pentru facturare.
 * Apel GET la api.php?path=discount-thresholds
 */
export async function loadDiscountThresholds() {
    return apiFetch('discount-thresholds');
}

/**
 * Salvează pragurile de discount pentru facturare.
 * Apel POST la api.php?path=discount-thresholds
 * @param {array} thresholds - Array de obiecte {hours, discount}
 */
export async function saveDiscountThresholds(thresholds) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thresholds)
    };
    try {
        const result = await apiFetch('discount-thresholds', options);
        showSuccessToast('Discounturi salvate', 'Pragurile de discount au fost salvate cu succes');
        return result;
    } catch (error) {
        showErrorToast('Eroare la salvare', 'Nu s-au putut salva pragurile de discount');
        throw error;
    }
}

/**
 * Încarcă abonamentele clienților.
 * Apel GET la api.php?path=subscriptions
 */
export async function loadSubscriptions() {
    return apiFetch('subscriptions');
}

/**
 * Salvează sau actualizează un abonament pentru un client.
 * Apel POST la api.php?path=subscriptions
 * @param {object} subscription - Obiectul cu datele abonamentului {clientId, amount, isActive}
 */
export async function saveSubscription(subscription) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
    };
    try {
        const result = await apiFetch('subscriptions', options);
        showSuccessToast('Abonament salvat', 'Abonamentul a fost salvat cu succes');
        return result;
    } catch (error) {
        showErrorToast('Eroare la salvare', 'Nu s-a putut salva abonamentul');
        throw error;
    }
}

/**
 * Șterge abonamentul unui client.
 * Apel DELETE la api.php?path=subscriptions
 * @param {string} clientId - ID-ul clientului
 */
export async function deleteSubscription(clientId) {
    const options = {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId })
    };
    try {
        const result = await apiFetch('subscriptions', options);
        showSuccessToast('Abonament șters', 'Abonamentul a fost șters cu succes');
        return result;
    } catch (error) {
        showErrorToast('Eroare la ștergere', 'Nu s-a putut șterge abonamentul');
        throw error;
    }
}

/**
 * Încarcă planurile de intervenție pentru clienți.
 * Apel GET la api.php?path=intervention-plans
 */
export async function loadInterventionPlans() {
    return apiFetch('intervention-plans');
}

/**
 * Salvează sau actualizează un plan de intervenție pentru un client.
 * Apel POST la api.php?path=intervention-plans
 * @param {object} plan - Obiectul cu datele planului {clientId, startDate, endDate, notes, programIds}
 */
export async function saveInterventionPlan(plan) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan)
    };
    try {
        const result = await apiFetch('intervention-plans', options);
        showSuccessToast('Plan salvat', 'Planul de intervenție a fost salvat cu succes');
        return result;
    } catch (error) {
        showErrorToast('Eroare la salvare', 'Nu s-a putut salva planul de intervenție');
        throw error;
    }
}

/**
 * Șterge planul de intervenție al unui client.
 * Apel DELETE la api.php?path=intervention-plans
 * @param {string} clientId - ID-ul clientului
 */
export async function deleteInterventionPlan(clientId) {
    const options = {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId })
    };
    try {
        const result = await apiFetch('intervention-plans', options);
        showSuccessToast('Plan șters', 'Planul de intervenție a fost șters cu succes');
        return result;
    } catch (error) {
        showErrorToast('Eroare la ștergere', 'Nu s-a putut șterge planul de intervenție');
        throw error;
    }
}

/**
 * Încarcă tipurile de evenimente din baza de date.
 * Apel GET la api.php?path=event_types
 */
export async function loadEventTypes() {
    return apiFetch('event_types');
}

/**
 * Creează un tip nou de eveniment.
 * Apel POST la api.php?path=event_types
 * @param {object} eventType - Obiectul cu datele tipului {id, label, isBillable, requiresTime}
 */
export async function createEventType(eventType) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventType)
    };
    try {
        const result = await apiFetch('event_types', options);
        showSuccessToast('Tip eveniment creat', `Tipul "${eventType.label}" a fost creat cu succes`);
        return result;
    } catch (error) {
        showErrorToast('Eroare la creare', 'Nu s-a putut crea tipul de eveniment');
        throw error;
    }
}

/**
 * Actualizează un tip de eveniment existent.
 * Apel PUT la api.php?path=event_types
 * @param {object} eventType - Obiectul cu datele tipului {id, label, isBillable, requiresTime}
 */
export async function updateEventType(eventType) {
    const options = {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventType)
    };
    try {
        const result = await apiFetch('event_types', options);
        showSuccessToast('Tip eveniment actualizat', 'Modificările au fost salvate cu succes');
        return result;
    } catch (error) {
        showErrorToast('Eroare la actualizare', 'Nu s-a putut actualiza tipul de eveniment');
        throw error;
    }
}

/**
 * Șterge un tip de eveniment.
 * Apel DELETE la api.php?path=event_types/{id}
 * @param {string} id - ID-ul tipului de eveniment
 */
export async function deleteEventType(id) {
    const options = {
        method: 'DELETE'
    };
    try {
        const result = await apiFetch(`event_types/${id}`, options);
        showSuccessToast('Tip eveniment șters', 'Tipul de eveniment a fost șters cu succes');
        return result;
    } catch (error) {
        showErrorToast('Eroare la ștergere', 'Nu s-a putut șterge tipul de eveniment');
        throw error;
    }
}

/**
 * Creează un program nou.
 * @param {object} program - Obiectul cu datele programului {id, title, description}
 */
export async function createProgram(program) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(program)
    };
    try {
        const result = await apiFetch('programs', options);
        showSuccessToast('Program creat', `Programul "${program.title}" a fost creat cu succes`);
        return result;
    } catch (error) {
        showErrorToast('Eroare la creare', 'Nu s-a putut crea programul');
        throw error;
    }
}

/**
 * Actualizează un program existent.
 * @param {object} program - Obiectul cu datele programului {id, title, description}
 */
export async function updateProgram(program) {
    const options = {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(program)
    };
    try {
        const result = await apiFetch('programs', options);
        showSuccessToast('Program actualizat', 'Modificările au fost salvate cu succes');
        return result;
    } catch (error) {
        showErrorToast('Eroare la actualizare', 'Nu s-a putut actualiza programul');
        throw error;
    }
}

/**
 * Șterge un program.
 * Apel DELETE la api.php?path=programs/{id}
 * @param {string} id - ID-ul programului
 */
export async function deleteProgram(id) {
    const options = {
        method: 'DELETE'
    };
    try {
        const result = await apiFetch(`programs/${id}`, options);
        showSuccessToast('Program șters', 'Programul a fost șters cu succes');
        return result;
    } catch (error) {
        showErrorToast('Eroare la ștergere', 'Nu s-a putut șterge programul');
        throw error;
    }
}

/**
 * Salvează datele generale (teams, clients, events).
 * Apel POST la api.php?path=data
 * @param {object} data - Obiectul cu datele de salvat
 */
export async function saveData(data) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    };
    return apiFetch('data', options);
}

/**
 * Clonează programul unei luni în alta.
 * Apel POST la api.php?path=clone-schedule
 * @param {string} sourceMonth - Luna sursă (format: YYYY-MM)
 * @param {string} targetMonth - Luna țintă (format: YYYY-MM)
 */
export async function cloneMonthSchedule(sourceMonth, targetMonth) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceMonth, targetMonth })
    };
    try {
        const result = await apiFetch('clone-schedule', options);
        showSuccessToast('Program clonat', `Programul din ${sourceMonth} a fost copiat în ${targetMonth}`);
        return result;
    } catch (error) {
        showErrorToast('Eroare la clonare', 'Nu s-a putut clona programul lunii');
        throw error;
    }
}

/**
 * Șterge toate evenimentele dintr-o lună.
 * Apel POST la api.php?path=clear-month
 * @param {string} month - Luna de șters (format: YYYY-MM)
 */
export async function clearMonth(month) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month })
    };
    try {
        const result = await apiFetch('clear-month', options);
        showSuccessToast('Lună ștearsă', `Toate evenimentele din ${month} au fost șterse`);
        return result;
    } catch (error) {
        showErrorToast('Eroare la ștergere', 'Nu s-au putut șterge evenimentele lunii');
        throw error;
    }
}

/**
 * Șterge toate evenimentele asociate cu un client.
 * Apel POST la api.php?path=delete-client-events/:clientId
 * @param {string} clientId - ID-ul clientului
 */
export async function deleteClientEvents(clientId) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };
    try {
        const result = await apiFetch(`delete-client-events/${clientId}`, options);
        showSuccessToast('Evenimente șterse', 'Toate evenimentele clientului au fost șterse');
        return result;
    } catch (error) {
        showErrorToast('Eroare la ștergere', 'Nu s-au putut șterge evenimentele clientului');
        throw error;
    }
}

/**
 * Încarcă opțiunile sistemului (limite, subscription type, etc.)
 * Apel GET la api.php?path=system-options
 */
export async function loadSystemOptions() {
    return apiFetch('system-options');
}

/**
 * Verifică subscriber_id împotriva bazei de date principale
 * Apel GET la api.php?path=verify-subscriber
 * @returns {Promise<{verified: boolean, message?: string}>}
 */
export async function verifySubscriber() {
    return apiFetch('verify-subscriber');
}

/**
 * Creează un utilizator nou în tabelul users.
 * Apel POST la api.php?path=users
 * @param {object} userData - Datele utilizatorului {id, username, password, role}
 */
export async function createUser(userData) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
    };
    try {
        const result = await apiFetch('users', options);
        showSuccessToast('Utilizator creat', `Utilizatorul ${userData.username} a fost creat cu succes`);
        return result;
    } catch (error) {
        showErrorToast('Eroare la creare', 'Nu s-a putut crea utilizatorul');
        throw error;
    }
}

/**
 * Actualizează parola utilizatorului.
 * Apel POST la api.php?path=update-password
 * @param {number} userId - ID-ul utilizatorului
 * @param {string} newPassword - Parola nouă
 */
export async function updatePassword(userId, newPassword) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, new_password: newPassword })
    };
    try {
        const result = await apiFetch('update-password', options);
        showSuccessToast('Parolă actualizată', 'Parola a fost schimbată cu succes');
        return result;
    } catch (error) {
        showErrorToast('Eroare la actualizare', 'Nu s-a putut schimba parola');
        throw error;
    }
}

/**
 * Șterge un utilizator din tabelul users.
 * Apel DELETE la api.php?path=users/:userId
 * @param {string} userId - ID-ul utilizatorului
 */
export async function deleteUser(userId) {
    const options = { method: 'DELETE' };
    try {
        const result = await apiFetch(`users/${userId}`, options);
        showSuccessToast('Utilizator șters', 'Utilizatorul a fost șters cu succes');
        return result;
    } catch (error) {
        showErrorToast('Eroare la ștergere', 'Nu s-a putut șterge utilizatorul');
        throw error;
    }
}

/**
 * Fetch analytics data for the dashboard.
 * Apel GET la api.php?path=analytics&months=N
 * @param {number} months - Number of months to include in analytics (default: 6)
 */
export async function fetchAnalytics(months = 6) {
    try {
        const result = await apiFetch(`analytics&months=${months}`);
        return result;
    } catch (error) {
        showErrorToast('Eroare la încărcare', 'Nu s-au putut încărca datele analytics');
        throw error;
    }
}

// ==========================================================
// CLIENT DOCUMENTS API
// ==========================================================

/**
 * Încarcă toate documentele pentru un client.
 * Apel GET la api.php?path=client-documents&client_id=xxx
 * @param {string} clientId - ID-ul clientului
 */
export async function getClientDocuments(clientId) {
    try {
        const result = await apiFetch(`client-documents&client_id=${clientId}`);
        return result.documents || [];
    } catch (error) {
        showErrorToast('Eroare la încărcare', 'Nu s-au putut încărca documentele');
        throw error;
    }
}

/**
 * Încarcă un document pentru un client.
 * Apel POST la api.php?path=client-documents cu FormData
 * @param {string} clientId - ID-ul clientului
 * @param {File} file - Fișierul de încărcat
 */
export async function uploadClientDocument(clientId, file) {
    const formData = new FormData();
    formData.append('client_id', clientId);
    formData.append('document', file);

    showLoader();

    try {
        const url = `api.php?path=client-documents`;
        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Upload failed');
        }

        const result = await response.json();
        showSuccessToast('Document încărcat', 'Documentul a fost încărcat cu succes');

        // Log activity
        await window.logActivity('a încărcat document', file.name, 'document', clientId);

        return result;
    } catch (error) {
        showErrorToast('Eroare la încărcare', error.message || 'Nu s-a putut încărca documentul');
        throw error;
    } finally {
        hideLoader();
    }
}

/**
 * Șterge un document al unui client.
 * Apel DELETE la api.php?path=client-documents/:id
 * @param {number} documentId - ID-ul documentului
 * @param {string} clientId - ID-ul clientului (optional, pentru activity logging)
 */
export async function deleteClientDocument(documentId, clientId = null) {
    const options = { method: 'DELETE' };
    try {
        const result = await apiFetch(`client-documents/${documentId}`, options);
        showSuccessToast('Document șters', 'Documentul a fost șters cu succes');

        // Log activity
        if (clientId) {
            await window.logActivity('a șters document', `Document ID: ${documentId}`, 'document', clientId);
        }

        return result;
    } catch (error) {
        showErrorToast('Eroare la ștergere', 'Nu s-a putut șterge documentul');
        throw error;
    }
}