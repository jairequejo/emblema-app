# routers/admin.py
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from typing import Optional
from database import supabase

router = APIRouter(prefix="/admin", tags=["admin"])


# ── MODELOS ──────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str

class NoticiaCreate(BaseModel):
    titulo: str
    descripcion: str
    categoria: str = "aviso"
    emoji: str = "📢"
    imagen_url: Optional[str] = None

class CreditoUpdate(BaseModel):
    student_id: str
    cantidad: int
    motivo: str = "Recarga manual"


# ── DEPENDENCIA JWT ───────────────────────────────────────
def verify_admin(authorization: Optional[str] = Header(None)):
    """Verifica que el token JWT sea válido en Supabase."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token requerido")

    token = authorization.replace("Bearer ", "")
    try:
        user = supabase.auth.get_user(token)
        if not user or not user.user:
            raise HTTPException(status_code=401, detail="Token inválido")
        return user.user
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")


# ── LOGIN ─────────────────────────────────────────────────
@router.post("/login")
def admin_login(body: LoginRequest):
    """Autentica al admin con Supabase Auth."""
    try:
        res = supabase.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password
        })
        return {
            "access_token": res.session.access_token,
            "user_email": res.user.email
        }
    except Exception as e:
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")


# ── STATS DEL DÍA ─────────────────────────────────────────
@router.get("/stats")
def get_stats(admin=Depends(verify_admin)):
    """Estadísticas rápidas del día de hoy."""
    from datetime import datetime, timezone
    hoy = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    total = supabase.table("students").select("id", count="exact").eq("is_active", True).execute()
    presentes_hoy = supabase.table("attendance").select("id", count="exact") \
        .gte("created_at", f"{hoy}T00:00:00") \
        .lte("created_at", f"{hoy}T23:59:59").execute()

    return {
        "total_alumnos": total.count or 0,
        "presentes_hoy": presentes_hoy.count or 0,
        "ausentes_hoy": max(0, (total.count or 0) - (presentes_hoy.count or 0)),
        "fecha": hoy
    }


# ── ALUMNOS ───────────────────────────────────────────────
@router.get("/alumnos")
def get_alumnos(admin=Depends(verify_admin)):
    res = supabase.table("students").select("*").order("full_name").execute()
    return res.data or []

class AlumnoCreate(BaseModel):
    full_name: str
    horario: str = "LMV"
    sede: Optional[str] = None
    turno: Optional[str] = None

@router.post("/alumnos")
def crear_alumno(body: AlumnoCreate, admin=Depends(verify_admin)):
    res = supabase.table("students").insert({
        "full_name": body.full_name,
        "horario": body.horario,
        "sede": body.sede,
        "turno": body.turno,
        "is_active": True,
        "batido_credits": 0
    }).execute()
    return res.data[0]

@router.delete("/alumnos/{student_id}")
def eliminar_alumno(student_id: str, admin=Depends(verify_admin)):
    supabase.table("students").update({"is_active": False}).eq("id", student_id).execute()
    return {"ok": True}


@router.get("/alumnos/by-dni/{dni}")
def get_alumno_by_dni(dni: str, admin=Depends(verify_admin)):
    """Busca un alumno por DNI para gestión de créditos."""
    res = supabase.table("students").select("id, full_name, dni, batido_credits") \
        .eq("dni", dni).eq("is_active", True).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    return res.data[0]


# ── CRÉDITOS DE BATIDOS ───────────────────────────────────
@router.post("/batidos/recargar")
def recargar_creditos(body: CreditoUpdate, admin=Depends(verify_admin)):
    """Suma créditos a un alumno."""
    alumno = supabase.table("students").select("id, full_name, batido_credits") \
        .eq("id", body.student_id).single().execute()
    if not alumno.data:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")

    nuevo = (alumno.data.get("batido_credits") or 0) + body.cantidad
    supabase.table("students").update({"batido_credits": nuevo}).eq("id", body.student_id).execute()

    return {
        "ok": True,
        "alumno": alumno.data["full_name"],
        "creditos_anteriores": alumno.data.get("batido_credits") or 0,
        "creditos_nuevos": nuevo
    }


# ── NOTICIAS ──────────────────────────────────────────────
@router.get("/noticias")
def get_noticias(admin=Depends(verify_admin)):
    res = supabase.table("noticias").select("*").order("created_at", desc=True).execute()
    return res.data or []

@router.post("/noticias")
def crear_noticia(body: NoticiaCreate, admin=Depends(verify_admin)):
    res = supabase.table("noticias").insert({
        "titulo": body.titulo,
        "descripcion": body.descripcion,
        "categoria": body.categoria,
        "emoji": body.emoji,
        "imagen_url": body.imagen_url,
        "activa": True
    }).execute()
    return res.data[0]

@router.delete("/noticias/{noticia_id}")
def eliminar_noticia(noticia_id: str, admin=Depends(verify_admin)):
    supabase.table("noticias").update({"activa": False}).eq("id", noticia_id).execute()
    return {"ok": True}


# ── FOTOS GALERÍA ─────────────────────────────────────────
@router.get("/fotos")
def get_fotos(admin=Depends(verify_admin)):
    res = supabase.table("galeria").select("*").order("created_at", desc=True).execute()
    return res.data or []

class FotoCreate(BaseModel):
    url: str
    descripcion: Optional[str] = None

@router.post("/fotos")
def agregar_foto(body: FotoCreate, admin=Depends(verify_admin)):
    res = supabase.table("galeria").insert({
        "url": body.url,
        "descripcion": body.descripcion,
        "activa": True
    }).execute()
    return res.data[0]

@router.delete("/fotos/{foto_id}")
def eliminar_foto(foto_id: str, admin=Depends(verify_admin)):
    supabase.table("galeria").update({"activa": False}).eq("id", foto_id).execute()
    return {"ok": True}