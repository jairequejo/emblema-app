/* ==========================================================================
   home.js - Lógica del Landing Page (Vía Negativa)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // Solo cargar el ranking al inicio, el resto espera al DNI
  cargarRanking();

  // Listeners para el input (permitir enter)
  const dniInput = document.getElementById('dni-input');
  if (dniInput) {
    dniInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') consultarDni();
    });
  }
});

/**
 * Consulta el DNI en el backend.
 * Controla la transición del Panel 1 al Panel 2.
 */
async function consultarDni() {
  const dni = document.getElementById('dni-input').value.trim();
  const errorBox = document.getElementById('error-box');
  const loaderBox = document.getElementById('loader-box');
  const btn = document.getElementById('btn-consultar');
  const logoBox = document.querySelector('.logo-box');

  errorBox.classList.add('hidden');

  if (dni.length < 8) {
    // Mini feedback visual de error en el input sin mostrar todo el cisne negro
    const input = document.getElementById('dni-input');
    input.style.borderColor = 'var(--error-red)';
    setTimeout(() => input.style.borderColor = 'var(--dark-border)', 800);
    return;
  }

  // Estado de carga UI
  btn.style.display = 'none';
  loaderBox.classList.remove('hidden');

  try {
    const response = await fetch(`/public/student/${dni}/info`);

    if (!response.ok) {
      // DNI NO ENCONTRADO -> El Cisne Negro
      if (response.status === 404) {
        loaderBox.classList.add('hidden');
        btn.style.display = 'block';
        errorBox.classList.remove('hidden'); // Mostrar mensaje agresivo
        logoBox.style.transform = 'scale(0.8)';
        logoBox.style.transition = '0.3s';
      } else {
        throw new Error('Error de servidor');
      }
      return;
    }

    const data = await response.json();

    // TRANSICIÓN DE PANELES (DNI VÁLIDO)
    setTimeout(() => {
      document.getElementById('panel-1').classList.remove('visible');
      document.getElementById('panel-1').classList.add('hidden');

      renderizarFicha(data);

      document.getElementById('panel-2').classList.remove('hidden');
      document.getElementById('panel-2').classList.add('visible');
      document.getElementById('panel-3').classList.remove('hidden');

      // Scroll to top
      window.scrollTo(0, 0);

      // Restaurar panel 1 por si vuelve
      loaderBox.classList.add('hidden');
      btn.style.display = 'block';
      document.getElementById('dni-input').value = '';
    }, 600); // Pequeño delay para que el loader se vea (puro teatro UX)

  } catch (error) {
    console.error('Error:', error);
    loaderBox.classList.add('hidden');
    btn.style.display = 'block';
    alert('Error de conexión. Intente nuevamente.');
  }
}

/**
 * Vuelve al Panel 1
 */
function volverInicio() {
  document.getElementById('panel-2').classList.remove('visible');
  document.getElementById('panel-2').classList.add('hidden');
  document.getElementById('panel-3').classList.add('hidden');

  setTimeout(() => {
    document.getElementById('panel-1').classList.remove('hidden');
    document.getElementById('panel-1').classList.add('visible');
    const logoBox = document.querySelector('.logo-box');
    logoBox.style.transform = 'scale(1)';
  }, 300);
}

/**
 * Renderiza dinámicamente el HTML de la ficha del atleta (Panel 2)
 * dependiendo de si DEBE (Estado A) o ESTÁ AL DÍA (Estado B)
 */
function renderizarFicha(data) {
  const container = document.getElementById('ficha-atleta');

  const avatarHtml = data.img_url
    ? `<img src="${data.img_url}" alt="${data.full_name}">`
    : `<span>${data.full_name.charAt(0)}</span>`;

  if (data.debe) {
    // ESTADO A: CASTIGO (DEUDA)
    container.className = 'fut-card deuda';
    container.innerHTML = `
      <div class="deuda-overlay">
        <div class="lock-icon">🔒</div>
        <div class="deuda-title">ESTATUS OCULTO</div>
        <div class="deuda-sub">MENSUALIDAD PENDIENTE</div>
        <p style="color:var(--gray);font-size:0.85rem;margin-bottom:1.5rem">
          Para acceder a las métricas e historial de <strong>${data.full_name.split(' ')[0]}</strong>, debes estar al día.
        </p>
        <button class="btn-heavy btn-gold" onclick="document.getElementById('modal-recarga').classList.add('visible')">
          PAGAR S/80 VÍA YAPE/PLIN
        </button>
      </div>
      
      <!-- Ficha de fondo (desenfocada) -->
      <div class="fut-header">
        <div class="fut-avatar">${avatarHtml}</div>
        <div class="fut-info">
          <h2>${data.full_name}</h2>
          <div class="fut-cat">${data.category}</div>
        </div>
      </div>
      <div class="racha-box">
        <div class="racha-title">RACHA ACTIVA</div>
        <div class="fire-metric">🔥 ${data.racha} CLASES</div>
      </div>
    `;
  } else {
    // ESTADO B: RECOMPENSA (AL DÍA)
    container.className = 'fut-card al-dia';

    // Generar enlace mágico falso / texto de WhatsApp
    const msg = encodeURIComponent(`¡Mira el estatus deportivo de ${data.full_name} en JR Stars Academia! 🔥🏆\n\nFicha Oficial: https://jrstars.pe`);
    const linkWa = `https://wa.me/?text=${msg}`;

    container.innerHTML = `
      <div class="fut-header">
        <div class="fut-avatar">${avatarHtml}</div>
        <div class="fut-info">
          <h2 class="gold-txt">${data.full_name}</h2>
          <div class="fut-cat">${data.category}</div>
        </div>
      </div>
      
      <div class="racha-box">
        <div class="racha-title">RACHA DE DISCIPLINA</div>
        <div class="fire-metric">🔥 ${data.racha} SESIONES</div>
      </div>
      
      <div class="bio-grid">
        <div class="bio-stat">
          <div class="bio-val">${data.bio.talla}</div>
          <div class="bio-label">Estatura</div>
        </div>
        <div class="bio-stat">
          <div class="bio-val">${data.bio.peso}</div>
          <div class="bio-label">Peso Corporal</div>
        </div>
      </div>
      
      <div class="fut-radar">
        <div class="hex-placeholder"></div>
        <p>Fase de medición física en progreso.<br>Próximamente: Ranking de Velocidad y Potencia.</p>
      </div>
      
      <a href="${linkWa}" target="_blank" class="presumir-btn">
        📲 PRESUMIR ESTATUS
      </a>
    `;
  }
}

/**
 * Consulta el TOP 5 en el backend y renderiza la lista (Panel 3)
 */
async function cargarRanking() {
  const container = document.getElementById('ranking-list');
  try {
    const response = await fetch('/public/leaderboard/month');
    if (!response.ok) throw new Error();
    const data = await response.json();

    if (data.length === 0) {
      container.innerHTML = '<div class="loader-txt" style="color:var(--gray)">Iniciando el mes de entrenamiento...</div>';
      return;
    }

    container.innerHTML = data.map((item, index) => {
      const cls = index === 0 ? 'rank-1' : '';
      return `
        <div class="ranking-item ${cls}">
          <div class="rank-pos">${index + 1}</div>
          <div class="rank-name">${item.name}</div>
          <div class="rank-score">🔥 ${item.score}</div>
        </div>
      `;
    }).join('');

  } catch (error) {
    container.innerHTML = '<div class="loader-txt" style="color:var(--error-red)">Data no disponible.</div>';
  }
}