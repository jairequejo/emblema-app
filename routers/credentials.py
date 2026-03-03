# routers/credentials.py
from fastapi import APIRouter, HTTPException, Depends
from database import supabase
from routers.admin import verify_admin
import secrets
import string
import base64
import hashlib
import hmac
import os
from datetime import date, datetime

def generate_jrs_code(student_id: str, full_name: str, valid_until_date: str | date | None) -> str:
    short_id = student_id[:8]
    
    if valid_until_date:
        if isinstance(valid_until_date, str):
            try:
                dt = datetime.strptime(valid_until_date, "%Y-%m-%d").date()
                valid_until_str = dt.strftime("%Y%m%d")
            except ValueError:
                valid_until_str = "20991231"
        else:
            valid_until_str = valid_until_date.strftime("%Y%m%d")
    else:
        valid_until_str = "20991231"
        
    first_name = full_name.strip().split()[0] if full_name else "USER"
    name_b64url = base64.urlsafe_b64encode(first_name.encode('utf-8')).decode('utf-8').rstrip('=')
    
    secret_key = os.getenv("JRS_SECRET_KEY", "default_secret_key_123")
    message = f"{short_id}|{valid_until_str}|{name_b64url}"
    
    signature = hmac.new(
        secret_key.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    hmac16hex = signature[:16]
    
    return f"JRS:{short_id}:{valid_until_str}:{name_b64url}:{hmac16hex}"

router = APIRouter(prefix="/credentials", tags=["credentials"])

@router.post("/generate/{student_id}")
def generate_credential(student_id: str, admin=Depends(verify_admin)):
    # 1. Verificamos que el alumno existe
    student = supabase.table("students").select("id, full_name, valid_until").eq("id", student_id).execute()
    if not student.data:
        raise HTTPException(status_code=404, detail="Estudiante no existe")
    
    student_data = student.data[0]

    # 2. Creamos el texto del QR JRS
    code = generate_jrs_code(
        student_id=student_data["id"],
        full_name=student_data.get("full_name", ""),
        valid_until_date=student_data.get("valid_until")
    )

    # 3. Lo guardamos en la Bóveda de Supabase
    supabase.table("credentials").insert({
        "student_id": student_id,
        "code": code,
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