# routers/students.py
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from database import supabase
from routers.admin import verify_admin

router = APIRouter(prefix="/students", tags=["students"])

class StudentCreate(BaseModel):
    full_name: str

@router.get("")
def get_students(admin=Depends(verify_admin)):
    response = supabase.table("students").select("*").order("full_name").execute()
    return response.data

@router.post("")
def create_student(student: StudentCreate, admin=Depends(verify_admin)):
    response = supabase.table("students").insert({
        "full_name": student.full_name
    }).execute()
    return response.data

@router.delete("/{student_id}")
def delete_student(student_id: str, admin=Depends(verify_admin)):
    # Baja lógica (no borrado físico) — el borrado real lo maneja admin.py
    supabase.table("students").update({"is_active": False}).eq("id", student_id).execute()
    return {"message": "Estudiante desactivado"}

@router.get("/by-dni/{dni}")
def get_student_by_dni(dni: str, admin=Depends(verify_admin)):
    res = (
        supabase.table("students")
        .select("id, full_name, dni, sede, turno, batido_credits")
        .eq("dni", dni)
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    return res.data
