// deshboard/dashboard.js

// ⚠️ VERSIÓN 3 - fix timezone + cache bust
const API_URL = "https://unwading-nonofficially-lilliana.ngrok-free.dev";
const HEADERS = { 'ngrok-skip-browser-warning': 'true', 'Accept': 'application/json' };
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DIAS = ['Do','Lu','Ma','Mi','Ju','Vi','Sa'];

let currentDate  = new Date();
let currentYear  = currentDate.getFullYear();
let currentMonth = currentDate.getMonth();
let allStudents  = [];
let attendanceMap = {};

function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    if (currentMonth < 0)  { currentMonth = 11; currentYear--; }
    loadData();
}

function updateMonthLabel() {
    document.getElementById('month-label').textContent =
        `${MESES[currentMonth]} ${currentYear}`;
}

async function loadData() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('table-container').innerHTML = '';
    updateMonthLabel();

    try {
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const mm = String(currentMonth + 1).padStart(2, '0');
        const dd = String(daysInMonth).padStart(2, '0');

        // ← Fix: incluir hora completa en ambos extremos
        const firstDay = `${currentYear}-${mm}-01T00:00:00`;
        const lastDay  = `${currentYear}-${mm}-${dd}T23:59:59`;

        // Agregar timestamp para evitar caché del navegador
        const ts = Date.now();

        const [studRes, rangeRes] = await Promise.all([
            fetch(`${API_URL}/students?_=${ts}`, { headers: HEADERS }),
            fetch(`${API_URL}/attendance/range?start=${firstDay}&end=${lastDay}&_=${ts}`, { headers: HEADERS })
        ]);

        allStudents = await studRes.json();
        const attData = await rangeRes.json();

        console.log("✅ Alumnos:", allStudents.length);
        console.log("✅ Registros asistencia:", attData.length);
        console.log("✅ Primer registro:", attData[0]);

        // Construir mapa usando fecha LOCAL
        attendanceMap = {};
        attData.forEach(record => {
            const sid  = record.student_id;
            // Extraer fecha directamente del string sin convertir timezone
            const date = record.created_at.substring(0, 10);
            if (sid && date) {
                const key = `${sid}_${date}`;
                attendanceMap[key] = true;
                console.log("📌 Mapa key:", key);
            }
        });

        console.log("✅ Total keys en mapa:", Object.keys(attendanceMap).length);

        renderTable();
        document.getElementById('last-update').textContent =
            `Actualizado: ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;

    } catch(e) {
        console.error("❌ Error:", e);
        document.getElementById('loading').textContent = '❌ Error: ' + e.message;
    }

    document.getElementById('loading').style.display = 'none';
}

function applyFilters() { renderTable(); }

function renderTable() {
    const turnoFilter  = document.getElementById('filter-turno').value;
    const searchFilter = document.getElementById('search').value.toLowerCase();

    const students = allStudents.filter(s => {
        const matchSearch = s.full_name.toLowerCase().includes(searchFilter);
        const matchTurno  = !turnoFilter || (s.turno || '') === turnoFilter;
        return matchSearch && matchTurno;
    });

    const today          = new Date();
    const isCurrentMonth = (today.getMonth() === currentMonth && today.getFullYear() === currentYear);
    const todayDay       = today.getDate();
    const daysInMonth    = new Date(currentYear, currentMonth + 1, 0).getDate();
    const mm             = String(currentMonth + 1).padStart(2, '0');

    // todayStr en formato YYYY-MM-DD local
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
        days.push({ day: d, dow: new Date(currentYear, currentMonth, d).getDay() });
    }

    let totalPresencias = 0, totalEsperadas = 0, presentHoy = 0;

    students.forEach(s => {
        days.forEach(({ day, dow }) => {
            if (dow === 0 || dow === 6) return;
            const dateStr = `${currentYear}-${mm}-${String(day).padStart(2,'0')}`;
            if (new Date(currentYear, currentMonth, day) > today) return;
            totalEsperadas++;
            if (attendanceMap[`${s.id}_${dateStr}`]) {
                totalPresencias++;
                if (dateStr === todayStr) presentHoy++;
            }
        });
    });

    document.getElementById('stat-total').textContent   = students.length;
    document.getElementById('stat-present').textContent = presentHoy;
    document.getElementById('stat-absent').textContent  = Math.max(0, students.length - presentHoy);
    document.getElementById('stat-pct').textContent     = totalEsperadas > 0
        ? `${Math.round((totalPresencias / totalEsperadas) * 100)}%` : '—';

    let html = `<table><thead><tr><th class="name-col">Alumno</th>`;
    days.forEach(({ day, dow }) => {
        const isToday   = isCurrentMonth && day === todayDay;
        const isWeekend = dow === 0 || dow === 6;
        const cls = isToday ? 'today-col' : isWeekend ? 'weekend-col' : '';
        html += `<th class="${cls}">${DIAS[dow]}<br>${day}</th>`;
    });
    html += `<th style="min-width:52px;border-left:1px solid var(--border)">%</th></tr></thead><tbody>`;

    students.forEach(s => {
        let presentCount = 0, workdayCount = 0;
        html += `<tr><td class="name-col">${s.full_name}${s.turno ? `<span class="badge-turno t-${s.turno}">${s.turno}</span>` : ''}</td>`;

        days.forEach(({ day, dow }) => {
            const isToday   = isCurrentMonth && day === todayDay;
            const isWeekend = dow === 0 || dow === 6;
            const dateStr   = `${currentYear}-${mm}-${String(day).padStart(2,'0')}`;
            const isFuture  = new Date(currentYear, currentMonth, day) > today;
            const isPresent = attendanceMap[`${s.id}_${dateStr}`];
            const todayCls  = isToday ? 'cell-today' : '';

            if (isWeekend) {
                html += `<td><div class="cell-dot cell-weekend">—</div></td>`;
            } else if (isFuture) {
                html += `<td><div class="cell-dot cell-empty" style="opacity:0.2">·</div></td>`;
            } else {
                workdayCount++;
                if (isPresent) {
                    presentCount++;
                    html += `<td><div class="cell-dot cell-present ${todayCls}" title="${dateStr}">✓</div></td>`;
                } else {
                    html += `<td><div class="cell-dot cell-absent ${todayCls}" title="${dateStr}">✗</div></td>`;
                }
            }
        });

        const pct      = workdayCount > 0 ? Math.round((presentCount / workdayCount) * 100) : 0;
        const pctColor = pct >= 80 ? 'var(--accent)' : pct >= 50 ? 'var(--accent2)' : 'var(--danger)';
        html += `<td class="pct-col" style="color:${pctColor}">${pct}%</td></tr>`;
    });

    html += '</tbody></table>';
    document.getElementById('table-container').innerHTML = html;
}

loadData();
setInterval(loadData, 60000);