# routers/credentials.py
from fastapi import APIRouter, HTTPException, Depends
from database import supabase
from routers.admin import verify_admin
from routers.jrs_utils import generate_jrs_code

router = APIRouter(prefix="/credentials", tags=["credentials"])


@router.post("/generate/{student_id}")
def generate_credential(student_id: str, admin=Depends(verify_admin)):
    # 1. Verificamos que el alumno existe
    student = supabase.table("students").select("id, full_name, valid_until").eq("id", student_id).execute()
    if not student.data:
        raise HTTPException(status_code=404, detail="Estudiante no existe")

    student_data = student.data[0]

    # 2. Creamos el código JRS
    code = generate_jrs_code(
        student_id=student_data["id"],
        full_name=student_data.get("full_name", ""),
        valid_until_date=student_data.get("valid_until"),
    )

    # 3. Lo guardamos en la Bóveda de Supabase
    supabase.table("credentials").insert({
        "student_id": student_id,
        "code": code,
        "is_active": True,
    }).execute()

    return {
        "message": "Credencial creada",
        "code": code,
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