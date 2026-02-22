# routers/students.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import supabase

router = APIRouter(prefix="/students", tags=["students"])

class StudentCreate(BaseModel):
    full_name: str

@router.get("")
def get_students():
    response = supabase.table("students").select("*").order("full_name").execute()
    return response.data

@router.post("")
def create_student(student: StudentCreate):
    response = supabase.table("students").insert({
        "full_name": student.full_name
    }).execute()
    return response.data

@router.delete("/{student_id}")
def delete_student(student_id: str):
    response = supabase.table("students").delete().eq("id", student_id).execute()
    return {"message": "Estudiante eliminado"}

@router.get("/students/by-dni/{dni}")
def get_student_by_dni(dni: str):
    """Retorna datos del alumno incluyendo créditos de batido."""
    res = (
        supabase.table("students")
        .select("id, name, dni, sede, turno, batido_credits")
        .eq("dni", dni)
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Alumno no encontrado")
    return res.data
