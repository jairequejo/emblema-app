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
            localStorage.setItem('scanner_offline_db', JSON.stringify(data));
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

// Al cargar: verificar si el servidor requiere PIN
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
            localStorage.setItem('scanner_offline_db', JSON.stringify(data));
            hidePinOverlay();
        }
    } catch { /* sin conexión al cargar — usar PIN almacenado */ }
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
    const headers = _scannerPin ? { 'X-Scanner-Pin': _scannerPin } : {};
    fetch('/attendance/scanner/offline-data', { headers })
        .then(res => res.json())
        .then(data => {
            localStorage.setItem('scanner_offline_db', JSON.stringify(data));
            console.log("Base de datos offline actualizada:", Object.keys(data).length, "registros");
        })
        .catch(err => console.log("Error actualizando DB offline:", err));
}
// Actualizar cada 5 min
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
const SIGNING_KEY_SK = 'jr_signing_key'; // localStorage
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

async function computeHmac(student_id, valid_yyyymmdd, name_b64) {
    const key = await getCryptoKey();
    if (!key) return null;
    // IMPORTANTE: el mensaje firma con name_b64 (base64url), igual que jrs_utils.py
    const msg = new TextEncoder().encode(`${student_id}|${valid_yyyymmdd}|${name_b64}`);
    const sig = await crypto.subtle.sign('HMAC', key, msg);
    return Array.from(new Uint8Array(sig).slice(0, 8))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64uDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return decodeURIComponent(escape(atob(str)));
}

async function validateJRS(code) {
    if (!code.startsWith('JRS:')) return null;
    const parts = code.slice(4).split(':');
    if (parts.length !== 4) return null;

    const [student_id, valid_date, name_b64, sig] = parts;
    let name;
    try { name = b64uDecode(name_b64); } catch { return null; }

    const expected = await computeHmac(student_id, valid_date, name_b64);  // name_b64, no el texto decodificado
    if (!expected || expected !== sig) return null;   // firma inválida

    // Verificar fecha
    const hoy = new Date();
    const yyyy = valid_date.slice(0, 4);
    const mm = valid_date.slice(4, 6) - 1;
    const dd = valid_date.slice(6, 8);
    const vencimiento = new Date(yyyy, mm, dd);
    vencimiento.setHours(23, 59, 59);   // final del día

    return { student_id, name, valid_date, debe: vencimiento < hoy };
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

            if (parsed.debe) {
                playWarning();
                showFlash('debe', parsed.name, 'Mensualidad vencida (Offline)');
                resume(fromNFC);
                return;
            }

            // student_id puede ser short_id (8 chars, formato JRS v2) o UUID completo
            studentId = parsed.student_id;
            fallbackName = parsed.name;

            // Fix 3: si no se encuentra por short_id, buscar en DB offline por prefijo
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
            else playWarning(); // debe

            showFlash(info.status, info.name, msg);
            addHistory(info.status, info.name + " (Offline)");
            resume(fromNFC);
        } else {
            // En JRS intentamos extraer el nombre válido aunque no lo tengamos en DB local
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
        // Safety-net: si algo explota internamente, siempre reanudar el scanner
        console.error('[Scanner] Error inesperado en processOfflineScan:', e);
        resume(fromNFC);
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
let html5Qrcode = null;       // API low-level — control total sobre pause/resume
let isProcessing = false;

// Timeout de seguridad: si isProcessing queda colgado más de 10s, lo fuerza a false
let _safetyTimer = null;
function _armSafety(fromNFC) {
    if (_safetyTimer) clearTimeout(_safetyTimer);
    _safetyTimer = setTimeout(() => {
        if (isProcessing) {
            console.warn('[Scanner] Safety-net: forzando reset de isProcessing');
            isProcessing = false;
            try { if (html5Qrcode) html5Qrcode.resume(); } catch (e) { }
            const s = document.getElementById('status-text');
            if (s) s.textContent = 'Acerca tu medallón';
        }
        _safetyTimer = null;
    }, 10000);
}

function handleScan(decodedText, fromNFC = false) {
    if (isProcessing) return;
    isProcessing = true;
    _armSafety(fromNFC); // safety-net contra cualquier excepción no capturada

    const code = decodedText.includes('?code=')
        ? decodedText.split('?code=')[1]
        : decodedText;

    // NO pausamos la cámara — bloqueo lógico con isProcessing
    // (evita congelamiento de cámara en Android con QRs densos)

    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.textContent = 'Procesando...';

    if (!navigator.onLine) {
        processOfflineScan(code, fromNFC); // async, pero su try/catch garantiza que resume() se llame
        return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 segundos máximo

    fetch('/attendance/scan', {
        method: 'POST',
        headers: getScannerHeaders(),
        body: JSON.stringify({ code }),
        signal: controller.signal
    })
        .then(res => {
            clearTimeout(timeoutId);
            return res.text();
        })
        .then(rawText => {
            let data;
            try { data = JSON.parse(rawText); }
            catch (e) {
                playError();
                showFlash('error', 'ERROR', 'Conexión fallida');
                resume(fromNFC); return;
            }

            const nombre = data.student_name || 'Desconocido';
            const estado = data.status || 'error';

            if (estado === 'success') playSuccess();
            else if (estado === 'warning') playWarning();
            else if (estado === 'debe') playWarning();
            else playError();

            showFlash(estado, nombre, data.message);

            if (estado !== 'error') addHistory(estado, nombre);

            resume(fromNFC);
        })
        .catch(() => {
            // Si es un error de red o timeout (AbortError), pasa a offline rápido
            processOfflineScan(code, fromNFC); // async, pero su try/catch garantiza resume()
        });
}

// Con la API low-level (Html5Qrcode), el scanner NUNCA se auto-pausa.
// Esta función existe solo como safety-net para mantener consistencia.
function _resumeCamera() {
    // No se necesita hacer nada — la cámara sigue active siempre.
    // isProcessing=false (puesto por resume()) es suficiente para aceptar nuevos scans.
}

function resume(fromNFC = false) {
    setTimeout(() => {
        isProcessing = false;
        _resumeCamera();
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
    const qrboxSide = Math.floor(size * 0.85);

    // ── API LOW-LEVEL: sin auto-pausa de UI, control 100% programático ────────
    html5Qrcode = new Html5Qrcode('reader');

    Html5Qrcode.getCameras()
        .then(cameras => {
            if (!cameras || cameras.length === 0) {
                console.error('[Scanner] No se encontraron cámaras.');
                return;
            }

            // Preferir cámara trasera (environment); si no, usar la primera
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
                (decodedText) => {
                    // La librería low-level NO auto-pausa — solo isProcessing controla el flujo
                    handleScan(decodedText);
                },
                () => { /* errores de lectura normales (frame sin QR), ignorar */ }
            ).then(() => {
                localStorage.setItem('preferred_camera_id', camId);
            });
        })
        .catch(err => console.error('[Scanner] Error iniciando cámara:', err));

    startMirrorCheck();
    initNFC();
}

// Toque en pantalla derecha para activar
document.getElementById('right-panel').addEventListener('click', initScanner);
// Auto-iniciar se hace en el listener 'load' del bloque PIN (arriba)

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
// Tabla oficial de prefijos URI del estándar NDEF (ISO 14443)
const NDEF_URI_PREFIXES = [
    '',             // 0x00 – sin prefijo
    'http://www.',  // 0x01
    'https://www.', // 0x02
    'http://',      // 0x03
    'https://',     // 0x04  ← el más común en apps NFC modernas
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
    if (!('NDEFReader' in window)) return;
    try {
        const ndef = new NDEFReader();
        await ndef.scan();
        const nfcEl = document.getElementById('nfc-indicator');
        if (nfcEl) nfcEl.classList.add('visible');

        ndef.addEventListener('reading', ({ message }) => {
            for (const record of message.records) {
                let fullText = null;

                try {
                    if (record.recordType === 'url') {
                        // ── Registro URI (NDEF U-Record) ──────────────────────
                        // Byte 0 = código de prefijo (ej: 0x04 → "https://")
                        // Bytes 1..n = resto de la URL en UTF-8
                        const bytes = new Uint8Array(record.data.buffer,
                            record.data.byteOffset,
                            record.data.byteLength);
                        const identifierCode = bytes[0];
                        const prefix = NDEF_URI_PREFIXES[identifierCode] ?? '';
                        const rest = new TextDecoder('utf-8').decode(bytes.slice(1)).trim();
                        fullText = prefix + rest;

                    } else if (record.recordType === 'text') {
                        // ── Registro texto plano (NDEF T-Record) ──────────────
                        // Byte 0 = status byte (bit7=UTF-16, bits 5-0=lang length)
                        // Bytes 1..langLen = código de idioma (ej: "en")
                        // Bytes langLen+1..end = texto
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
                        // Tipo desconocido: fallback genérico con strip de control chars
                        const raw = new TextDecoder(record.encoding || 'utf-8')
                            .decode(record.data)
                            .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
                            .trim();
                        fullText = raw;
                    }
                } catch {
                    continue; // error al decodificar este record → siguiente
                }

                if (!fullText) continue;

                // ── Extraer el código JRS / STU del texto ─────────────────
                let code = null;

                if (fullText.startsWith('http://') || fullText.startsWith('https://')) {
                    // Es una URL — extraer el parámetro ?code= de forma robusta
                    try {
                        const url = new URL(fullText);
                        const param = url.searchParams.get('code');
                        if (param) code = decodeURIComponent(param);
                    } catch {
                        // URL malformada: buscar manualmente
                        const idx = fullText.indexOf('?code=');
                        if (idx !== -1) code = decodeURIComponent(fullText.slice(idx + 6));
                    }
                } else if (fullText.startsWith('JRS:') || fullText.startsWith('STU-')) {
                    // Código directo (sin URL)
                    code = fullText;
                } else if (fullText.includes('?code=')) {
                    // URL sin protocolo (ej: dominio/?code=JRS:...)
                    code = decodeURIComponent(fullText.split('?code=')[1]);
                }

                if (!code) continue; // nada útil en este record → siguiente

                handleScan(code.trim(), true /* fromNFC */);
                break; // Primer registro válido procesado — detener el loop
            }
        });
    } catch (e) {
        console.warn('NFC no disponible:', e.message);
    }
}