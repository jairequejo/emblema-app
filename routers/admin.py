# routers/admin.py
import os
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from typing import Optional
from database import supabase
from datetime import datetime, timedelta, timezone
try:
    from zoneinfo import ZoneInfo          # Python 3.9+
except ImportError:
    from backports.zoneinfo import ZoneInfo # pip install backports.zoneinfo
import secrets
import string
from passlib.context import CryptContext

# Zona horaria oficial del proyecto: Lima, Perú (UTC-5)
PERU_TZ = ZoneInfo("America/Lima")

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Emails autorizados como admin — configura en Railway:
# ADMIN_EMAILS=academiajrstars@gmail.com,jairequejo@gmail.com
_ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.getenv("ADMIN_EMAILS", "").split(",")
    if e.strip()
}

router = APIRouter(prefix="/admin", tags=["admin"])


# ── MODELOS ──────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str


class CreditoUpdate(BaseModel):
    student_id: str
    cantidad: int
    motivo: str = "Recarga manual"


# ── DEPENDENCIA JWT ───────────────────────────────────────
def verify_admin(authorization: Optional[str] = Header(None)):
    """Verifica que el token JWT sea válido y que el usuario tenga rol 'admin'."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token requerido")

    token = authorization.replace("Bearer ", "")
    try:
        user = supabase.auth.get_user(token)
        if not user or not user.user:
            raise HTTPException(status_code=401, detail="Token inválido")
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")

    # Verificar que el email está en la lista de admins (env var ADMIN_EMAILS)
    email = user.user.email.strip().lower()
    if _ADMIN_EMAILS and email not in _ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Acceso denegado: no eres administrador")

    return user.user



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
    hoy = datetime.now(PERU_TZ).strftime("%Y-%m-%d")

    total = supabase.table("students").select("id", count="exact").eq("is_active", True).execute()
    presentes_hoy = supabase.table("attendance").select("id", count="exact") \
        .gte("created_at", f"{hoy}T00:00:00-05:00") \
        .lte("created_at", f"{hoy}T23:59:59-05:00").execute()

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
    hoy_date = datetime.now(PERU_TZ).date()
    fecha_vencimiento_str = (hoy_date + timedelta(days=30)).strftime("%Y-%m-%d")

    # 1. Crear el alumno
    res = supabase.table("students").insert({
        "full_name": body.full_name,
        "dni": body.dni,
        "horario": body.horario,
        "sede": body.sede,
        "turno": body.turno,
        "is_active": True,
        "batido_credits": 0,
        "valid_until": fecha_vencimiento_str,
        "parent_name": body.parent_name,
        "parent_phone": body.parent_phone
    }).execute()
    
    nuevo_alumno = res.data[0]
    
    # 2. Generar el código de credencial automáticamente
    try:
        alphabet = string.ascii_uppercase + string.digits
        codigo_qr = f"STU-{''.join(secrets.choice(alphabet) for _ in range(8))}"
        
        supabase.table("credentials").insert({
            "student_id": nuevo_alumno["id"],
            "code": codigo_qr,
            "type": "qr",
            "is_active": True
        }).execute()
    except Exception as e:
        print(f"Error generando credencial automática: {e}")

    # 3. Registrar el cobro inicial
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
        print(f"Error guardando el pago: {e}")

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
        hoy = datetime.now(PERU_TZ).date()
        dias_restantes = (vencimiento - hoy).days
        if dias_restantes < 0:
            dias_restantes = 0
            
    alumno["dias_restantes"] = dias_restantes
    return alumno


@router.get("/alumnos/buscar")
def buscar_alumno_por_nombre(q: str = "", admin=Depends(verify_admin)):
    """Busca alumnos por nombre completo (búsqueda parcial). Devuelve hasta 10 coincidencias."""
    if len(q.strip()) < 2:
        return []
    res = supabase.table("students") \
        .select("id, full_name, dni, batido_credits, valid_until, is_active, horario") \
        .ilike("full_name", f"%{q.strip()}%") \
        .order("full_name") \
        .limit(10) \
        .execute()
    
    hoy = datetime.now(PERU_TZ).date()
    alumnos = []
    for alumno in (res.data or []):
        dias_restantes = 0
        if alumno.get("valid_until"):
            vencimiento = datetime.strptime(alumno["valid_until"], "%Y-%m-%d").date()
            dias_restantes = (vencimiento - hoy).days
            if dias_restantes < 0:
                dias_restantes = 0
        alumno["dias_restantes"] = dias_restantes
        alumnos.append(alumno)
    return alumnos


# ── BÓVEDA FINANCIERA (Renovación de Mensualidades) ─────────

class PagoMensualidad(BaseModel):
    student_id: str
    monto: float = 80.00
    metodo: str = "Efectivo"

@router.post("/mensualidades/pagar")
def pagar_mensualidad(body: PagoMensualidad, admin=Depends(verify_admin)):
    """Registra el pago de una RENOVACIÓN de mensualidad."""
    hoy = datetime.now(PERU_TZ).date()
    
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


# ── CALENDARIO — ASISTENCIA GLOBAL ──────────────────────
@router.get("/students")
def get_students_for_calendar(admin=Depends(verify_admin)):
    """Lista de alumnos activos para el calendario de asistencia global."""
    res = supabase.table("students") \
        .select("id, full_name, horario, turno, sede") \
        .eq("is_active", True) \
        .order("full_name").execute()
    return res.data or []


@router.get("/attendance/range")
def get_attendance_range(
    start: str,
    end: str,
    admin=Depends(verify_admin)
):
    """
    Registros de asistencia entre start y end (ISO datetime strings).
    Ejemplo: /admin/attendance/range?start=2026-02-01T00:00:00&end=2026-02-28T23:59:59
    """
    res = supabase.table("attendance") \
        .select("id, student_id, created_at") \
        .gte("created_at", start) \
        .lte("created_at", end) \
        .execute()
    return res.data or []


# ── ENTRENADORES (gestión desde admin) ───────────────────
class EntrenadorCreate(BaseModel):
    nombre: str

@router.get("/entrenadores")
def listar_entrenadores(admin=Depends(verify_admin)):
    res = supabase.table("entrenadores") \
        .select("id, nombre, token, is_active, created_at, last_used_at") \
        .order("nombre").execute()
    return res.data or []

@router.post("/entrenadores")
def crear_entrenador(body: EntrenadorCreate, request_info=None, admin=Depends(verify_admin)):
    import secrets as _secrets
    from fastapi import Request
    nombre = body.nombre.strip()
    if not nombre:
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")

    token = _secrets.token_urlsafe(24)   # ~32 chars, URL-safe

    res = supabase.table("entrenadores").insert({
        "nombre": nombre,
        "token":  token,
        "is_active": True
    }).execute()

    if not res.data:
        raise HTTPException(status_code=500, detail="Error al crear el entrenador")

    e = res.data[0]
    return {
        "id":          e["id"],
        "nombre":      e["nombre"],
        "token":       token,
        "is_active":   e["is_active"],
        "magic_link":  f"/entrenador?token={token}"
    }

@router.delete("/entrenadores/{ent_id}")
def toggle_entrenador(ent_id: str, reactivar: bool = False, admin=Depends(verify_admin)):
    supabase.table("entrenadores").update({"is_active": reactivar}).eq("id", ent_id).execute()
    return {"ok": True}
