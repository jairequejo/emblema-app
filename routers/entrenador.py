# routers/entrenador.py
import os
import hmac
import hashlib
import base64
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from typing import Optional
from database import supabase
from datetime import datetime, timezone

router = APIRouter(prefix="/entrenador", tags=["entrenador"])

# ── CLAVE HMAC (compartida con attendance.py) ─────────────
_raw_key = os.getenv("QR_SIGNING_KEY", "a" * 64)
try:
    SIGNING_KEY = bytes.fromhex(_raw_key)
except ValueError:
    SIGNING_KEY = _raw_key.encode()

# Hex público de la clave que se entrega al frontend en el login
SIGNING_KEY_HEX = SIGNING_KEY.hex()


def _b64u_encode(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).rstrip(b"=").decode()


def _sign(student_id: str, valid_until_yyyymmdd: str, name: str) -> str:
    msg = f"{student_id}|{valid_until_yyyymmdd}|{name}".encode("utf-8")
    return hmac.new(SIGNING_KEY, msg, hashlib.sha256).digest()[:8].hex()


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

    email = user.user.email
    res = supabase.table("user_roles").select("role").eq("email", email).execute()
    if not res.data or res.data[0].get("role") != "entrenador":
        raise HTTPException(status_code=403, detail="Acceso denegado: se requiere rol entrenador")

    return user.user


# ── LOGIN ─────────────────────────────────────────────────
@router.post("/login")
def entrenador_login(body: LoginRequest):
    """Autentica al entrenador con Supabase Auth, verifica rol y devuelve signing_key."""
    try:
        res = supabase.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password
        })
    except Exception:
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")

    email = res.user.email
    rol_res = supabase.table("user_roles").select("role").eq("email", email).execute()
    if not rol_res.data or rol_res.data[0].get("role") != "entrenador":
        raise HTTPException(status_code=403, detail="Esta cuenta no tiene acceso de entrenador")

    return {
        "access_token": res.session.access_token,
        "user_email": res.user.email,
        "signing_key": SIGNING_KEY_HEX   # ← clave para validación local offline
    }


# ── GENERAR CREDENCIAL FIRMADA PARA UN ALUMNO ─────────────
@router.post("/credentials/generate-signed/{student_id}")
def generate_signed_credential(student_id: str, entrenador=Depends(verify_entrenador)):
    """
    Genera el string del payload JRS firmado para el alumno.
    Úsalo para imprimir/escribir en QR o NFC.
    """
    st = supabase.table("students").select("id, full_name, valid_until, is_active")\
        .eq("id", student_id).execute()
    if not st.data:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")

    alumno = st.data[0]
    if not alumno.get("is_active"):
        raise HTTPException(status_code=400, detail="El alumno está inactivo")

    valid_until = alumno.get("valid_until") or ""
    try:
        valid_yyyymmdd = datetime.strptime(valid_until, "%Y-%m-%d").strftime("%Y%m%d")
    except ValueError:
        valid_yyyymmdd = "00000000"

    name = alumno["full_name"]
    name_b64 = _b64u_encode(name)
    sig = _sign(student_id, valid_yyyymmdd, name)

    payload = f"JRS:{student_id}:{valid_yyyymmdd}:{name_b64}:{sig}"

    return {
        "payload": payload,
        "student_name": name,
        "valid_until": valid_until,
        "qr_url": f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={payload}"
    }


# ── ASISTENCIA DEL DÍA ────────────────────────────────────
@router.get("/asistencia/hoy")
def get_asistencia_hoy(entrenador=Depends(verify_entrenador)):
    """Lista todos los alumnos activos con estado de asistencia de hoy."""
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ).isoformat()

    all_students = supabase.table("students")\
        .select("id, full_name, horario, turno, valid_until")\
        .eq("is_active", True).order("full_name").execute()

    attended = supabase.table("attendance")\
        .select("student_id, created_at").gte("created_at", today_start).execute()

    attended_ids = {r["student_id"]: r["created_at"] for r in (attended.data or [])}
    hoy = datetime.now(timezone.utc).date()

    result = []
    for student in (all_students.data or []):
        sid = student["id"]
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
