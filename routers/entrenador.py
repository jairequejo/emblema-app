# routers/entrenador.py — Magic Token Auth (sin passwords ni emails en login)
import os
import hmac
import hashlib
import base64
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from database import supabase

router = APIRouter(prefix="/entrenador", tags=["entrenador"])

# ── CLAVE HMAC QR ─────────────────────────────────────────
_raw_key = os.getenv("QR_SIGNING_KEY", "a" * 64)
try:
    SIGNING_KEY = bytes.fromhex(_raw_key)
except ValueError:
    SIGNING_KEY = _raw_key.encode()

SIGNING_KEY_HEX = SIGNING_KEY.hex()


def _b64u_encode(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).rstrip(b"=").decode()


def _sign_qr(student_id: str, valid_yyyymmdd: str, name: str) -> str:
    msg = f"{student_id}|{valid_yyyymmdd}|{name}".encode()
    return hmac.new(SIGNING_KEY, msg, hashlib.sha256).digest()[:8].hex()


# ── DEPENDENCIA: VERIFICAR TOKEN ──────────────────────────
def verify_token(authorization: Optional[str] = Header(None)) -> dict:
    """Lee el token mágico del header y verifica que esté activo en la BD."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token requerido")

    token = authorization.replace("Bearer ", "").strip()
    res = supabase.table("entrenadores") \
        .select("id, nombre, is_active") \
        .eq("token", token).execute()

    if not res.data:
        raise HTTPException(status_code=403, detail="Token inválido")

    ent = res.data[0]
    if not ent.get("is_active"):
        raise HTTPException(status_code=403, detail="Acceso revocado por el administrador")

    # Actualizar last_used_at
    supabase.table("entrenadores").update({
        "last_used_at": datetime.now(timezone.utc).isoformat()
    }).eq("token", token).execute()

    return {"id": ent["id"], "nombre": ent["nombre"]}


# ── VERIFY ENDPOINT (llamado al cargar el panel) ──────────
@router.get("/verify")
def verify_entrenador_token(ent=Depends(verify_token)):
    """El frontend llama a este endpoint para validar el token al iniciar."""
    return {
        "ok":          True,
        "nombre":      ent["nombre"],
        "signing_key": SIGNING_KEY_HEX
    }


# ── GENERAR CREDENCIAL FIRMADA PARA UN ALUMNO ─────────────
@router.post("/credentials/generate-signed/{student_id}")
def generate_signed_credential(student_id: str, ent=Depends(verify_token)):
    st = supabase.table("students").select("id, full_name, valid_until, is_active") \
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
    payload  = f"JRS:{student_id}:{valid_yyyymmdd}:{name_b64}:{sig}"

    return {
        "payload":      payload,
        "student_name": name,
        "valid_until":  valid_until,
        "qr_url": f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={payload}"
    }


# ── ASISTENCIA DEL DÍA ────────────────────────────────────
@router.get("/asistencia/hoy")
def get_asistencia_hoy(ent=Depends(verify_token)):
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ).isoformat()

    all_students = supabase.table("students") \
        .select("id, full_name, horario, turno, valid_until") \
        .eq("is_active", True).order("full_name").execute()

    attended = supabase.table("attendance") \
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
