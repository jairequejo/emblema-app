// scanner/scanner.js — v3.0 unificado
// Este archivo ES el kiosko. No necesita kiosko.js separado.

// ── BLOQUEAR BOTÓN ATRÁS ──────────────────────────────
window.history.pushState(null, null, window.location.href);
window.onpopstate = function() { window.history.go(1); };

// ── WAKE LOCK (pantalla no se apaga) ─────────────────
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try { await navigator.wakeLock.request('screen'); } catch(e) {}
    }
}
requestWakeLock();
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
});

// ── RELOJ ─────────────────────────────────────────────
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

// ── AUDIO ─────────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSuccess() {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, audioCtx.currentTime);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    osc.start(); osc.stop(audioCtx.currentTime + 0.4);
}

function playWarning() {
    [0, 0.2].forEach(offset => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime + offset);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + offset + 0.15);
        osc.start(audioCtx.currentTime + offset);
        osc.stop(audioCtx.currentTime + offset + 0.15);
    });
}

function playError() {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    osc.start(); osc.stop(audioCtx.currentTime + 0.5);
}

// ── FLASH DE PANTALLA ─────────────────────────────────
const FLASH_DURATION = 3500;

function showFlash(estado, nombre, mensaje) {
    const flashBg = document.getElementById('flash-bg');
    const overlay = document.getElementById('result-overlay');
    const nameEl  = document.getElementById('result-name');
    const msgEl   = document.getElementById('result-msg');

    if (!flashBg || !overlay || !nameEl) return;

    flashBg.className = `show ${estado}`;
    overlay.className = `result-overlay show ${estado}`;
    nameEl.textContent = nombre || 'Desconocido';
    if (msgEl) {
        msgEl.textContent = estado === 'success' ? '¡BIENVENIDO!' :
                            estado === 'warning'  ? 'YA REGISTRADO' : 'RECHAZADO';
    }

    // Barra de progreso: recrear el elemento para reiniciar la animación
    const oldBar = overlay.querySelector('.result-progress');
    if (oldBar) oldBar.remove();
    const bar = document.createElement('div');
    bar.className = 'result-progress';
    overlay.appendChild(bar);

    setTimeout(() => {
        flashBg.className = '';
        overlay.className = 'result-overlay';
        const statusEl = document.getElementById('status-text');
        if (statusEl) statusEl.textContent = 'Acerca tu medallón';
    }, FLASH_DURATION);
}

// ── HISTORIAL ─────────────────────────────────────────
const historyItems = [];

function addHistory(estado, nombre) {
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
}

// ── LÓGICA CENTRAL DE SCAN ────────────────────────────
let html5QrcodeScanner = null;
let isProcessing = false;

function handleScan(decodedText) {
    if (isProcessing) return;
    isProcessing = true;

    const code = decodedText.includes('?code=')
        ? decodedText.split('?code=')[1]
        : decodedText;

    if (html5QrcodeScanner) html5QrcodeScanner.pause();

    // Actualizar status
    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.textContent = 'Procesando...';

    fetch('/attendance/scan', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ code })
    })
    .then(res => res.text())
    .then(rawText => {
        let data;
        try { data = JSON.parse(rawText); }
        catch(e) {
            playError();
            showFlash('error', 'ERROR', 'Conexión fallida');
            resume(); return;
        }

        const nombre = data.student_name || 'Desconocido';
        const estado = data.status || 'error';

        if (estado === 'success')      playSuccess();
        else if (estado === 'warning') playWarning();
        else                           playError();

        showFlash(estado, nombre, data.message);

        if (estado !== 'error') addHistory(estado, nombre);
    })
    .catch(() => {
        playError();
        showFlash('error', 'SIN CONEXIÓN', '');
        resume();
    });
}

function resume() {
    setTimeout(() => {
        isProcessing = false;
        if (html5QrcodeScanner) html5QrcodeScanner.resume();
        const statusEl = document.getElementById('status-text');
        if (statusEl) statusEl.textContent = 'Acerca tu medallón';
    }, FLASH_DURATION);
}

// ── INICIAR CÁMARA (al tocar la pantalla) ────────────
let scannerStarted = false;

function initScanner() {
    if (scannerStarted) return;
    scannerStarted = true;

    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('scanner-frame').style.display = 'block';

    const frame = document.getElementById('scanner-frame');
    const size  = frame ? Math.min(frame.clientWidth, frame.clientHeight) - 20 : 300;

    html5QrcodeScanner = new Html5QrcodeScanner(
        "reader",
        {
            fps: 15,
            qrbox: { width: Math.floor(size * 0.85), height: Math.floor(size * 0.85) },
            rememberLastUsedCamera: true,     // recuerda la cámara elegida
            showTorchButtonIfSupported: true  // linterna si disponible
            // Sin facingMode forzado: el usuario elige la primera vez,
            // rememberLastUsedCamera la guarda para siempre
        }
    );

    html5QrcodeScanner.render(
        (decoded) => {
            handleScan(decoded);
            // Resumir después del flash
            setTimeout(() => {
                isProcessing = false;
                if (html5QrcodeScanner) html5QrcodeScanner.resume();
            }, FLASH_DURATION + 200);
        },
        (err) => { /* errores de lectura normales, ignorar */ }
    );

    startMirrorCheck();
    initNFC();
}

// Toque en pantalla derecha para activar
document.getElementById('right-panel').addEventListener('click', initScanner);
// Auto-iniciar al cargar (si ya tiene permisos guardados)
window.addEventListener('load', () => setTimeout(initScanner, 300));

// ── MODO ESPEJO (cámara selfie) ──────────────────────
function startMirrorCheck() {
    setInterval(() => {
        const video = document.querySelector('#reader video');
        if (!video || !video.srcObject) return;
        const label = video.srcObject.getVideoTracks()[0]?.label?.toLowerCase() || '';
        if (label.includes('front') || label.includes('user') || label.includes('facetime')) {
            video.classList.add('mirror');
        } else {
            video.classList.remove('mirror');
        }
    }, 1000);
}

// ── NFC ───────────────────────────────────────────────
async function initNFC() {
    if (!('NDEFReader' in window)) return;
    try {
        const ndef = new NDEFReader();
        await ndef.scan();
        const nfcEl = document.getElementById('nfc-indicator');
        if (nfcEl) nfcEl.classList.add('visible');
        ndef.addEventListener('reading', ({ message }) => {
            for (const record of message.records) {
                const decoder = new TextDecoder(record.encoding || 'utf-8');
                const raw  = decoder.decode(record.data).trim();
                const code = raw.includes('?code=') ? raw.split('?code=')[1] : raw;
                handleScan(code);
            }
        });
    } catch(e) {
        console.warn('NFC no disponible:', e.message);
    }
}