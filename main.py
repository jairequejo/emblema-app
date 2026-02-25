# main.py
import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from routers import students, credentials, attendance, batidos, admin, entrenador
from database import supabase

app = FastAPI()

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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

@app.get("/dashboard")
def dashboard():
    return FileResponse("frontend/dashboard/index.html")

@app.get("/kiosko")
def kiosko_page():
    return FileResponse("frontend/kiosko/index.html")

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
    today = datetime.now()
    first_day = today.replace(day=1, hour=0, minute=0, second=0).isoformat()

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



@app.get("/public/student/{dni}/info")
def student_public_info(dni: str):
    from datetime import datetime
    from fastapi import HTTPException

    # 1. Buscar atleta activo — solo columnas que existen en students
    res = supabase.table("students") \
        .select("id, full_name, valid_until, horario, sede, batido_credits") \
        .eq("dni", dni).eq("is_active", True).execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Atleta no encontrado")

    student = res.data[0]
    sid = student["id"]

    # 2. Estado de pago
    hoy = datetime.now().date()
    valid_until_str = student.get("valid_until")
    if valid_until_str:
        fecha_venc = datetime.strptime(valid_until_str, "%Y-%m-%d").date()
        debe = fecha_venc < hoy
    else:
        debe = True

    # 3. Racha del mes actual
    first_day = datetime.now().replace(day=1, hour=0, minute=0, second=0).isoformat()
    att_res = supabase.table("attendance").select("id") \
        .eq("student_id", sid).gte("created_at", first_day).execute()
    racha = len(att_res.data) if att_res.data else 0

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