// entrenador/login.js — Verificación de acceso del entrenador
// Extraído del <script> inline de login.html

const TOKEN_KEY = 'jr_entrenador_token';

async function init() {
    const urlToken = new URLSearchParams(location.search).get('token');

    // Si llegó un token nuevo en la URL, guardarlo y limpiar la URL
    if (urlToken) {
        localStorage.setItem(TOKEN_KEY, urlToken);
        history.replaceState({}, '', '/entrenador/login');
    }

    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return showNoAccess();

    // Verificar el token con el backend
    try {
        const res = await fetch('/entrenador/verify', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
            const data = await res.json();
            // Guardar clave de firma y nombre para el panel
            if (data.signing_key) sessionStorage.setItem('jr_signing_key', data.signing_key);
            sessionStorage.setItem('jr_nombre', data.nombre || '');
            document.getElementById('status-msg').textContent = `¡Hola, ${data.nombre}! Abriendo scanner...`;
            setTimeout(() => { window.location.href = '/entrenador'; }, 600);
        } else {
            // Token inválido o revocado
            localStorage.removeItem(TOKEN_KEY);
            showNoAccess();
        }
    } catch {
        // Sin conexión
        document.getElementById('status-msg').textContent = 'Sin conexión. Reintenta en un momento.';
        document.getElementById('status-msg').classList.add('error');
        document.getElementById('spinner').style.display = 'none';
    }
}

function showNoAccess() {
    document.getElementById('spinner').style.display = 'none';
    document.getElementById('status-msg').style.display = 'none';
    document.getElementById('no-access').style.display = 'block';
}

// Ejecutar al cargar la página
init();
