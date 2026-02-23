// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  JR Stars — Scanner Kiosko v2.0
//  QR + NFC | Modo horizontal | Tema rojo/dorado
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const API_URL = "https://emblema-app-production.up.railway.app";
const HEADERS = { 'Content-Type': 'application/json', 'Accept': 'application/json' };

// ── BLOQUEAR BOTÓN ATRÁS ─────────────────
window.history.pushState(null, null, window.location.href);
window.onpopstate = function() { window.history.go(1); };

// ── RELOJ ────────────────────────────────
const DIAS  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2,'0');
    const m = String(now.getMinutes()).padStart(2,'0');
    document.getElementById('clock').textContent = `${h}:${m}`;
    document.getElementById('date-display').textContent =
        `${DIAS[now.getDay()]} ${now.getDate()} ${MESES[now.getMonth()]}`;
}
updateClock();
setInterval(updateClock, 1000);

// ── SONIDOS ──────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSuccess() {
    [523, 659, 784].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sine'; osc.frequency.value = freq;
        const t = audioCtx.currentTime + i * 0.13;
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.start(t); osc.stop(t + 0.3);
    });
}

function playWarning() {
    [0, 0.25].forEach(offset => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sine'; osc.frequency.value = 420;
        const t = audioCtx.currentTime + offset;
        gain.gain.setValueAtTime(0.28, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.start(t); osc.stop(t + 0.2);
    });
}

function playError() {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.5);
}

// ── FLASH DE FONDO ───────────────────────
function flashBg(type) {
    const el = document.getElementById('flash-bg');
    el.className = `active ${type}`;
    setTimeout(() => { el.className = ''; }, 700);
}

// ── OVERLAY RESULTADO ────────────────────
let overlayTimer = null;
let scanning = true;

function showResult(type, icon, name, msg) {
    const overlay = document.getElementById('result-overlay');
    document.getElementById('result-icon').textContent = icon;
    document.getElementById('result-name').textContent = name;
    document.getElementById('result-msg').textContent  = msg;

    // Barra de progreso
    const existing = overlay.querySelector('.result-progress');
    if (existing) existing.remove();
    const bar = document.createElement('div');
    bar.className = 'result-progress';
    overlay.appendChild(bar);

    overlay.className = `result-overlay show ${type}`;

    if (overlayTimer) clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => {
        overlay.className = 'result-overlay';
        document.getElementById('status-text').textContent = 'Acerca tu medallón';
        scanning = true;
        scanner.resume();
    }, 2500);
}

// ── HISTORIAL ────────────────────────────
const historyItems = [];

function addHistory(type, name) {
    const strip = document.getElementById('history-strip');
    const hora  = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    historyItems.unshift({ type, name, hora });
    if (historyItems.length > 15) historyItems.pop();
    strip.innerHTML = historyItems.map(item => `
        <div class="history-item ${item.type}">
            <div class="h-dot"></div>
            <span class="h-name">${item.name}</span>
            <span class="h-time">${item.hora}</span>
        </div>
    `).join('');
}

// ── PROCESO DE SCAN ──────────────────────
function processCode(code) {
    if (!scanning) return;
    scanning = false;

    document.getElementById('status-text').textContent = 'Verificando...';
    scanner.pause();

    fetch(`${API_URL}/attendance/scan`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ code })
    })
    .then(r => r.text())
    .then(rawText => {
        let data;
        try { data = JSON.parse(rawText); }
        catch(e) {
            playError(); flashBg('error');
            showResult('error', '✗', 'ERROR', 'Sin conexión');
            scanning = true; return;
        }

        const estado = data.status;
        const nombre = data.student_name || 'Desconocido';

        if (estado === 'success') {
            playSuccess(); flashBg('success');
            showResult('success', '✓', nombre, '¡Bienvenido!');
            addHistory('success', nombre);
        } else if (estado === 'warning') {
            playWarning(); flashBg('warning');
            showResult('warning', '◎', nombre, 'Ya registrado hoy');
            addHistory('warning', nombre);
        } else {
            playError(); flashBg('error');
            showResult('error', '✗', 'Credencial inválida', 'Consulta al staff');
        }
    })
    .catch(() => {
        playError(); flashBg('error');
        showResult('error', '✗', 'SIN CONEXIÓN', 'Revisa el servidor');
        scanning = true;
    });
}

// ── QR SCANNER ───────────────────────────
function onScanSuccess(decodedText) {
    const code = decodedText.includes('?code=')
        ? decodedText.split('?code=')[1]
        : decodedText;
    processCode(code);
}

const scanner = new Html5QrcodeScanner('reader', {
    fps: 15,
    qrbox: { width: 250, height: 250 },
    rememberLastUsedCamera: true,
    showTorchButtonIfSupported: false,
    showZoomSliderIfSupported: false,
    videoConstraints: { facingMode: 'environment' }
});
scanner.render(onScanSuccess);

// ── NFC (Web NFC API — Chrome Android) ───
async function initNFC() {
    if (!('NDEFReader' in window)) {
        console.log('NFC no disponible en este dispositivo');
        return;
    }
    try {
        const nfc = new NDEFReader();
        await nfc.scan();

        // Mostrar indicador NFC
        const nfcEl = document.getElementById('nfc-indicator');
        if (nfcEl) nfcEl.classList.add('visible');

        nfc.addEventListener('reading', ({ message }) => {
            for (const record of message.records) {
                if (record.recordType === 'text') {
                    const decoder = new TextDecoder(record.encoding || 'utf-8');
                    const code = decoder.decode(record.data).trim();
                    processCode(code);
                } else if (record.recordType === 'url') {
                    const decoder = new TextDecoder();
                    const url = decoder.decode(record.data);
                    const code = url.includes('?code=') ? url.split('?code=')[1] : url;
                    processCode(code.trim());
                }
            }
        });

        console.log('✅ NFC activo');
    } catch(e) {
        console.warn('NFC no pudo iniciarse:', e.message);
    }
}
initNFC();

// ── WAKE LOCK (pantalla siempre encendida) ─
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try { await navigator.wakeLock.request('screen'); }
        catch(e) { console.warn('WakeLock no disponible'); }
    }
}
requestWakeLock();
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
});