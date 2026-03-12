import asyncio
import os
os.environ["ALLOWED_ORIGINS"] = "*"
os.environ["JRS_SECRET_KEY"] = "test_key_123"

from routers.jrs_utils import generate_jrs_code
from routers.attendance import _parse_jrs, scan_credential, ScanRequest

short_id = "12345678"
student_uuid = "12345678-aaaa-bbbb-cccc-123456789abc"
name = "Jair"

code = generate_jrs_code(student_uuid, name, "2026-12-31")
print("Generated Code:", code)

parsed = _parse_jrs(code)
print("Parsed:", parsed)
