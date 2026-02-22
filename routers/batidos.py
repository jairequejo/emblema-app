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

    # 1. Obtener alumno y verificar saldo
    alumno = (
        supabase.table("students")
        .select("id, name, batido_credits")
        .eq("id", body.student_id)
        .single()
        .execute()
    )
    if not alumno.data:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")

    saldo = alumno.data.get("batido_credits", 0) or 0
    if saldo < body.credits_used:
        raise HTTPException(status_code=400, detail="Saldo insuficiente")

    # 2. Descontar créditos
    nuevo_saldo = saldo - body.credits_used
    supabase.table("students").update(
        {"batido_credits": nuevo_saldo}
    ).eq("id", body.student_id).execute()

    # 3. Registrar el canje
    supabase.table("batido_canjes").insert({
        "student_id": body.student_id,
        "batido_name": body.batido_name,
        "credits_used": body.credits_used,
        "emoji": body.emoji,
    }).execute()

    return {
        "ok": True,
        "alumno": alumno.data["name"],
        "batido": body.batido_name,
        "creditos_usados": body.credits_used,
        "saldo_restante": nuevo_saldo,
    }