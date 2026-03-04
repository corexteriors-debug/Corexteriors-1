import json

with open("core_exteriors_combined.json", "r", encoding="utf-8") as f:
    d = json.load(f)

names = set(n["name"] for n in d["nodes"])
conns = d["connections"]
errors = []

# Check all connection sources and targets exist
for src, v in conns.items():
    if src not in names:
        errors.append(f"SOURCE MISSING: {src}")
    for outputs in v.get("main", []):
        for link in outputs:
            if link["node"] not in names:
                errors.append(f"TARGET MISSING: {link['node']} (from {src})")

# Find connected nodes
connected = set()
for src, v in conns.items():
    connected.add(src)
    for outputs in v.get("main", []):
        for link in outputs:
            connected.add(link["node"])

triggers = {
    "Collector \u2013 Every 6 hours",
    "Sender \u2013 Every 10 min",
    "Followup \u2013 Weekdays 9:15",
    "Telegram Trigger",
}
orphans = names - connected - triggers

# Trace paths
def trace(start, depth=0, visited=None):
    if visited is None:
        visited = set()
    if start in visited:
        return visited
    visited.add(start)
    if start in conns:
        for i, outputs in enumerate(conns[start].get("main", [])):
            for link in outputs:
                t = link["node"]
                print(f"{'  ' * depth}{start} -> {t}")
                trace(t, depth + 1, visited)
    return visited

print("=" * 50)
print("CONNECTION VERIFICATION REPORT")
print("=" * 50)

if errors:
    print("\nERRORS:")
    for e in errors:
        print(f"  {e}")
else:
    print("\nAll connection targets exist!")

if orphans:
    print(f"\nORPHAN NODES (disconnected): {orphans}")
else:
    print("No orphan nodes!")

print("\n--- Collector Path ---")
v1 = trace("Collector \u2013 Every 6 hours")
print(f"\n--- Sender Path ---")
v2 = trace("Sender \u2013 Every 10 min")
print(f"\n--- Followup Path ---")
v3 = trace("Followup \u2013 Weekdays 9:15")
print(f"\n--- Telegram Bot Path ---")
v4 = trace("Telegram Trigger")

all_reached = v1 | v2 | v3 | v4 | triggers
not_reached = names - all_reached
print(f"\n{'=' * 50}")
if not_reached:
    print(f"NOT REACHABLE: {not_reached}")
else:
    print(f"All {len(names)} nodes are reachable!")
print(f"Total nodes: {len(names)}, Total connections: {len(conns)}")
