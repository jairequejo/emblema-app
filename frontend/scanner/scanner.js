// scanner/scanner.js — v4.1
// NFC eliminado. Solo QR. Selector de cámara al primer arranque.

const FLASH_DURATION = 2200;

window.history.pushState(null, null, window.location.href);
window.onpopstate = function () { window.history.go(1); };

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try { await navigator.wakeLock.request('screen'); } catch (e) { }
    }
}
requestWakeLock();

function updateClock() {
    const now = new Date();
    const clockEl = document.getElementById('clock');
    const dateEl = document.getElementById('date-display');
    if (clockEl) clockEl.textContent = now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    if (dateEl) dateEl.textContent = now.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
}
updateClock();
setInterval(updateClock, 1000);

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

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        requestWakeLock();
        _dbg('visible - restart camara');
        [100, 600, 1500, 3000].forEach(d => {
            setTimeout(() => { if (!_restartingCamera) _hardRestartCamera(); }, d);
        });
    }
});

// ── PIN ───────────────────────────────────────────────
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
    dots.textContent = ('●'.repeat(_pinBuffer.length) + ' ' + '○'.repeat(Math.max(0, 4 - _pinBuffer.length))).trim() || '○ ○ ○ ○';
}

function pinKey(k) {
    const errEl = document.getElementById('pin-err');
    if (errEl) errEl.textContent = '';
    if (k === 'DEL') _pinBuffer = _pinBuffer.slice(0, -1);
    else if (_pinBuffer.length < 8) _pinBuffer += k;
    pinUpdateDots();
}

async function pinSubmit() {
    if (!_pinBuffer) return;
    const errEl = document.getElementById('pin-err');
    try {
        const r = await fetch('/attendance/scanner/offline-data', { headers: { 'X-Scanner-Pin': _pinBuffer } });
        if (r.ok) {
            _scannerPin = _pinBuffer;
            sessionStorage.setItem('scanner_pin', _scannerPin);
            const data = await r.json();
            _saveOfflineData(data);
            const ind = document.getElementById('offline-queue-indicator');
            if (ind) { ind.style.background = 'var(--gold)'; ind.style.color = '#000'; }
            _startSyncLoop();
            hidePinOverlay();
        } else {
            if (errEl) errEl.textContent = 'PIN incorrecto.';
            _pinBuffer = ''; pinUpdateDots();
        }
    } catch {
        if (errEl) errEl.textContent = 'Sin conexión — PIN almacenado.';
        _scannerPin = _pinBuffer;
        sessionStorage.setItem('scanner_pin', _scannerPin);
        setTimeout(hidePinOverlay, 1500);
    }
}

function showPinOverlay() { const ov = document.getElementById('pin-overlay'); if (ov) ov.style.display = 'flex'; }
function hidePinOverlay() { const ov = document.getElementById('pin-overlay'); if (ov) ov.style.display = 'none'; }

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
        if (r.ok) { const data = await r.json(); _saveOfflineData(data); }
    } catch { }
}

window.addEventListener('load', async () => {
    // Solo pedir PIN si hay internet Y el servidor dice 401
    // Sin internet: arrancar directo con el PIN guardado (o sin PIN)
    if (navigator.onLine) {
        try {
            const r = await fetch('/attendance/scanner/offline-data',
                { headers: _scannerPin ? { 'X-Scanner-Pin': _scannerPin } : {} });
            if (r.status === 401 && !_scannerPin) {
                // Solo mostrar PIN si no tenemos ninguno guardado
                _scannerPin = ''; sessionStorage.removeItem('scanner_pin'); _pinBuffer = '';
                showPinOverlay();
            } else if (r.ok) {
                const data = await r.json(); _saveOfflineData(data); hidePinOverlay();
            }
        } catch { }
    } else {
        // Sin internet: no pedir PIN, arrancar con lo que hay en cache
        hidePinOverlay();
    }

    if (localStorage.getItem('preferred_camera_id')) {
        setTimeout(initScanner, 300);
    }
});

setInterval(fetchOfflineData, 5 * 60 * 1000);

// ── COLA OFFLINE ──────────────────────────────────────
let queuedScans = JSON.parse(localStorage.getItem('scanner_queued_scans') || '[]');

function updateQueueUI() {
    let ind = document.getElementById('offline-queue-indicator');
    if (!ind) {
        ind = document.createElement('div');
        ind.id = 'offline-queue-indicator';
        ind.style.cssText = 'position:fixed;bottom:48px;right:1rem;background:var(--gold);color:#000;padding:.5rem 1rem;border-radius:20px;font-family:"Barlow Condensed",sans-serif;font-weight:bold;z-index:9999;display:none;gap:.6rem;align-items:center;flex-wrap:wrap;max-width:260px;';
        document.body.appendChild(ind);
    }
    if (queuedScans.length === 0) {
        ind.style.display = 'none';
        return;
    }
    ind.style.display = 'flex';
    ind.style.background = '#d4a017';
    ind.style.color = '#000';
    ind.innerHTML = `
        <span>⏳ ${queuedScans.length} pendiente${queuedScans.length > 1 ? 's' : ''}</span>
        <button onclick="anularCola()" style="background:#000;color:#fff;border:none;border-radius:12px;padding:.2rem .7rem;font-size:.8rem;font-family:inherit;font-weight:700;cursor:pointer;letter-spacing:.05em;">
            🗑 ANULAR
        </button>
    `;
}

function anularCola() {
    if (!confirm('¿Anular ' + queuedScans.length + ' registro(s) pendiente(s)? Esta acción no se puede deshacer.')) return;
    queuedScans = [];
    localStorage.setItem('scanner_queued_scans', '[]');
    updateQueueUI();
    // Resetear estado del scanner para que pueda volver a escanear
    isProcessing = false;
    _lastResumeAt = Date.now();
    _softResume();
    const s = document.getElementById('status-text');
    if (s) s.textContent = 'Acerca tu medallón';
}
updateQueueUI();

// ── CRYPTO ────────────────────────────────────────────
const SIGNING_KEY_SK = 'jr_signing_key';
let _cryptoKey = null;

function hexToBytes(hex) {
    const a = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) a[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    return a;
}

async function getCryptoKey() {
    if (_cryptoKey) return _cryptoKey;
    const k = localStorage.getItem(SIGNING_KEY_SK);
    if (!k) return null;
    try {
        _cryptoKey = await crypto.subtle.importKey('raw', hexToBytes(k),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        return _cryptoKey;
    } catch { return null; }
}

async function computeHmac(short_id, valid_yyyymmdd, name_b64) {
    const key = await getCryptoKey();
    if (!key) return null;
    const sig = await crypto.subtle.sign('HMAC', key,
        new TextEncoder().encode(`${short_id}|${valid_yyyymmdd}|${name_b64}`));
    return Array.from(new Uint8Array(sig).slice(0, 8))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64uDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    try {
        const bin = atob(str);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
    } catch { return decodeURIComponent(escape(atob(str))); }
}

async function validateJRS(code) {
    if (!code.startsWith('JRS:')) return null;
    const parts = code.slice(4).split(':');
    if (parts.length !== 4) return null;
    const [short_id, valid_date, name_b64, sig] = parts;
    let name;
    try { name = b64uDecode(name_b64); } catch { return null; }
    if (!localStorage.getItem(SIGNING_KEY_SK)) {
        try {
            const r = await fetch('/attendance/scanner/offline-data',
                { headers: _scannerPin ? { 'X-Scanner-Pin': _scannerPin } : {} });
            if (r.ok) { const d = await r.json(); _saveOfflineData(d); }
        } catch { }
    }
    const expected = await computeHmac(short_id, valid_date, name_b64);
    if (!expected) return { short_id, name, valid_date, debe: false, skipLocalValidation: true };
    if (expected !== sig) return null;
    const v = new Date(valid_date.slice(0, 4), valid_date.slice(4, 6) - 1, valid_date.slice(6, 8));
    v.setHours(23, 59, 59);
    return { short_id, name, valid_date, debe: v < new Date() };
}

// ── AUDIO ─────────────────────────────────────────────
function _beep(freq, dur, vol = 0.3) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq; gain.gain.value = vol;
        osc.start(); osc.stop(ctx.currentTime + dur / 1000);
        setTimeout(() => ctx.close(), dur + 100);
    } catch { }
}
function playSuccess() { _beep(880, 120); setTimeout(() => _beep(1100, 180), 130); }
function playWarning() { _beep(440, 300); }
function playError()   { _beep(220, 400, 0.4); }

// ── FLASH ─────────────────────────────────────────────
const STATUS_CONFIG = {
    success: { icon: '✅', color: '#1a472a', text: '#00ff88' },
    warning: { icon: '⚠️',  color: '#7a4a00', text: '#ffd700' },
    debe:    { icon: '💰', color: '#7a2a00', text: '#ff8c00' },
    error:   { icon: '❌', color: '#4a0000', text: '#ff4444' },
};

function showFlash(status, name, msg) {
    const ov = document.getElementById('result-overlay');
    const ic = document.getElementById('result-icon');
    const nm = document.getElementById('result-name');
    const ms = document.getElementById('result-msg');
    const bg = document.getElementById('flash-bg');

    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.error;
    if (ic) ic.textContent = cfg.icon;
    if (nm) nm.textContent = name || '';
    if (ms) ms.textContent = msg || '';

    // Overlay — usar clase .show (el CSS maneja opacity 0→1)
    if (ov) {
        ov.className = 'result-overlay ' + status + ' show';
        setTimeout(() => { ov.className = 'result-overlay'; }, FLASH_DURATION);
    }

    // Flash fondo — usar clases CSS (success/warning/debe/error)
    if (bg) {
        bg.className = 'show ' + status;
        setTimeout(() => { bg.className = ''; }, FLASH_DURATION);
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
async function processOfflineScan(code) {
    try {
        const db = JSON.parse(localStorage.getItem('scanner_offline_db') || '{}');
        let studentId = code, fallbackName = 'Desconocido';
        if (code.startsWith('JRS:')) {
            const parsed = await validateJRS(code);
            if (!parsed) { playError(); showFlash('error', 'QR INVÁLIDO', 'Firma incorrecta.'); resume(); return; }
            if (parsed.skipLocalValidation) { isProcessing = false; _doOnlineScan(code); return; }
            if (parsed.debe) { playWarning(); showFlash('debe', parsed.name, 'Mensualidad vencida (Offline)'); resume(); return; }
            studentId = parsed.short_id;
            fallbackName = parsed.name;
            if (!db[studentId]) {
                const full = Object.keys(db).find(k => k.length > 8 && k.startsWith(studentId));
                if (full) studentId = full;
            }
        }
        const info = db[studentId];
        if (info) {
            queuedScans.push({ code, timestamp: new Date().toISOString() });
            localStorage.setItem('scanner_queued_scans', JSON.stringify(queuedScans));
            updateQueueUI();
            if (info.status === 'success') playSuccess(); else playWarning();
            showFlash(info.status, info.name, info.status === 'success' ? '¡BIENVENIDO! (Guardado Offline)' : info.detalle);
            addHistory(info.status, info.name + ' (Offline)');
            resume();
        } else if (code.startsWith('JRS:')) {
            queuedScans.push({ code, timestamp: new Date().toISOString() });
            localStorage.setItem('scanner_queued_scans', JSON.stringify(queuedScans));
            updateQueueUI();
            playSuccess();
            showFlash('success', fallbackName, 'Guardado Offline');
            addHistory('success', fallbackName + ' (Offline)');
            resume();
        } else {
            playError();
            showFlash('error', 'SIN CONEXIÓN', 'No se puede validar código clásico');
            resume();
        }
    } catch (e) {
        console.error('[Scanner] processOfflineScan:', e);
        resume();
    }
}

// ── SYNC ──────────────────────────────────────────────
let _syncIntervalId = null;
function _stopSyncLoop() { if (_syncIntervalId !== null) { clearInterval(_syncIntervalId); _syncIntervalId = null; } }
function _startSyncLoop() { if (_syncIntervalId !== null) return; _syncIntervalId = setInterval(syncOfflineQueue, 15000); }

function syncOfflineQueue() {
    if (!navigator.onLine || queuedScans.length === 0) return;
    const token = localStorage.getItem('trainer_token') || '';
    const db = JSON.parse(localStorage.getItem('scanner_offline_db') || '{}');
    const records = queuedScans.map((s, i) => {
        let sid = s.code.startsWith('JRS:')
            ? (Object.keys(db).find(k => k.length === 36 && k.startsWith(s.code.split(':')[1])) || null)
            : s.code;
        return { student_id: sid || s.code, timestamp: s.timestamp, local_id: `sync-${i}-${s.timestamp}` };
    }).filter(r => r.student_id);
    fetch('/attendance/sync-batch', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records, token })
    }).then(res => {
        if (res.ok) { queuedScans = []; localStorage.setItem('scanner_queued_scans', '[]'); updateQueueUI(); return; }
        if (res.status === 401) {
            _stopSyncLoop();
            const ind = document.getElementById('offline-queue-indicator');
            if (ind) { ind.style.background = '#c0392b'; ind.style.color = '#fff'; ind.textContent = `⚠️ ${queuedScans.length} pendientes — reintentando...`; ind.style.display = 'block'; }
            // No mostrar PIN overlay automáticamente — solo limpiar el PIN para que
            // el próximo fetch al cargar lo solicite. No interrumpir el scanner.
            _scannerPin = ''; sessionStorage.removeItem('scanner_pin');
        }
        if (res.status === 413 || res.status === 400) _stopSyncLoop();
    }).catch(e => console.log('[Sync] Error:', e));
}

window.addEventListener('online', () => { fetchOfflineData(); _startSyncLoop(); syncOfflineQueue(); });
_startSyncLoop();

// ── SCAN CORE ─────────────────────────────────────────
let html5Qrcode = null;
let isProcessing = false;
let _safetyTimer = null;

function _armSafety() {
    if (_safetyTimer) clearTimeout(_safetyTimer);
    _safetyTimer = setTimeout(() => {
        if (isProcessing) {
            isProcessing = false;
            _softResume();
            const s = document.getElementById('status-text');
            if (s) s.textContent = 'Acerca tu medallón';
        }
        _safetyTimer = null;
    }, 10000);
}

function _doOnlineScan(code) {
    isProcessing = true;
    _armSafety();
    _dbg('SCAN: ' + code.slice(0, 30));
    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.textContent = 'Procesando...';
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3000);
    fetch('/attendance/scan', {
        method: 'POST', headers: getScannerHeaders(),
        body: JSON.stringify({ code }), signal: ctrl.signal
    })
        .then(r => { clearTimeout(tid); _dbg('HTTP:' + r.status); return r.text(); })
        .then(raw => {
            _dbg('RSP:' + raw.slice(0, 80));
            let data;
            try { data = JSON.parse(raw); }
            catch { playError(); showFlash('error', 'ERROR', 'Conexión fallida'); resume(); return; }
            // El servidor siempre devuelve student_name cuando es una respuesta válida.
            // Solo devuelve {detail: "..."} sin student_name en errores HTTP (400, 404, etc.)
            const nombre = data.student_name || data.name || '';
            const estado = data.status || '';
            const msg    = data.message || data.detail || '';

            // Sin student_name → error HTTP real (credencial inválida, no encontrado, etc.)
            if (!nombre) {
                playError();
                showFlash('error', 'RECHAZADO', msg || 'Error del servidor');
                resume();
                return;
            }

            // Respuesta válida con student_name → mostrar según status
            if (estado === 'success') {
                playSuccess();
                showFlash('success', nombre, msg);
                addHistory('success', nombre);
            } else if (estado === 'warning') {
                playWarning();
                showFlash('warning', nombre, msg);
                addHistory('warning', nombre);
            } else if (estado === 'debe') {
                playWarning();
                showFlash('debe', nombre, msg);
                addHistory('debe', nombre);
            } else {
                // status desconocido pero tenemos nombre → warning por las dudas
                playWarning();
                showFlash('warning', nombre, msg);
                addHistory('warning', nombre);
            }
            resume();
        })
        .catch(() => processOfflineScan(code));
}

function handleScan(decodedText) {
    if (isProcessing) return;
    const code = decodedText.includes('?code=') ? decodedText.split('?code=')[1] : decodedText;
    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.textContent = 'Procesando...';
    if (!navigator.onLine) { isProcessing = true; _armSafety(); processOfflineScan(code); return; }
    _doOnlineScan(code);
}

// ── CÁMARA ────────────────────────────────────────────
let _restartingCamera = false;
let _restartAttempts = 0;
const _MAX_RESTART_ATTEMPTS = 10;

function _softResume() {
    if (!html5Qrcode) return;
    try { if (typeof html5Qrcode.resume === 'function') html5Qrcode.resume(); } catch { }
}

function _hardRestartCamera() {
    if (_restartingCamera || !html5Qrcode) return;
    if (_restartAttempts >= _MAX_RESTART_ATTEMPTS) {
        const s = document.getElementById('status-text');
        if (s) s.textContent = 'Toca la pantalla para reactivar';
        document.getElementById('right-panel')?.addEventListener('click', () => {
            _restartAttempts = 0; _hardRestartCamera();
        }, { once: true });
        return;
    }
    _restartingCamera = true;
    _restartAttempts++;
    _dbg('hardRestart #' + _restartAttempts);
    const camId = localStorage.getItem('preferred_camera_id');
    const frame = document.getElementById('scanner-frame');
    const size = frame ? Math.min(frame.clientWidth, frame.clientHeight) - 20 : 300;
    const qrboxSide = Math.floor(size * 0.85);
    html5Qrcode.stop().catch(() => { }).finally(() => {
        document.querySelectorAll('#reader *').forEach(el => {
            if (el.innerText && el.innerText.trim() === 'Scanner paused') el.remove();
        });
        html5Qrcode.start(
            camId,
            { fps: 15, qrbox: { width: qrboxSide, height: qrboxSide }, aspectRatio: 1.0 },
            (text) => { handleScan(text); },
            () => { }
        ).then(() => {
            _dbg('hardRestart OK');
            _restartAttempts = 0;
            _restartingCamera = false;
            isProcessing = false;
            _lastResumeAt = Date.now();
            _scannerStartedAt = Date.now();
        }).catch(err => {
            console.error('[Scanner] hardRestart error:', err);
            _restartingCamera = false;
            setTimeout(() => _hardRestartCamera(), _restartAttempts * 1000);
        });
    });
}

// ── WATCHDOG ──────────────────────────────────────────
let _scannerStartedAt = 0;
let _lastResumeAt = 0;

setInterval(() => {
    if (!scannerStarted || _restartingCamera || document.visibilityState !== 'visible') return;
    if (isProcessing) return;
    if (Date.now() - _scannerStartedAt < 5000) return;
    if (Date.now() - _lastResumeAt < 5000) return;
    try {
        const state = html5Qrcode
            ? (typeof html5Qrcode.getState === 'function' ? html5Qrcode.getState() : -1) : -1;
        const video = document.querySelector('#reader video');
        const pausedLabel = Array.from(document.querySelectorAll('#reader *'))
            .some(el => el.innerText && el.innerText.trim() === 'Scanner paused' && el.style.display !== 'none');
        if (state === 3 || (video && video.paused) || pausedLabel) {
            _dbg('watchdog: atasco → hardRestart');
            _hardRestartCamera();
        }
    } catch { }
}, 2500);

// ── RESUME ────────────────────────────────────────────
function resume() {
    setTimeout(() => {
        isProcessing = false;
        _lastResumeAt = Date.now();
        _softResume();
        const s = document.getElementById('status-text');
        if (s) s.textContent = 'Acerca tu medallón';
    }, FLASH_DURATION);
}

// ── SELECTOR DE CÁMARA ────────────────────────────────
function _showCameraSelector(cameras) {
    const old = document.getElementById('_cam_selector');
    if (old) old.remove();

    const ov = document.createElement('div');
    ov.id = '_cam_selector';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.96);display:flex;align-items:center;justify-content:center;font-family:"Barlow Condensed",system-ui,sans-serif;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#111;border:2px solid #d4a017;border-radius:16px;padding:2rem;width:320px;text-align:center;color:#fff;';
    box.innerHTML = `
        <div style="font-size:2.5rem;margin-bottom:.4rem">📷</div>
        <div style="font-size:1.6rem;font-weight:700;color:#d4a017;margin-bottom:.3rem">ELEGIR CÁMARA</div>
        <div style="font-size:.85rem;color:#888;margin-bottom:1.4rem">Se guardará la elección</div>
    `;

    cameras.forEach((cam, i) => {
        const label = cam.label || `Cámara ${i + 1}`;
        const btn = document.createElement('button');
        btn.style.cssText = 'display:block;width:100%;margin-bottom:.6rem;background:#1a1a1a;border:1px solid #333;color:#fff;border-radius:10px;padding:1rem;font-size:1rem;font-family:inherit;cursor:pointer;text-align:left;';
        btn.innerHTML = `<span style="color:#d4a017;font-weight:700;margin-right:.6rem">${i + 1}.</span>${label}`;
        btn.ontouchstart = () => btn.style.background = '#2a2a1a';
        btn.ontouchend = () => btn.style.background = '#1a1a1a';
        btn.onmouseover = () => btn.style.background = '#2a2a1a';
        btn.onmouseout = () => btn.style.background = '#1a1a1a';
        btn.onclick = () => {
            ov.remove();
            _startWithCamera(cam.id);
        };
        box.appendChild(btn);
    });

    // Botón cambiar cámara (olvidar elección)
    const changeBtn = document.createElement('button');
    changeBtn.style.cssText = 'margin-top:1rem;background:transparent;border:none;color:#555;font-size:.8rem;cursor:pointer;font-family:inherit;text-decoration:underline;';
    changeBtn.textContent = '🔄 Cambiar cámara guardada';
    changeBtn.onclick = () => {
        localStorage.removeItem('preferred_camera_id');
        ov.remove();
        _showCameraSelector(cameras);
    };
    box.appendChild(changeBtn);

    ov.appendChild(box);
    document.body.appendChild(ov);
}

function _startWithCamera(camId) {
    const frame = document.getElementById('scanner-frame');
    const size = frame ? Math.min(frame.clientWidth, frame.clientHeight) - 20 : 300;
    const qrboxSide = Math.floor(size * 0.85);

    html5Qrcode.start(
        camId,
        { fps: 15, qrbox: { width: qrboxSide, height: qrboxSide }, aspectRatio: 1.0 },
        (text) => { handleScan(text); },
        () => { }
    ).then(() => {
        localStorage.setItem('preferred_camera_id', camId);
        _scannerStartedAt = Date.now();
        _lastResumeAt = Date.now();
        _dbg('camara OK — ' + camId.slice(0, 20));
        // NFC activo SOLO cuando camara esta corriendo
        // Asi Android maneja el chip normalmente si el kiosko no esta activo
        initNFC();
    }).catch(err => {
        console.error('[Scanner] start error:', err);
        _showStartScreen('Error de cámara — toca para reintentar');
    });
}

// ── INIT SCANNER ──────────────────────────────────────
let scannerStarted = false;

function _showStartScreen(msg) {
    scannerStarted = false;
    localStorage.removeItem('preferred_camera_id');
    const ss = document.getElementById('start-screen');
    if (ss) {
        ss.style.display = 'flex';
        const sub = ss.querySelector('.start-sub');
        if (sub && msg) sub.textContent = msg;
    }
    const sf = document.getElementById('scanner-frame');
    if (sf) sf.style.display = 'none';
}

function initScanner() {
    if (scannerStarted) return;
    scannerStarted = true;
    _scannerStartedAt = Date.now();
    _lastResumeAt = Date.now();

    const ss = document.getElementById('start-screen');
    const sf = document.getElementById('scanner-frame');
    if (ss) ss.style.display = 'none';
    if (sf) sf.style.display = 'block';

    html5Qrcode = new Html5Qrcode('reader');

    Html5Qrcode.getCameras()
        .then(cameras => {
            if (!cameras || cameras.length === 0) {
                _showStartScreen('No se encontró cámara — toca para reintentar');
                return;
            }
            const savedId = localStorage.getItem('preferred_camera_id');
            if (savedId && cameras.find(c => c.id === savedId)) {
                // Elección guardada → arrancar directo
                _startWithCamera(savedId);
            } else if (cameras.length === 1) {
                // Una sola cámara → arrancar directo
                _startWithCamera(cameras[0].id);
            } else {
                // Varias cámaras → mostrar selector
                _showCameraSelector(cameras);
            }
        })
        .catch(err => {
            console.error('[Scanner] getCameras error:', err);
            _showStartScreen('Permiso denegado — toca para reintentar');
        });

    startMirrorCheck();
}

// Click en panel derecho
const rightPanel = document.getElementById('right-panel');
if (rightPanel) {
    rightPanel.addEventListener('click', () => {
        if (!scannerStarted) initScanner();
        else if (!isProcessing) _softResume();
    });
}

// ── MODO ESPEJO ───────────────────────────────────────
function startMirrorCheck() {
    setInterval(() => {
        const video = document.querySelector('#reader video');
        if (!video || !video.srcObject) return;
        const label = video.srcObject.getVideoTracks()[0]?.label?.toLowerCase() || '';
        video.classList.toggle('mirror',
            label.includes('front') || label.includes('user') || label.includes('facetime'));
    }, 1000);
}

// ── NFC (activo siempre — PWA y browser) ─────────────
// NDEFReader intercepta el chip ANTES que Android abra Chrome.
// No pausa ni toca la cámara — solo llama handleScan() con el código.
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
        _dbg('NFC API no disponible');
        return;
    }
    try {
        const ndef = new NDEFReader();
        await ndef.scan();
        _dbg('NFC activo interceptando chips');

        const nfcEl = document.getElementById('nfc-indicator');
        if (nfcEl) nfcEl.classList.add('visible');

        ndef.addEventListener('reading', ({ message }) => {
            for (const record of message.records) {
                let fullText = null;
                try {
                    if (record.recordType === 'url') {
                        const b = new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength);
                        fullText = (NDEF_URI_PREFIXES[b[0]] ?? '') + new TextDecoder('utf-8').decode(b.slice(1)).trim();
                    } else if (record.recordType === 'text') {
                        const b = new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength);
                        fullText = new TextDecoder((b[0] & 0x80) ? 'utf-16' : 'utf-8').decode(b.slice(1 + (b[0] & 0x3F))).trim();
                    } else {
                        fullText = new TextDecoder(record.encoding || 'utf-8').decode(record.data)
                            .replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
                    }
                } catch { continue; }

                if (!fullText) continue;

                let code = null;
                if (fullText.startsWith('http://') || fullText.startsWith('https://')) {
                    try {
                        const u = new URL(fullText);
                        const p = u.searchParams.get('code');
                        if (p) code = decodeURIComponent(p);
                    } catch {
                        const i = fullText.indexOf('?code=');
                        if (i !== -1) code = decodeURIComponent(fullText.slice(i + 6));
                    }
                } else if (fullText.startsWith('JRS:') || fullText.startsWith('STU-')) {
                    code = fullText;
                } else if (fullText.includes('?code=')) {
                    code = decodeURIComponent(fullText.split('?code=')[1]);
                }

                if (!code) continue;
                _dbg('NFC: ' + code.slice(0, 24));
                handleScan(code.trim());
                break;
            }
        });

        ndef.addEventListener('readingerror', e => _dbg('NFC readingerror'));
    } catch (e) {
        _dbg('NFC: ' + e.message);
    }
}

// initNFC se llama desde _startWithCamera cuando la camara esta lista