import json, os

base = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(base, "core_exteriors_combined.json")

with open(path, "r", encoding="utf-8") as f:
    wf = json.load(f)

for node in wf["nodes"]:
    # --- Convert cron to scheduleTrigger ---
    if node["type"] == "n8n-nodes-base.cron":
        node["type"] = "n8n-nodes-base.scheduleTrigger"
        node["typeVersion"] = 1.2
        # Convert parameters
        old = node.get("parameters", {})
        items = old.get("triggerTimes", {}).get("item", [])
        if items:
            item = items[0]
            if item.get("mode") == "custom":
                cron = item.get("cronExpression", "")
                node["parameters"] = {"rule": {"interval": [{"field": "cronExpression", "expression": cron}]}}
            elif item.get("mode") == "everyWeekday":
                h = item.get("hour", 9)
                m = item.get("minute", 0)
                node["parameters"] = {"rule": {"interval": [{"field": "weeks", "daysOfWeek": [1,2,3,4,5], "hour": h, "minute": m}]}}

    # --- Convert function to code ---
    if node["type"] == "n8n-nodes-base.function":
        node["type"] = "n8n-nodes-base.code"
        node["typeVersion"] = 2
        old_code = node["parameters"].get("functionCode", "")
        node["parameters"] = {"jsCode": old_code, "mode": "runOnceForAllItems"}

    # --- Convert set v2 to v3.4 ---
    if node["type"] == "n8n-nodes-base.set":
        node["typeVersion"] = 3.4
        old_vals = node["parameters"].get("values", {})
        assignments = []
        for typ in ["string", "number", "boolean"]:
            for item in old_vals.get(typ, []):
                assignments.append({"id": item["name"], "name": item["name"], "value": item["value"], "type": typ})
        node["parameters"] = {"mode": "manual", "assignments": {"assignments": assignments}}

    # --- Convert if v2 to v2 with new conditions format ---
    if node["type"] == "n8n-nodes-base.if":
        node["typeVersion"] = 2.2
        old_conds = node["parameters"].get("conditions", {})
        conditions = []
        for cond in old_conds.get("string", []):
            op = cond.get("operation", "equals")
            v1 = cond.get("value1", "")
            v2 = cond.get("value2", "")
            if op == "isNotEmpty":
                conditions.append({"id": node["id"]+"_c", "leftValue": v1, "rightValue": "", "operator": {"type": "string", "operation": "isNotEmpty"}})
            elif op == "equals":
                conditions.append({"id": node["id"]+"_c", "leftValue": v1, "rightValue": v2, "operator": {"type": "string", "operation": "equals"}})
        for cond in old_conds.get("boolean", []):
            op = cond.get("operation", "")
            v1 = cond.get("value1", "")
            if op == "isEmpty":
                conditions.append({"id": node["id"]+"_c", "leftValue": v1, "rightValue": "", "operator": {"type": "string", "operation": "isEmpty"}})
        node["parameters"] = {"conditions": {"options": {"caseSensitive": True, "leftValue": ""}, "conditions": conditions, "combinator": "and"}}

    # --- Convert switch v2 to v3 ---
    if node["type"] == "n8n-nodes-base.switch":
        node["typeVersion"] = 3.2
        old_rules = node["parameters"].get("rules", {})
        rules_list = []
        for i, rule in enumerate(old_rules.get("string", [])):
            v1 = rule.get("value1", "")
            v2 = rule.get("value2", "")
            op = rule.get("operation", "equals")
            rules_list.append({
                "conditions": {"conditions": [{"id": f"rule_{i}", "leftValue": v1, "rightValue": v2,
                    "operator": {"type": "string", "operation": op}}], "combinator": "and"},
                "renameOutput": False
            })
        node["parameters"] = {"rules": {"values": rules_list}, "options": {}}

    # --- Convert splitInBatches ---
    if node["type"] == "n8n-nodes-base.splitInBatches":
        node["typeVersion"] = 3

    # --- Convert httpRequest ---
    if node["type"] == "n8n-nodes-base.httpRequest":
        node["typeVersion"] = 4.2
        opts = node["parameters"].get("options", {})
        if "responseFormat" in opts:
            rf = opts.pop("responseFormat")
            if rf == "json":
                node["parameters"]["options"] = opts
            elif rf == "string":
                node["parameters"]["options"] = {**opts, "response": {"response": {"responseFormat": "text"}}}

    # --- Convert googleSheets ---
    if node["type"] == "n8n-nodes-base.googleSheets":
        node["typeVersion"] = 4.5

    # --- Convert gmail ---
    if node["type"] == "n8n-nodes-base.gmail":
        node["typeVersion"] = 2.1

    # --- Convert openAi ---
    if node["type"] == "n8n-nodes-base.openAi":
        # Keep as-is but bump version
        pass

    # --- Convert telegram ---
    if node["type"] == "n8n-nodes-base.telegram":
        node["typeVersion"] = 1.2

    if node["type"] == "n8n-nodes-base.telegramTrigger":
        node["typeVersion"] = 1.1

    # --- Convert wait ---
    if node["type"] == "n8n-nodes-base.wait":
        node["typeVersion"] = 1.1

with open(path, "w", encoding="utf-8") as f:
    json.dump(wf, f, indent=2, ensure_ascii=False)

print(f"Fixed {len(wf['nodes'])} nodes for n8n v2.4.8 compatibility")
