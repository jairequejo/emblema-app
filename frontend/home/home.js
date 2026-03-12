// home/home.js — Lógica de la página pública JR Stars

const $ = id => document.getElementById(id);
const p1 = $('p1'), p2 = $('p2'), p3 = $('p3');

document.addEventListener('DOMContentLoaded', () => {
  // ── NUEVO: leer ?code= de la URL al abrir desde chip NFC ──
  const urlParams = new URLSearchParams(window.location.search);
  const nfcCode = urlParams.get('code');
  if (nfcCode) {
    window.history.replaceState({}, '', '/'); // limpiar URL
    handleScanCode(nfcCode.trim());           // buscar directo
  }

  loadRanking();
  initNFC();
});

$('dni').addEventListener('keypress', e => { if (e.key === 'Enter') buscar(); });

/* ── SCANNER QR / NFC ── */
let qrScanner = null;

function toggleScanner() {
  const container = $('scanner-container');
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
          if (qrScanner.getState && qrScanner.getState() !== 3) {
            qrScanner.pause(true);
          }
          toggleScanner();
          handleScanCode(decodedText);
        },
        () => { }
      );
    } else {
      if (qrScanner.getState && qrScanner.getState() === 3) {
        qrScanner.resume();
      }
    }
  } else {
    container.classList.add('hidden');
    if (qrScanner && qrScanner.getState && qrScanner.getState() !== 3) {
      qrScanner.pause(true);
    }
  }
}

function handleScanCode(rawCode) {
  let raw = rawCode.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();

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

  $('dni').value = raw;
  buscar();
}

/* ── NFC ── */
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
      const prefix = NDEF_URI_PREFIXES_HOME[bytes[0]] ?? '';
      fullText = prefix + new TextDecoder('utf-8').decode(bytes.slice(1)).trim();
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
        if (qrScanner && !$('scanner-container').classList.contains('hidden')) {
          toggleScanner();
        }
        handleScanCode(raw);
        break;
      }
    });
  } catch (e) {
    console.warn('NFC no disponible:', e.message);
  }
}

/* ── CONSULTAR DNI O UUID ── */
async function buscar() {
  const dni = $('dni').value.trim();
  const btn = $('btnC');
  $('err').classList.add('hidden');

  if (dni.length < 8) {
    $('dni').style.borderBottomColor = 'var(--red)';
    setTimeout(() => $('dni').style.borderBottomColor = 'var(--gold)', 900);
    return;
  }

  btn.disabled = true;
  $('ld').classList.remove('hidden');

  try {
    const res = await fetch(`/public/student/${encodeURIComponent(dni)}/info`);

    if (res.status === 404) {
      $('ld').classList.add('hidden');
      btn.disabled = false;
      $('err').classList.remove('hidden');
      $('err').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    if (!res.ok) throw new Error('server');

    const data = await res.json();
    $('ld').classList.add('hidden');
    btn.disabled = false;

    setTimeout(() => {
      renderCard(data);
      p1.classList.add('hidden');
      p2.classList.remove('hidden');
      p3.classList.remove('hidden');
      $('dni').value = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 250);

  } catch {
    $('ld').classList.add('hidden');
    btn.disabled = false;
    alert('Error de conexión. Verifica tu internet.');
  }
}

/* ── VOLVER ── */
function volver() {
  p2.classList.add('hidden');
  p3.classList.add('hidden');
  p1.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── RENDER FICHA ── */
function renderCard(d) {
  const wrap = $('card-wrap');
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
      `Consulta el tuyo → https://emblema-app.up.railway.app`
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

/* ── RANKING ── */
async function loadRanking() {
  const el = $('ranking');
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