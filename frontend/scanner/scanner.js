// scanner/scanner.js — v3.1 bugfix
// FIXES aplicados:
// [FIX-1] validateJRS: si no hay clave local, hace fetch online en lugar de rechazar
// [FIX-2] b64uDecode: usa TextDecoder en lugar de escape()/unescape() (falla en Firefox/Samsung)
// [FIX-3] NFC: la clave se recarga automáticamente si estaba ausente al momento del scan
// [FIX-4] QR Admin: se expone initAdminScanner() para que admin.js pueda inicializarlo

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
    if (document.visibilityState === 'visible') {
        requestWakeLock();
        // Android pausa el browser al procesar NFC — reintentar varias veces
        // porque el sistema puede tardar hasta 1s en devolver el control completo
        [300, 700, 1200].forEach(delay => {
            setTimeout(() => {
                if (typeof _resumeCamera === 'function') _resumeCamera();
            }, delay);
        });
    }
});

// ── FIX 2: GESTIÓN DEL PIN DEL SCANNER ────────────────────────────────────
let _scannerPin = sessionStorage.getItem('scanner_pin') || '';
let _pinBuffer = '';

function getScannerHeaders() {
    const h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (_scannerPin) h['X-Scanner-Pin'] = _scannerPin;
    return h;
}

function pinUpdateDots() {
    const dots = document.getElementById('pin-dots');
    if (!dots) return;
    const filled = '●'.repeat(_pinBuffer.length);
    const empty = '○'.repeat(Math.max(0, 4 - _pinBuffer.length));
    dots.textContent = (filled + ' ' + empty).trim() || '○ ○ ○ ○';
}

function pinKey(k) {
    const errEl = document.getElementById('pin-err');
    if (errEl) errEl.textContent = '';
    if (k === 'DEL') { _pinBuffer = _pinBuffer.slice(0, -1); }
    else if (_pinBuffer.length < 8) { _pinBuffer += k; }
    pinUpdateDots();
}

async function pinSubmit() {
    if (!_pinBuffer) return;
    const errEl = document.getElementById('pin-err');
    try {
        const r = await fetch('/attendance/scanner/offline-data', {
            headers: { 'X-Scanner-Pin': _pinBuffer }
        });
        if (r.ok) {
            _scannerPin = _pinBuffer;
            sessionStorage.setItem('scanner_pin', _scannerPin);
            const data = await r.json();
            _saveOfflineData(data);

            const indicator = document.getElementById('offline-queue-indicator');
            if (indicator) {
                indicator.style.background = 'var(--gold)';
                indicator.style.color = '#000';
            }

            if (typeof _startSyncLoop === 'function') _startSyncLoop();
            hidePinOverlay();
        } else {
            if (errEl) errEl.textContent = 'PIN incorrecto. Inténtalo de nuevo.';
            _pinBuffer = '';
            pinUpdateDots();
        }
    } catch (e) {
        if (errEl) errEl.textContent = 'Sin conexión — PIN almacenado.';
        _scannerPin = _pinBuffer;
        sessionStorage.setItem('scanner_pin', _scannerPin);
        setTimeout(hidePinOverlay, 1500);
    }
}

function showPinOverlay() {
    const ov = document.getElementById('pin-overlay');
    if (ov) { ov.style.display = 'flex'; }
}
function hidePinOverlay() {
    const ov = document.getElementById('pin-overlay');
    if (ov) { ov.style.display = 'none'; }
}

// ── [FIX-3] Helper para guardar datos offline incluyendo la clave ──────────
function _saveOfflineData(data) {
    if (data._META_SIGNING_KEY) {
        localStorage.setItem('jr_signing_key', data._META_SIGNING_KEY);
        _cryptoKey = null; // forzar re-importación con la nueva clave
        delete data._META_SIGNING_KEY;
    }
    localStorage.setItem('scanner_offline_db', JSON.stringify(data));
}

window.addEventListener('load', async () => {
    try {
        const r = await fetch('/attendance/scanner/offline-data',
            { headers: _scannerPin ? { 'X-Scanner-Pin': _scannerPin } : {} });
        if (r.status === 401) {
            _scannerPin = '';
            sessionStorage.removeItem('scanner_pin');
            _pinBuffer = '';
            showPinOverlay();
        } else if (r.ok) {
            const data = await r.json();
            _saveOfflineData(data);
            hidePinOverlay();
        }
    } catch { /* sin conexión al cargar — usar clave almacenada */ }
    setTimeout(initScanner, 300);
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
    const headers = _scannerPin ? { 'X-Scanner-Pin': _scannerPin } : {};
    fetch('/attendance/scanner/offline-data', { headers })
        .then(res => res.json())
        .then(data => {
            _saveOfflineData(data);
            console.log("Base de datos offline actualizada:", Object.keys(data).length, "registros");
        })
        .catch(err => console.log("Error actualizando DB offline:", err));
}
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

// ── CRYPTO: VALIDACIÓN HMAC LOCAL ─────────────────────────
const SIGNING_KEY_SK = 'jr_signing_key';
let _cryptoKey = null;

function hexToBytes(hex) {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2)
        arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    return arr;
}

async function getCryptoKey() {
    if (_cryptoKey) return _cryptoKey;
    const keyHex = localStorage.getItem(SIGNING_KEY_SK);
    if (!keyHex) return null;
    try {
        _cryptoKey = await crypto.subtle.importKey(
            'raw', hexToBytes(keyHex),
            { name: 'HMAC', hash: 'SHA-256' },
            false, ['sign']
        );
        return _cryptoKey;
    } catch { return null; }
}

async function computeHmac(short_id, valid_yyyymmdd, name_b64) {
    const key = await getCryptoKey();
    if (!key) return null;
    const msg = new TextEncoder().encode(`${short_id}|${valid_yyyymmdd}|${name_b64}`);
    const sig = await crypto.subtle.sign('HMAC', key, msg);
    return Array.from(new Uint8Array(sig).slice(0, 8))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

// [FIX-2] b64uDecode con TextDecoder — funciona correctamente con UTF-8 multi-byte
// (la versión anterior con escape()/unescape() falla en Firefox y Samsung Browser)
function b64uDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    try {
        // Método moderno y correcto para UTF-8
        const binary = atob(str);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new TextDecoder('utf-8').decode(bytes);
    } catch {
        // Fallback para navegadores muy antiguos
        return decodeURIComponent(escape(atob(str)));
    }
}

// [FIX-1] validateJRS: si no hay clave local, recarga desde el servidor antes de fallar
async function validateJRS(code) {
    if (!code.startsWith('JRS:')) return null;
    const parts = code.slice(4).split(':');
    if (parts.length !== 4) return null;

    const [short_id, valid_date, name_b64, sig] = parts;

    let name;
    try { name = b64uDecode(name_b64); } catch { return null; }

    // [FIX-1] Si no hay clave en localStorage, intentar recargar del servidor
    if (!localStorage.getItem(SIGNING_KEY_SK)) {
        console.warn('[validateJRS] Sin clave de firma local — recargando del servidor...');
        try {
            const headers = _scannerPin ? { 'X-Scanner-Pin': _scannerPin } : {};
            const r = await fetch('/attendance/scanner/offline-data', { headers });
            if (r.ok) {
                const data = await r.json();
                _saveOfflineData(data); // guarda la clave y actualiza _cryptoKey = null
            }
        } catch (e) {
            console.warn('[validateJRS] No se pudo recargar clave:', e.message);
        }
    }

    const expected = await computeHmac(short_id, valid_date, name_b64);

    // Si aun sin clave (offline sin datos previos), confiar en el servidor para validar
    if (!expected) {
        console.warn('[validateJRS] Sin clave local — enviando al servidor para validación online');
        return { short_id, name, valid_date, debe: false, skipLocalValidation: true };
    }

    if (expected !== sig) return null; // firma inválida

    // Verificar fecha
    const hoy = new Date();
    const yyyy = valid_date.slice(0, 4);
    const mm = valid_date.slice(4, 6) - 1;
    const dd = valid_date.slice(6, 8);
    const vencimiento = new Date(yyyy, mm, dd);
    vencimiento.setHours(23, 59, 59);

    return { short_id, name, valid_date, debe: vencimiento < hoy };
}

async function processOfflineScan(code, fromNFC = false) {
    try {
        const db = JSON.parse(localStorage.getItem('scanner_offline_db') || '{}');

        let studentId = code;
        let fallbackName = "Desconocido";

        if (code.startsWith("JRS:")) {
            const parsed = await validateJRS(code);

            if (!parsed) {
                playError();
                showFlash('error', 'QR INVÁLIDO', 'Firma criptográfica incorrecta.');
                resume(fromNFC);
                return;
            }

            // [FIX-1] Si no había clave local, skipLocalValidation=true → ir online
            if (parsed.skipLocalValidation) {
                // Redirigir al flujo online aunque esté en processOfflineScan
                isProcessing = false; // liberar el lock antes de llamar handleScan online
                _doOnlineScan(code, fromNFC);
                return;
            }

            if (parsed.debe) {
                playWarning();
                showFlash('debe', parsed.name, 'Mensualidad vencida (Offline)');
                resume(fromNFC);
                return;
            }

            studentId = parsed.short_id; // usar short_id para buscar en DB offline
            fallbackName = parsed.name;

            if (!db[studentId]) {
                const fullId = Object.keys(db).find(k => k.length > 8 && k.startsWith(studentId));
                if (fullId) { studentId = fullId; }
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
            else playWarning();

            showFlash(info.status, info.name, msg);
            addHistory(info.status, info.name + " (Offline)");
            resume(fromNFC);
        } else {
            if (code.startsWith("JRS:")) {
                queuedScans.push({ code, timestamp: new Date().toISOString() });
                localStorage.setItem('scanner_queued_scans', JSON.stringify(queuedScans));
                updateQueueUI();
                playSuccess();
                showFlash('success', fallbackName, 'Guardado Offline');
                addHistory('success', fallbackName + " (Offline)");
                resume(fromNFC);
            } else {
                playError();
                showFlash('error', 'SIN CONEXIÓN', 'No se puede validar código clásico');
                resume(fromNFC);
            }
        }
    } catch (e) {
        console.error('[Scanner] Error inesperado en processOfflineScan:', e);
        resume(fromNFC);
    }
}

// ── SYNC OFFLINE ──────────────────────────────────────
let _syncIntervalId = null;

function _stopSyncLoop() {
    if (_syncIntervalId !== null) {
        clearInterval(_syncIntervalId);
        _syncIntervalId = null;
        console.warn('[Sync] Bucle de sincronización DETENIDO.');
    }
}

function _startSyncLoop() {
    if (_syncIntervalId !== null) return;
    _syncIntervalId = setInterval(syncOfflineQueue, 15000);
}

function syncOfflineQueue() {
    if (!navigator.onLine || queuedScans.length === 0) return;

    const token = localStorage.getItem('trainer_token') || '';
    const offlineDb = JSON.parse(localStorage.getItem('scanner_offline_db') || '{}');

    const batchRecords = queuedScans.map((scan, index) => {
        let student_id = null;

        if (scan.code.startsWith("JRS:")) {
            const parts = scan.code.split(":");
            const shortId = parts.length >= 2 ? parts[1] : null;
            if (shortId) {
                const fullUuid = Object.keys(offlineDb).find(
                    k => k.length === 36 && k.startsWith(shortId)
                );
                student_id = fullUuid || null;
            }
        } else {
            student_id = scan.code;
        }

        return {
            student_id: student_id || scan.code,
            timestamp: scan.timestamp,
            local_id: `sync-${index}-${scan.timestamp}`
        };
    }).filter(r => r.student_id);

    fetch('/attendance/sync-batch', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ records: batchRecords, token })
    })
        .then(res => {
            if (res.ok) {
                queuedScans = [];
                localStorage.setItem('scanner_queued_scans', JSON.stringify(queuedScans));
                updateQueueUI();
                console.log('[Sync] Sincronización masiva exitosa.');
                return;
            }
            if (res.status === 401) {
                console.error('[Sync] 401 Unauthorized — deteniendo bucle.');
                _stopSyncLoop();
                const indicator = document.getElementById('offline-queue-indicator');
                if (indicator) {
                    indicator.style.background = '#c0392b';
                    indicator.style.color = '#fff';
                    indicator.textContent = `⚠️ Sesión expirada. ${queuedScans.length} escaneos pendientes.`;
                    indicator.style.display = 'block';
                }
                showPinOverlay();
                const pinErr = document.getElementById('pin-err');
                if (pinErr) pinErr.textContent = 'Sesión expirada. Ingrese PIN para sincronizar datos offline.';
                return;
            }
            if (res.status === 413 || res.status === 400) {
                console.error(`[Sync] ${res.status} — Lote rechazado.`);
                _stopSyncLoop();
                return;
            }
            console.warn('[Sync] Fallo temporal. Status:', res.status);
        })
        .catch(err => console.log('[Sync] Error de red:', err));
}

window.addEventListener('online', () => {
    fetchOfflineData();
    _startSyncLoop();
    syncOfflineQueue();
});

_startSyncLoop();

// ── LÓGICA CENTRAL DE SCAN ────────────────────────────
let html5Qrcode = null;
let isProcessing = false;
let _safetyTimer = null;

function _armSafety(fromNFC) {
    if (_safetyTimer) clearTimeout(_safetyTimer);
    _safetyTimer = setTimeout(() => {
        if (isProcessing) {
            console.warn('[Scanner] Safety-net: forzando reset de isProcessing');
            isProcessing = false;
            _resumeCamera();
            const s = document.getElementById('status-text');
            if (s) s.textContent = 'Acerca tu medallón';
        }
        _safetyTimer = null;
    }, 10000);
}

// Separar el fetch online para poder llamarlo desde processOfflineScan si no hay clave
function _doOnlineScan(code, fromNFC) {
    isProcessing = true;
    _armSafety(fromNFC);

    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.textContent = 'Procesando...';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    fetch('/attendance/scan', {
        method: 'POST',
        headers: getScannerHeaders(),
        body: JSON.stringify({ code }),
        signal: controller.signal
    })
        .then(res => { clearTimeout(timeoutId); return res.text(); })
        .then(rawText => {
            let data;
            try { data = JSON.parse(rawText); }
            catch (e) {
                playError();
                showFlash('error', 'ERROR', 'Conexión fallida');
                resume(fromNFC); return;
            }

            if (data.detail) {
                playError();
                showFlash('error', 'RECHAZADO', data.detail);
                resume(fromNFC); return;
            }

            const nombre = data.student_name || 'Desconocido';
            const estado = data.status || 'error';

            if (estado === 'success') playSuccess();
            else if (estado === 'warning') playWarning();
            else if (estado === 'debe') playWarning();
            else playError();

            showFlash(estado, nombre, data.message || data.detail);
            if (estado !== 'error') addHistory(estado, nombre);
            resume(fromNFC);
        })
        .catch(() => {
            processOfflineScan(code, fromNFC);
        });
}

function handleScan(decodedText, fromNFC = false) {
    if (isProcessing) return;

    const code = decodedText.includes('?code=')
        ? decodedText.split('?code=')[1]
        : decodedText;

    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.textContent = 'Procesando...';

    if (!navigator.onLine) {
        isProcessing = true;
        _armSafety(fromNFC);
        processOfflineScan(code, fromNFC);
        return;
    }

    _doOnlineScan(code, fromNFC);
}

function _resumeCamera() {
    if (!html5Qrcode) return;

    // Paso 1: intentar resume() de la librería sin importar el estado reportado.
    // html5-qrcode a veces reporta state=2 (SCANNING) pero internamente está pausado,
    // especialmente tras una interrupción de NFC en Android.
    try {
        if (typeof html5Qrcode.resume === 'function') {
            html5Qrcode.resume();
        }
    } catch (e) { /* ya estaba activa — ignorar */ }

    // Paso 2: forzar el elemento <video> a reproducir (Android bloquea el autoplay tras NFC)
    const forceVideo = () => {
        const video = document.querySelector('#reader video');
        if (video) {
            // Quitar atributo pause que pone html5-qrcode internamente
            video.removeAttribute('data-paused');
            if (video.paused) {
                video.play().catch(() => {
                    // Si play() falla (política de autoplay), reintentar tras interacción
                    // El watchdog lo rescatará en el próximo ciclo de 2.5s
                });
            }
        }
        // Ocultar el cartel "Scanner paused" que deja la librería en el DOM
        document.querySelectorAll('#reader *').forEach(el => {
            if (el.innerText && el.innerText.trim() === 'Scanner paused') {
                el.style.display = 'none';
            }
        });
    };

    // Ejecutar inmediatamente y también con delay para cubrir la animación de vuelta de NFC
    forceVideo();
    setTimeout(forceVideo, 200);
    setTimeout(forceVideo, 600);
}

setInterval(() => {
    if (!scannerStarted || isProcessing || document.visibilityState !== 'visible') return;
    try {
        const state = html5Qrcode ? (typeof html5Qrcode.getState === 'function' ? html5Qrcode.getState() : -1) : -1;
        const video = document.querySelector('#reader video');
        const scannerPausedVisible = Array.from(document.querySelectorAll('#reader *'))
            .some(el => el.innerText && el.innerText.trim() === 'Scanner paused' && el.style.display !== 'none');

        // Rescatar si: estado PAUSED, video pausado, O cartel "Scanner paused" visible
        if (state === 3 || (video && video.paused) || scannerPausedVisible) {
            console.warn("[Watchdog] Cámara atorada detectada (state=" + state + ", videoPaused=" + (video && video.paused) + "). Rescatando...");
            _resumeCamera();
        }
    } catch (e) { }
}, 2500);

function resume(fromNFC = false) {
    setTimeout(() => {
        isProcessing = false;
        _resumeCamera();
        const statusEl = document.getElementById('status-text');
        if (statusEl) statusEl.textContent = 'Acerca tu medallón';
    }, FLASH_DURATION);
}

// ── INICIAR CÁMARA ────────────────────────────────────
let scannerStarted = false;

function initScanner() {
    if (scannerStarted) return;
    scannerStarted = true;

    const startScreen = document.getElementById('start-screen');
    const scannerFrame = document.getElementById('scanner-frame');
    if (startScreen) startScreen.style.display = 'none';
    if (scannerFrame) scannerFrame.style.display = 'block';

    const frame = document.getElementById('scanner-frame');
    const size = frame ? Math.min(frame.clientWidth, frame.clientHeight) - 20 : 300;
    const qrboxSide = Math.floor(size * 0.85);

    html5Qrcode = new Html5Qrcode('reader');

    Html5Qrcode.getCameras()
        .then(cameras => {
            if (!cameras || cameras.length === 0) {
                console.error('[Scanner] No se encontraron cámaras.');
                return;
            }

            const savedId = localStorage.getItem('preferred_camera_id');
            let camId = cameras[0].id;
            if (savedId && cameras.find(c => c.id === savedId)) {
                camId = savedId;
            } else {
                const back = cameras.find(c =>
                    c.label.toLowerCase().includes('back') ||
                    c.label.toLowerCase().includes('rear') ||
                    c.label.toLowerCase().includes('environment')
                );
                if (back) camId = back.id;
            }

            return html5Qrcode.start(
                camId,
                {
                    fps: 15,
                    qrbox: { width: qrboxSide, height: qrboxSide },
                    aspectRatio: 1.0
                },
                (decodedText) => { handleScan(decodedText); },
                () => { }
            ).then(() => {
                localStorage.setItem('preferred_camera_id', camId);
            });
        })
        .catch(err => console.error('[Scanner] Error iniciando cámara:', err));

    startMirrorCheck();
    initNFC();
}

const rightPanel = document.getElementById('right-panel');
if (rightPanel) {
    rightPanel.addEventListener('click', () => {
        if (!scannerStarted) initScanner();
        else if (!isProcessing) _resumeCamera();
    });
}

// ── MODO ESPEJO ──────────────────────────────────────
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
const NDEF_URI_PREFIXES = [
    '',             // 0x00
    'http://www.',  // 0x01
    'https://www.', // 0x02
    'http://',      // 0x03
    'https://',     // 0x04 ← más común
    'tel:',         // 0x05
    'mailto:',      // 0x06
    'ftp://anonymous:anonymous@', // 0x07
    'ftp://ftp.',   // 0x08
    'ftps://',      // 0x09
    'sftp://',      // 0x0A
    'smb://',       // 0x0B
    'nfs://',       // 0x0C
    'ftp://',       // 0x0D
    'dav://',       // 0x0E
    'news:',        // 0x0F
    'telnet://',    // 0x10
    'imap:',        // 0x11
    'rtsp://',      // 0x12
    'urn:',         // 0x13
    'pop:',         // 0x14
    'sip:',         // 0x15
    'sips:',        // 0x16
    'tftp:',        // 0x17
    'btspp://',     // 0x18
    'btl2cap://',   // 0x19
    'btgoep://',    // 0x1A
    'tcpobex://',   // 0x1B
    'irdaobex://',  // 0x1C
    'file://',      // 0x1D
    'urn:epc:id:',  // 0x1E
    'urn:epc:tag:', // 0x1F
    'urn:epc:pat:', // 0x20
    'urn:epc:raw:', // 0x21
    'urn:epc:',     // 0x22
    'urn:nfc:',     // 0x23
];

async function initNFC() {
    if (!('NDEFReader' in window)) {
        console.warn('[NFC] NDEFReader no disponible en este navegador/dispositivo.');
        return;
    }
    try {
        const ndef = new NDEFReader();
        await ndef.scan();
        const nfcEl = document.getElementById('nfc-indicator');
        if (nfcEl) nfcEl.classList.add('visible');
        console.log('[NFC] Escáner NFC activo ✅');

        ndef.addEventListener('reading', ({ message }) => {
            for (const record of message.records) {
                let fullText = null;

                try {
                    if (record.recordType === 'url') {
                        const bytes = new Uint8Array(record.data.buffer,
                            record.data.byteOffset,
                            record.data.byteLength);
                        const identifierCode = bytes[0];
                        const prefix = NDEF_URI_PREFIXES[identifierCode] ?? '';
                        const rest = new TextDecoder('utf-8').decode(bytes.slice(1)).trim();
                        fullText = prefix + rest;

                    } else if (record.recordType === 'text') {
                        const bytes = new Uint8Array(record.data.buffer,
                            record.data.byteOffset,
                            record.data.byteLength);
                        const statusByte = bytes[0];
                        const isUtf16 = (statusByte & 0x80) !== 0;
                        const langLen = statusByte & 0x3F;
                        const textBytes = bytes.slice(1 + langLen);
                        const charset = isUtf16 ? 'utf-16' : 'utf-8';
                        fullText = new TextDecoder(charset).decode(textBytes).trim();

                    } else {
                        // Tipo desconocido: fallback
                        const raw = new TextDecoder(record.encoding || 'utf-8')
                            .decode(record.data)
                            .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
                            .trim();
                        fullText = raw;
                    }
                } catch {
                    continue;
                }

                if (!fullText) continue;

                let code = null;

                if (fullText.startsWith('http://') || fullText.startsWith('https://')) {
                    try {
                        const url = new URL(fullText);
                        const param = url.searchParams.get('code');
                        if (param) code = decodeURIComponent(param);
                    } catch {
                        const idx = fullText.indexOf('?code=');
                        if (idx !== -1) code = decodeURIComponent(fullText.slice(idx + 6));
                    }
                } else if (fullText.startsWith('JRS:') || fullText.startsWith('STU-')) {
                    code = fullText;
                } else if (fullText.includes('?code=')) {
                    code = decodeURIComponent(fullText.split('?code=')[1]);
                }

                if (!code) continue;

                _resumeCamera();
                handleScan(code.trim(), true);
                break;
            }
        });

        ndef.addEventListener('readingerror', (e) => {
            console.warn('[NFC] Error de lectura:', e);
        });

    } catch (e) {
        console.warn('[NFC] No disponible o permiso denegado:', e.message);
        // No mostrar error al usuario — NFC es opcional, el QR sigue funcionando
    }
}