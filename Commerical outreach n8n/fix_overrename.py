import json

with open("core_exteriors_combined.json", "r", encoding="utf-8") as f:
    d = json.load(f)

# Fix the over-renamed nodes - undo the damage from the global replace
fix_map = {
    "Sheets \u2013 Read Leads (followup) (dedupe)": "Sheets \u2013 Read Leads (dedupe)",
    "Sheets \u2013 Read Leads (followup) (send)": "Sheets \u2013 Read Leads (send)",
    "Sheets \u2013 Read Leads (followup) (bot)": "Sheets \u2013 Read Leads (bot)",
}

for node in d["nodes"]:
    if node["name"] in fix_map:
        old = node["name"]
        node["name"] = fix_map[old]
        print(f"  Fixed: {old} -> {node['name']}")

# Fix connections too
new_conns = {}
for src, v in d["connections"].items():
    new_src = fix_map.get(src, src)
    for outputs in v.get("main", []):
        for link in outputs:
            link["node"] = fix_map.get(link["node"], link["node"])
    new_conns[new_src] = v
d["connections"] = new_conns

# Also fix any $node references inside jsCode or parameter strings
s = json.dumps(d, ensure_ascii=False)
for old, new in fix_map.items():
    s = s.replace(old, new)
d = json.loads(s)

# Verify
names = set(n["name"] for n in d["nodes"])
errors = []
connected = set()
for src, v in d["connections"].items():
    if src not in names:
        errors.append(f"SOURCE: {src}")
    connected.add(src)
    for outputs in v.get("main", []):
        for link in outputs:
            if link["node"] not in names:
                errors.append(f"TARGET: {link['node']}")
            connected.add(link["node"])

triggers = {n["name"] for n in d["nodes"] if "Trigger" in n["type"] or "scheduleTrigger" in n["type"]}
orphans = names - connected - triggers

print(f"\nErrors: {errors if errors else 'NONE'}")
print(f"Orphans: {orphans if orphans else 'NONE'}")
print(f"Total: {len(names)} nodes, {len(d['connections'])} connections")

with open("core_exteriors_combined.json", "w", encoding="utf-8") as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
print("Saved!")
