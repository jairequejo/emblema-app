// entrenador/entrenador.js
// ── AUTH ─────────────────────────────────────────────────
const TOKEN_KEY = 'jr_entrenador_token';
const EMAIL_KEY = 'jr_entrenador_email';

const token = localStorage.getItem(TOKEN_KEY);
if (!token) window.location.href = '/entrenador/login';

document.addEventListener('DOMContentLoaded', () => {
    const emailEl = document.getElementById('coach-email');
    if (emailEl) emailEl.textContent = localStorage.getItem(EMAIL_KEY) || '';
});

function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    window.location.href = '/entrenador/login';
}

// ── NAVEGACIÓN TABS ───────────────────────────────────────
function goTab(name, btn) {
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
    const page = document.getElementById('tab-' + name);
    if (page) page.classList.add('active');
    if (btn) btn.classList.add('active');

    if (name === 'asistencia') loadAsistencia();
}

// ── AUDIO ─────────────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSuccess() {
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
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
        const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime + offset);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + offset + 0.15);
        osc.start(audioCtx.currentTime + offset);
        osc.stop(audioCtx.currentTime + offset + 0.15);
    });
}
function playDebe() {
    // Sonido urgente: tres tonos cortos descendentes
    [0, 0.18, 0.36].forEach((offset, i) => {
        const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(380 - i * 40, audioCtx.currentTime + offset);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + offset + 0.14);
        osc.start(audioCtx.currentTime + offset);
        osc.stop(audioCtx.currentTime + offset + 0.14);
    });
}
function playError() {
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    osc.start(); osc.stop(audioCtx.currentTime + 0.5);
}

// ── FLASH OVERLAY ─────────────────────────────────────────
const FLASH_DUR = 4000;

const FLASH_CONFIG = {
    success: { icon: '✅', status: '¡BIENVENIDO!', detalle: '' },
    warning: { icon: '⚠️', status: 'YA REGISTRADO', detalle: '' },
    debe: { icon: '🚫', status: 'MENSUALIDAD VENCIDA', detalle: '' },
    error: { icon: '❌', status: 'CREDENCIAL INVÁLIDA', detalle: '' }
};

function showFlash(estado, nombre, detalle) {
    const overlay = document.getElementById('flash-overlay');
    const iconEl = document.getElementById('flash-icon');
    const nameEl = document.getElementById('flash-name');
    const statusEl = document.getElementById('flash-status');
    const detEl = document.getElementById('flash-detalle');
    const barEl = document.getElementById('flash-bar');
    if (!overlay) return;

    const cfg = FLASH_CONFIG[estado] || FLASH_CONFIG.error;

    overlay.className = `flash-overlay show ${estado}`;
    iconEl.textContent = cfg.icon;
    nameEl.textContent = nombre || '';
    statusEl.textContent = cfg.status;
    detEl.textContent = detalle || cfg.detalle;

    // Reiniciar barra
    barEl.style.cssText = '';
    void barEl.offsetWidth; // forzar reflow
    barEl.style.setProperty('--flash-dur', FLASH_DUR + 'ms');

    setTimeout(() => {
        overlay.className = 'flash-overlay';
    }, FLASH_DUR);
}

// ── HISTORIAL SCAN ────────────────────────────────────────
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
        </li>
    `).join('');
}

// ── SCANNER ───────────────────────────────────────────────
let qrScanner = null;
let processing = false;

function handleScan(decodedText) {
    if (processing) return;
    processing = true;
    if (qrScanner) qrScanner.pause();

    const code = decodedText.includes('?code=')
        ? decodedText.split('?code=')[1]
        : decodedText;

    fetch('/attendance/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    })
        .then(r => r.json())
        .then(data => {
            const nombre = data.student_name || 'Desconocido';
            const estado = data.status || 'error';
            const detalle = data.detalle || '';

            if (estado === 'success') playSuccess();
            else if (estado === 'warning') playWarning();
            else if (estado === 'debe') playDebe();
            else playError();

            showFlash(estado, nombre, detalle);
            addHistory(estado, nombre);
        })
        .catch(() => {
            playError();
            showFlash('error', 'SIN CONEXIÓN', 'Verifica la red.');
        })
        .finally(() => {
            setTimeout(() => {
                processing = false;
                if (qrScanner) qrScanner.resume();
            }, FLASH_DUR + 200);
        });
}

// Iniciar cámara
window.addEventListener('load', () => {
    setTimeout(() => {
        qrScanner = new Html5QrcodeScanner('reader', {
            fps: 15,
            qrbox: { width: 240, height: 240 },
            rememberLastUsedCamera: true,
            showTorchButtonIfSupported: true
        });
        qrScanner.render(
            decoded => handleScan(decoded),
            () => { } // ignorar errores de lectura
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
        if (listEl) listEl.innerHTML = '<div class="loading-msg" style="color:var(--red2)">Error al cargar asistencia.</div>';
    }
}

function setFiltroAsist(filtro, btn) {
    filtroAsist = filtro;
    document.querySelectorAll('.asistencia-filtros .chip').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderAsistencia();
}

function renderAsistencia() {
    const listEl = document.getElementById('asistencia-list');
    const statsEl = document.getElementById('asistencia-stats');
    if (!listEl) return;

    const total = asistenciaData.length;
    const presentes = asistenciaData.filter(a => a.present).length;
    const ausentes = total - presentes;
    const deudores = asistenciaData.filter(a => a.debe).length;

    if (statsEl) {
        statsEl.innerHTML = `
            <div class="stat-pill">
                <div class="stat-pill-num">${total}</div>
                <div class="stat-pill-label">Total activos</div>
            </div>
            <div class="stat-pill">
                <div class="stat-pill-num green">${presentes}</div>
                <div class="stat-pill-label">Presentes</div>
            </div>
            <div class="stat-pill">
                <div class="stat-pill-num red">${ausentes}</div>
                <div class="stat-pill-label">Ausentes</div>
            </div>
        `;
    }

    let datos = asistenciaData;
    if (filtroAsist === 'presentes') datos = datos.filter(a => a.present);
    if (filtroAsist === 'ausentes') datos = datos.filter(a => !a.present);
    if (filtroAsist === 'deudores') datos = datos.filter(a => a.debe);

    if (!datos.length) {
        listEl.innerHTML = '<div class="loading-msg">Sin resultados para el filtro seleccionado.</div>';
        return;
    }

    const html = datos.map(a => {
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
        return `
            <div class="alumno-card ${cls}">
                <div class="alumno-avatar">${emoji}</div>
                <div class="alumno-info">
                    <div class="alumno-nombre">${a.full_name}</div>
                    <div class="alumno-meta">${meta}</div>
                </div>
                ${badge}
            </div>
        `;
    }).join('');

    listEl.innerHTML = `<div class="asistencia-grid">${html}</div>`;
}
