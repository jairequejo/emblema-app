# main.py
import os
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from routers import students, credentials, attendance, batidos, admin, entrenador
from routers.jrs_utils import generate_jrs_code
from database import supabase
try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo

# Zona horaria oficial: Lima, Perú (UTC-5)
PERU_TZ = ZoneInfo("America/Lima")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Fix 5: Advertencias de configuración crítica al iniciar ──────────────
    if not os.getenv("JRS_SECRET_KEY"):
        print("⚠️  [SEGURIDAD] JRS_SECRET_KEY no configurada — se usa clave por defecto. "
              "¡IMPRESCINDIBLE configurar esta variable en producción!")
    if not os.getenv("ALLOWED_ORIGINS"):
        print("⚠️  [CONFIG] ALLOWED_ORIGINS no configurada — CORS abierto ('*'). "
              "Solo aceptable en desarrollo local.")
    yield  # La app corre aquí


app = FastAPI(lifespan=lifespan)

# --- CORS (Fix 1) ---
_raw_origins = os.getenv("ALLOWED_ORIGINS", "").strip()
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()] if _raw_origins else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ARCHIVOS ESTÁTICOS ---
os.makedirs("qrs", exist_ok=True)
app.mount("/qrs", StaticFiles(directory="qrs"), name="qrs")
app.mount("/static", StaticFiles(directory="frontend"), name="static")

# --- ROUTERS ---
app.include_router(admin.router)
app.include_router(students.router)
app.include_router(credentials.router)
app.include_router(attendance.router)
app.include_router(batidos.router)
app.include_router(entrenador.router)

# --- PÁGINAS ---
@app.get("/")
def home():
    return FileResponse("frontend/home/index.html")

@app.get("/scanner")
def scanner():
    return FileResponse("frontend/scanner/index.html")


@app.get("/caja")
def caja_page():
    return FileResponse("frontend/caja/index.html")

@app.get("/admin/login")
def admin_login_page():
    return FileResponse("frontend/admin/login.html")

@app.get("/admin")
def admin_panel():
    return FileResponse("frontend/admin/index.html")

@app.get("/entrenador/login")
def entrenador_login_page():
    return FileResponse("frontend/entrenador/login.html")

@app.get("/entrenador")
def entrenador_panel():
    return FileResponse("frontend/entrenador/index.html")

@app.get("/status")
def status():
    return {"status": "Backend funcionando 🚀"}

# --- ENDPOINTS PÚBLICOS ---
@app.get("/public/leaderboard/month")
def leaderboard_mes():
    from datetime import datetime
    today = datetime.now(PERU_TZ)
    first_day = today.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    res = supabase.table("attendance").select("student_id").gte("created_at", first_day).execute()
    if not res.data:
        return []

    counts = {}
    for r in res.data:
        sid = r["student_id"]
        counts[sid] = counts.get(sid, 0) + 1

    top_sids = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:5]
    if not top_sids:
        return []

    ids = [t[0] for t in top_sids]
    st_res = supabase.table("students").select("id, full_name").in_("id", ids).execute()
    st_map = {s["id"]: s for s in (st_res.data or [])}

    result = []
    for sid, count in top_sids:
        st = st_map.get(sid)
        if st:
            parts = st["full_name"].split(" ")
            short = parts[0] + (" " + parts[1][0] + "." if len(parts) > 1 else "")
            result.append({"student_id": sid, "name": short, "score": count})
    return result


# ── BIOMETRÍA ADMIN ────────────────────────────────────────────────────────

@app.post("/admin/biometria")
def registrar_biometria(payload: dict = __import__('fastapi').Body(...)):
    """Registra medición mensual de un atleta."""
    from fastapi import HTTPException
    student_id = payload.get("student_id")
    fecha      = payload.get("fecha")
    talla      = payload.get("talla")
    peso       = payload.get("peso")

    if not all([student_id, fecha]):
        raise HTTPException(400, "Faltan campos: student_id y fecha son obligatorios")

    data = {"student_id": student_id, "fecha": str(fecha)}
    if talla is not None:
        try: data["talla"] = float(talla)
        except: pass
    if peso is not None:
        try: data["peso"] = int(peso)
        except: pass

    res = supabase.table("biometria").insert(data).execute()
    return res.data[0] if res.data else {}


@app.get("/admin/biometria/{student_id}")
def historial_biometria(student_id: str):
    """Historial biométrico completo de un atleta."""
    res = supabase.table("biometria") \
        .select("id, fecha, talla, peso, created_at") \
        .eq("student_id", student_id) \
        .order("created_at", desc=True).limit(24).execute()
    return res.data or []


@app.delete("/admin/biometria/{record_id}")
def eliminar_biometria(record_id: str):
    """Elimina una medición biométrica."""
    supabase.table("biometria").delete().eq("id", record_id).execute()
    return {"ok": True}


# ── RANKING PÚBLICO (con filtros) ──────────────────────────────────────────

@app.get("/public/ranking")
def ranking_publico(categoria: str = None, sede: str = None, campo: str = "talla"):
    """
    Ranking de atletas por campo biométrico (talla o peso).
    Filtra por categoría y/o sede.
    """
    from datetime import datetime

    # Traer todos los students activos
    q = supabase.table("students").select("id, full_name, horario, sede")
    q = q.eq("is_active", True)
    if sede:
        q = q.eq("sede", sede)
    st_res = q.execute()
    students_list = st_res.data or []
    if not students_list:
        return []

    # Filtrar por categoría (horario en students)
    if categoria:
        students_list = [s for s in students_list if (s.get("horario") or "") == categoria]

    ids = [s["id"] for s in students_list]
    if not ids:
        return []

    st_map = {s["id"]: s for s in students_list}

    # Traer la última medición biométrica de cada alumno
    bio_res = supabase.table("biometria") \
        .select("student_id, talla, peso, fecha, created_at") \
        .in_("student_id", ids) \
        .order("created_at", desc=True).execute()

    # Quedarme solo con la medición más reciente por alumno
    last_bio = {}
    for r in (bio_res.data or []):
        sid = r["student_id"]
        if sid not in last_bio:
            last_bio[sid] = r

    # Construir resultados con dato del campo solicitado
    result = []
    for sid, bio in last_bio.items():
        st = st_map.get(sid)
        if not st:
            continue
        val = bio.get(campo)
        if val is None:
            continue
        parts = st["full_name"].split(" ")
        short = parts[0] + (" " + parts[1][0] + "." if len(parts) > 1 else "")
        result.append({
            "student_id": sid,
            "name":       short,
            "full_name":  st["full_name"],
            "sede":       st.get("sede") or "",
            "horario":    st.get("horario") or "",
            "talla":      bio.get("talla"),
            "peso":       bio.get("peso"),
            "fecha":      bio.get("fecha"),
            "valor":      float(val),
        })

    # Ordenar por valor descendente y tomar top 20
    result.sort(key=lambda x: x["valor"], reverse=True)
    return result[:20]



@app.get("/public/student/{dni_or_id}/info")
def student_public_info(dni_or_id: str):
    from datetime import datetime, timedelta
    from fastapi import HTTPException

    # 1. Buscar atleta activo — por DNI, UUID completo, o código JRS
    student_id_resolved = None

    if dni_or_id.startswith("JRS:"):
        # Extraer short_id del código JRS y buscar via credentials
        parts = dni_or_id.split(":")
        if len(parts) >= 2:
            short_id = parts[1]  # JRS:{short_id}:...
            cred = supabase.table("credentials") \
                .select("student_id") \
                .like("code", f"JRS:{short_id}:%") \
                .eq("is_active", True) \
                .limit(1).execute()
            if cred.data:
                student_id_resolved = cred.data[0]["student_id"]

    if student_id_resolved:
        res = supabase.table("students") \
            .select("id, full_name, valid_until, horario, sede, batido_credits") \
            .eq("is_active", True).eq("id", student_id_resolved).execute()
    else:
        query = supabase.table("students") \
            .select("id, full_name, valid_until, horario, sede, batido_credits") \
            .eq("is_active", True)
        # UUID completo (36 chars con guiones) o DNI numérico
        import re
        if re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', dni_or_id, re.I):
            query = query.eq("id", dni_or_id)
        else:
            query = query.eq("dni", dni_or_id)
        res = query.execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Atleta no encontrado")

    student = res.data[0]
    sid = student["id"]

    # 2. Estado de pago
    hoy = datetime.now(PERU_TZ).date()
    valid_until_str = student.get("valid_until")
    if valid_until_str:
        fecha_venc = datetime.strptime(valid_until_str, "%Y-%m-%d").date()
        debe = fecha_venc < hoy
    else:
        debe = True

    # 3. Racha consecutiva real (sesiones sin romper la cadena)
    #    - Trae últimas 90 días de asistencia, ordenado más reciente primero
    #    - Gap permitido: ≤ 4 días (cubre fines de semana + horario LMV/MJS)
    #    - Si el gap entre dos sesiones > 4 días, la racha se rompe
    ahora_lima = datetime.now(PERU_TZ)
    noventa_dias = (ahora_lima - timedelta(days=90)).isoformat()
    att_res = supabase.table("attendance").select("created_at") \
        .eq("student_id", sid) \
        .gte("created_at", noventa_dias) \
        .order("created_at", desc=True).execute()

    racha = 0
    if att_res.data:
        # Convertir timestamps a fechas únicas (1 por día como máximo)
        fechas_vistas = set()
        fechas_ord = []
        for r in att_res.data:
            try:
                ts = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
                dia = ts.astimezone(PERU_TZ).date()
            except Exception:
                continue
            if dia not in fechas_vistas:
                fechas_vistas.add(dia)
                fechas_ord.append(dia)
        # fechas_ord está ordenada de más reciente a más antigua
        if fechas_ord:
            racha = 1
            for i in range(1, len(fechas_ord)):
                gap = (fechas_ord[i - 1] - fechas_ord[i]).days
                if gap <= 4:
                    racha += 1
                else:
                    break

    # 4+5. Biometria real desde tabla biometria — sin datos inventados
    bio_res = supabase.table("biometria") \
        .select("fecha, talla, peso") \
        .eq("student_id", sid) \
        .order("created_at", desc=True).limit(12).execute()

    historial     = []
    talla_actual  = None
    peso_actual   = None
    delta_talla   = None

    if bio_res.data:
        # La más reciente es el primer registro
        ultimo = bio_res.data[0]
        talla_actual = f"{ultimo['talla']}m" if ultimo.get("talla") is not None else None
        peso_actual  = f"{ultimo['peso']}kg" if ultimo.get("peso")  is not None else None

        # Delta talla: diferencia entre el último y el anterior
        if len(bio_res.data) >= 2:
            anterior = bio_res.data[1]
            if ultimo.get("talla") and anterior.get("talla"):
                diff = round(float(ultimo["talla"]) - float(anterior["talla"]), 2)
                delta_talla = f"+{int(diff*100)}cm" if diff >= 0 else f"{int(diff*100)}cm"

        historial = [
            {
                "fecha": r["fecha"],
                "talla": f"{r['talla']}m" if r.get("talla") is not None else "—",
                "peso":  f"{r['peso']}kg"  if r.get("peso")  is not None else "—",
            }
            for r in bio_res.data
        ]

    horario   = student.get("horario") or "LMV"
    sede      = student.get("sede") or ""
    categoria = f"Sede {sede}" if sede else f"Entreno {horario}"

    return {
        "full_name":  student["full_name"],
        "category":   categoria,
        "img_url":    None,
        "debe":       debe,
        "racha":      racha,
        "talla_actual":  talla_actual,
        "delta_talla":   delta_talla,
        "peso_actual":   peso_actual,
        "historial_biometrico": historial,
    }


if __name__ == "__main__":
    puerto = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=puerto)