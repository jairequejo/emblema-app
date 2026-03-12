import sys
sys.path.append(".")
from routers.attendance import _parse_jrs
import json

code = "JRS:1aa80c53:20991231:QUNVw5FB:778b5e8053be4d3d"
parsed = _parse_jrs(code)
print("Parsed:", parsed)
