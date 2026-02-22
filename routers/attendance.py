# routers/attendance.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import supabase
from datetime import datetime, timedelta

router = APIRouter(prefix="/attendance", tags=["attendance"])

class ScanRequest(BaseModel):
    code: str

@router.post("/scan")
def scan_credential(scan: ScanRequest):
    res = supabase.table("credentials") \
        .select("id, student_id, students(full_name)") \
        .eq("code", scan.code) \
        .eq("is_active", True) \
        .execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Credencial inválida")

    raw_data = res.data[0]
    student_id = raw_data["student_id"]

    st_info = raw_data.get("students")
    if isinstance(st_info, list) and len(st_info) > 0:
        nombre_final = st_info[0].get("full_name", "Sin Nombre")
    elif isinstance(st_info, dict):
        nombre_final = st_info.get("full_name", "Sin Nombre")
    else:
        nombre_final = "Sin Nombre"

    twelve_ago = (datetime.now() - timedelta(hours=12)).isoformat()
    recent = supabase.table("attendance").select("id") \
        .eq("student_id", student_id) \
        .gte("created_at", twelve_ago).execute()

    if recent.data:
        return {
            "status": "warning",
            "message": f"Ya registrado: {nombre_final}",
            "student_name": nombre_final
        }

    supabase.table("attendance").insert({
        "credential_id": raw_data["id"],
        "student_id": student_id
    }).execute()

    return {
        "status": "success",
        "message": f"¡Bienvenido, {nombre_final}!",
        "student_name": nombre_final
    }

@router.get("/today")
def get_today_attendance():
    today_start = datetime.now().replace(hour=0, minute=0, second=0).isoformat()

    all_students = supabase.table("students") \
        .select("id, full_name") \
        .eq("is_active", True) \
        .order("full_name") \
        .execute()

    attended = supabase.table("attendance") \
        .select("student_id, created_at") \
        .gte("created_at", today_start) \
        .execute()

    attended_ids = {r["student_id"]: r["created_at"] for r in attended.data}

    result = []
    for student in all_students.data:
        sid = student["id"]
        result.append({
            "id": sid,
            "full_name": student["full_name"],
            "present": sid in attended_ids,
            "time": attended_ids.get(sid, None)
        })

    return result

@router.get("/range")
def get_attendance_range(start: str, end: str):
    # Devuelve todos los registros entre dos fechas
    # Ejemplo: /attendance/range?start=2025-02-01&end=2025-02-28
    response = supabase.table("attendance") \
        .select("student_id, created_at") \
        .gte("created_at", start) \
        .lte("created_at", end) \
        .execute()
    return response.data

@router.get("/history")
def get_history(limit: int = 50):
    response = supabase.table("attendance") \
        .select("id, created_at, students(full_name)") \
        .order("created_at", desc=True) \
        .limit(limit) \
        .execute()
    return response.data