# routers/jrs_utils.py
"""
Utilidades para generar códigos JRS firmados criptográficamente.
Separado aquí para evitar imports circulares entre admin.py y credentials.py.
"""
import base64
import hashlib
import hmac
import os
from datetime import date, datetime


def generate_jrs_code(student_id: str, full_name: str, valid_until_date: str | date | None) -> str:
    """
    Genera un código JRS con la estructura:
    JRS:{short_id}:{valid_until_YYYYMMDD}:{name_b64url}:{hmac16hex}

    - short_id: primeros 8 chars del UUID del alumno
    - valid_until_YYYYMMDD: fecha de vencimiento formateada; '20991231' si no aplica
    - name_b64url: primer nombre en Base64 URL-safe sin padding
    - hmac16hex: primeros 16 chars hex de HMAC-SHA256(short_id|valid_until|name_b64url)
    """
    short_id = student_id[:8]

    if valid_until_date:
        if isinstance(valid_until_date, str):
            try:
                dt = datetime.strptime(valid_until_date, "%Y-%m-%d").date()
                valid_until_str = dt.strftime("%Y%m%d")
            except ValueError:
                valid_until_str = "20991231"
        elif isinstance(valid_until_date, date):
            valid_until_str = valid_until_date.strftime("%Y%m%d")
        else:
            valid_until_str = "20991231"
    else:
        valid_until_str = "20991231"

    first_name = full_name.strip().split()[0] if full_name and full_name.strip() else "USER"
    name_b64url = base64.urlsafe_b64encode(first_name.encode("utf-8")).decode("utf-8").rstrip("=")

    secret_key = os.getenv("JRS_SECRET_KEY", "default_secret_key_123")
    message = f"{short_id}|{valid_until_str}|{name_b64url}"

    signature = hmac.new(
        secret_key.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    hmac16hex = signature[:16]

    return f"JRS:{short_id}:{valid_until_str}:{name_b64url}:{hmac16hex}"
