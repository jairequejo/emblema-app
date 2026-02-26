// kiosko/kiosko.js — Lógica del Kiosko Virtual JR Stars
// Extraído del <script> inline de index.html

let alumnoActual = null;

/* ── CONSULTAR SALDO ── */
async function consultarSaldo() {
    const dni = document.getElementById('dni-input').value.trim();
    if (dni.length < 7) return;
    try {
        const res = await fetch(`/students/by-dni/${dni}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        alumnoActual = data;
        document.getElementById('saldo-name').textContent = data.name || data.nombre || 'Atleta';
        document.getElementById('saldo-num').textContent = data.batido_credits ?? 0;
        document.getElementById('saldo-result').classList.add('visible');
        cargarCanjes(data.id);
    } catch {
        document.getElementById('saldo-result').classList.remove('visible');
        alumnoActual = null;
        alert('DNI no encontrado.');
    }
}

/* ── HISTORIAL DE CANJES ── */
async function cargarCanjes(studentId) {
    try {
        const res = await fetch(`/batidos/history/${studentId}`);
        const data = await res.json();
        const list = document.getElementById('canjes-list');
        if (!data.length) {
            list.innerHTML = '<li class="empty-canjes">Sin canjes registrados aún</li>';
            return;
        }
        list.innerHTML = data.slice(0, 8).map(c => `
      <li class="canje-item">
        <span class="canje-emoji">${c.emoji || '🥤'}</span>
        <div class="canje-info">
          <div class="canje-name">${c.batido_name}</div>
          <div class="canje-date">${new Date(c.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <span class="canje-cost">-${c.credits_used} cr.</span>
      </li>
    `).join('');
    } catch { }
}

/* ── AVISO DE COMPRA NFC ── */
function avisoCompra() {
    alert('Para comprar este producto, acerca tu medallón NFC en la Caja de la academia.');
}
