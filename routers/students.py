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