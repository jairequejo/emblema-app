# routers/attendance.py
import os
import hmac
import hashlib
import base64
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from typing import Optional, List
from database import supabase
from datetime import datetime, timedelta, timezone
try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo

router = APIRouter(prefix="/attendance", tags=["attendance"])

# Zona horaria Lima (Fix 6)
PERU_TZ = ZoneInfo("America/Lima")

# ── CLAVE HMAC ────────────────────────────────────────────
# Misma variable que usa jrs_utils.py para GENERAR los códigos.
# Setear JRS_SECRET_KEY en Railway para producción.
_JRS_SECRET = os.getenv("JRS_SECRET_KEY", "default_secret_key_123").encode("utf-8")
SIGNING_KEY = _JRS_SECRET

# ── FIX 2: PIN del scanner ──────────────────────────────────────────────────
_SCANNER_PIN = os.getenv("SCANNER_PIN", "").strip()


def verify_scanner_pin(x_scanner_pin: Optional[str] = Header(None)):
    """Valida el PIN del scanner. Sin SCANNER_PIN configurado → acceso público."""
    if not _SCANNER_PIN:
        return  # fallback público para desarrollo
    if x_scanner_pin != _SCANNER_PIN:
        raise HTTPException(status_code=401, detail="PIN de scanner inválido")


def _sign(short_id: str, valid_until: str, name_b64: str) -> str:
    """Reproduce la firma de jrs_utils.py: HMAC-SHA256 sobre 'short_id|fecha|name_b64url', 16 hex chars.
    Usa short_id (primeros 8 chars del UUID), igual que jrs_utils.py."""
    msg = f"{short_id}|{valid_until}|{name_b64}".encode("utf-8")
    return hmac.new(SIGNING_KEY, msg, hashlib.sha256).hexdigest()[:16]


def _b64u_encode(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).rstrip(b"=").decode()


def _b64u_decode(text: str) -> str:
    padding = 4 - len(text) % 4
    return base64.urlsafe_b64decode(text + "=" * padding).decode("utf-8")


def _parse_jrs(code: str):
    """
    Parsea payload JRS:{short_id}:{YYYYMMDD}:{name_b64url}:{hmac16hex}
    short_id = primeros 8 chars del UUID del alumno (igual que jrs_utils.py).
    Devuelve dict o None si es inválido/manipulado.
    """
    try:
        parts = code[4:].split(":")          # quitar "JRS:"
        if len(parts) != 4:
            return None
        short_id, valid_date, name_b64, sig = parts
        name = _b64u_decode(name_b64)

        # Verificar firma usando short_id, igual que jrs_utils.py al generar
        expected = _sign(short_id, valid_date, name_b64)
        if not hmac.compare_digest(expected, sig):
            return None                      # firma inválida

        return {"short_id": short_id, "valid_date": valid_date, "name": name}
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
def scan_credential(scan: ScanRequest, _pin=Depends(verify_scanner_pin)):
    code = scan.code.strip()

    # ── FORMATO NUEVO: JRS:short_id:YYYYMMDD:name_b64:hmac ──
    if code.startswith("JRS:"):
        parsed = _parse_jrs(code)
        if not parsed:
            raise HTTPException(status_code=400, detail="Credencial JRS inválida o manipulada")

        short_id = parsed["short_id"]        # primeros 8 chars del UUID
        nombre_final = parsed["name"]

        # ── Buscar estudiante via credentials (más seguro que id::text cast) ──
        # El código en credentials siempre empieza con JRS:{short_id}:
        cred_res = supabase.table("credentials") \
            .select("student_id") \
            .like("code", f"JRS:{short_id}:%") \
            .eq("is_active", True) \
            .limit(1).execute()

        if cred_res.data:
            student_id = cred_res.data[0]["student_id"]
            st_res = supabase.table("students") \
                .select("id, is_active, valid_until") \
                .eq("id", student_id).execute()
        else:
            # Fallback: castear a texto explícitamente usando eq si sabemos que era JRS
            # O mejor, simplemente lanzar error si no se encuentra en credentials
            raise HTTPException(status_code=404, detail="Credencial JRS no registrada")

        if not st_res.data:
            raise HTTPException(status_code=404, detail="Alumno no encontrado")

        st = st_res.data[0]
        student_id = st["id"]               # UUID completo real

        if not st.get("is_active"):
            return {"status": "debe", "message": f"{nombre_final} — Alumno inactivo",
                    "student_name": nombre_final, "detalle": "Este alumno está marcado como inactivo."}

        # ── Verificar vencimiento usando valid_until de la BD (fuente de verdad) ──
        # NUNCA usamos la fecha del payload JRS para validación online:
        # puede estar desactualizada si el chip/QR no fue regrabado después del último pago.
        hoy = datetime.now(timezone.utc).date()
        valid_until_db = st.get("valid_until")

        if valid_until_db:
            try:
                fecha_venc = datetime.strptime(valid_until_db, "%Y-%m-%d").date()
            except ValueError:
                fecha_venc = hoy  # si el formato falla, permitir el acceso
        else:
            fecha_venc = hoy  # sin fecha en BD = no ha pagado → hoy como límite

        if fecha_venc < hoy:
            dias = (hoy - fecha_venc).days
            return {"status": "debe", "message": f"{nombre_final} — Mensualidad vencida",
                    "student_name": nombre_final,
                    "detalle": f"Venció hace {dias} día{'s' if dias != 1 else ''}. Contactar al administrador."}

        # upsert con ignore_duplicates=True → INSERT ... ON CONFLICT DO NOTHING
        # Cuando el UNIQUE INDEX rechaza el duplicado, res.data queda vacío.
        # No hay SELECT previo: cero TOCTOU.
        fecha_registro = datetime.now(timezone.utc).isoformat()
        res = supabase.table("attendance").upsert(
            {"student_id": student_id, "created_at": fecha_registro},
            ignore_duplicates=True,
        ).execute()

        if res.data is not None and len(res.data) == 0:
            return {"status": "warning", "message": f"Ya registrado: {nombre_final}", "student_name": nombre_final}

        return {"status": "success", "message": f"¡Bienvenido, {nombre_final}!", "student_name": nombre_final}

    # ── FORMATO LEGACY O UUID CRUDA ─────────
    # Si el código tiene formato exacto de UUID (36 chars), buscar en students directamente
    import re
    is_uuid = re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', code, re.I)
    
    if is_uuid:
        st_res = supabase.table("students") \
            .select("id, full_name, valid_until, is_active") \
            .eq("id", code).execute()
            
        if not st_res.data:
            raise HTTPException(status_code=404, detail="Alumno no encontrado (por UUID)")
            
        raw_data = {
            "id": None, # no hay credential_id
            "student_id": st_res.data[0]["id"],
            "students": st_res.data[0]
        }
    else:
        # Fallback LEGACY, buscar si es short_id también: si son 8 caracteres
        if len(code) == 8 and all(c in "0123456789abcdefABCDEF" for c in code):
           st_res_short = supabase.table("students") \
               .select("id, full_name, valid_until, is_active") \
               .ilike("id", f"{code}%").execute()
           
           if st_res_short.data:
               raw_data = {
                   "id": None,
                   "student_id": st_res_short.data[0]["id"],
                   "students": st_res_short.data[0]
               }
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

    fecha_registro = datetime.now(timezone.utc).isoformat()
    res = supabase.table("attendance").upsert(
        {"credential_id": raw_data["id"], "student_id": student_id, "created_at": fecha_registro},
        ignore_duplicates=True,
    ).execute()

    if res.data is not None and len(res.data) == 0:
        return {"status": "warning", "message": f"Ya registrado: {nombre_final}", "student_name": nombre_final}

    return {"status": "success", "message": f"¡Bienvenido, {nombre_final}!", "student_name": nombre_final}


# ── SYNC BATCH (desde Web Worker offline) ─────────────────

# Máximo de registros por lote — protege contra payloads que superan 1MB de Starlette
_MAX_BATCH = 500


@router.post("/sync-batch")
def sync_batch(req: BatchScanRequest):
    """
    Acepta lotes de registros de asistencia generados offline.
    - Un único bulk INSERT (no bucle for).
    - Duplicados absorbidos por el UNIQUE INDEX uq_attendance_student_day.
    - Timestamps futuros descartados en el servidor.
    """
    # Verificar Magic Token del entrenador
    ent_res = supabase.table("entrenadores") \
        .select("id, is_active") \
        .eq("token", req.token).execute()

    if not ent_res.data:
        raise HTTPException(status_code=401, detail="Token de entrenador inválido")
    if not ent_res.data[0].get("is_active"):
        raise HTTPException(status_code=403, detail="Acceso revocado por el administrador")

    ahora_utc = datetime.now(timezone.utc)
    # Margen de tolerancia: 5 minutos hacia el futuro (desfases de reloj normales)
    limite_futuro = ahora_utc + timedelta(minutes=5)

    filas = []
    rechazados_futuro = 0
    rechazados_id = 0

    for rec in req.records[:_MAX_BATCH]:  # Vía Negativa: ignorar lo que exceda el límite
        # ── Filtro 1: timestamp futuro (reloj de niño adelantado) ─────────────
        try:
            ts = datetime.fromisoformat(rec.timestamp.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            rechazados_futuro += 1
            continue

        if ts > limite_futuro:
            rechazados_futuro += 1
            continue

        # ── Filtro 2: student_id debe ser UUID completo (36 chars con guiones) ──
        # El frontend enviaba short_id (8 chars) — eso causaba pérdida silenciosa.
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

    # ── Bulk upsert único — una sola petición HTTP a Supabase ──────────────
    # ignore_duplicates=True → INSERT ... ON CONFLICT DO NOTHING
    # El UNIQUE INDEX rechaza duplicados; res.data solo contiene las filas insertadas.
    res = supabase.table("attendance").upsert(
        filas,
        ignore_duplicates=True,
    ).execute()

    inserted = len(res.data) if res.data else 0
    duplicates = len(filas) - inserted

    return {
        "ok": True,
        "inserted": inserted,
        "duplicates": duplicates,
        "rechazados_futuro": rechazados_futuro,
        "rechazados_id": rechazados_id,
    }


# ── ENDPOINTS EXISTENTES ──────────────────────────────────
@router.get("/scanner/offline-data")
def scanner_offline_data(_pin=Depends(verify_scanner_pin)):
    """
    Descarga una copia ligera del estado de los alumnos para que el kiosko de scanner
    funcione offline. Fix 6: usa PERU_TZ. Fix 3: indexa también por short_id.
    """
    res = supabase.table("students").select("id, full_name, is_active, valid_until").execute()
    alumnos = res.data or []

    hoy = datetime.now(PERU_TZ).date()  # Fix 6: Lima, no UTC
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

        entry = {
            "name": a["full_name"],
            "status": status,
            "detalle": detalle
        }
        offline_db[a["id"]] = entry           # clave UUID completo (legacy)
        offline_db[a["id"][:8]] = entry       # Fix 3: clave short_id para JRS v2

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
