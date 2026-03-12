// scanner/scanner.js — v3.2
// FIXES aplicados:
// [FIX-1] validateJRS: si no hay clave local, hace fetch online en lugar de rechazar
// [FIX-2] b64uDecode: usa TextDecoder en lugar de escape()/unescape() (falla en Firefox/Samsung)
// [FIX-3] NFC: la clave se recarga automáticamente si estaba ausente al momento del scan
// [FIX-4] QR Admin: se expone initAdminScanner() para que admin.js pueda inicializarlo
// [FIX-5] resume(fromNFC): usa delay correcto (2500ms NFC vs FLASH_DURATION QR)
// [FIX-6] _scannerStartedAt: se asigna correctamente en initScanner()
// [FIX-7] watchdog: no interrumpe mientras isProcessing=true

// ── CONSTANTES ────────────────────────────────────────
const FLASH_DURATION = 2200; // ms que se muestra el resultado en pantalla

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

// ── RELOJ ─────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    const clockEl = document.getElementById('clock');
    const dateEl = document.getElementById('date-display');
    if (clockEl) {
        clockEl.textContent = now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    }
    if (dateEl) {
        dateEl.textContent = now.toLocaleDateString('es-PE', {
            weekday: 'long', day: 'numeric', month: 'long'
        });
    }
}
updateClock();
setInterval(updateClock, 1000);

// ── DEBUG VISUAL ──────────────────────────────────────
function _dbg(msg) {
    let el = document.getElementById('_dbg_bar');
    if (!el) {
        el = document.createElement('div');
        el.id = '_dbg_bar';
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:rgba(0,0,0,0.85);color:#00ff88;font-size:12px;font-family:monospace;padding:4px 8px;pointer-events:none;';
        document.body.appendChild(el);
    }
    el.textContent = new Date().toLocaleTimeString() + ' > ' + msg;
}

// ── VISIBILIDAD ───────────────────────────────────────
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        requestWakeLock();
        _dbg('pagina visible - forzando restart camara');
        [100, 600, 1500, 3000].forEach(delay => {
            setTimeout(() => {
                if (!_restartingCamera) _hardRestartCamera();
            }, delay);
        });
    }
});

// ── GESTIÓN DEL PIN ───────────────────────────────────
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

// ── OFFLINE DATA ──────────────────────────────────────
function _saveOfflineData(data) {
    if (data._META_SIGNING_KEY) {
        localStorage.setItem('jr_signing_key', data._META_SIGNING_KEY);
        _cryptoKey = null;
        delete data._META_SIGNING_KEY;
    }
    localStorage.setItem('scanner_offline_db', JSON.stringify(data));
}

async function fetchOfflineData() {
    try {
        const r = await fetch('/attendance/scanner/offline-data',
            { headers: _scannerPin ? { 'X-Scanner-Pin': _scannerPin } : {} });
        if (r.ok) {
            const data = await r.json();
            _saveOfflineData(data);
        }
    } catch { /* sin conexión */ }
}

// ── LOAD ──────────────────────────────────────────────
window.addEventListener('load', async () => {
    const _urlParams = new URLSearchParams(window.location.search);
    const _nfcCode = _urlParams.get('code');
    if (_nfcCode) {
        window.history.replaceState({}, '', '/scanner');
        window._pendingNfcCode = _nfcCode.trim();
        _dbg('NFC via URL capturado: ' + _nfcCode.slice(0, 20));
    }

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
    } catch { /* sin conexion al cargar */ }
    setTimeout(initScanner, 300);
});

setInterval(fetchOfflineData, 5 * 60 * 1000);

// ── COLA OFFLINE ──────────────────────────────────────
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

// ── CRYPTO: VALIDACIÓN HMAC LOCAL ─────────────────────
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

// [FIX-2] b64uDecode con TextDecoder
function b64uDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    try {
        const binary = atob(str);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
    } catch {
        return decodeURIComponent(escape(atob(str)));
    }
}

// [FIX-1] validateJRS
async function validateJRS(code) {
    if (!code.startsWith('JRS:')) return null;
    const parts = code.slice(4).split(':');
    if (parts.length !== 4) return null;

    const [short_id, valid_date, name_b64, sig] = parts;
    let name;
    try { name = b64uDecode(name_b64); } catch { return null; }

    if (!localStorage.getItem(SIGNING_KEY_SK)) {
        console.warn('[validateJRS] Sin clave local — recargando del servidor...');
        try {
            const headers = _scannerPin ? { 'X-Scanner-Pin': _scannerPin } : {};
            const r = await fetch('/attendance/scanner/offline-data', { headers });
            if (r.ok) { const data = await r.json(); _saveOfflineData(data); }
        } catch (e) { console.warn('[validateJRS] No se pudo recargar clave:', e.message); }
    }

    const expected = await computeHmac(short_id, valid_date, name_b64);

    if (!expected) {
        console.warn('[validateJRS] Sin clave local — validando online');
        return { short_id, name, valid_date, debe: false, skipLocalValidation: true };
    }

    if (expected !== sig) return null;

    const hoy = new Date();
    const vencimiento = new Date(
        valid_date.slice(0, 4),
        valid_date.slice(4, 6) - 1,
        valid_date.slice(6, 8)
    );
    vencimiento.setHours(23, 59, 59);

    return { short_id, name, valid_date, debe: vencimiento < hoy };
}

// ── AUDIO ─────────────────────────────────────────────
function _beep(freq, duration, vol = 0.3) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.value = vol;
        osc.start();
        osc.stop(ctx.currentTime + duration / 1000);
        setTimeout(() => ctx.close(), duration + 100);
    } catch (e) { }
}

function playSuccess() { _beep(880, 120); setTimeout(() => _beep(1100, 180), 130); }
function playWarning() { _beep(440, 300); }
function playError()   { _beep(220, 400, 0.4); }

// ── FLASH / RESULTADO ─────────────────────────────────
const STATUS_CONFIG = {
    success: { icon: '✅', color: '#1a472a', text: '#00ff88' },
    warning: { icon: '⚠️', color: '#7a4a00', text: '#ffd700' },
    debe:    { icon: '💰', color: '#7a2a00', text: '#ff8c00' },
    error:   { icon: '❌', color: '#4a0000', text: '#ff4444' },
};

function showFlash(status, name, msg) {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.error;
    const overlay = document.getElementById('result-overlay');
    const iconEl  = document.getElementById('result-icon');
    const nameEl  = document.getElementById('result-name');
    const msgEl   = document.getElementById('result-msg');
    const flashBg = document.getElementById('flash-bg');

    if (iconEl)  iconEl.textContent  = cfg.icon;
    if (nameEl)  nameEl.textContent  = name || '';
    if (msgEl)   msgEl.textContent   = msg  || '';

    if (overlay) {
        overlay.className = 'result-overlay result-' + status;
        overlay.style.display = 'flex';
        setTimeout(() => { overlay.style.display = 'none'; }, FLASH_DURATION);
    }

    if (flashBg) {
        flashBg.style.background = cfg.color;
        flashBg.style.opacity = '1';
        setTimeout(() => { flashBg.style.opacity = '0'; }, FLASH_DURATION - 300);
    }
}

function addHistory(status, name) {
    const strip = document.getElementById('history-strip');
    if (!strip) return;
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.error;
    const item = document.createElement('div');
    item.className = 'history-item';
    item.style.color = cfg.text;
    item.textContent = cfg.icon + ' ' + name;
    strip.insertBefore(item, strip.firstChild);
    while (strip.children.length > 8) strip.removeChild(strip.lastChild);
}

// ── OFFLINE SCAN ──────────────────────────────────────
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

            if (parsed.skipLocalValidation) {
                isProcessing = false;
                _doOnlineScan(code, fromNFC);
                return;
            }

            if (parsed.debe) {
                playWarning();
                showFlash('debe', parsed.name, 'Mensualidad vencida (Offline)');
                resume(fromNFC);
                return;
            }

            studentId = parsed.short_id;
            fallbackName = parsed.name;

            if (!db[studentId]) {
                const fullId = Object.keys(db).find(k => k.length > 8 && k.startsWith(studentId));
                if (fullId) studentId = fullId;
            }
        }

        const info = db[studentId];
        if (info) {
            queuedScans.push({ code, timestamp: new Date().toISOString() });
            localStorage.setItem('scanner_queued_scans', JSON.stringify(queuedScans));
            updateQueueUI();

            const msg = info.status === 'success' ? "¡BIENVENIDO! (Guardado Offline)" : info.detalle;
            if (info.status === 'success') playSuccess();
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
        console.error('[Scanner] Error en processOfflineScan:', e);
        resume(fromNFC);
    }
}

// ── SYNC OFFLINE ──────────────────────────────────────
let _syncIntervalId = null;

function _stopSyncLoop() {
    if (_syncIntervalId !== null) {
        clearInterval(_syncIntervalId);
        _syncIntervalId = null;
        console.warn('[Sync] Bucle detenido.');
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
        return { student_id: student_id || scan.code, timestamp: scan.timestamp, local_id: `sync-${index}-${scan.timestamp}` };
    }).filter(r => r.student_id);

    fetch('/attendance/sync-batch', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: batchRecords, token })
    })
        .then(res => {
            if (res.ok) {
                queuedScans = [];
                localStorage.setItem('scanner_queued_scans', JSON.stringify(queuedScans));
                updateQueueUI();
                console.log('[Sync] Sincronización exitosa.');
                return;
            }
            if (res.status === 401) {
                console.error('[Sync] 401 — deteniendo bucle.');
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
                if (pinErr) pinErr.textContent = 'Sesión expirada. Ingrese PIN para sincronizar.';
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
            console.warn('[Scanner] Safety-net: forzando reset');
            isProcessing = false;
            _resumeCamera();
            const s = document.getElementById('status-text');
            if (s) s.textContent = 'Acerca tu medallón';
        }
        _safetyTimer = null;
    }, 10000);
}

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
            else if (estado === 'warning' || estado === 'debe') playWarning();
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

// ── CÁMARA ────────────────────────────────────────────
let _restartingCamera = false;
let _restartAttempts = 0;
const _MAX_RESTART_ATTEMPTS = 10;

function _resumeCamera() {
    if (!html5Qrcode) return;

    try {
        if (typeof html5Qrcode.resume === 'function') {
            html5Qrcode.resume();
        }
    } catch (e) { }

    setTimeout(() => {
        if (isProcessing) return; // [FIX-7] no chequear si aún procesando
        const video = document.querySelector('#reader video');
        const state = typeof html5Qrcode.getState === 'function' ? html5Qrcode.getState() : -1;
        const pausedLabel = Array.from(document.querySelectorAll('#reader *'))
            .some(el => el.innerText && el.innerText.trim() === 'Scanner paused' && el.style.display !== 'none');

        if (state === 3 || (video && video.paused) || pausedLabel) {
            _hardRestartCamera();
        }
    }, 600); // aumentado de 400 a 600ms para mayor estabilidad
}

function _hardRestartCamera() {
    if (_restartingCamera || !html5Qrcode) return;

    if (_restartAttempts >= _MAX_RESTART_ATTEMPTS) {
        console.error('[Scanner] Demasiados reintentos. Esperando interacción.');
        const statusEl = document.getElementById('status-text');
        if (statusEl) statusEl.textContent = 'Toca la pantalla para reactivar';
        document.getElementById('right-panel')?.addEventListener('click', () => {
            _restartAttempts = 0;
            _hardRestartCamera();
        }, { once: true });
        return;
    }

    _restartingCamera = true;
    _restartAttempts++;
    console.warn(`[Scanner] Hard restart #${_restartAttempts}...`);

    const camId = localStorage.getItem('preferred_camera_id');
    const frame = document.getElementById('scanner-frame');
    const size = frame ? Math.min(frame.clientWidth, frame.clientHeight) - 20 : 300;
    const qrboxSide = Math.floor(size * 0.85);

    html5Qrcode.stop()
        .catch(() => { })
        .finally(() => {
            document.querySelectorAll('#reader *').forEach(el => {
                if (el.innerText && el.innerText.trim() === 'Scanner paused') el.remove();
            });

            html5Qrcode.start(
                camId,
                { fps: 15, qrbox: { width: qrboxSide, height: qrboxSide }, aspectRatio: 1.0 },
                (decodedText) => { handleScan(decodedText); },
                () => { }
            )
                .then(() => {
                    _dbg('camara reiniciada OK #' + _restartAttempts);
                    _restartAttempts = 0;
                    _restartingCamera = false;
                    isProcessing = false;
                    _scannerStartedAt = Date.now(); // resetear ventana de gracia
                })
                .catch(err => {
                    console.error(`[Scanner] Error restart #${_restartAttempts}:`, err);
                    _restartingCamera = false;
                    setTimeout(() => _hardRestartCamera(), _restartAttempts * 1000);
                });
        });
}

// ── WATCHDOG ──────────────────────────────────────────
let _scannerStartedAt = 0; // [FIX-6] se asigna en initScanner()

setInterval(() => {
    if (!scannerStarted || _restartingCamera || document.visibilityState !== 'visible') return;
    if (Date.now() - _scannerStartedAt < 4000) return; // [FIX-6] ventana de gracia 4s
    if (isProcessing) return; // [FIX-7] no interrumpir mientras procesa un scan
    try {
        const state = html5Qrcode ? (typeof html5Qrcode.getState === 'function' ? html5Qrcode.getState() : -1) : -1;
        const video = document.querySelector('#reader video');
        const pausedLabel = Array.from(document.querySelectorAll('#reader *'))
            .some(el => el.innerText && el.innerText.trim() === 'Scanner paused' && el.style.display !== 'none');

        if (state === 3 || (video && video.paused) || pausedLabel) {
            _dbg('watchdog: state=' + state + ' → restart');
            _hardRestartCamera();
        }
    } catch (e) { }
}, 2500);

// ── RESUME ────────────────────────────────────────────
// [FIX-5] NFC usa 2500ms de delay, QR usa FLASH_DURATION
function resume(fromNFC = false) {
    const delay = fromNFC ? 2500 : FLASH_DURATION;
    setTimeout(() => {
        isProcessing = false;
        _resumeCamera();
        const statusEl = document.getElementById('status-text');
        if (statusEl) statusEl.textContent = 'Acerca tu medallón';
    }, delay); // ← delay correcto, no FLASH_DURATION hardcodeado
}

// ── INICIAR CÁMARA ────────────────────────────────────
let scannerStarted = false;

function initScanner() {
    if (scannerStarted) return;
    scannerStarted = true;
    _scannerStartedAt = Date.now(); // [FIX-6] marcar momento de arranque

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
                { fps: 15, qrbox: { width: qrboxSide, height: qrboxSide }, aspectRatio: 1.0 },
                (decodedText) => { handleScan(decodedText); },
                () => { }
            ).then(() => {
                localStorage.setItem('preferred_camera_id', camId);
                _scannerStartedAt = Date.now(); // [FIX-6] actualizar al confirmar inicio real

                // NFC pendiente via URL redirect
                if (window._pendingNfcCode) {
                    const code = window._pendingNfcCode;
                    window._pendingNfcCode = null;
                    _dbg('NFC pendiente: ' + code.slice(0, 20));
                    setTimeout(() => {
                        isProcessing = false;
                        _restartAttempts = 0;
                        handleScan(code, true);
                    }, 900); // 900ms: cámara estabilizada antes de procesar
                }
            });
        })
        .catch(err => console.error('[Scanner] Error iniciando cámara:', err));

    startMirrorCheck();

    // En PWA el NFC llega via URL redirect — NDEFReader no se usa
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    if (!isStandalone) {
        initNFC();
    } else {
        _dbg('PWA standalone — NFC via URL activo');
    }
}

// Click en el panel derecho
const rightPanel = document.getElementById('right-panel');
if (rightPanel) {
    rightPanel.addEventListener('click', () => {
        if (!scannerStarted) initScanner();
        else if (!isProcessing) _resumeCamera();
    });
}

// ── MODO ESPEJO ───────────────────────────────────────
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

// ── NFC (browser normal, no PWA) ──────────────────────
const NDEF_URI_PREFIXES = [
    '', 'http://www.', 'https://www.', 'http://', 'https://',
    'tel:', 'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.',
    'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://',
    'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:',
    'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://',
    'tcpobex://', 'irdaobex://', 'file://', 'urn:epc:id:', 'urn:epc:tag:',
    'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:',
];

async function initNFC() {
    if (!('NDEFReader' in window)) {
        console.warn('[NFC] NDEFReader no disponible.');
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
                        const bytes = new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength);
                        const prefix = NDEF_URI_PREFIXES[bytes[0]] ?? '';
                        fullText = prefix + new TextDecoder('utf-8').decode(bytes.slice(1)).trim();
                    } else if (record.recordType === 'text') {
                        const bytes = new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength);
                        const statusByte = bytes[0];
                        const langLen = statusByte & 0x3F;
                        const charset = (statusByte & 0x80) ? 'utf-16' : 'utf-8';
                        fullText = new TextDecoder(charset).decode(bytes.slice(1 + langLen)).trim();
                    } else {
                        fullText = new TextDecoder(record.encoding || 'utf-8')
                            .decode(record.data).replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
                    }
                } catch { continue; }

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
    }
}