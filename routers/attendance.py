# routers/attendance.py
import os
import hmac
import hashlib
import base64
from fastapi import APIRouter, HTTPException, Depends, Header, Request
from pydantic import BaseModel
from typing import Optional, List
from database import supabase
from datetime import datetime, timedelta, timezone
try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo

router = APIRouter(prefix="/attendance", tags=["attendance"])

PERU_TZ = ZoneInfo("America/Lima")

_JRS_SECRET = os.getenv("JRS_SECRET_KEY", "default_secret_key_123").encode("utf-8")
SIGNING_KEY = _JRS_SECRET

_SCANNER_PIN = os.getenv("SCANNER_PIN", "").strip()


def verify_scanner_pin(request: Request, x_scanner_pin: Optional[str] = Header(None)):
    if not _SCANNER_PIN:
        return
    auth = request.headers.get("Authorization")
    if auth and auth.startswith("Bearer "):
        token = auth.replace("Bearer ", "")
        try:
            user = supabase.auth.get_user(token)
            if user and user.user:
                return
        except Exception:
            pass
    if x_scanner_pin != _SCANNER_PIN:
        raise HTTPException(status_code=401, detail="PIN de scanner inválido")


def _sign(short_id: str, valid_until: str, name_b64: str) -> str:
    msg = f"{short_id}|{valid_until}|{name_b64}".encode("utf-8")
    return hmac.new(SIGNING_KEY, msg, hashlib.sha256).hexdigest()[:16]


def _b64u_decode(text: str) -> str:
    padding = (4 - len(text) % 4) % 4
    return base64.urlsafe_b64decode(text + "=" * padding).decode("utf-8")


def _parse_jrs(code: str):
    try:
        parts = code[4:].split(":")
        if len(parts) != 4:
            return None
        short_id, valid_date, name_b64, sig = parts
        name = _b64u_decode(name_b64)
        expected = _sign(short_id, valid_date, name_b64)
        if not hmac.compare_digest(expected, sig):
            return None
        return {"short_id": short_id, "valid_date": valid_date, "name": name}
    except Exception:
        return None


# ── HELPER: verificar si ya fue registrado hoy ───────────────────────────────
def _ya_registrado_hoy(student_id: str) -> bool:
    """
    Verifica si el alumno ya tiene un registro de asistencia en el día de hoy (hora Lima).
    Esto es el respaldo en Python por si el UNIQUE INDEX aún no existe en Supabase.
    Con el índice creado, el upsert ignore_duplicates lo maneja solo.
    """
    hoy_lima = datetime.now(PERU_TZ)
    inicio_dia = hoy_lima.replace(hour=0, minute=0, second=0, microsecond=0)
    fin_dia    = hoy_lima.replace(hour=23, minute=59, second=59, microsecond=999999)

    res = supabase.table("attendance") \
        .select("id") \
        .eq("student_id", student_id) \
        .gte("created_at", inicio_dia.isoformat()) \
        .lte("created_at", fin_dia.isoformat()) \
        .limit(1).execute()

    return bool(res.data)


class ScanRequest(BaseModel):
    code: str
    timestamp: Optional[str] = None


class BatchScanRecord(BaseModel):
    student_id: str
    timestamp: str
    local_id: str


class BatchScanRequest(BaseModel):
    records: List[BatchScanRecord]
    token: str


# ── SCAN ─────────────────────────────────────────────
@router.post("/scan")
def scan_credential(scan: ScanRequest, _pin=Depends(verify_scanner_pin)):
    code = scan.code.strip()

    # ── FORMATO JRS ──────────────────────────────────────────────────────────
    if code.startswith("JRS:"):
        parsed = _parse_jrs(code)
        if not parsed:
            raise HTTPException(status_code=400, detail="Credencial JRS inválida o manipulada")

        short_id     = parsed["short_id"]
        nombre_final = parsed["name"]

        cred_res = supabase.table("credentials") \
            .select("student_id") \
            .like("code", f"JRS:{short_id}:%") \
            .eq("is_active", True) \
            .limit(1).execute()

        if not cred_res.data:
            raise HTTPException(status_code=404, detail="Credencial JRS no registrada")

        student_id = cred_res.data[0]["student_id"]

        st_res = supabase.table("students") \
            .select("id, is_active, valid_until, full_name") \
            .eq("id", student_id).execute()

        if not st_res.data:
            raise HTTPException(status_code=404, detail="Alumno no encontrado")

        st = st_res.data[0]
        student_id   = st["id"]
        nombre_final = st.get("full_name") or nombre_final  # preferir nombre real de BD

        if not st.get("is_active"):
            return {
                "status": "debe",
                "message": f"{nombre_final} — Alumno inactivo",
                "student_name": nombre_final,
                "detalle": "Este alumno está marcado como inactivo."
            }

        # Verificar vencimiento contra BD (fuente de verdad)
        hoy = datetime.now(PERU_TZ).date()
        valid_until_db = st.get("valid_until")
        if valid_until_db:
            try:
                fecha_venc = datetime.strptime(valid_until_db, "%Y-%m-%d").date()
            except ValueError:
                fecha_venc = hoy
        else:
            fecha_venc = hoy

        if fecha_venc < hoy:
            dias = (hoy - fecha_venc).days
            return {
                "status": "debe",
                "message": f"{nombre_final} — Mensualidad vencida",
                "student_name": nombre_final,
                "detalle": f"Venció hace {dias} día{'s' if dias != 1 else ''}. Contactar al administrador."
            }

        # ── [FIX] Verificar duplicado ANTES de insertar ──────────────────────
        if _ya_registrado_hoy(student_id):
            return {
                "status": "warning",
                "message": f"Ya registrado hoy: {nombre_final}",
                "student_name": nombre_final,
                "detalle": "Este alumno ya marcó asistencia hoy."
            }

        # Insertar asistencia
        fecha_registro = datetime.now(timezone.utc).isoformat()
        supabase.table("attendance").insert({
            "student_id": student_id,
            "created_at": fecha_registro,
            "source": "scanner"
        }).execute()

        return {
            "status": "success",
            "message": f"¡Bienvenido, {nombre_final}!",
            "student_name": nombre_final
        }

    # ── FORMATO LEGACY / UUID ─────────────────────────────────────────────────
    import re
    is_uuid = re.match(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        code, re.I
    )

    if is_uuid:
        st_res = supabase.table("students") \
            .select("id, full_name, valid_until, is_active") \
            .eq("id", code).execute()
        if not st_res.data:
            raise HTTPException(status_code=404, detail="Alumno no encontrado (por UUID)")
        raw_data = {"id": None, "student_id": st_res.data[0]["id"], "students": st_res.data[0]}
    else:
        if len(code) == 8 and all(c in "0123456789abcdefABCDEF" for c in code):
            st_res_short = supabase.table("students") \
                .select("id, full_name, valid_until, is_active") \
                .ilike("id", f"{code}%").execute()
            if st_res_short.data:
                raw_data = {"id": None, "student_id": st_res_short.data[0]["id"], "students": st_res_short.data[0]}
            else:
                res = supabase.table("credentials") \
                    .select("id, student_id, students(full_name, valid_until, is_active)") \
                    .eq("code", code).eq("is_active", True).execute()
                if not res.data:
                    raise HTTPException(status_code=404, detail="Credencial inválida")
                raw_data = res.data[0]
        else:
            res = supabase.table("credentials") \
                .select("id, student_id, students(full_name, valid_until, is_active)") \
                .eq("code", code).eq("is_active", True).execute()
            if not res.data:
                raise HTTPException(status_code=404, detail="Credencial inválida")
            raw_data = res.data[0]

    student_id = raw_data["student_id"]
    st_info    = raw_data.get("students")

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
        return {
            "status": "debe",
            "message": f"{nombre_final} — Alumno inactivo",
            "student_name": nombre_final,
            "detalle": "Este alumno está marcado como inactivo."
        }

    if valid_until:
        hoy = datetime.now(PERU_TZ).date()
        fecha_venc = datetime.strptime(valid_until, "%Y-%m-%d").date()
        if fecha_venc < hoy:
            dias = (hoy - fecha_venc).days
            return {
                "status": "debe",
                "message": f"{nombre_final} — Mensualidad vencida",
                "student_name": nombre_final,
                "detalle": f"Venció hace {dias} día{'s' if dias != 1 else ''}. Contactar al administrador."
            }

    # ── [FIX] Verificar duplicado ANTES de insertar ──────────────────────────
    if _ya_registrado_hoy(student_id):
        return {
            "status": "warning",
            "message": f"Ya registrado hoy: {nombre_final}",
            "student_name": nombre_final,
            "detalle": "Este alumno ya marcó asistencia hoy."
        }

    fecha_registro = datetime.now(timezone.utc).isoformat()
    supabase.table("attendance").insert({
        "credential_id": raw_data["id"],
        "student_id": student_id,
        "created_at": fecha_registro,
        "source": "scanner"
    }).execute()

    return {
        "status": "success",
        "message": f"¡Bienvenido, {nombre_final}!",
        "student_name": nombre_final
    }


# ── SYNC BATCH ────────────────────────────────────────
_MAX_BATCH = 500


@router.post("/sync-batch")
def sync_batch(req: BatchScanRequest):
    ent_res = supabase.table("entrenadores") \
        .select("id, is_active") \
        .eq("token", req.token).execute()

    if not ent_res.data:
        raise HTTPException(status_code=401, detail="Token de entrenador inválido")
    if not ent_res.data[0].get("is_active"):
        raise HTTPException(status_code=403, detail="Acceso revocado por el administrador")

    ahora_utc    = datetime.now(timezone.utc)
    limite_futuro = ahora_utc + timedelta(minutes=5)

    filas = []
    rechazados_futuro = 0
    rechazados_id     = 0

    for rec in req.records[:_MAX_BATCH]:
        try:
            ts = datetime.fromisoformat(rec.timestamp.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            rechazados_futuro += 1
            continue

        if ts > limite_futuro:
            rechazados_futuro += 1
            continue

        import re as _re
        if not _re.match(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            rec.student_id, _re.I
        ):
            rechazados_id += 1
            continue

        filas.append({
            "student_id": rec.student_id,
            "created_at": ts.isoformat(),
            "source": "offline_sync",
        })

    if not filas:
        return {
            "ok": True, "inserted": 0, "duplicates": 0,
            "rechazados_futuro": rechazados_futuro,
            "rechazados_id": rechazados_id,
        }

    res = supabase.table("attendance").upsert(
        filas,
        ignore_duplicates=True,
    ).execute()

    inserted  = len(res.data) if res.data else 0
    duplicates = len(filas) - inserted

    return {
        "ok": True,
        "inserted": inserted,
        "duplicates": duplicates,
        "rechazados_futuro": rechazados_futuro,
        "rechazados_id": rechazados_id,
    }


# ── OFFLINE DATA ──────────────────────────────────────
@router.get("/scanner/offline-data")
def scanner_offline_data(_pin=Depends(verify_scanner_pin)):
    res = supabase.table("students").select("id, full_name, is_active, valid_until").execute()
    alumnos = res.data or []

    hoy = datetime.now(PERU_TZ).date()
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

        entry = {"name": a["full_name"], "status": status, "detalle": detalle}
        offline_db[a["id"]]       = entry
        offline_db[a["id"][:8]]   = entry

    offline_db["_META_SIGNING_KEY"] = _JRS_SECRET.hex()
    return offline_db


@router.get("/today")
def get_today_attendance():
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ).isoformat()
    all_students = supabase.table("students").select("id, full_name") \
        .eq("is_active", True).order("full_name").execute()
    attended = supabase.table("attendance").select("student_id, created_at") \
        .gte("created_at", today_start).execute()
    attended_ids = {r["student_id"]: r["created_at"] for r in attended.data}
    result = []
    for student in all_students.data:
        sid = student["id"]
        result.append({
            "id": sid,
            "full_name": student["full_name"],
            "present": sid in attended_ids,
            "time": attended_ids.get(sid)
        })
    return result


@router.get("/range")
def get_attendance_range(start: str, end: str):
    return supabase.table("attendance").select("student_id, created_at") \
        .gte("created_at", start).lte("created_at", end).execute().data


@router.get("/history")
def get_history(limit: int = 50):
    return supabase.table("attendance").select("id, created_at, students(full_name)") \
        .order("created_at", desc=True).limit(limit).execute().data