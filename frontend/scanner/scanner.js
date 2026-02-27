// scanner/scanner.js — v3.0 unificado
// Este archivo ES el kiosko. No necesita kiosko.js separado.

// ── BLOQUEAR BOTÓN ATRÁS ──────────────────────────────
window.history.pushState(null, null, window.location.href);
window.onpopstate = function () { window.history.go(1); };

// ── WAKE LOCK (pantalla no se apaga) ─────────────────
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try { await navigator.wakeLock.request('screen'); } catch (e) { }
    }
}
requestWakeLock();
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
});

// ── RELOJ ─────────────────────────────────────────────
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const clockEl = document.getElementById('clock');
    const dateEl = document.getElementById('date-display');
    if (clockEl) clockEl.textContent = `${h}:${m}`;
    if (dateEl) dateEl.textContent = `${DIAS[now.getDay()]} ${now.getDate()} ${MESES[now.getMonth()]}`;
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
    const nameEl = document.getElementById('result-name');
    const msgEl = document.getElementById('result-msg');

    if (!flashBg || !overlay || !nameEl) return;

    flashBg.className = `show ${estado}`;
    overlay.className = `result-overlay show ${estado}`;
    nameEl.textContent = nombre || 'Desconocido';
    if (msgEl) {
        msgEl.textContent = estado === 'success' ? '¡BIENVENIDO!' :
            estado === 'warning' ? 'YA REGISTRADO' :
                estado === 'debe' ? 'MENSUALIDAD VENCIDA' : 'RECHAZADO';
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

    const hora = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

// ── SINCRONIZACIÓN OFFLINE ────────────────────────────
function fetchOfflineData() {
    fetch('/attendance/scanner/offline-data')
        .then(res => res.json())
        .then(data => {
            localStorage.setItem('scanner_offline_db', JSON.stringify(data));
            console.log("Base de datos offline actualizada:", Object.keys(data).length, "registros");
        })
        .catch(err => console.log("Error actualizando DB offline:", err));
}
// Actualizar al cargar y cada 5 min
fetchOfflineData();
setInterval(fetchOfflineData, 5 * 60 * 1000);

let queuedScans = JSON.parse(localStorage.getItem('scanner_queued_scans') || '[]');
function updateQueueUI() {
    let indicator = document.getElementById('offline-queue-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'offline-queue-indicator';
        indicator.style.cssText = 'position:fixed;bottom:1rem;right:1rem;background:var(--gold);color:#000;padding:.5rem 1rem;border-radius:20px;font-family:var(--font-cond);font-weight:bold;z-index:9999;display:none;';
        document.body.appendChild(indicator);
    }
    if (queuedScans.length > 0) {
        indicator.style.display = 'block';
        indicator.textContent = `⏳ ${queuedScans.length} pendientes de envío`;
    } else {
        indicator.style.display = 'none';
    }
}
updateQueueUI();

function processOfflineScan(code) {
    const db = JSON.parse(localStorage.getItem('scanner_offline_db') || '{}');

    // Decodificar el código para buscar el ID en caso de JRS
    let studentId = code;
    let fallbackName = "Desconocido";

    if (code.startsWith("JRS:")) {
        const parts = code.split(":");
        if (parts.length >= 4) {
            studentId = parts[1];
            try {
                // b64u_decode aproximado
                const base64 = (parts[3] + '===').slice(0, parts[3].length + (parts[3].length % 4 ? 4 - parts[3].length % 4 : 0)).replace(/-/g, '+').replace(/_/g, '/');
                fallbackName = decodeURIComponent(escape(atob(base64)));
            } catch (e) {
                fallbackName = "Alumno";
            }
        }
    }

    const info = db[studentId];
    if (info) {
        queuedScans.push({ code, timestamp: new Date().toISOString() });
        localStorage.setItem('scanner_queued_scans', JSON.stringify(queuedScans));
        updateQueueUI();

        let msg = info.detalle;
        if (info.status === 'success') msg = "¡BIENVENIDO! (Guardado Offline)";

        if (info.status === 'success') playSuccess();
        else if (info.status === 'warning') playWarning();
        else playWarning(); // debe

        showFlash(info.status, info.name, msg);
        addHistory(info.status, info.name + " (Offline)");
        resume();
    } else {
        // En JRS intentamos extraer el nombre válido aunque no lo tengamos en DB local
        if (code.startsWith("JRS:")) {
            queuedScans.push({ code, timestamp: new Date().toISOString() });
            localStorage.setItem('scanner_queued_scans', JSON.stringify(queuedScans));
            updateQueueUI();
            playSuccess();
            showFlash('success', fallbackName, 'Guardado Offline');
            addHistory('success', fallbackName + " (Offline)");
            resume();
        } else {
            playError();
            showFlash('error', 'SIN CONEXIÓN', 'No se puede validar código clásico');
            resume();
        }
    }
}

function syncOfflineQueue() {
    if (!navigator.onLine || queuedScans.length === 0) return;

    // Obtener la identidad del entrenador
    const token = localStorage.getItem('trainer_token') || '';

    // Preparar el lote de registros adaptándolos a BatchScanRecord
    const batchRecords = queuedScans.map((scan, index) => {
        let student_id = scan.code;
        // Si es código seguro generado offline (JRS:), extraer solo el ID
        if (scan.code.startsWith("JRS:")) {
            const parts = scan.code.split(":");
            if (parts.length >= 2) student_id = parts[1];
        }
        return {
            student_id: student_id,
            timestamp: scan.timestamp,
            local_id: 'sync-' + Date.now() + '-' + index
        };
    });

    // Enviar lote completo con un solo Request
    fetch('/attendance/sync-batch', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            records: batchRecords,
            token: token // Enviado también en el body por requerimiento de FastAPI
        })
    })
        .then(res => {
            if (res.ok) {
                // Solo si la respuesta es exitosa vaciamos la memoria (200 OK)
                queuedScans = [];
                localStorage.setItem('scanner_queued_scans', JSON.stringify(queuedScans));
                updateQueueUI();
                console.log("Sincronización masiva exitosa.");
            } else {
                console.warn("Reteniendo mochila: Fallo el sync masivo. Status:", res.status);
            }
        })
        .catch(err => {
            console.log("Reteniendo mochila: Error de red durante el sync, reintentando en próximo ciclo:", err);
        });
}

window.addEventListener('online', () => {
    fetchOfflineData();
    syncOfflineQueue();
});
setInterval(syncOfflineQueue, 15000);

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

    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.textContent = 'Procesando...';

    if (!navigator.onLine) {
        processOfflineScan(code);
        return;
    }

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
            catch (e) {
                playError();
                showFlash('error', 'ERROR', 'Conexión fallida');
                resume(); return;
            }

            const nombre = data.student_name || 'Desconocido';
            const estado = data.status || 'error';

            if (estado === 'success') playSuccess();
            else if (estado === 'warning') playWarning();
            else if (estado === 'debe') playWarning(); // doble tono de advertencia
            else playError();

            showFlash(estado, nombre, data.message);

            if (estado !== 'error') addHistory(estado, nombre);
        })
        .catch(() => {
            // Si el fetch falla, intentamos procesarlo en modo offline
            processOfflineScan(code);
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
    const size = frame ? Math.min(frame.clientWidth, frame.clientHeight) - 20 : 300;

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
                const raw = decoder.decode(record.data).trim();
                const code = raw.includes('?code=') ? raw.split('?code=')[1] : raw;
                handleScan(code);
            }
        });
    } catch (e) {
        console.warn('NFC no disponible:', e.message);
    }
}