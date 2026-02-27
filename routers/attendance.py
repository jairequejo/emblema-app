# routers/attendance.py
import os
import hmac
import hashlib
import base64
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from database import supabase
from datetime import datetime, timedelta, timezone

router = APIRouter(prefix="/attendance", tags=["attendance"])

# ── CLAVE HMAC ────────────────────────────────────────────
# Setear QR_SIGNING_KEY=64_hex_chars en .env para producción
_raw_key = os.getenv("QR_SIGNING_KEY", "a" * 64)
try:
    SIGNING_KEY = bytes.fromhex(_raw_key)
except ValueError:
    SIGNING_KEY = _raw_key.encode()


def _sign(student_id: str, valid_until: str, name: str) -> str:
    """Devuelve los primeros 8 bytes del HMAC-SHA256 como hex (16 chars)."""
    msg = f"{student_id}|{valid_until}|{name}".encode("utf-8")
    return hmac.new(SIGNING_KEY, msg, hashlib.sha256).digest()[:8].hex()


def _b64u_encode(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).rstrip(b"=").decode()


def _b64u_decode(text: str) -> str:
    padding = 4 - len(text) % 4
    return base64.urlsafe_b64decode(text + "=" * padding).decode("utf-8")


def _parse_jrs(code: str):
    """
    Parsea payload JRS:{uuid}:{YYYYMMDD}:{name_b64url}:{hmac16hex}
    Devuelve dict o None si es inválido/manipulado.
    """
    try:
        parts = code[4:].split(":")          # quitar "JRS:"
        if len(parts) != 4:
            return None
        student_id, valid_date, name_b64, sig = parts
        name = _b64u_decode(name_b64)

        expected = _sign(student_id, valid_date, name)
        if not hmac.compare_digest(expected, sig):
            return None                      # firma inválida

        return {"student_id": student_id, "valid_date": valid_date, "name": name}
    except Exception:
        return None


# ── MODELO ───────────────────────────────────────────────
class ScanRequest(BaseModel):
    code: str
    timestamp: Optional[str] = None


class BatchScanRecord(BaseModel):
    student_id: str
    timestamp: str                  # ISO8601
    local_id: str                   # ID local del cliente para dedup


class BatchScanRequest(BaseModel):
    records: List[BatchScanRecord]
    token: str                      # JWT del entrenador para autenticar


# ── SCAN ─────────────────────────────────────────────────
@router.post("/scan")
def scan_credential(scan: ScanRequest):
    code = scan.code.strip()

    # ── FORMATO NUEVO: JRS:uuid:YYYYMMDD:name_b64:hmac ──
    if code.startswith("JRS:"):
        parsed = _parse_jrs(code)
        if not parsed:
            raise HTTPException(status_code=400, detail="Credencial JRS inválida o manipulada")

        student_id = parsed["student_id"]
        nombre_final = parsed["name"]
        valid_date_str = parsed["valid_date"]  # YYYYMMDD

        # Verificar si el alumno existe y está activo
        st_res = supabase.table("students").select("id, is_active, valid_until").eq("id", student_id).execute()
        if not st_res.data:
            raise HTTPException(status_code=404, detail="Alumno no encontrado")

        st = st_res.data[0]
        if not st.get("is_active"):
            return {"status": "debe", "message": f"{nombre_final} — Alumno inactivo",
                    "student_name": nombre_final, "detalle": "Este alumno está marcado como inactivo."}

        # Verificar vencimiento usando la fecha del payload (validada por HMAC)
        hoy = datetime.now(timezone.utc).date()
        try:
            fecha_venc = datetime.strptime(valid_date_str, "%Y%m%d").date()
        except ValueError:
            fecha_venc = hoy  # fallback seguro

        if fecha_venc < hoy:
            dias = (hoy - fecha_venc).days
            return {"status": "debe", "message": f"{nombre_final} — Mensualidad vencida",
                    "student_name": nombre_final,
                    "detalle": f"Venció hace {dias} día{'s' if dias != 1 else ''}. Contactar al administrador."}

        # Registrar asistencia (usar student_id directamente, sin credential_id)
        fecha_registro = scan.timestamp if scan.timestamp else datetime.now(timezone.utc).isoformat()
        
        twelve_ago = (datetime.fromisoformat(fecha_registro.replace("Z", "+00:00")) - timedelta(hours=12)).isoformat()
        recent = supabase.table("attendance").select("id").eq("student_id", student_id)\
            .gte("created_at", twelve_ago).execute()
        if recent.data:
            return {"status": "warning", "message": f"Ya registrado: {nombre_final}", "student_name": nombre_final}

        supabase.table("attendance").insert({"student_id": student_id, "created_at": fecha_registro}).execute()
        return {"status": "success", "message": f"¡Bienvenido, {nombre_final}!", "student_name": nombre_final}

    # ── FORMATO LEGACY: STU-XXXXX o código libre ─────────
    res = supabase.table("credentials") \
        .select("id, student_id, students(full_name, valid_until, is_active)") \
        .eq("code", code).eq("is_active", True).execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Credencial inválida")

    raw_data = res.data[0]
    student_id = raw_data["student_id"]

    st_info = raw_data.get("students")
    if isinstance(st_info, list) and st_info:
        nombre_final = st_info[0].get("full_name", "Sin Nombre")
        valid_until  = st_info[0].get("valid_until")
        is_active    = st_info[0].get("is_active", True)
    elif isinstance(st_info, dict):
        nombre_final = st_info.get("full_name", "Sin Nombre")
        valid_until  = st_info.get("valid_until")
        is_active    = st_info.get("is_active", True)
    else:
        nombre_final, valid_until, is_active = "Sin Nombre", None, True

    if not is_active:
        return {"status": "debe", "message": f"{nombre_final} — Alumno inactivo",
                "student_name": nombre_final, "detalle": "Este alumno está marcado como inactivo."}

    if valid_until:
        hoy = datetime.now(timezone.utc).date()
        fecha_venc = datetime.strptime(valid_until, "%Y-%m-%d").date()
        if fecha_venc < hoy:
            dias = (hoy - fecha_venc).days
            return {"status": "debe", "message": f"{nombre_final} — Mensualidad vencida",
                    "student_name": nombre_final,
                    "detalle": f"Venció hace {dias} día{'s' if dias != 1 else ''}. Contactar al administrador."}

    fecha_registro = scan.timestamp if scan.timestamp else datetime.now(timezone.utc).isoformat()
    twelve_ago = (datetime.fromisoformat(fecha_registro.replace("Z", "+00:00")) - timedelta(hours=12)).isoformat()
    recent = supabase.table("attendance").select("id").eq("student_id", student_id)\
        .gte("created_at", twelve_ago).execute()
    if recent.data:
        return {"status": "warning", "message": f"Ya registrado: {nombre_final}", "student_name": nombre_final}

    supabase.table("attendance").insert({"credential_id": raw_data["id"], "student_id": student_id, "created_at": fecha_registro}).execute()
    return {"status": "success", "message": f"¡Bienvenido, {nombre_final}!", "student_name": nombre_final}


# ── SYNC BATCH (desde Web Worker offline) ─────────────────
@router.post("/sync-batch")
def sync_batch(req: BatchScanRequest):
    """
    Acepta lotes de registros de asistencia generados offline.
    Autentica el Magic Token del entrenador contra la tabla `entrenadores`.
    """
    # Verificar Magic Token del entrenador (igual que entrenador.py)
    ent_res = supabase.table("entrenadores") \
        .select("id, is_active") \
        .eq("token", req.token).execute()

    if not ent_res.data:
        raise HTTPException(status_code=401, detail="Token de entrenador inválido")
    if not ent_res.data[0].get("is_active"):
        raise HTTPException(status_code=403, detail="Acceso revocado por el administrador")

    inserted = 0
    duplicates = 0

    for rec in req.records:
        try:
            ts = datetime.fromisoformat(rec.timestamp.replace("Z", "+00:00"))
            window_start = (ts - timedelta(hours=12)).isoformat()
            window_end   = (ts + timedelta(hours=12)).isoformat()

            # Verificar duplicado en ventana de 12h alrededor del timestamp offline
            dup = supabase.table("attendance").select("id").eq("student_id", rec.student_id)\
                .gte("created_at", window_start).lte("created_at", window_end).execute()

            if dup.data:
                duplicates += 1
                continue

            supabase.table("attendance").insert({
                "student_id": rec.student_id,
                "created_at": rec.timestamp,
                "source": "offline_sync"
            }).execute()
            inserted += 1
        except Exception as e:
            print(f"[sync-batch] Error en {rec.student_id}: {e}")

    return {"ok": True, "inserted": inserted, "duplicates": duplicates}


# ── ENDPOINTS EXISTENTES ──────────────────────────────────
@router.get("/scanner/offline-data")
def scanner_offline_data():
    """
    Descarga una copia ligera del estado de los alumnos para que el kiosko de scanner
    funcione offline.
    """
    res = supabase.table("students").select("id, full_name, is_active, valid_until").execute()
    alumnos = res.data or []
    
    hoy = datetime.now(timezone.utc).date()
    offline_db = {}
    
    for a in alumnos:
        if not a.get("is_active"):
            status = "debe"
            detalle = "Alumno inactivo"
        else:
            fecha_str = a.get("valid_until")
            if not fecha_str:
                status = "debe"
                detalle = "Sin pago registrado"
            else:
                try:
                    fecha_venc = datetime.strptime(fecha_str, "%Y-%m-%d").date()
                    if fecha_venc < hoy:
                        status = "debe"
                        dias = (hoy - fecha_venc).days
                        detalle = f"Venció hace {dias} día{'s' if dias != 1 else ''}."
                    else:
                        status = "success"
                        detalle = "OK"
                except Exception:
                    status = "success"
                    detalle = "OK"
                    
        offline_db[a["id"]] = {
            "name": a["full_name"],
            "status": status,
            "detalle": detalle
        }
        
    return offline_db

@router.get("/today")
def get_today_attendance():
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    all_students = supabase.table("students").select("id, full_name").eq("is_active", True).order("full_name").execute()
    attended = supabase.table("attendance").select("student_id, created_at").gte("created_at", today_start).execute()
    attended_ids = {r["student_id"]: r["created_at"] for r in attended.data}
    result = []
    for student in all_students.data:
        sid = student["id"]
        result.append({"id": sid, "full_name": student["full_name"],
                        "present": sid in attended_ids, "time": attended_ids.get(sid)})
    return result


@router.get("/range")
def get_attendance_range(start: str, end: str):
    return supabase.table("attendance").select("student_id, created_at")\
        .gte("created_at", start).lte("created_at", end).execute().data


@router.get("/history")
def get_history(limit: int = 50):
    return supabase.table("attendance").select("id, created_at, students(full_name)")\
        .order("created_at", desc=True).limit(limit).execute().data
