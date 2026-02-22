# routers/credentials.py
from fastapi import APIRouter, HTTPException
from database import supabase
import secrets
import string
import qrcode

router = APIRouter(prefix="/credentials", tags=["credentials"])

@router.post("/generate/{student_id}")
def generate_credential(student_id: str):
    student = supabase.table("students").select("*").eq("id", student_id).execute()
    if not student.data:
        raise HTTPException(status_code=404, detail="Estudiante no existe")

    alphabet = string.ascii_uppercase + string.digits
    code = f"STU-{''.join(secrets.choice(alphabet) for _ in range(8))}"

    supabase.table("credentials").insert({
        "student_id": student_id,
        "code": code,
        "type": "qr",
        "is_active": True
    }).execute()

    img = qrcode.make(code)
    img.save(f"qrs/{code}.png")

    return {
        "message": "Credencial creada",
        "code": code,
        "qr_url": f"/qrs/{code}.png"
    }

@router.get("/{student_id}")
def get_credential(student_id: str):
    response = supabase.table("credentials") \
        .select("*") \
        .eq("student_id", student_id) \
        .eq("is_active", True) \
        .execute()
    return response.data