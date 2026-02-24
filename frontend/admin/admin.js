// admin/admin.js — Panel de administración JR Stars

// ── AUTH ──────────────────────────────────────────────
const token = localStorage.getItem('jr_admin_token');
if (!token) window.location.href = '/admin/login';

document.getElementById('admin-email').textContent =
  localStorage.getItem('jr_admin_email') || '';

const H = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`
};

function logout() {
  localStorage.removeItem('jr_admin_token');
  localStorage.removeItem('jr_admin_email');
  window.location.href = '/admin/login';
}

// ── NAVEGACIÓN ────────────────────────────────────────
let scannerInit = false;

function goTo(page, ev) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  if (ev && ev.currentTarget) ev.currentTarget.classList.add('active');

  if (page === 'stats') loadStats();
  if (page === 'alumnos') loadAlumnos();
  if (page === 'batidos') loadCreditos();
  if (page === 'noticias') loadNoticias();
  if (page === 'fotos') loadFotos();
  if (page === 'scanner' && !scannerInit) initScanner();
}

// ── TOAST ─────────────────────────────────────────────
function showToast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast visible ${type === 'error' ? 'error' : ''}`;
  setTimeout(() => t.classList.remove('visible'), 3000);
}

// ── STATS ─────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch('/admin/stats', { headers: H });
    if (res.status === 401) { logout(); return; }
    const d = await res.json();
    document.getElementById('s-total').textContent = d.total_alumnos;
    document.getElementById('s-presentes').textContent = d.presentes_hoy;
    document.getElementById('s-ausentes').textContent = d.ausentes_hoy;
    document.getElementById('s-fecha').textContent = d.fecha;
  } catch {}
}

// ── SCANNER ───────────────────────────────────────────
function initScanner() {
  scannerInit = true;
  const scanner = new Html5QrcodeScanner('admin-reader', {
    fps: 15,
    qrbox: { width: 250, height: 250 }
  });
  scanner.render(async (code) => {
    scanner.pause();
    const clean = code.includes('?code=') ? code.split('?code=')[1] : code;
    try {
      const res = await fetch('/attendance/scan', {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ code: clean })
      });
      const d = await res.json();
      const el = document.getElementById('scan-result');
      el.style.display = 'block';
      el.className = `scan-result ${d.status}`;
      el.innerHTML = d.message;

      const li = document.createElement('li');
      li.style.cssText = 'padding:.5rem 0;border-bottom:1px solid var(--border);font-family:var(--font-cond);font-size:.9rem';
      li.innerHTML = `<strong style="color:var(--gold)">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong> — ${d.student_name || clean}`;
      document.getElementById('scan-history').prepend(li);

      setTimeout(() => { el.style.display = 'none'; scanner.resume(); }, 2500);
    } catch { setTimeout(() => scanner.resume(), 2000); }
  });
}

// ── ALUMNOS (Registro + Cobro Inicial y Tabla Semáforo) ──
async function loadAlumnos() {
  const res = await fetch('/admin/alumnos', { headers: H });
  if (res.status === 401) { logout(); return; }
  const data = await res.json();
  const container = document.getElementById('alumnos-list');
  if (!data.length) { container.innerHTML = '<p style="color:var(--gray);font-family:var(--font-cond)">No hay alumnos aún.</p>'; return; }

  const hoy = new Date();
  
  container.innerHTML = `
    <table class="admin-table">
      <thead><tr>
        <th>Nombre</th><th>Estado</th><th>Vence</th><th>Horario</th><th>Acciones</th>
      </tr></thead>
      <tbody>
        ${data.map(a => {
          // Lógica Antifrágil Visual
          let estadoColor = 'var(--red2)';
          let estadoTexto = 'Inactivo';
          let vencimiento = '—';
          
          if (a.is_active) {
              if (a.valid_until) {
                  const fechaVence = new Date(a.valid_until);
                  fechaVence.setMinutes(fechaVence.getMinutes() + fechaVence.getTimezoneOffset());
                  vencimiento = fechaVence.toLocaleDateString('es-PE');
                  
                  if (fechaVence >= hoy) {
                      estadoColor = '#00ff88';
                      estadoTexto = 'Al Día';
                  } else {
                      estadoColor = 'var(--gold)';
                      estadoTexto = 'Vencido';
                  }
              } else {
                  estadoColor = 'var(--gold)';
                  estadoTexto = 'Sin Pago';
              }
          }

          return `
          <tr style="opacity: ${a.is_active ? '1' : '0.5'}">
            <td><strong>${a.full_name}</strong><br><span style="font-size:0.75rem; color:var(--gray)">DNI: ${a.dni || '—'}</span></td>
            <td><span style="color:${estadoColor}; font-weight:bold; font-size:0.85rem">${estadoTexto}</span></td>
            <td style="font-family:var(--font-mono); font-size:0.85rem">${vencimiento}</td>
            <td><span class="badge badge-gold">${a.horario || 'LMV'}</span></td>
            <td>
              <button class="btn btn-outline" style="font-size:.75rem;padding:.3rem .7rem" onclick="verQR('${a.id}')">QR</button>
              ${a.is_active 
                ? `<button class="btn btn-red" style="font-size:.75rem;padding:.3rem .7rem;margin-left:.3rem" onclick="toggleEstadoAlumno('${a.id}','${a.full_name.replace(/'/g, "\\'")}', false)">Desactivar</button>`
                : `<button class="btn btn-outline" style="font-size:.75rem;padding:.3rem .7rem;margin-left:.3rem; border-color:#00ff88; color:#00ff88" onclick="toggleEstadoAlumno('${a.id}','${a.full_name.replace(/'/g, "\\'")}', true)">Reactivar</button>`
              }
            </td>
          </tr>
        `}).join('')}
      </tbody>
    </table>`;
}

async function crearAlumno() {
  const nombre = document.getElementById('a-nombre').value.trim();
  const dni = document.getElementById('a-dni').value.trim();
  const apoderado = document.getElementById('a-apoderado').value.trim(); // NUEVO
  const telefono = document.getElementById('a-telefono').value.trim();   // NUEVO
  const pagoMes = parseFloat(document.getElementById('a-pago-mes').value) || 0;
  const pagoMat = parseFloat(document.getElementById('a-pago-mat').value) || 0;
  const metodo = document.getElementById('a-metodo').value;

  if (!nombre) return showToast('El nombre es obligatorio', 'error');

  const res = await fetch('/admin/alumnos', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      full_name: nombre,
      dni: dni || null,
      parent_name: apoderado || null, // Enviamos el dato
      parent_phone: telefono || null, // Enviamos el dato
      horario: document.getElementById('a-horario').value,
      turno: document.getElementById('a-turno')?.value || null,
      sede: null, 
      pago_mensualidad: pagoMes,
      pago_matricula: pagoMat,
      metodo_pago: metodo
    })
  });
  
  if (res.ok) {
    document.getElementById('a-nombre').value = '';
    document.getElementById('a-dni').value = '';
    document.getElementById('a-apoderado').value = ''; // Limpiamos
    document.getElementById('a-telefono').value = '';  // Limpiamos
    showToast('✅ Alumno inscrito. Cobro registrado.');
    loadAlumnos();
  } else {
    showToast('❌ Error. ¿DNI duplicado?', 'error');
  }
}

async function toggleEstadoAlumno(id, nombre, reactivar) {
  const accion = reactivar ? 'Reactivar' : 'Desactivar';
  if (!confirm(`¿${accion} a ${nombre}?`)) return;
  
  await fetch(`/admin/alumnos/${id}`, { method: 'DELETE', headers: H }); 
  
  showToast(`✅ Alumno actualizado`);
  loadAlumnos();
}

async function verQR(studentId) {
  try {
    // 1. Buscamos el código en la base de datos eterna (Supabase)
    const res = await fetch(`/credentials/${studentId}`, { headers: H });
    const data = await res.json();
    
    let codeStr = "";
    
    if (data.length > 0) {
      // Si ya existe, tomamos el texto
      codeStr = data[0].code;
    } else {
      // Si no existe, le decimos al backend que lo genere y nos devuelva el texto
      showToast('Generando nuevo QR...', 'ok');
      const gen = await fetch(`/credentials/generate/${studentId}`, { method: 'POST', headers: H });
      const d = await gen.json();
      codeStr = d.code;
    }
    
    // Usamos una herramienta pública y gratuita 
    // para dibujar el QR en pantalla al instante, sin usar el disco de Railway.
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${codeStr}`;
    
    // Abrimos la imagen gigante lista para imprimir
    window.open(qrImageUrl, '_blank');
    
  } catch (error) {
    showToast('❌ Error al obtener el QR.', 'error');
  }
}

// ── CAJA FUERTE / BATIDOS (Renovaciones) ───────────────
function loadCreditos() {
  const container = document.getElementById('creditos-result');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--gray);font-family:var(--font-cond)">Ingresa el DNI y haz clic en Buscar.</p>';
  const dniInput = document.getElementById('batidos-dni-search');
  if (dniInput) {
    dniInput.value = '';
    dniInput.onkeypress = (e) => { if (e.key === 'Enter') buscarAlumnoPorDni(); };
  }
}

async function buscarAlumnoPorDni() {
  const dni = document.getElementById('batidos-dni-search')?.value?.trim();
  if (!dni || dni.length < 6) {
    showToast('Ingresa un DNI válido (mín. 6 dígitos)', 'error');
    return;
  }
  const container = document.getElementById('creditos-result');
  container.innerHTML = '<p style="color:var(--gray)">Buscando…</p>';
  try {
    const res = await fetch(`/admin/alumnos/by-dni/${encodeURIComponent(dni)}`, { headers: H });
    if (res.status === 401) { logout(); return; }
    if (res.status === 404) {
      container.innerHTML = '<p style="color:var(--red2);font-family:var(--font-cond)">Alumno no encontrado. Verifica el DNI.</p>';
      return;
    }
    const a = await res.json();
    
    // Lógica visual Antifrágil
    const dias = a.dias_restantes || 0;
    const estadoMensualidad = dias > 0 
      ? `<span style="color:#00ff88; font-weight:bold;">ACTIVO (${dias} días)</span>` 
      : `<span style="color:var(--red2); font-weight:bold;">VENCIDO</span>`;

    container.innerHTML = `
      <div class="form-card">
        <div class="form-card-title">👤 ${a.full_name}</div>
        <p style="font-family:var(--font-cond);color:var(--gray);font-size:.9rem;margin-bottom:1rem">
          DNI: ${a.dni || '—'} | Estado: ${estadoMensualidad}
        </p>
        
        <div class="credit-row" style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border);">
          <span class="credit-name" style="color:var(--gold); font-weight:bold;">Mensualidad (S/ 80)</span>
          <button class="btn btn-outline" style="border-color:var(--gold); color:var(--gold);" onclick="pagarMensualidad('${a.id}')">💵 Cobrar Mes</button>
        </div>

        <div class="credit-row">
          <span class="credit-name">Créditos de Batido</span>
          <span class="credit-bal">${a.batido_credits ?? 0} cr.</span>
          <input class="input-jr credit-input" type="number" min="1" max="20" value="4" id="cr-${a.id}">
          <button class="btn btn-gold" onclick="recargar('${a.id}')">+ Recargar</button>
        </div>
      </div>`;
  } catch {
    container.innerHTML = '<p style="color:var(--red2)">Error de conexión.</p>';
  }
}

async function pagarMensualidad(id) {
  const confirmacion = confirm('¿Confirmar el cobro de S/ 80 por 1 mes de entrenamiento?');
  if (!confirmacion) return;
  
  let metodo = prompt("¿Cómo pagó? (Escribe: Efectivo, Yape o Plin):", "Efectivo");
  if (!metodo) return;

  const res = await fetch('/admin/mensualidades/pagar', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ student_id: id, monto: 80.00, metodo: metodo })
  });
  
  if (res.ok) {
    const d = await res.json();
    showToast(`✅ Pago registrado. Vence el: ${d.nueva_fecha_vencimiento}`);
    buscarAlumnoPorDni(); 
  } else {
    showToast('❌ Error al procesar el pago', 'error');
  }
}

async function recargar(id) {
  const cantidad = parseInt(document.getElementById(`cr-${id}`)?.value) || 4;
  const res = await fetch('/admin/batidos/recargar', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ student_id: id, cantidad, motivo: 'Recarga Yape/Plin' })
  });
  const d = await res.json();
  if (res.ok) {
    showToast(`✅ ${d.alumno}: ahora tiene ${d.creditos_nuevos} cr.`);
    buscarAlumnoPorDni();
  } else {
    showToast('❌ Error al recargar', 'error');
  }
}

// ── NOTICIAS ───────────────────────────────────────────
async function loadNoticias() {
  const res = await fetch('/admin/noticias', { headers: H });
  const data = await res.json();
  const container = document.getElementById('noticias-list');
  if (!data.length) { container.innerHTML = '<p style="color:var(--gray);font-family:var(--font-cond)">No hay noticias publicadas.</p>'; return; }
  container.innerHTML = data.map(n => `
    <div class="noticia-admin-card">
      <span class="emoji">${n.emoji || '📢'}</span>
      <div class="info">
        <div class="titulo">${n.titulo}</div>
        <div class="desc">${n.descripcion}</div>
        <div class="meta">${new Date(n.created_at).toLocaleDateString('es-PE')} · ${n.categoria}</div>
      </div>
      <button class="btn btn-red" style="font-size:.75rem;padding:.3rem .7rem;flex-shrink:0"
        onclick="eliminarNoticia('${n.id}')">✕</button>
    </div>
  `).join('');
}

async function crearNoticia() {
  const titulo = document.getElementById('n-titulo').value.trim();
  const desc = document.getElementById('n-desc').value.trim();
  if (!titulo || !desc) return;
  const res = await fetch('/admin/noticias', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      titulo,
      descripcion: desc,
      categoria: document.getElementById('n-categoria').value,
      emoji: document.getElementById('n-emoji').value || '📢',
      imagen_url: document.getElementById('n-imagen').value || null
    })
  });
  if (res.ok) {
    document.getElementById('n-titulo').value = '';
    document.getElementById('n-desc').value = '';
    showToast('✅ Noticia publicada');
    loadNoticias();
  } else showToast('❌ Error al publicar', 'error');
}

async function eliminarNoticia(id) {
  await fetch(`/admin/noticias/${id}`, { method: 'DELETE', headers: H });
  showToast('✅ Noticia eliminada');
  loadNoticias();
}

// ── FOTOS ─────────────────────────────────────────────
async function loadFotos() {
  const res = await fetch('/admin/fotos', { headers: H });
  const data = await res.json();
  const grid = document.getElementById('fotos-grid');
  if (!data.length) { grid.innerHTML = '<p style="color:var(--gray);font-family:var(--font-cond)">No hay fotos aún.</p>'; return; }
  grid.innerHTML = data.map(f => `
    <div style="position:relative;aspect-ratio:1;background:var(--card);border:1px solid var(--border);overflow:hidden">
      <img src="${f.url}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML='<div style=padding:1rem;font-size:.75rem;color:var(--gray)>Error al cargar</div>'">
      <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(8,8,8,.8);padding:.4rem .6rem;font-family:var(--font-cond);font-size:.72rem;color:var(--gray)">
        ${f.descripcion || ''}
        <button onclick="eliminarFoto('${f.id}')" style="float:right;background:none;border:none;color:var(--red2);cursor:pointer;font-size:.9rem">✕</button>
      </div>
    </div>
  `).join('');
}

async function agregarFoto() {
  const url = document.getElementById('f-url').value.trim();
  const desc = document.getElementById('f-desc').value.trim();
  if (!url) return;
  const res = await fetch('/admin/fotos', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ url, descripcion: desc })
  });
  if (res.ok) {
    document.getElementById('f-url').value = '';
    document.getElementById('f-desc').value = '';
    showToast('✅ Foto agregada');
    loadFotos();
  } else showToast('❌ Error al agregar foto', 'error');
}

async function eliminarFoto(id) {
  await fetch(`/admin/fotos/${id}`, { method: 'DELETE', headers: H });
  showToast('✅ Foto eliminada');
  loadFotos();
}

// ── INIT ──────────────────────────────────────────────
loadStats();