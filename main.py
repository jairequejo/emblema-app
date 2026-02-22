# main.py
import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from routers import students, credentials, attendance, batidos, admin

app = FastAPI()

app.include_router(admin.router)

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
app.include_router(students.router)
app.include_router(credentials.router)
app.include_router(attendance.router)
app.include_router(batidos.router)  # ← agrega esta línea

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

@app.get("/batidos")
def batidos_page():        # ← renombra la función para que no choque con el módulo batidos
    return FileResponse("frontend/batidos/index.html")

@app.get("/status")
def status():
    return {"status": "Backend funcionando 🚀"}

@app.get("/admin/login")
def admin_login_page():
    return FileResponse("frontend/admin/login.html")

@app.get("/admin")
def admin_panel():
    return FileResponse("frontend/admin/index.html")


if __name__ == "__main__":
    puerto = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=puerto)