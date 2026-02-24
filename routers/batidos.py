# routers/batidos.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import supabase

router = APIRouter(prefix="/batidos", tags=["batidos"])


# ── MODELOS ──────────────────────────────────────────────
class CanjeRequest(BaseModel):
    student_id: str
    batido_name: str
    credits_used: int
    emoji: str = "🥤"


# ── RUTAS ────────────────────────────────────────────────

@router.get("/nfc/{code}")
def get_alumno_por_codigo(code: str):
    """Busca al alumno por su QR o NFC para la Caja Registradora."""
    codigo_limpio = code.strip()

    # 1. Buscar el código en la tabla de credenciales
    cred = supabase.table("credentials").select("student_id").eq("code", codigo_limpio).eq("is_active", True).execute()
    if not cred.data:
        raise HTTPException(status_code=404, detail="Credencial inválida")

    student_id = cred.data[0]["student_id"]

    # 2. Buscar al dueño de la credencial en la tabla de alumnos
    student = supabase.table("students").select("id, full_name, batido_credits").eq("id", student_id).eq("is_active", True).execute()
    if not student.data:
        raise HTTPException(status_code=404, detail="Alumno inactivo o no existe")

    alumno = student.data[0]

    # Devolvemos los datos. El JS de tu caja espera que el nombre venga en 'name'
    return {
        "id": alumno["id"],
        "name": alumno["full_name"], 
        "batido_credits": alumno["batido_credits"]
    }


@router.get("/history/{student_id}")
def get_historial(student_id: str):
    """Últimos canjes de un alumno."""
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

    # 1. Obtener alumno y verificar saldo (Corregido a 'full_name')
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

    # 2. Descontar créditos
    nuevo_saldo = saldo - body.credits_used
    supabase.table("students").update(
        {"batido_credits": nuevo_saldo}
    ).eq("id", body.student_id).execute()

    # 3. Registrar el canje en el historial
    supabase.table("batido_canjes").insert({
        "student_id": body.student_id,
        "batido_name": body.batido_name,
        "credits_used": body.credits_used,
        "emoji": body.emoji,
    }).execute()

    return {
        "ok": True,
        "alumno": alumno["full_name"],
        "batido": body.batido_name,
        "creditos_usados": body.credits_used,
        "saldo_restante": nuevo_saldo,
    }