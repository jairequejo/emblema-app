# routers/entrenador.py — Auth independiente (sin Supabase Auth)
import os
import hmac
import hashlib
import base64
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, List

import jwt
from passlib.context import CryptContext
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from database import supabase

router = APIRouter(prefix="/entrenador", tags=["entrenador"])

# ── CRYPTO ────────────────────────────────────────────────
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

JWT_SECRET  = os.getenv("ENTRENADOR_JWT_SECRET", secrets.token_hex(32))
JWT_ALG     = "HS256"
JWT_EXPIRE  = 60 * 24   # 24 horas en minutos

# ── CLAVE HMAC QR (compartida con attendance.py) ──────────
_raw_key = os.getenv("QR_SIGNING_KEY", "a" * 64)
try:
    SIGNING_KEY = bytes.fromhex(_raw_key)
except ValueError:
    SIGNING_KEY = _raw_key.encode()

SIGNING_KEY_HEX = SIGNING_KEY.hex()


def _b64u_encode(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).rstrip(b"=").decode()


def _sign_qr(student_id: str, valid_until_yyyymmdd: str, name: str) -> str:
    msg = f"{student_id}|{valid_until_yyyymmdd}|{name}".encode("utf-8")
    return hmac.new(SIGNING_KEY, msg, hashlib.sha256).digest()[:8].hex()


# ── MODELOS ───────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str


# ── JWT HELPERS ───────────────────────────────────────────
def create_token(entrenador_id: str, email: str, nombre: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE)
    payload = {
        "sub":    entrenador_id,
        "email":  email,
        "nombre": nombre,
        "role":   "entrenador",
        "exp":    exp
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


# ── DEPENDENCIA ───────────────────────────────────────────
def verify_entrenador(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token requerido")
    token = authorization.replace("Bearer ", "")
    payload = decode_token(token)
    if payload.get("role") != "entrenador":
        raise HTTPException(status_code=403, detail="Acceso denegado")
    return payload


# ── LOGIN ─────────────────────────────────────────────────
@router.post("/login")
def entrenador_login(body: LoginRequest):
    """Autentica con la tabla 'entrenadores' (sin Supabase Auth)."""
    res = supabase.table("entrenadores") \
        .select("id, nombre, email, password_hash, is_active") \
        .eq("email", body.email.strip().lower()) \
        .execute()

    if not res.data:
        raise HTTPException(status_code=403, detail="Credenciales incorrectas")

    ent = res.data[0]

    if not ent.get("is_active"):
        raise HTTPException(status_code=403, detail="Cuenta desactivada")

    if not pwd_ctx.verify(body.password, ent["password_hash"]):
        raise HTTPException(status_code=403, detail="Credenciales incorrectas")

    token = create_token(str(ent["id"]), ent["email"], ent["nombre"])
    return {
        "access_token": token,
        "user_email":   ent["email"],
        "nombre":       ent["nombre"],
        "signing_key":  SIGNING_KEY_HEX
    }


# ── GENERAR CREDENCIAL FIRMADA PARA UN ALUMNO ─────────────
@router.post("/credentials/generate-signed/{student_id}")
def generate_signed_credential(student_id: str, payload=Depends(verify_entrenador)):
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

    name     = alumno["full_name"]
    name_b64 = _b64u_encode(name)
    sig      = _sign_qr(student_id, valid_yyyymmdd, name)
    payload_str = f"JRS:{student_id}:{valid_yyyymmdd}:{name_b64}:{sig}"

    return {
        "payload":      payload_str,
        "student_name": name,
        "valid_until":  valid_until,
        "qr_url": f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={payload_str}"
    }


# ── ASISTENCIA DEL DÍA ────────────────────────────────────
@router.get("/asistencia/hoy")
def get_asistencia_hoy(payload=Depends(verify_entrenador)):
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
            "id":          sid,
            "full_name":   student["full_name"],
            "horario":     student.get("horario", ""),
            "turno":       student.get("turno", ""),
            "present":     sid in attended_ids,
            "time":        attended_ids.get(sid),
            "debe":        debe,
            "valid_until": valid_until
        })
    return result
