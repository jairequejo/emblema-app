# routers/admin.py
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from typing import Optional
from database import supabase
from datetime import datetime, timedelta, timezone

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


# ── ALUMNOS (Inscripción con Cobro Inicial) ───────────────
@router.get("/alumnos")
def get_alumnos(admin=Depends(verify_admin)):
    res = supabase.table("students").select("*").order("full_name").execute()
    return res.data or []

class AlumnoCreate(BaseModel):
    full_name: str
    dni: Optional[str] = None
    horario: str = "LMV"
    sede: Optional[str] = None
    turno: Optional[str] = None
    pago_mensualidad: float = 80.00
    pago_matricula: float = 0.00
    metodo_pago: str = "Efectivo"
    parent_name: Optional[str] = None  # NUEVO: Nombre del padre
    parent_phone: Optional[str] = None # NUEVO: Teléfono

@router.post("/alumnos")
def crear_alumno(body: AlumnoCreate, admin=Depends(verify_admin)):
    hoy_date = datetime.now(timezone.utc).date()
    fecha_vencimiento_str = (hoy_date + timedelta(days=30)).strftime("%Y-%m-%d")

    # 1. Crear el alumno con los datos del padre
    res = supabase.table("students").insert({
        "full_name": body.full_name,
        "dni": body.dni,
        "horario": body.horario,
        "sede": body.sede,
        "turno": body.turno,
        "is_active": True,
        "batido_credits": 0,
        "valid_until": fecha_vencimiento_str,
        "parent_name": body.parent_name,   # Guardamos el padre
        "parent_phone": body.parent_phone  # Guardamos el teléfono
    }).execute()
    
    nuevo_alumno = res.data[0]
    
    # 2. Registrar el cobro inicial
    try:
        if body.pago_mensualidad > 0:
            supabase.table("mensualidades").insert({
                "student_id": nuevo_alumno["id"],
                "monto": body.pago_mensualidad,
                "metodo_pago": body.metodo_pago,
                "fecha_inicio": hoy_date.strftime("%Y-%m-%d"),
                "fecha_vencimiento": fecha_vencimiento_str
            }).execute()
    except Exception as e:
        print(f"Error guardando el pago inicial: {e}")

    return nuevo_alumno

@router.delete("/alumnos/{student_id}")
def eliminar_alumno(student_id: str, admin=Depends(verify_admin)):
    """Desactiva lógicamente a un alumno o lo reactiva si ya estaba desactivado."""
    alumno_actual = supabase.table("students").select("is_active").eq("id", student_id).single().execute()
    if alumno_actual.data:
        nuevo_estado = not alumno_actual.data["is_active"]
        supabase.table("students").update({"is_active": nuevo_estado}).eq("id", student_id).execute()
    return {"ok": True}


@router.get("/alumnos/by-dni/{dni}")
def get_alumno_by_dni(dni: str, admin=Depends(verify_admin)):
    """Busca un alumno por DNI y calcula sus días restantes."""
    res = supabase.table("students").select("id, full_name, dni, batido_credits, valid_until") \
        .eq("dni", dni).eq("is_active", True).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    
    alumno = res.data[0]
    
    dias_restantes = 0
    if alumno.get("valid_until"):
        vencimiento = datetime.strptime(alumno["valid_until"], "%Y-%m-%d").date()
        hoy = datetime.now(timezone.utc).date()
        dias_restantes = (vencimiento - hoy).days
        if dias_restantes < 0:
            dias_restantes = 0
            
    alumno["dias_restantes"] = dias_restantes
    return alumno


# ── BÓVEDA FINANCIERA (Renovación de Mensualidades) ─────────

class PagoMensualidad(BaseModel):
    student_id: str
    monto: float = 80.00
    metodo: str = "Efectivo"

@router.post("/mensualidades/pagar")
def pagar_mensualidad(body: PagoMensualidad, admin=Depends(verify_admin)):
    """Registra el pago de una RENOVACIÓN de mensualidad."""
    hoy = datetime.now(timezone.utc).date()
    
    res_alumno = supabase.table("students").select("id, valid_until, full_name").eq("id", body.student_id).single().execute()
    if not res_alumno.data:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    
    alumno = res_alumno.data
    
    # Lógica Antifrágil para sumar fechas
    if alumno.get("valid_until"):
        fecha_actual_vencimiento = datetime.strptime(alumno["valid_until"], "%Y-%m-%d").date()
        if fecha_actual_vencimiento >= hoy:
            nueva_fecha = fecha_actual_vencimiento + timedelta(days=30)
        else:
            nueva_fecha = hoy + timedelta(days=30)
    else:
        nueva_fecha = hoy + timedelta(days=30)
        
    fecha_str = nueva_fecha.strftime("%Y-%m-%d")

    # Actualizar al alumno (Le damos acceso a la puerta)
    supabase.table("students").update({
        "valid_until": fecha_str
    }).eq("id", body.student_id).execute()

    # Registrar en el libro contable
    fecha_inicio_str = hoy.strftime("%Y-%m-%d")
    try:
        supabase.table("mensualidades").insert({
            "student_id": body.student_id,
            "monto": body.monto,
            "metodo_pago": body.metodo,
            "fecha_inicio": fecha_inicio_str,
            "fecha_vencimiento": fecha_str
        }).execute()
    except Exception as e:
        print(f"Advertencia: No se pudo registrar en la tabla 'mensualidades': {e}")

    return {
        "ok": True,
        "alumno": alumno["full_name"],
        "monto_pagado": body.monto,
        "nueva_fecha_vencimiento": fecha_str,
        "dias_agregados": 30
    }

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