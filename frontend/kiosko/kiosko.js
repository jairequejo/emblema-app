// Marca modo kiosko ANTES de que cargue scanner.js
window._kioskMode = true;

// Kiosko v4 — inicia cámara con toque

// ── BLOQUEAR ATRÁS ───────────────────────
window.history.pushState(null, null, window.location.href);
window.onpopstate = function() { window.history.go(1); };

// ── RELOJ ────────────────────────────────
const DIAS  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2,'0');
    const m = String(now.getMinutes()).padStart(2,'0');
    const clockEl = document.getElementById('clock');
    const dateEl  = document.getElementById('date-display');
    if (clockEl) clockEl.textContent = `${h}:${m}`;
    if (dateEl)  dateEl.textContent  = `${DIAS[now.getDay()]} ${now.getDate()} ${MESES[now.getMonth()]}`;
}
updateClock();
setInterval(updateClock, 1000);

// ── INICIAR CÁMARA AUTOMÁTICAMENTE ───────
let scannerStarted = false;

function initKioskoScanner() {
    if (scannerStarted) return;
    scannerStarted = true;
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('scanner-frame').style.display = 'block';
    if (typeof startKioskoScanner === 'function') {
        startKioskoScanner();
    }
}

// Auto-iniciar al cargar (scanner.js se carga después)
window.addEventListener('load', initKioskoScanner);

// Fallback: toque por si falla el permiso la primera vez
document.getElementById('right-panel').addEventListener('click', initKioskoScanner);

// ── HISTORIAL ────────────────────────────
const historyItems = [];
const FLASH_DURATION = 3500; /* ms que dura el flash de pantalla completa */

document.addEventListener('scan-result', (e) => {
    const { estado, nombre, mensaje } = e.detail;

    // Pantalla completa: verde (aceptado), rojo (rechazado), naranja (ya registrado)
    const flashBg = document.getElementById('flash-bg');
    const overlay = document.getElementById('result-overlay');
    const nameEl = document.getElementById('result-name');
    const msgEl = document.getElementById('result-msg');

    if (flashBg && overlay && nameEl) {
        flashBg.className = 'show ' + estado;
        overlay.className = 'result-overlay show ' + estado;
        nameEl.textContent = nombre || 'Desconocido';
        if (msgEl) {
            msgEl.textContent = estado === 'success' ? '¡Bienvenido!' :
                estado === 'warning' ? 'Ya registrado' : 'Rechazado';
        }

        setTimeout(() => {
            flashBg.className = '';
            overlay.className = 'result-overlay';
        }, FLASH_DURATION);
    }

    // Historial (solo success y warning)
    if (estado !== 'success' && estado !== 'warning') return;

    const strip = document.getElementById('history-strip');
    if (!strip) return;

    const hora = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    historyItems.unshift({ type: estado, name: nombre, hora });
    if (historyItems.length > 15) historyItems.pop();

    strip.innerHTML = historyItems.map(item => `
        <div class="history-item ${item.type}">
            <div class="h-dot"></div>
            <span class="h-name">${item.name}</span>
            <span class="h-time">${item.hora}</span>
        </div>
    `).join('');

    const statusEl = document.getElementById('status-text');
    if (statusEl) {
        statusEl.textContent = estado === 'success' ? `✓ ${nombre}` : `◎ ${nombre}`;
        setTimeout(() => { statusEl.textContent = 'Acerca tu medallón'; }, FLASH_DURATION);
    }
});

// ── WAKE LOCK ────────────────────────────
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try { await navigator.wakeLock.request('screen'); } catch(e) {}
    }
}
requestWakeLock();
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
});