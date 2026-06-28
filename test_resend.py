import urllib.request, json

r = urllib.request.urlopen("http://localhost:4000/api/admin/test-email", timeout=15)
d = json.loads(r.read())
print(json.dumps(d, indent=2))
