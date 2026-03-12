import urllib.request
import json
import ssl

url = "https://emblema-app-production.up.railway.app/attendance/scan"
req = urllib.request.Request(url, method="POST")
req.add_header("Content-Type", "application/json")
data = json.dumps({"code": "JRS:12345678:20991231:VXN1YXJpbw:abcdef"}).encode("utf-8")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

try:
    response = urllib.request.urlopen(req, data=data, context=ctx)
    print("STATUS:", response.status)
    print("BODY:", response.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    print("HTTP ERROR:", e.code)
    print("BODY:", e.read().decode("utf-8"))
except Exception as e:
    print("ERROR:", str(e))
