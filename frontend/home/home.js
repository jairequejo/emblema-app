// home.js — JR Stars Landing

// ── SCROLL REVEAL ──────────────────────────────────────
const reveals = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('visible'); revealObserver.unobserve(e.target); }
  });
}, { threshold: 0.15 });
reveals.forEach(r => revealObserver.observe(r));

// ── CONTADOR ANIMADO ───────────────────────────────────
function animateCount(el, target, duration = 1800) {
  let start = null;
  const step = (ts) => {
    if (!start) start = ts;
    const progress = Math.min((ts - start) / duration, 1);
    el.textContent = Math.floor(progress * target);
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = target;
  };
  requestAnimationFrame(step);
}

const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      animateCount(document.getElementById('cnt-alumnos'), 48);
      animateCount(document.getElementById('cnt-sesiones'), 312);
      animateCount(document.getElementById('cnt-años'), 3);
      statsObserver.disconnect();
    }
  });
}, { threshold: 0.5 });
statsObserver.observe(document.querySelector('.hero-stats'));

// ── NOTICIAS DESDE SUPABASE ────────────────────────────
async function loadNoticias() {
  try {
    const res  = await fetch('/public/noticias');
    if (!res.ok) return; // si falla, se queda con el HTML estático
    const data = await res.json();
    if (!data || data.length === 0) return;

    // Noticia destacada (la más reciente)
    const featured = data[0];
    const featuredEl = document.getElementById('noticia-featured');
    if (featuredEl) {
      featuredEl.innerHTML = `
        ${featured.imagen_url
          ? `<img src="${featured.imagen_url}" class="noticia-featured-img" alt="${featured.titulo}">`
          : `<div class="img-placeholder">${featured.emoji || '📢'}</div>`}
        <div class="noticia-featured-body">
          <span class="noticia-cat">${featured.emoji || '📢'} ${featured.categoria || 'Aviso'}</span>
          <div class="noticia-title">${featured.titulo}</div>
          <p class="noticia-desc">${featured.descripcion || ''}</p>
          <div class="noticia-meta">
            <span>📅 ${new Date(featured.created_at).toLocaleDateString('es-PE', {day:'2-digit', month:'short', year:'numeric'})}</span>
            · Por el entrenador JR
          </div>
        </div>`;
    }

    // Noticias secundarias (las siguientes 4)
    const listEl = document.getElementById('noticias-list');
    if (listEl && data.length > 1) {
      listEl.innerHTML = data.slice(1, 5).map(n => `
        <div class="noticia-item">
          <div class="noticia-item-icon">${n.emoji || '📢'}</div>
          <div class="noticia-item-body">
            <div class="noticia-item-title">${n.titulo}</div>
            <div class="noticia-item-date">📅 ${new Date(n.created_at).toLocaleDateString('es-PE', {day:'2-digit', month:'short', year:'numeric'})}</div>
          </div>
        </div>`).join('');
    }
  } catch (e) {
    console.log('Noticias: usando contenido estático', e);
  }
}

// ── GALERÍA DESDE SUPABASE ─────────────────────────────
async function loadGaleria() {
  try {
    const res  = await fetch('/public/galeria');
    if (!res.ok) return;
    const data = await res.json();
    if (!data || data.length === 0) return;

    const gridEl = document.getElementById('galeria-grid');
    if (!gridEl) return;

    // Primera foto ancha, resto normales
    gridEl.innerHTML = data.slice(0, 6).map((f, i) => `
      <div class="galeria-item ${i === 0 || i === 5 ? 'wide' : ''}">
        <img src="${f.url}" alt="${f.descripcion || 'Foto JR Stars'}"
          onerror="this.parentElement.innerHTML='<div class=galeria-placeholder>📸<span>Foto</span></div>'">
        <div class="galeria-overlay">
          <span class="galeria-overlay-text">${f.descripcion || 'JR Stars'}</span>
        </div>
      </div>`).join('');
  } catch (e) {
    console.log('Galería: usando contenido estático', e);
  }
}

// ── INIT ───────────────────────────────────────────────
loadNoticias();
loadGaleria();