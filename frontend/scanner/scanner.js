// scanner/scanner.js

// ⚠️ Cambia esta URL por la de tu ngrok cada vez que lo reinicies
const API_URL = "https://unwading-nonofficially-lilliana.ngrok-free.dev";

// --- SONIDOS ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSuccess() {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.4);
}

function playWarning() {
    // Dos beeps cortos para "ya registrado"
    [0, 0.2].forEach(offset => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime + offset);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + offset + 0.15);
        osc.start(audioCtx.currentTime + offset);
        osc.stop(audioCtx.currentTime + offset + 0.15);
    });
}

function playError() {
    // Sonido grave descendente para error/negado
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.5);
}

// --- SCANNER ---
function onScanSuccess(decodedText) {
    const code = decodedText.includes('?code=')
        ? decodedText.split('?code=')[1]
        : decodedText;

    const resultDiv = document.getElementById('result');
    const list = document.getElementById('attendance-list');

    html5QrcodeScanner.pause();

    fetch(`${API_URL}/attendance/scan`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ code: code })
    })
    .then(res => res.text())
    .then(rawText => {
        console.log("RAW response:", rawText);

        let data;
        try {
            data = JSON.parse(rawText);
        } catch(e) {
            playError();
            resultDiv.style.display = 'block';
            resultDiv.className = 'result-card error';
            resultDiv.innerHTML = '❌ Error: Abre la URL de ngrok en el navegador y acepta la advertencia';
            setTimeout(() => {
                resultDiv.style.display = 'none';
                html5QrcodeScanner.resume();
            }, 4000);
            return;
        }

        const nombreRecibido = data.student_name;
        const mensajeServidor = data.message;
        const estado = data.status;

        // Reproducir sonido según estado
        if (estado === 'success') playSuccess();
        else if (estado === 'warning') playWarning();
        else playError();

        // Mostrar tarjeta resultado
        resultDiv.style.display = 'block';
        resultDiv.className = `result-card ${estado}`;
        resultDiv.innerHTML = mensajeServidor;
        setTimeout(() => { resultDiv.style.display = 'none'; }, 3000);

        // Agregar a lista
        if (estado === 'success' || estado === 'warning') {
            const newItem = document.createElement('li');
            const hora = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            let nombreFinal = nombreRecibido;
            if (!nombreFinal || nombreFinal === "null" || nombreFinal === "undefined") {
                const match = mensajeServidor.match(/(?:Bienvenido,?\s+|Ya registrado:\s*)([^!]+)/);
                nombreFinal = match ? match[1].trim() : mensajeServidor;
            }

            newItem.className = estado;
            newItem.innerHTML = `<strong>${hora}</strong> — ${nombreFinal}`;
            list.prepend(newItem);
        }

        setTimeout(() => html5QrcodeScanner.resume(), 2000);
    })
    .catch(err => {
        console.error("Fetch error:", err);
        playError();
        resultDiv.style.display = 'block';
        resultDiv.className = 'result-card error';
        resultDiv.innerHTML = '❌ Sin conexión con el servidor';
        setTimeout(() => {
            resultDiv.style.display = 'none';
            html5QrcodeScanner.resume();
        }, 3000);
    });
}

// Inicializar escáner
let html5QrcodeScanner = new Html5QrcodeScanner(
    "reader",
    {
        fps: 15,
        qrbox: { width: 250, height: 250 },
        rememberLastUsedCamera: true
    }
);

html5QrcodeScanner.render(onScanSuccess);

// Modo espejo solo en cámara frontal
function checkMirror() {
    const video = document.querySelector('#reader video');
    if (!video) return;
    navigator.mediaDevices.enumerateDevices().then(devices => {
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        // La cámara frontal generalmente dice "front" o "user" en el label
        const stream = video.srcObject;
        if (!stream) return;
        const trackLabel = stream.getVideoTracks()[0]?.label?.toLowerCase() || '';
        if (trackLabel.includes('front') || trackLabel.includes('user') || trackLabel.includes('facetime')) {
            video.classList.add('mirror');
        } else {
            video.classList.remove('mirror');
        }
    });
}

// Revisar cada vez que cambia la cámara
setInterval(checkMirror, 1000);