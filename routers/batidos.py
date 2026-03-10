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

# ── FIX 3: Clave JRS unificada ────────────────────────────────────────────────
# Misma clave que jrs_utils.py, attendance.py y entrenador.py
_JRS_SECRET = os.getenv("JRS_SECRET_KEY", "default_secret_key_123").encode("utf-8")


def _b64u_decode(text: str) -> str:
    padding = 4 - len(text) % 4
    return base64.urlsafe_b64decode(text + "=" * padding).decode("utf-8")


def _parse_jrs(code: str):
    """
    Parsea y valida el formato JRS unificado:
    JRS:{short_id}:{YYYYMMDD}:{name_b64url}:{hmac16hex}
    Usa JRS_SECRET_KEY y short_id, igual que jrs_utils.py y attendance.py.
    """
    try:
        parts = code[4:].split(":")   # quita "JRS:"
        if len(parts) != 4:
            return None
        short_id, valid_date, name_b64, sig = parts
        name = _b64u_decode(name_b64)
        # Fix 3: mensaje con short_id y name_b64 (no name decodificado)
        msg = f"{short_id}|{valid_date}|{name_b64}".encode("utf-8")
        expected = hmac.new(_JRS_SECRET, msg, hashlib.sha256).hexdigest()[:16]
        if not hmac.compare_digest(expected, sig):
            return None
        return {"short_id": short_id, "name": name}
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
    Fix 3: formato JRS unificado con short_id → lookup via tabla credentials.
    """
    codigo_limpio = code.strip()

    # ── FORMATO JRS FIRMADO (unificado) ──────────────────
    if codigo_limpio.startswith("JRS:"):
        parsed = _parse_jrs(codigo_limpio)
        if not parsed:
            raise HTTPException(status_code=400, detail="QR JRS inválido o manipulado")

        short_id = parsed["short_id"]

        cred_res = supabase.table("credentials") \
            .select("student_id") \
            .like("code", f"JRS:{short_id}:%") \
            .eq("is_active", True) \
            .limit(1).execute()

        if cred_res.data:
            student_id = cred_res.data[0]["student_id"]
            student = supabase.table("students") \
                .select("id, full_name, batido_credits") \
                .eq("id", student_id).eq("is_active", True).execute()
        else:
            # Fallback: buscar por prefijo de UUID (igual que attendance.py)
            student = supabase.table("students") \
                .select("id, full_name, batido_credits") \
                .ilike("id", f"{short_id}%").eq("is_active", True).execute()

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
def canjear_batido_endpoint(body: CanjeRequest):
    """
    Descuenta créditos y registra el canje de forma atómica.
    Toda la lógica transaccional vive en la función PL/pgSQL canjear_batido().
    FastAPI es solo un mensajero: delega y traduce la respuesta.
    """
    res = supabase.rpc("canjear_batido", {
        "p_student_id":   body.student_id,
        "p_batido_name":  body.batido_name,
        "p_credits_used": body.credits_used,
        "p_emoji":        body.emoji,
    }).execute()

    # supabase-py envuelve el JSONB retornado por la función en res.data.
    # Para llamadas RPC que retornan un único JSONB, res.data es la dict directamente
    # o una lista con un elemento, dependiendo de la versión de supabase-py.
    result = res.data
    if isinstance(result, list):
        result = result[0] if result else {}

    if not result or not result.get("ok"):
        status = result.get("status", "error") if result else "error"
        message = result.get("message", "Error en el canje") if result else "Sin respuesta del servidor"

        if status == "sin_credito":
            raise HTTPException(status_code=402, detail=message)
        elif status == "not_found":
            raise HTTPException(status_code=404, detail=message)
        else:
            raise HTTPException(status_code=500, detail=message)

    return result
