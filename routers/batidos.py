# routers/batidos.py
import os
import hmac
import hashlib
import base64
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from database import supabase
from routers.admin import verify_admin

router = APIRouter(prefix="/batidos", tags=["batidos"])

# ── CLAVE HMAC (misma que attendance.py y entrenador.py) ──
_raw_key = os.getenv("QR_SIGNING_KEY", "a" * 64)
try:
    SIGNING_KEY = bytes.fromhex(_raw_key)
except ValueError:
    SIGNING_KEY = _raw_key.encode()


def _b64u_decode(text: str) -> str:
    padding = 4 - len(text) % 4
    return base64.urlsafe_b64decode(text + "=" * padding).decode("utf-8")


def _parse_jrs(code: str):
    """
    Parsea y valida un payload JRS:{uuid}:{YYYYMMDD}:{name_b64url}:{hmac16hex}.
    Devuelve dict con 'student_id' y 'name', o None si la firma es inválida.
    """
    try:
        parts = code[4:].split(":")   # quita "JRS:"
        if len(parts) != 4:
            return None
        student_id, valid_date, name_b64, sig = parts
        name = _b64u_decode(name_b64)
        msg = f"{student_id}|{valid_date}|{name}".encode("utf-8")
        expected = hmac.new(SIGNING_KEY, msg, hashlib.sha256).digest()[:8].hex()
        if not hmac.compare_digest(expected, sig):
            return None
        return {"student_id": student_id, "name": name}
    except Exception:
        return None


# ── MODELOS ──────────────────────────────────────────────
class PinRequest(BaseModel):
    pin: str

class CanjeRequest(BaseModel):
    student_id: str
    batido_name: str
    credits_used: int
    emoji: str = "🥤"


# ── AUTH KIOSKO ──────────────────────────────────────────
@router.post("/auth")
def auth_caja(body: PinRequest):
    """Valida el PIN del kiosko contra la variable de entorno CAJA_PIN."""
    correcto = os.getenv("CAJA_PIN", "1234")
    if body.pin != correcto:
        raise HTTPException(status_code=401, detail="PIN incorrecto")
    return {"ok": True}


# ── RUTAS ────────────────────────────────────────────────

@router.get("/nfc/{code}")
def get_alumno_por_codigo(code: str):
    """
    Busca al alumno por su QR (STU-legacy o JRS firmado) para la Caja Registradora.
    """
    codigo_limpio = code.strip()

    # ── FORMATO JRS FIRMADO ───────────────────────────────
    if codigo_limpio.startswith("JRS:"):
        parsed = _parse_jrs(codigo_limpio)
        if not parsed:
            raise HTTPException(status_code=400, detail="QR JRS inválido o manipulado")

        student_id = parsed["student_id"]
        student = supabase.table("students") \
            .select("id, full_name, batido_credits") \
            .eq("id", student_id).eq("is_active", True).execute()

        if not student.data:
            raise HTTPException(status_code=404, detail="Alumno inactivo o no existe")

        alumno = student.data[0]
        return {
            "id":             alumno["id"],
            "name":           alumno["full_name"],
            "batido_credits": alumno["batido_credits"]
        }

    # ── FORMATO LEGACY STU-XXXXX ─────────────────────────
    cred = supabase.table("credentials").select("student_id") \
        .eq("code", codigo_limpio).eq("is_active", True).execute()
    if not cred.data:
        raise HTTPException(status_code=404, detail="Credencial inválida")

    student_id = cred.data[0]["student_id"]
    student = supabase.table("students") \
        .select("id, full_name, batido_credits") \
        .eq("id", student_id).eq("is_active", True).execute()
    if not student.data:
        raise HTTPException(status_code=404, detail="Alumno inactivo o no existe")

    alumno = student.data[0]
    return {
        "id":             alumno["id"],
        "name":           alumno["full_name"],
        "batido_credits": alumno["batido_credits"]
    }


@router.get("/history/{student_id}")
def get_historial(student_id: str, admin=Depends(verify_admin)):
    """Últimos canjes de un alumno (protegido por token admin)."""
    res = (
        supabase.table("batido_canjes")
        .select("*")
        .eq("student_id", student_id)
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )
    return res.data or []


@router.post("/canjear")
def canjear_batido(body: CanjeRequest):
    """Descuenta créditos y registra el canje."""

    alumno_res = (
        supabase.table("students")
        .select("id, full_name, batido_credits")
        .eq("id", body.student_id)
        .execute()
    )

    if not alumno_res.data:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")

    alumno = alumno_res.data[0]
    saldo = alumno.get("batido_credits") or 0

    if saldo < body.credits_used:
        raise HTTPException(status_code=400, detail="Saldo insuficiente")

    nuevo_saldo = saldo - body.credits_used
    supabase.table("students").update(
        {"batido_credits": nuevo_saldo}
    ).eq("id", body.student_id).execute()

    supabase.table("batido_canjes").insert({
        "student_id":  body.student_id,
        "batido_name": body.batido_name,
        "credits_used": body.credits_used,
        "emoji":       body.emoji,
    }).execute()

    return {
        "ok":             True,
        "alumno":         alumno["full_name"],
        "batido":         body.batido_name,
        "creditos_usados": body.credits_used,
        "saldo_restante": nuevo_saldo,
    }