/* ==========================================================================
   home.js - Landing Page JR Stars (Vía Negativa)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  cargarRanking();

  document.getElementById('dni-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') consultarDni();
  });
});

/* ══ CONSULTAR DNI ══════════════════════════════════════════════════════ */
async function consultarDni() {
  const dni = document.getElementById('dni-input').value.trim();
  const errorBox = document.getElementById('error-box');
  const loader = document.getElementById('loader-box');
  const btn = document.getElementById('btn-consultar');

  errorBox.classList.add('hidden');

  if (dni.length < 8) {
    const input = document.getElementById('dni-input');
    input.style.borderColor = 'var(--red)';
    setTimeout(() => input.style.borderColor = 'var(--border)', 800);
    return;
  }

  // Estado: cargando
  btn.style.display = 'none';
  loader.classList.remove('hidden');

  try {
    const res = await fetch(`/public/student/${dni}/info`);

    if (!res.ok) {
      loader.classList.add('hidden');
      btn.style.display = 'block';

      if (res.status === 404) {
        // CISNE NEGRO — DNI no registrado
        errorBox.classList.remove('hidden');
      } else {
        alert('Error del servidor. Intenta de nuevo.');
      }
      return;
    }

    const data = await res.json();

    // Transición: Panel 1 → Panel 2
    setTimeout(() => {
      document.getElementById('panel-1').classList.replace('on', 'off');

      renderizarFicha(data);

      document.getElementById('panel-2').classList.replace('off', 'on');
      document.getElementById('panel-3').classList.remove('hidden');

      window.scrollTo({ top: 0, behavior: 'smooth' });
      loader.classList.add('hidden');
      btn.style.display = 'block';
      document.getElementById('dni-input').value = '';
    }, 450);

  } catch (err) {
    console.error(err);
    loader.classList.add('hidden');
    btn.style.display = 'block';
    alert('Sin conexión. Intenta de nuevo.');
  }
}

/* ══ VOLVER AL PANEL 1 ══════════════════════════════════════════════════ */
function volverInicio() {
  document.getElementById('panel-2').classList.replace('on', 'off');
  document.getElementById('panel-3').classList.add('hidden');

  setTimeout(() => {
    document.getElementById('panel-1').classList.replace('off', 'on');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 200);
}

/* ══ RENDERIZAR FICHA FUT ══════════════════════════════════════════════ */
function renderizarFicha(data) {
  const container = document.getElementById('ficha-atleta');

  const avatarHtml = data.img_url
    ? `<img src="${data.img_url}" alt="${data.full_name}">`
    : `<span>${data.full_name.charAt(0)}</span>`;

  if (data.debe) {
    /* ── ESTADO A: CASTIGO / DEUDA ─────────────────────────── */
    container.className = 'fut-card deuda';
    container.innerHTML = `
      <div class="card-accent"></div>
      
      <div class="deuda-overlay">
        <div class="lock-icon">🔒</div>
        <div class="deuda-title">ESTATUS OCULTO</div>
        <div class="deuda-sub">MENSUALIDAD PENDIENTE</div>
        <p class="deuda-desc">
          Para acceder a las métricas de <strong>${data.full_name.split(' ')[0]}</strong>
          debes estar al día con la academia.
        </p>
        <button class="btn-pagar"
                onclick="document.getElementById('modal-yape').classList.add('open')">
          PAGAR S/80 VÍA YAPE / PLIN
        </button>
      </div>

      <!-- Ficha de fondo borrosa -->
      <div class="fut-header">
        <div class="fut-avatar">${avatarHtml}</div>
        <div class="fut-info">
          <div class="fut-name">${data.full_name}</div>
          <div class="fut-cat">${data.category}</div>
        </div>
      </div>
      <div class="racha-box">
        <span class="racha-tag">// racha activa</span>
        <div class="fire-metric"><span>🔥</span> ${data.racha} SESIONES</div>
      </div>`;

  } else {
    /* ── ESTADO B: AL DÍA / DOPAMINA ───────────────────────── */
    container.className = 'fut-card al-dia';

    const msg = encodeURIComponent(
      `¡Mira el estatus deportivo de ${data.full_name} en JR Stars! 🔥🏆\n\nConsulta el tuyo: https://emblema-app.up.railway.app`
    );
    const linkWa = `https://wa.me/?text=${msg}`;

    container.innerHTML = `
      <div class="card-accent"></div>

      <div class="fut-header">
        <div class="fut-avatar">${avatarHtml}</div>
        <div class="fut-info">
          <div class="fut-name">${data.full_name}</div>
          <div class="fut-cat">${data.category}</div>
        </div>
      </div>

      <div class="racha-box">
        <span class="racha-tag">// RACHA DE DISCIPLINA</span>
        <div class="fire-metric"><span>🔥</span> ${data.racha} SESIONES</div>
      </div>

      <div class="bio-row">
        <div class="bio-cell">
          <div class="bio-val">${data.bio.talla}</div>
          <div class="bio-label">Estatura</div>
        </div>
        <div class="bio-cell">
          <div class="bio-val">${data.bio.peso}</div>
          <div class="bio-label">Peso corporal</div>
        </div>
      </div>

      <div class="radar-box">
        <span class="radar-icon">📊</span>
        <div class="radar-txt">
          Fase de medición física en progreso.<br>
          Próximamente: Ranking de Velocidad y Potencia.
        </div>
      </div>

      <a href="${linkWa}" target="_blank" class="btn-presumir">
        📲 PRESUMIR ESTATUS
      </a>`;
  }
}

/* ══ CARGAR TOP 5 DE HIERRO ════════════════════════════════════════════ */
async function cargarRanking() {
  const container = document.getElementById('ranking-list');
  try {
    const res = await fetch('/public/leaderboard/month');
    if (!res.ok) throw new Error();
    const data = await res.json();

    if (!data.length) {
      container.innerHTML = '<div class="rank-loader">Iniciando el mes...</div>';
      return;
    }

    container.innerHTML = data.map((item, i) => `
      <div class="rank-item${i === 0 ? ' first' : ''}">
        <div class="rank-pos">${i + 1}</div>
        <div class="rank-name">${item.name}</div>
        <div class="rank-score">🔥 ${item.score}</div>
      </div>`).join('');

  } catch {
    container.innerHTML = '<div class="rank-loader" style="color:var(--red2)">No disponible.</div>';
  }
}