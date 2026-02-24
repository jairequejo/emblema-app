# main.py
import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from routers import students, credentials, attendance, batidos, admin
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

if __name__ == "__main__":
    puerto = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=puerto)