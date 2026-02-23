// scanner/scanner.js — v2.1 con NFC + función startKioskoScanner

const API_URL = "https://emblema-app-production.up.railway.app";

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSuccess() {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.4);
}

function playWarning() {
    [0, 0.2].forEach(offset => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime + offset);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + offset + 0.15);
        osc.start(audioCtx.currentTime + offset);
        osc.stop(audioCtx.currentTime + offset + 0.15);
    });
}

function playError() {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.5);
}

// --- LÓGICA CENTRAL ---
function handleScan(decodedText) {
    const code = decodedText.includes('?code=')
        ? decodedText.split('?code=')[1]
        : decodedText;

    const resultDiv = document.getElementById('result');
    const list      = document.getElementById('attendance-list');

    if (html5QrcodeScanner) html5QrcodeScanner.pause();

    fetch(`${API_URL}/attendance/scan`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ code })
    })
    .then(res => res.text())
    .then(rawText => {
        let data;
        try { data = JSON.parse(rawText); }
        catch(e) {
            playError();
            if (resultDiv) {
                resultDiv.style.display = 'block';
                resultDiv.className = 'result-card error';
                resultDiv.innerHTML = '❌ Error de conexión';
            }
            setTimeout(() => {
                if (resultDiv) resultDiv.style.display = 'none';
                if (html5QrcodeScanner) html5QrcodeScanner.resume();
            }, 4000);
            return;
        }

        const nombre  = data.student_name;
        const mensaje = data.message;
        const estado  = data.status;

        if (estado === 'success') playSuccess();
        else if (estado === 'warning') playWarning();
        else playError();

        if (resultDiv) {
            resultDiv.style.display = 'block';
            resultDiv.className = `result-card ${estado}`;
            resultDiv.innerHTML = mensaje;
            setTimeout(() => { resultDiv.style.display = 'none'; }, 3000);
        }

        if (list && (estado === 'success' || estado === 'warning')) {
            const newItem = document.createElement('li');
            const hora = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            let nombreFinal = nombre;
            if (!nombreFinal || nombreFinal === 'null') {
                const match = mensaje?.match(/(?:Bienvenido,?\s+|Ya registrado:\s*)([^!]+)/);
                nombreFinal = match ? match[1].trim() : mensaje;
            }
            newItem.className = estado;
            newItem.innerHTML = `<strong>${hora}</strong> — ${nombreFinal}`;
            list.prepend(newItem);
        }

        // Evento para kiosko
        document.dispatchEvent(new CustomEvent('scan-result', {
            detail: { estado, nombre: nombre || 'Desconocido', mensaje }
        }));

        setTimeout(() => {
            if (html5QrcodeScanner) html5QrcodeScanner.resume();
        }, 2000);
    })
    .catch(() => {
        playError();
        if (resultDiv) {
            resultDiv.style.display = 'block';
            resultDiv.className = 'result-card error';
            resultDiv.innerHTML = '❌ Sin conexión con el servidor';
        }
        setTimeout(() => {
            if (resultDiv) resultDiv.style.display = 'none';
            if (html5QrcodeScanner) html5QrcodeScanner.resume();
        }, 3000);
    });
}

// --- INSTANCIA GLOBAL ---
let html5QrcodeScanner = null;

// startKioskoScanner: llamado desde kiosko.js al tocar la pantalla
function startKioskoScanner() {
    // Obtener tamaño real del frame
    const frame = document.getElementById('scanner-frame');
    const size  = frame ? Math.min(frame.clientWidth, frame.clientHeight) - 20 : 300;

    html5QrcodeScanner = new Html5QrcodeScanner(
        "reader",
        {
            fps: 15,
            qrbox: { width: Math.floor(size * 0.85), height: Math.floor(size * 0.85) },
            rememberLastUsedCamera: true
        }
    );
    html5QrcodeScanner.render(handleScan);
    startMirrorCheck();
    initNFC();
}

// Para el scanner normal (no kiosko) — arranca directo
if (!window._kioskMode) {
    html5QrcodeScanner = new Html5QrcodeScanner(
        "reader",
        {
            fps: 15,
            qrbox: { width: 250, height: 250 },
            rememberLastUsedCamera: true
        }
    );
    html5QrcodeScanner.render(handleScan);
    initNFCWhenReady();
}

// --- MODO ESPEJO ---
function startMirrorCheck() {
    setInterval(() => {
        const video = document.querySelector('#reader video');
        if (!video || !video.srcObject) return;
        const label = video.srcObject.getVideoTracks()[0]?.label?.toLowerCase() || '';
        if (label.includes('front') || label.includes('user') || label.includes('facetime')) {
            video.classList.add('mirror');
        } else {
            video.classList.remove('mirror');
        }
    }, 1000);
}

// --- NFC ---
async function initNFC() {
    if (!('NDEFReader' in window)) return;
    try {
        const ndef = new NDEFReader();
        await ndef.scan();
        const nfcEl = document.getElementById('nfc-indicator');
        if (nfcEl) nfcEl.classList.add('visible');
        ndef.addEventListener('reading', ({ message }) => {
            for (const record of message.records) {
                const decoder = new TextDecoder(record.encoding || 'utf-8');
                const raw  = decoder.decode(record.data).trim();
                const code = raw.includes('?code=') ? raw.split('?code=')[1] : raw;
                handleScan(code);
            }
        });
    } catch(e) {
        console.warn('NFC:', e.message);
    }
}

function initNFCWhenReady() {
    // En modo scanner normal inicia NFC directamente
    initNFC();
    startMirrorCheck();
}