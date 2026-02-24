// --- LÓGICA DEL PIN ---
let pinActual = "";
const PIN_CORRECTO = "1234";
let html5QrcodeScanner = null;

function addPin(num) {
  if (pinActual.length < 4) {
    pinActual += num;
    actualizarDots();
    if (pinActual.length === 4) verificarPin();
  }
}

function clearPin() { 
  pinActual = ""; 
  actualizarDots(); 
}

function actualizarDots() {
  const dots = document.querySelectorAll('.pin-dot');
  dots.forEach((dot, i) => { dot.className = i < pinActual.length ? 'pin-dot filled' : 'pin-dot'; });
}

function verificarPin() {
  if (pinActual === PIN_CORRECTO) {
    document.getElementById('pin-screen').style.display = 'none';
    document.getElementById('caja-layout').style.display = 'block';
    initNFC(); 
    initQR(); // Encendemos la cámara QR
  } else {
    setTimeout(() => { alert("PIN Incorrecto"); clearPin(); }, 100);
  }
}

// --- LÓGICA DE AUDIO ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playBeep(tipo) {
  const osc = audioCtx.createOscillator();
  osc.connect(audioCtx.destination);
  osc.frequency.setValueAtTime(tipo === 'ok' ? 880 : 300, audioCtx.currentTime);
  osc.start(); 
  osc.stop(audioCtx.currentTime + 0.15);
}

// --- LÓGICA CÁMARA QR ---
function initQR() {
  html5QrcodeScanner = new Html5QrcodeScanner(
    "reader",
    { fps: 10, qrbox: { width: 200, height: 200 }, rememberLastUsedCamera: true },
    false
  );
  html5QrcodeScanner.render(onScanSuccess);
}

async function onScanSuccess(decodedText) {
  if (html5QrcodeScanner) html5QrcodeScanner.pause(); // Pausamos cámara mientras cobra
  const code = decodedText.includes('?code=') ? decodedText.split('?code=')[1] : decodedText;
  playBeep('ok');
  document.getElementById('status-nfc').innerHTML = "⏳ Buscando QR...";
  await consultarAtleta(code);
}

// --- LÓGICA NFC ---
async function initNFC() {
  if (!('NDEFReader' in window)) return;
  try {
    const ndef = new NDEFReader();
    await ndef.scan();
    ndef.addEventListener('reading', async ({ message }) => {
      for (const record of message.records) {
        const decoder = new TextDecoder(record.encoding || 'utf-8');
        const raw = decoder.decode(record.data).trim();
        const code = raw.includes('?code=') ? raw.split('?code=')[1] : raw;
        
        if (html5QrcodeScanner) html5QrcodeScanner.pause(); // Pausamos QR si usó NFC
        playBeep('ok');
        document.getElementById('status-nfc').innerHTML = "⏳ Buscando NFC...";
        await consultarAtleta(code);
      }
    });
  } catch(e) { console.warn("NFC Error", e); }
}

// --- LÓGICA DE COBRO (AMBOS MÉTODOS) ---
let alumnoActual = null;

async function consultarAtleta(code) {
  try {
    // Parche Antifrágil: Usamos la ruta de asistencia que sabemos que escanea sin fallar
    const res = await fetch('/attendance/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('jr_admin_token') || ''}` },
      body: JSON.stringify({ code: code })
    });

    if (!res.ok) throw new Error("Código no encontrado o error de servidor");
    const d = await res.json();
    
    if (d.status === 'ok' || d.status === 'warning') {
        // Encontramos sus créditos pidiendo la lista
        const resAlumno = await fetch('/admin/alumnos', { headers: { 'Authorization': `Bearer ${localStorage.getItem('jr_admin_token') || ''}` } });
        const todosLosAlumnos = await resAlumno.json();
        
        const data = todosLosAlumnos.find(a => a.id === d.student_id);
        if(!data) throw new Error("Alumno no encontrado en la base de datos");

        alumnoActual = data;
        document.getElementById('c-nombre').textContent = data.full_name || data.name;
        document.getElementById('c-num').textContent = data.batido_credits ?? 0;
        
        document.getElementById('cliente-box').classList.add('active');
        document.getElementById('menu-grid').classList.add('active');
        document.getElementById('status-nfc').innerHTML = "✅ Listo para cobrar";
    } else {
        throw new Error("QR inválido o Vencido severo");
    }

  } catch (error) {
    console.log(error);
    playBeep('error');
    document.getElementById('status-nfc').innerHTML = "❌ Código no registrado o Vencido";
    setTimeout(resetCaja, 2000);
  }
}

async function cobrar(nombreBatido, costo, emoji) {
  if (!alumnoActual) return;
  if (alumnoActual.batido_credits < costo) {
    playBeep('error');
    alert("❌ Saldo insuficiente");
    return;
  }

  document.getElementById('menu-grid').classList.remove('active');
  document.getElementById('status-nfc').innerHTML = "💸 Cobrando...";

  try {
    const res = await fetch('/batidos/canjear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: alumnoActual.id,
        batido_name: nombreBatido,
        credits_used: costo,
        emoji: emoji
      })
    });

    if (!res.ok) throw new Error();
    
    playBeep('ok');
    alumnoActual.batido_credits -= costo;
    document.getElementById('c-num').textContent = alumnoActual.batido_credits;
    document.getElementById('status-nfc').innerHTML = "✅ ¡Cobrado! Pasa otro atleta.";
    
    setTimeout(resetCaja, 3000);
    
  } catch {
    playBeep('error');
    alert("Error en el servidor");
    document.getElementById('menu-grid').classList.add('active');
  }
}

function resetCaja() {
  alumnoActual = null;
  document.getElementById('cliente-box').classList.remove('active');
  document.getElementById('menu-grid').classList.remove('active');
  document.getElementById('status-nfc').innerHTML = "📡 Esperando NFC o QR...";
  if (html5QrcodeScanner) html5QrcodeScanner.resume(); // Volvemos a encender la cámara
}