// home/home.js — Portal público JR Stars

// ── HELPERS ──────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── INIT ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Leer ?code= de la URL (viene de chip NFC)
    const urlParams = new URLSearchParams(window.location.search);
    const nfcCode = urlParams.get('code');
    if (nfcCode) {
        window.history.replaceState({}, '', '/');
        handleScanCode(nfcCode.trim());
    }

    loadRanking();
    initNFC();
});

// ── BUSCAR POR DNI ────────────────────────────────────
async function buscar() {
    const dniEl = $('dni');
    const btn   = $('btnC');
    const errEl = $('err');
    const ldEl  = $('ld');
    if (!dniEl) return;

    const dni = dniEl.value.trim();
    if (errEl) errEl.classList.add('hidden');

    if (dni.length < 8) {
        dniEl.style.borderBottomColor = 'var(--red)';
        setTimeout(() => dniEl.style.borderBottomColor = '', 900);
        return;
    }

    if (btn) btn.disabled = true;
    if (ldEl) ldEl.classList.remove('hidden');

    try {
        const res = await fetch(`/public/student/${encodeURIComponent(dni)}/info`);

        if (res.status === 404) {
            if (ldEl) ldEl.classList.add('hidden');
            if (btn) btn.disabled = false;
            if (errEl) {
                errEl.classList.remove('hidden');
                errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            return;
        }

        if (!res.ok) throw new Error('server');

        const data = await res.json();
        if (ldEl) ldEl.classList.add('hidden');
        if (btn) btn.disabled = false;

        renderCard(data);
        mostrarPaneles('ficha');
        dniEl.value = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch {
        if (ldEl) ldEl.classList.add('hidden');
        if (btn) btn.disabled = false;
        alert('Error de conexión. Verifica tu internet.');
    }
}

// ── NAVEGACIÓN ENTRE PANELES ──────────────────────────
function mostrarPaneles(vista) {
    const p1 = $('p1'), p2 = $('p2'), p3 = $('p3');
    if (vista === 'ficha') {
        if (p1) p1.classList.add('hidden');
        if (p2) p2.classList.remove('hidden');
        if (p3) p3.classList.remove('hidden');
    } else {
        if (p1) p1.classList.remove('hidden');
        if (p2) p2.classList.add('hidden');
        if (p3) p3.classList.add('hidden');
    }
}

function volver() {
    mostrarPaneles('buscar');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── SCANNER QR ────────────────────────────────────────
let qrScanner = null;

function toggleScanner() {
    const container = $('scanner-container');
    if (!container) return;
    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        if (!qrScanner) {
            qrScanner = new Html5QrcodeScanner('reader', {
                fps: 15,
                qrbox: { width: 220, height: 220 },
                rememberLastUsedCamera: true
            });
            qrScanner.render(
                (decodedText) => {
                    try { if (qrScanner.getState() !== 3) qrScanner.pause(true); } catch {}
                    toggleScanner();
                    handleScanCode(decodedText);
                },
                () => {}
            );
        } else {
            try { if (qrScanner.getState() === 3) qrScanner.resume(); } catch {}
        }
    } else {
        container.classList.add('hidden');
        try { if (qrScanner && qrScanner.getState() !== 3) qrScanner.pause(true); } catch {}
    }
}

// ── HANDLE CÓDIGO (QR o NFC) ──────────────────────────
function handleScanCode(rawCode) {
    let raw = rawCode.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();

    // Extraer ?code= si viene en URL completa
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
        try {
            const url = new URL(raw);
            const param = url.searchParams.get('code');
            if (param) raw = decodeURIComponent(param);
        } catch {
            const idx = raw.indexOf('?code=');
            if (idx !== -1) raw = decodeURIComponent(raw.slice(idx + 6));
        }
    } else if (raw.includes('?code=')) {
        raw = decodeURIComponent(raw.split('?code=')[1]);
    }

    const dniEl = $('dni');
    if (dniEl) dniEl.value = raw;
    buscar();
}

// ── NFC ───────────────────────────────────────────────
const NDEF_URI_PREFIXES_HOME = [
    '', 'http://www.', 'https://www.', 'http://', 'https://',
    'tel:', 'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.',
    'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://',
    'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:', 'sip:',
    'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://',
    'tcpobex://', 'irdaobex://', 'file://', 'urn:epc:id:',
    'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:',
];

function _homeNfcExtract(record) {
    let fullText = null;
    try {
        if (record.recordType === 'url') {
            const bytes = new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength);
            fullText = (NDEF_URI_PREFIXES_HOME[bytes[0]] ?? '') + new TextDecoder('utf-8').decode(bytes.slice(1)).trim();
        } else if (record.recordType === 'text') {
            const bytes = new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength);
            const langLen = bytes[0] & 0x3F;
            const charset = (bytes[0] & 0x80) ? 'utf-16' : 'utf-8';
            fullText = new TextDecoder(charset).decode(bytes.slice(1 + langLen)).trim();
        } else {
            fullText = new TextDecoder(record.encoding || 'utf-8').decode(record.data)
                .replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
        }
    } catch { return null; }
    return fullText || null;
}

async function initNFC() {
    if (!('NDEFReader' in window)) return;
    try {
        const ndef = new NDEFReader();
        await ndef.scan();
        ndef.addEventListener('reading', ({ message }) => {
            for (const record of message.records) {
                const raw = _homeNfcExtract(record);
                if (!raw) continue;
                try { if (qrScanner && !$('scanner-container').classList.contains('hidden')) toggleScanner(); } catch {}
                handleScanCode(raw);
                break;
            }
        });
    } catch (e) {
        console.warn('NFC no disponible:', e.message);
    }
}

// ── RENDER FICHA ──────────────────────────────────────
function renderCard(d) {
    const wrap = $('card-wrap');
    if (!wrap) return;

    const av = d.img_url
        ? `<img src="${d.img_url}" alt="${d.full_name}">`
        : `<span>${d.full_name.charAt(0).toUpperCase()}</span>`;

    if (d.debe) {
        wrap.innerHTML = `
          <div class="fut-card deuda">
            <div class="card-stripe"></div>
            <div class="c-header">
              <div class="avatar">${av}</div>
              <div>
                <div class="c-name">${d.full_name}</div>
                <div class="c-cat">${d.category}</div>
              </div>
            </div>
            <div class="deuda-overlay">
              <div class="lock-ico">🔒</div>
              <div class="deuda-h">ESTATUS OCULTO</div>
              <div class="deuda-sub">MENSUALIDAD PENDIENTE</div>
              <p class="deuda-desc">
                El historial de <strong>${d.full_name.split(' ')[0]}</strong>
                está bloqueado. Regulariza el pago para ver tus métricas.
              </p>
              <button class="btn-pagar"
                      onclick="document.getElementById('modal-yape').classList.add('open')">
                PAGAR S/80 VÍA YAPE / PLIN
              </button>
            </div>
          </div>`;
    } else {
        const waMsg = encodeURIComponent(
            `¡Mi hijo/a ${d.full_name} tiene ${d.racha} sesiones en JR Stars! 🔥🏆\n` +
            `Consulta el tuyo → https://emblema-app-production.up.railway.app`
        );

        const histRows = (d.historial_biometrico || []).map(h => `
          <tr>
            <td class="fecha">${h.fecha}</td>
            <td>${h.talla}</td>
            <td>${h.peso}</td>
          </tr>`).join('');

        const histSection = histRows ? `
          <div class="bio-hist">
            <div class="hist-title">// EVOLUCIÓN FÍSICA</div>
            <table class="hist-table">
              <thead><tr><th>Mes</th><th>Talla</th><th>Peso</th></tr></thead>
              <tbody>${histRows}</tbody>
            </table>
          </div>` : '';

        wrap.innerHTML = `
          <div class="fut-card ok">
            <div class="card-stripe"></div>
            <div class="c-header">
              <div class="avatar">${av}</div>
              <div>
                <div class="c-name">${d.full_name}</div>
                <div class="c-cat">${d.category}</div>
              </div>
            </div>
            <div class="racha-blk">
              <span class="racha-tag">// RACHA ACTIVA DE DISCIPLINA</span>
              <div class="racha-num"><span class="fire">🔥</span> ${d.racha} SESIONES</div>
            </div>
            ${(d.talla_actual || d.peso_actual) ? `
            <div class="bio-row">
              <div class="bio-cell">
                <div class="bio-val">${d.talla_actual || '—'}<span class="bio-delta">${d.delta_talla || ''}</span></div>
                <div class="bio-label">Estatura</div>
              </div>
              <div class="bio-cell">
                <div class="bio-val">${d.peso_actual || '—'}</div>
                <div class="bio-label">Peso corporal</div>
              </div>
            </div>` : `
            <div style="padding:.9rem 1.2rem;border-bottom:1px solid var(--border);font-family:var(--ff-c);font-size:.82rem;color:var(--gray);text-align:center">
              📏 Sin mediciones físicas registradas aún
            </div>`}
            ${histSection}
            <div class="radar-blk">
              <div class="radar-hex"></div>
              <div class="radar-txt">
                <strong>PRÓXIMAMENTE</strong>
                Velocidad · Potencia · Resistencia.
              </div>
            </div>
            <a href="https://wa.me/?text=${waMsg}" target="_blank" class="btn-presumir">
              📲 COMPARTIR ESTATUS
            </a>
          </div>`;
    }
}

// ── RANKING ───────────────────────────────────────────
async function loadRanking() {
    const el = $('ranking');
    if (!el) return;
    try {
        const res = await fetch('/public/leaderboard/month');
        const data = res.ok ? await res.json() : [];
        if (!data.length) {
            el.innerHTML = '<div class="rk-empty">Datos disponibles próximamente.</div>';
            return;
        }
        el.innerHTML = data.map((item, i) => `
          <div class="rk-item${i === 0 ? ' first' : ''}">
            <div class="rk-pos">${i + 1}</div>
            <div class="rk-name">${item.name}</div>
            <div class="rk-score">🔥 ${item.score}</div>
          </div>`).join('');
    } catch {
        el.innerHTML = '<div class="rk-empty" style="color:var(--red2)">No disponible.</div>';
    }
}