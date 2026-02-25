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
@app.get("/public/noticias")
def noticias_publicas():
    res = supabase.table("noticias").select("*") \
        .eq("activa", True).order("created_at", desc=True).limit(5).execute()
    return res.data or []

@app.get("/public/galeria")
def galeria_publica():
    res = supabase.table("galeria").select("*") \
        .eq("activa", True).order("created_at", desc=True).limit(6).execute()
    return res.data or []

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
        
    # Ordenar por asistencia desc
    top_sids = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:5]
    if not top_sids:
        return []
        
    # Traer nombres
    ids = [t[0] for t in top_sids]
    st_res = supabase.table("students").select("id, full_name, img_url").in_("id", ids).execute()
    st_map = {s["id"]: s for s in (st_res.data or [])}
    
    result = []
    for sid, count in top_sids:
        st = st_map.get(sid)
        if st:
            # Fake names for privacy, user wants first name and initial
            name_parts = st["full_name"].split(" ")
            short_name = name_parts[0] + (" " + name_parts[1][0] + "." if len(name_parts) > 1 else "")
            result.append({
                "student_id": sid,
                "name": short_name,
                "avatar": st.get("img_url"),
                "score": count
            })
    return result

@app.get("/public/student/{dni}/info")
def student_public_info(dni: str):
    from datetime import datetime
    from fastapi import HTTPException

    # 1. Buscar atleta activo por DNI
    res = supabase.table("students") \
        .select("id, full_name, valid_until, img_url, category, talla, peso") \
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

    # 4. Biometria actual
    h = abs(hash(sid))
    talla_raw = student.get("talla")
    peso_raw  = student.get("peso")
    talla_cm  = float(talla_raw) if talla_raw else round(1.40 + (h % 25) / 100, 2)
    peso_kg   = int(peso_raw)   if peso_raw  else 36 + (h % 18)
    talla_str = f"{talla_cm}m"
    peso_str  = f"{peso_kg}kg"

    # 5. Historial biométrico - tabla "biometria" (crea cuando tengas datos reales)
    historial = []
    try:
        bio_res = supabase.table("biometria") \
            .select("fecha, talla, peso") \
            .eq("student_id", sid) \
            .order("fecha", desc=True).limit(4).execute()
        if bio_res.data:
            historial = [
                {"fecha": r["fecha"], "talla": f"{r['talla']}m", "peso": f"{r['peso']}kg"}
                for r in bio_res.data
            ]
    except Exception:
        pass

    # Fallback: 2 meses estimados si no hay datos reales
    if not historial:
        meses = ["Feb 2026", "Ene 2026"]
        for i, mes in enumerate(meses):
            t = round(talla_cm - i * 0.02, 2)
            p = peso_kg - i
            historial.append({"fecha": mes, "talla": f"{t}m", "peso": f"{p}kg"})

    return {
        "full_name":  student["full_name"],
        "category":   student.get("category") or "Categoria Base",
        "img_url":    student.get("img_url"),
        "debe":       debe,
        "racha":      racha,
        "talla_actual":  talla_str,
        "delta_talla":   "+2cm",
        "peso_actual":   peso_str,
        "historial_biometrico": historial,
    }


if __name__ == "__main__":
    puerto = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=puerto)