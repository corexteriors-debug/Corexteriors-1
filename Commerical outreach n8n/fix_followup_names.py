import json

with open("core_exteriors_combined.json", "r", encoding="utf-8") as f:
    d = json.load(f)

# Fix the 3 remaining mismatched names
renames = {
    "Cron \u2013 Weekdays 9:15": "Followup \u2013 Weekdays 9:15",
    "Sheets \u2013 Read Leads": "Sheets \u2013 Read Leads (followup)",
}

for node in d["nodes"]:
    if node["name"] in renames:
        old = node["name"]
        node["name"] = renames[old]
        print(f"  Renamed: {old} -> {node['name']}")

# Also update any internal $node references in jsCode / parameters
s = json.dumps(d, ensure_ascii=False)
for old, new in renames.items():
    s = s.replace(old, new)
d = json.loads(s)

# Verify
names = set(n["name"] for n in d["nodes"])
errors = []
for src, v in d["connections"].items():
    if src not in names:
        errors.append(f"SOURCE: {src}")
    for outputs in v.get("main", []):
        for link in outputs:
            if link["node"] not in names:
                errors.append(f"TARGET: {link['node']}")

connected = set()
for src, v in d["connections"].items():
    connected.add(src)
    for outputs in v.get("main", []):
        for link in outputs:
            connected.add(link["node"])
triggers = {n["name"] for n in d["nodes"] if "Trigger" in n["type"] or "scheduleTrigger" in n["type"]}
orphans = names - connected - triggers

if errors:
    print(f"Errors: {errors}")
else:
    print("All connections valid!")
if orphans:
    print(f"Orphans: {orphans}")
else:
    print("No orphans!")

print(f"Total: {len(names)} nodes, {len(d['connections'])} connections")

with open("core_exteriors_combined.json", "w", encoding="utf-8") as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
print("Saved!")
