# routers/credentials.py
from fastapi import APIRouter, HTTPException, Depends
from database import supabase
from routers.admin import verify_admin
import secrets
import string

router = APIRouter(prefix="/credentials", tags=["credentials"])

@router.post("/generate/{student_id}")
def generate_credential(student_id: str, admin=Depends(verify_admin)):
    # 1. Verificamos que el alumno existe
    student = supabase.table("students").select("id").eq("id", student_id).execute()
    if not student.data:
        raise HTTPException(status_code=404, detail="Estudiante no existe")

    # 2. Creamos el texto del QR (Ej: STU-X8F9A2B)
    alphabet = string.ascii_uppercase + string.digits
    code = f"STU-{''.join(secrets.choice(alphabet) for _ in range(8))}"

    # 3. Lo guardamos en la Bóveda de Supabase
    supabase.table("credentials").insert({
        "student_id": student_id,
        "code": code,
        "type": "qr",
        "is_active": True
    }).execute()

    return {
        "message": "Credencial creada",
        "code": code
    }

@router.get("/{student_id}")
def get_credential(student_id: str, admin=Depends(verify_admin)):
    # Busca si el alumno ya tiene un QR asignado
    response = supabase.table("credentials") \
        .select("*") \
        .eq("student_id", student_id) \
        .eq("is_active", True) \
        .execute()
    return response.data