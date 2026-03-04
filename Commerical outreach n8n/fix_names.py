import json

with open("core_exteriors_combined.json", "r", encoding="utf-8") as f:
    d = json.load(f)

# Normalize all node names: replace escaped unicode with actual characters
for node in d["nodes"]:
    old = node["name"]
    # These should already be actual chars after json.load, but some
    # might have literal \\u2013 etc if double-escaped in the source
    node["name"] = node["name"].replace("\\u2013", "\u2013")
    node["name"] = node["name"].replace("\\u2019", "\u2019")
    node["name"] = node["name"].replace("\\u2014", "\u2014")
    if old != node["name"]:
        print(f"  Fixed node: {old} -> {node['name']}")

# Also normalize connection keys and targets
new_conns = {}
for src, v in d["connections"].items():
    src2 = src.replace("\\u2013", "\u2013").replace("\\u2019", "\u2019")
    for outputs in v.get("main", []):
        for link in outputs:
            link["node"] = link["node"].replace("\\u2013", "\u2013").replace("\\u2019", "\u2019")
    new_conns[src2] = v
d["connections"] = new_conns

# Build sets for verification
names = set(n["name"] for n in d["nodes"])
connected = set()
errors = []
for src, v in d["connections"].items():
    if src not in names:
        errors.append(f"SOURCE: {repr(src)}")
    connected.add(src)
    for outputs in v.get("main", []):
        for link in outputs:
            if link["node"] not in names:
                errors.append(f"TARGET: {repr(link['node'])} from {repr(src)}")
            connected.add(link["node"])

triggers = {n["name"] for n in d["nodes"] if "Trigger" in n["type"] or "scheduleTrigger" in n["type"]}
orphans = names - connected - triggers

if errors:
    print(f"\nRemaining errors: {len(errors)}")
    for e in errors:
        print(f"  {e}")
else:
    print("\nAll connections valid!")

if orphans:
    print(f"Orphans: {orphans}")
else:
    print("No orphans!")

print(f"Total: {len(names)} nodes, {len(d['connections'])} connections")

with open("core_exteriors_combined.json", "w", encoding="utf-8") as f:
    json.dump(d, f, indent=2, ensure_ascii=False)

print("File saved!")
