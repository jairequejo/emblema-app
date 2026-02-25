# routers/entrenador.py
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from typing import Optional
from database import supabase
from datetime import datetime, timezone

router = APIRouter(prefix="/entrenador", tags=["entrenador"])


# ── MODELOS ──────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str


# ── DEPENDENCIA: VERIFICAR ROL ENTRENADOR ────────────────
def verify_entrenador(authorization: Optional[str] = Header(None)):
    """Verifica token + que el usuario tenga rol 'entrenador' en user_roles."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token requerido")

    token = authorization.replace("Bearer ", "")
    try:
        user = supabase.auth.get_user(token)
        if not user or not user.user:
            raise HTTPException(status_code=401, detail="Token inválido")
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")

    # Verificar rol en tabla user_roles
    email = user.user.email
    res = supabase.table("user_roles").select("role").eq("email", email).execute()
    if not res.data or res.data[0].get("role") != "entrenador":
        raise HTTPException(status_code=403, detail="Acceso denegado: se requiere rol entrenador")

    return user.user


# ── LOGIN ─────────────────────────────────────────────────
@router.post("/login")
def entrenador_login(body: LoginRequest):
    """Autentica al entrenador con Supabase Auth y verifica su rol."""
    try:
        res = supabase.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password
        })
    except Exception:
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")

    # Verificar que el usuario tiene rol entrenador
    email = res.user.email
    rol_res = supabase.table("user_roles").select("role").eq("email", email).execute()
    if not rol_res.data or rol_res.data[0].get("role") != "entrenador":
        raise HTTPException(status_code=403, detail="Esta cuenta no tiene acceso de entrenador")

    return {
        "access_token": res.session.access_token,
        "user_email": res.user.email
    }


# ── ASISTENCIA DEL DÍA ────────────────────────────────────
@router.get("/asistencia/hoy")
def get_asistencia_hoy(entrenador=Depends(verify_entrenador)):
    """Lista todos los alumnos activos con su estado de asistencia de hoy."""
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ).isoformat()

    all_students = supabase.table("students") \
        .select("id, full_name, horario, turno, valid_until") \
        .eq("is_active", True) \
        .order("full_name") \
        .execute()

    attended = supabase.table("attendance") \
        .select("student_id, created_at") \
        .gte("created_at", today_start) \
        .execute()

    attended_ids = {r["student_id"]: r["created_at"] for r in (attended.data or [])}
    hoy = datetime.now(timezone.utc).date()

    result = []
    for student in (all_students.data or []):
        sid = student["id"]

        # Calcular estado de membresía
        valid_until = student.get("valid_until")
        debe = False
        if valid_until:
            fecha_venc = datetime.strptime(valid_until, "%Y-%m-%d").date()
            debe = fecha_venc < hoy

        result.append({
            "id": sid,
            "full_name": student["full_name"],
            "horario": student.get("horario", ""),
            "turno": student.get("turno", ""),
            "present": sid in attended_ids,
            "time": attended_ids.get(sid),
            "debe": debe,
            "valid_until": valid_until
        })

    return result
