// entrenador/entrenador.js — v2 Offline-First
// ════════════════════════════════════════════════════════════════

// ── AUTH ─────────────────────────────────────────────────
const TOKEN_KEY = 'jr_entrenador_token';
const EMAIL_KEY = 'jr_entrenador_email';
const SIGNING_KEY_SK = 'jr_signing_key';     // sessionStorage

const token = localStorage.getItem(TOKEN_KEY);
if (!token) window.location.href = '/entrenador/login';

document.addEventListener('DOMContentLoaded', () => {
    const nameEl = document.getElementById('coach-email');
    if (nameEl) nameEl.textContent = sessionStorage.getItem('jr_nombre') || '';
});

function logout() {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.clear();
    syncWorker?.terminate();
    window.location.href = '/entrenador/login';
}

// ── WEB WORKER DE SYNC ────────────────────────────────────
let syncWorker = null;
let pendingCount = 0;

function initSyncWorker() {
    if (!window.Worker) return;
    syncWorker = new Worker('/static/entrenador/sync-worker.js');
    syncWorker.postMessage({ type: 'set_token', token });
    syncWorker.postMessage({ type: 'count' });

    syncWorker.addEventListener('message', ({ data }) => {
        if (data.type === 'sync_ok') {
            console.log(`[sync] OK — insertados: ${data.inserted}, duplicados: ${data.duplicates}`);
        }
        if (data.type === 'sync_error') {
            console.warn('[sync] Error:', data.error);
        }
        if (data.type === 'queue_count') {
            pendingCount = data.count;
            updateOfflineBadge();
        }
        if (data.type === 'offline') {
            updateOfflineBadge();
        }
    });
}

function updateOfflineBadge() {
    const badge = document.getElementById('offline-badge');
    if (!badge) return;
    if (pendingCount > 0) {
        badge.textContent = `📡 ${pendingCount} pendiente${pendingCount !== 1 ? 's' : ''}`;
        badge.classList.add('visible');
    } else {
        badge.classList.remove('visible');
    }
}

function queueScan(student_id) {
    if (!syncWorker) return;
    const record = {
        student_id,
        timestamp: new Date().toISOString(),
        local_id: `${student_id}_${Date.now()}`
    };
    syncWorker.postMessage({ type: 'queue', record });
}

// Auto-flush al reconectar
window.addEventListener('online', () => syncWorker?.postMessage({ type: 'flush', token }));
window.addEventListener('offline', () => updateOfflineBadge());

// ── CRYPTO: VALIDACIÓN HMAC LOCAL ─────────────────────────
let _cryptoKey = null;   // CryptoKey cacheada

function hexToBytes(hex) {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2)
        arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    return arr;
}

async function getCryptoKey() {
    if (_cryptoKey) return _cryptoKey;
    const keyHex = sessionStorage.getItem(SIGNING_KEY_SK);
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

async function computeHmac(student_id, valid_yyyymmdd, name) {
    const key = await getCryptoKey();
    if (!key) return null;
    const msg = new TextEncoder().encode(`${student_id}|${valid_yyyymmdd}|${name}`);
    const sig = await crypto.subtle.sign('HMAC', key, msg);
    return Array.from(new Uint8Array(sig).slice(0, 8))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64uDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return decodeURIComponent(escape(atob(str)));
}

/**
 * Valida un payload JRS localmente.
 * Devuelve { student_id, name, valid_date, debe } o null si es inválido.
 */
async function validateJRS(code) {
    // Formato: JRS:{uuid}:{YYYYMMDD}:{name_b64url}:{hmac16hex}
    if (!code.startsWith('JRS:')) return null;
    const parts = code.slice(4).split(':');
    if (parts.length !== 4) return null;

    const [student_id, valid_date, name_b64, sig] = parts;
    let name;
    try { name = b64uDecode(name_b64); } catch { return null; }

    const expected = await computeHmac(student_id, valid_date, name);
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

// ── AUDIO ─────────────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function _tone(freq, type, dur, offset = 0) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = type; o.frequency.setValueAtTime(freq, audioCtx.currentTime + offset);
    g.gain.setValueAtTime(0.35, audioCtx.currentTime + offset);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + offset + dur);
    o.start(audioCtx.currentTime + offset);
    o.stop(audioCtx.currentTime + offset + dur);
}

const playSuccess = () => { _tone(660, 'sine', .1); _tone(880, 'sine', .3, .1); };
const playWarning = () => { _tone(440, 'sine', .15); _tone(440, 'sine', .15, .2); };
const playDebe = () => { [0, .18, .36].forEach((d, i) => _tone(380 - i * 40, 'sawtooth', .14, d)); };
const playError = () => _tone(300, 'sawtooth', .5);

// ── FLASH OVERLAY ─────────────────────────────────────────
const FLASH_DUR = 4000;
const FLASH_CFG = {
    success: { icon: '✅', status: '¡BIENVENIDO!' },
    warning: { icon: '⚠️', status: 'YA REGISTRADO' },
    debe: { icon: '🚫', status: 'MENSUALIDAD VENCIDA' },
    error: { icon: '❌', status: 'CREDENCIAL INVÁLIDA' },
    offline_ok: { icon: '📶', status: 'REGISTRADO OFFLINE' },
    offline_need: { icon: '📡', status: 'REQUIERE CONEXIÓN' }
};

function showFlash(estado, nombre, detalle) {
    const overlay = document.getElementById('flash-overlay');
    const iconEl = document.getElementById('flash-icon');
    const nameEl = document.getElementById('flash-name');
    const statusEl = document.getElementById('flash-status');
    const detEl = document.getElementById('flash-detalle');
    const barEl = document.getElementById('flash-bar');
    if (!overlay) return;

    const cfg = FLASH_CFG[estado] || FLASH_CFG.error;
    overlay.className = `flash-overlay show ${estado}`;
    iconEl.textContent = cfg.icon;
    nameEl.textContent = nombre || '';
    statusEl.textContent = cfg.status;
    detEl.textContent = detalle || '';

    barEl.style.cssText = '';
    void barEl.offsetWidth;
    barEl.style.setProperty('--flash-dur', FLASH_DUR + 'ms');

    setTimeout(() => { overlay.className = 'flash-overlay'; }, FLASH_DUR);
}

// ── HISTORIAL ─────────────────────────────────────────────
const histItems = [];
function addHistory(estado, nombre) {
    const ul = document.getElementById('scan-history');
    if (!ul) return;
    const hora = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    histItems.unshift({ estado, nombre, hora });
    if (histItems.length > 20) histItems.pop();
    ul.innerHTML = histItems.map(h => `
        <li class="history-item ${h.estado}">
            <div class="h-dot"></div>
            <span class="h-name">${h.nombre}</span>
            <span class="h-time">${h.hora}</span>
        </li>`).join('');
}

// ── LÓGICA CENTRAL DE SCAN ────────────────────────────────
let processing = false;
const RESUME_DELAY = FLASH_DUR + 300;

async function handleScan(decodedText) {
    if (processing) return;
    processing = true;
    if (qrScanner) qrScanner.pause();

    // Extraer código limpio
    const raw = decodedText.trim();
    const code = raw.includes('?code=') ? raw.split('?code=')[1] : raw;

    // ── FORMATO OFFLINE (JRS:) ────────────────────────────
    if (code.startsWith('JRS:')) {
        const parsed = await validateJRS(code);

        if (!parsed) {
            // Firma inválida (QR manipulado)
            playError();
            showFlash('error', 'QR INVÁLIDO', 'Firma criptográfica incorrecta.');
            addHistory('error', 'QR inválido');
            scheduleResume(); return;
        }

        if (parsed.debe) {
            playDebe();
            showFlash('debe', parsed.name, 'Mensualidad vencida. Contacta al administrador.');
            addHistory('debe', parsed.name);
            // No registramos asistencia si debe
            scheduleResume(); return;
        }

        // ✅ Válido offline: flash inmediato
        playSuccess();
        showFlash(
            navigator.onLine ? 'success' : 'offline_ok',
            parsed.name,
            navigator.onLine ? '' : '(sin internet — se sincronizará luego)'
        );
        addHistory('success', parsed.name);

        // Encolar para sync con Supabase
        queueScan(parsed.student_id);

        // Si hay conexión, también llamar al servidor para dedup inmediato
        if (navigator.onLine) {
            fetch('/attendance/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            }).catch(() => { });  // ignorar errores — ya está en cola
        }

        scheduleResume(); return;
    }

    // ── FORMATO LEGACY (STU-XXX u otro) ──────────────────
    if (!navigator.onLine) {
        playError();
        showFlash('offline_need', 'SIN CONEXIÓN', 'Este QR antiguo requiere internet.\nUsa el nuevo QR firmado.');
        addHistory('error', 'Sin conexión');
        scheduleResume(); return;
    }

    // Online: petición normal al servidor
    try {
        const res = await fetch('/attendance/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const data = await res.json();
        const nombre = data.student_name || 'Desconocido';
        const estado = data.status || 'error';

        if (estado === 'success') playSuccess();
        else if (estado === 'warning') playWarning();
        else if (estado === 'debe') playDebe();
        else playError();

        showFlash(estado, nombre, data.detalle || '');
        addHistory(estado, nombre);
    } catch {
        playError();
        showFlash('error', 'SIN CONEXIÓN', '');
    }

    scheduleResume();
}

function scheduleResume() {
    setTimeout(() => {
        processing = false;
        if (qrScanner) qrScanner.resume();
    }, RESUME_DELAY);
}

// ── NAVEGACIÓN TABS ───────────────────────────────────────
function goTab(name, btn) {
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + name)?.classList.add('active');
    btn?.classList.add('active');
    if (name === 'asistencia') loadAsistencia();
}

// ── QR SCANNER ────────────────────────────────────────────
let qrScanner = null;

window.addEventListener('load', () => {
    initSyncWorker();
    setTimeout(() => {
        qrScanner = new Html5QrcodeScanner('reader', {
            fps: 15,
            qrbox: { width: 240, height: 240 },
            rememberLastUsedCamera: true,
            showTorchButtonIfSupported: true
        });
        qrScanner.render(
            decoded => handleScan(decoded),
            () => { }
        );
        initNFC();
    }, 400);
});

// ── NFC ───────────────────────────────────────────────────
async function initNFC() {
    if (!('NDEFReader' in window)) return;
    try {
        const ndef = new NDEFReader();
        await ndef.scan();
        const badge = document.getElementById('nfc-badge');
        if (badge) badge.classList.add('visible');
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

// ── ASISTENCIA ────────────────────────────────────────────
let asistenciaData = [];
let filtroAsist = 'todos';

async function loadAsistencia() {
    const listEl = document.getElementById('asistencia-list');
    const statsEl = document.getElementById('asistencia-stats');
    if (listEl) listEl.innerHTML = '<div class="loading-msg">Cargando...</div>';

    try {
        const res = await fetch('/entrenador/asistencia/hoy', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error();
        asistenciaData = await res.json();
        renderAsistencia();
    } catch {
        if (listEl) listEl.innerHTML = '<div class="loading-msg" style="color:var(--red2)">Error al cargar. ¿Hay conexión?</div>';
    }
}

function setFiltroAsist(filtro, btn) {
    filtroAsist = filtro;
    document.querySelectorAll('.asistencia-filtros .chip')
        .forEach(c => c.classList.remove('active'));
    btn?.classList.add('active');
    renderAsistencia();
}

function renderAsistencia() {
    const listEl = document.getElementById('asistencia-list');
    const statsEl = document.getElementById('asistencia-stats');
    if (!listEl) return;

    const total = asistenciaData.length;
    const presentes = asistenciaData.filter(a => a.present).length;
    const ausentes = total - presentes;

    if (statsEl) {
        statsEl.innerHTML = `
            <div class="stat-pill"><div class="stat-pill-num">${total}</div><div class="stat-pill-label">Total</div></div>
            <div class="stat-pill"><div class="stat-pill-num green">${presentes}</div><div class="stat-pill-label">Presentes</div></div>
            <div class="stat-pill"><div class="stat-pill-num red">${ausentes}</div><div class="stat-pill-label">Ausentes</div></div>`;
    }

    let datos = asistenciaData;
    if (filtroAsist === 'presentes') datos = datos.filter(a => a.present);
    if (filtroAsist === 'ausentes') datos = datos.filter(a => !a.present);
    if (filtroAsist === 'deudores') datos = datos.filter(a => a.debe);

    if (!datos.length) {
        listEl.innerHTML = '<div class="loading-msg">Sin resultados.</div>'; return;
    }

    listEl.innerHTML = `<div class="asistencia-grid">${datos.map(a => {
        const cls = a.debe ? 'debe' : (a.present ? 'presente' : 'ausente');
        const emoji = a.debe ? '🚫' : (a.present ? '✅' : '❌');
        const badge = a.debe
            ? '<span class="alumno-badge badge-debe">DEBE</span>'
            : (a.present
                ? '<span class="alumno-badge badge-presente">PRESENTE</span>'
                : '<span class="alumno-badge badge-ausente">AUSENTE</span>');
        const hora = a.time
            ? new Date(a.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';
        const meta = [a.horario, a.turno].filter(Boolean).join(' · ') + (hora ? ` · ${hora}` : '');
        return `<div class="alumno-card ${cls}">
            <div class="alumno-avatar">${emoji}</div>
            <div class="alumno-info">
                <div class="alumno-nombre">${a.full_name}</div>
                <div class="alumno-meta">${meta}</div>
            </div>${badge}</div>`;
    }).join('')}</div>`;
}
