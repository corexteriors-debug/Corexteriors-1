import json, os, copy

base = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(base, "core_exteriors_outreach_engine.json"), "r", encoding="utf-8") as f:
    outreach = json.load(f)
with open(os.path.join(base, "core_exteriors_followups.json"), "r", encoding="utf-8") as f:
    followup = json.load(f)
with open(os.path.join(base, "core_exteriors_telegram_bot.json"), "r", encoding="utf-8") as f:
    telegram = json.load(f)

# --- Master config values (superset of all 3 workflows) ---
config_values = [
    {"name":"sheetId","value":"1hm8hisPCTqfurATHBExftrzhbfIC0-FPm0jOU3I_E-k"},
    {"name":"leadsTab","value":"Leads"},
    {"name":"portfolioTab","value":"Portfolio"},
    {"name":"companyName","value":"Core Exteriors"},
    {"name":"senderName","value":"YOUR NAME"},
    {"name":"senderPhone","value":"YOUR PHONE"},
    {"name":"liability","value":"$5,000,000 liability coverage"},
    {"name":"legalLine","value":"We\u2019re a fully registered/insured Ontario business (HST set up)."},
    {"name":"servicesList","value":"Wood Restoration and Deck Maintenance; Hardscape Optimization (Interlock & Polymeric Sand); Exterior Siding Cleaning (Soft Wash); Gutter and Eavestrough Maintenance; Window Cleaning; Landscaping and Garden Finishing (Mulching & Weeding)"},
    {"name":"auditOffer","value":"Free 5\u201310 min Exterior Audit (walkthrough + 3 curb-appeal fixes + options/quote)"},
    {"name":"latlng","value":"42.9849,-81.2453"},
    {"name":"radiusMeters","value":"60000"},
    {"name":"dailySendCap","value":"40"},
    {"name":"minDelaySec","value":"90"},
    {"name":"maxDelaySec","value":"360"},
    {"name":"telegramChatId","value":"YOUR_TELEGRAM_CHAT_ID"},
]

def make_cfg(nid, name, pos):
    return {"id":nid,"name":name,"type":"n8n-nodes-base.set","typeVersion":2,"position":pos,
            "parameters":{"values":{"string":config_values}}}

GS = {"googleSheetsOAuth2Api":{"id":"GSHEETS_CRED_ID","name":"Google Sheets"}}
TG = {"telegramApi":{"id":"TELEGRAM_CRED_ID","name":"Telegram"}}

# ---- Helper: replace $node['Set Config'] refs in a node ----
def fix_cfg_ref(node, new_name):
    s = json.dumps(node, ensure_ascii=False)
    s = s.replace("$node['Set Config']", f"$node['{new_name}']")
    s = s.replace('$node["Set Config"]', f"$node['{new_name}']")
    return json.loads(s)

# ==== OUTREACH NODES ====
sender_names = {"Sender \u2013 Every 10 min","Sheets \u2013 Read Leads (send)",
    "Select One Queued (6am-9pm + cap)","IF mode=send","Wait Random",
    "Gmail \u2013 Send","Sheets \u2013 Update Row (sent)","Increment Sent Counter"}

outreach_nodes = []
for node in outreach["nodes"]:
    if node["name"] == "Set Config":
        continue
    cfg = "Config \u2013 Sender" if node["name"] in sender_names else "Config \u2013 Collector"
    node = fix_cfg_ref(node, cfg)
    # Fix Set Contact Method to use $json
    if node["name"] == "Set Contact Method":
        node["parameters"]["functionCode"] = (
            "\nconst lead = $json;\n"
            "const contactUrl = (lead.website ? lead.website.replace(/\\/$/, '') + '/contact' : '');\n"
            "return [{ json: { ...lead, contactMethod: lead.foundEmail ? 'Email' : 'ContactForm',\n"
            "  contactFormUrl: lead.foundEmail ? '' : contactUrl } }];\n")
    # Fix Queue ContactForm to use $json
    if node["name"] == "Queue ContactForm (no email)":
        node["parameters"]["functionCode"] = (
            "\nconst lead = $json;\nreturn [{\n  json: {\n    ...lead,\n"
            "    variant: '', leadScore: 50,\n"
            "    priority: /property|management|plaza|facility/i.test("
            "(lead.searchQuery||'') + ' ' + (lead.types||'') + ' ' + (lead.businessName||''))"
            " ? 'High' : 'Medium',\n"
            "    recommendedServices: '', nextBestOffer: 'Exterior audit',\n"
            "    emailSubject: '', emailBody: '',\n"
            "    nextFollowUpDate: new Date(Date.now()+7*86400000).toISOString().slice(0,10),\n"
            "    status: 'Queued', approvedToSend: 'N'\n  }\n}];\n")
    outreach_nodes.append(node)

# ==== FOLLOWUP NODES ====
followup_nodes = []
for node in followup["nodes"]:
    if node["name"] == "Set Config":
        continue
    node = fix_cfg_ref(node, "Config \u2013 Followup")
    if node["name"] == "Cron \u2013 Weekdays 9:15":
        node["name"] = "Followup \u2013 Weekdays 9:15"
        node["id"] = "FU_Cron"
    elif node["name"] == "Sheets \u2013 Read Leads":
        node["name"] = "Sheets \u2013 Read Leads (followup)"
        node["id"] = "FU_Read"
    elif node["name"] == "Bucket Leads":
        node["id"] = "FU_Bucket"
        node["parameters"]["functionCode"] = (
            "\nfunction norm(s){ return (s ?? '').toString().trim(); }\n"
            "function daysBetween(a,b){ return Math.floor((a-b)/(24*3600*1000)); }\n"
            "const today = new Date();\nconst rows = items.map(i=>i.json);\n"
            "const noResponse=[],interestedNoMeeting=[],timingLater=[];\n"
            "for(let idx=0;idx<rows.length;idx++){\n"
            "  const r=rows[idx], rowNumber=idx+2;\n"
            "  const status=norm(r.Status).toLowerCase();\n"
            "  const lastTouch=norm(r['Last Touch Date']);\n"
            "  const meeting=norm(r['Meeting Date/Time']);\n"
            "  const outcome=norm(r['Outcome Reason']).toLowerCase();\n"
            "  if(outcome.includes('timing')||outcome.includes('later'))\n"
            "    timingLater.push({rowNumber,name:r['Business Name']||r.BusinessName});\n"
            "  if(status.includes('interested')&&!meeting)\n"
            "    interestedNoMeeting.push({rowNumber,name:r['Business Name']||r.BusinessName});\n"
            "  if(status==='sent'&&lastTouch){\n"
            "    const lt=new Date(lastTouch);\n"
            "    if(!isNaN(lt)&&daysBetween(today,lt)>=3)\n"
            "      noResponse.push({rowNumber,name:r['Business Name']||r.BusinessName,types:r['Type(s)']||r.Types||''});\n"
            "  }\n}\nreturn [{json:{noResponse,interestedNoMeeting,timingLater}}];\n")
    elif node["name"] == "Build Interested Alert":
        node["id"] = "FU_IntMsg"
        node["parameters"]["functionCode"] = (
            "\nconst arr=($json.interestedNoMeeting||[]).slice(0,12);\n"
            "if(!arr.length) return [{json:{skip:true}}];\n"
            "const lines=arr.map(x=>`\\u2022 ${x.name} (row ${x.rowNumber})`).join('\\n');\n"
            "return [{json:{text:'INTERESTED - NO MEETING - CALL TODAY:\\n'+lines}}];\n")
    elif node["name"] == "IF Send Interested Alert":
        node["id"] = "FU_IfInt"
    elif node["name"] == "Telegram \u2013 Interested Alert":
        node["id"] = "FU_TgInt"
    node["position"][1] += 800
    followup_nodes.append(node)

# New followup branches: No-Response + Timing
followup_nodes.extend([
    {"id":"FU_NRMsg","name":"Build No-Response Alert","type":"n8n-nodes-base.function","typeVersion":2,
     "position":[240,1040],
     "parameters":{"functionCode":
        "\nconst arr=($json.noResponse||[]).slice(0,12);\nif(!arr.length) return [{json:{skip:true}}];\n"
        "const lines=arr.map(x=>`\\u2022 ${x.name} (row ${x.rowNumber})`).join('\\n');\n"
        "return [{json:{text:'NO RESPONSE (3+ days):\\n'+lines}}];\n"}},
    {"id":"FU_IfNR","name":"IF Send No-Response Alert","type":"n8n-nodes-base.if","typeVersion":2,
     "position":[460,1040],
     "parameters":{"conditions":{"boolean":[{"value1":"={{$json.skip}}","operation":"isEmpty"}]}}},
    {"id":"FU_TgNR","name":"Telegram \u2013 No-Response Alert","type":"n8n-nodes-base.telegram","typeVersion":1,
     "position":[680,1040],
     "parameters":{"chatId":"={{$node['Config \u2013 Followup'].json.telegramChatId}}","text":"={{$json.text}}"},
     "credentials":TG},
    {"id":"FU_TMMsg","name":"Build Timing Alert","type":"n8n-nodes-base.function","typeVersion":2,
     "position":[240,1200],
     "parameters":{"functionCode":
        "\nconst arr=($json.timingLater||[]).slice(0,12);\nif(!arr.length) return [{json:{skip:true}}];\n"
        "const lines=arr.map(x=>`\\u2022 ${x.name} (row ${x.rowNumber})`).join('\\n');\n"
        "return [{json:{text:'TIMING/LATER - re-engage soon:\\n'+lines}}];\n"}},
    {"id":"FU_IfTM","name":"IF Send Timing Alert","type":"n8n-nodes-base.if","typeVersion":2,
     "position":[460,1200],
     "parameters":{"conditions":{"boolean":[{"value1":"={{$json.skip}}","operation":"isEmpty"}]}}},
    {"id":"FU_TgTM","name":"Telegram \u2013 Timing Alert","type":"n8n-nodes-base.telegram","typeVersion":1,
     "position":[680,1200],
     "parameters":{"chatId":"={{$node['Config \u2013 Followup'].json.telegramChatId}}","text":"={{$json.text}}"},
     "credentials":TG},
])

# ==== TELEGRAM BOT NODES ====
tg_nodes = []
for node in telegram["nodes"]:
    if node["name"] == "Set Config":
        continue
    node = fix_cfg_ref(node, "Config \u2013 Telegram")
    if node["name"] == "Telegram Trigger":
        node["id"] = "TG_Trigger"
    elif node["name"] == "Parse Command":
        node["id"] = "TG_Parse"
        node["parameters"]["functionCode"] = (
            "\nconst text=($json.message?.text||'').trim();\n"
            "const lower=text.toLowerCase();\n"
            "let cmd='help',payload='';\n"
            "if(lower.startsWith('/today')) cmd='today';\n"
            "else if(lower.startsWith('/due')) cmd='due';\n"
            "else if(lower.startsWith('/top10')) cmd='top10';\n"
            "else if(lower.startsWith('/addportfolio')){cmd='addportfolio';payload=text.replace(/\\/addportfolio\\s*/i,'');}\n"
            "return [{json:{cmd,payload,chatId:$json.message.chat.id}}];\n")
    elif node["name"] == "Switch Command":
        node["id"] = "TG_Switch"
        node["parameters"]["rules"]["string"].append(
            {"value1":"={{$json.cmd}}","operation":"equals","value2":"help"})
    node["position"][1] += 1400
    tg_nodes.append(node)

# New telegram handler nodes
tg_nodes.extend([
    {"id":"TG_ReadLeads","name":"Sheets \u2013 Read Leads (bot)","type":"n8n-nodes-base.googleSheets","typeVersion":4,
     "position":[240,1400],
     "parameters":{"operation":"read",
        "documentId":"={{$node['Config \u2013 Telegram'].json.sheetId}}",
        "sheetName":"={{$node['Config \u2013 Telegram'].json.leadsTab}}","options":{}},
     "credentials":GS},
    {"id":"TG_Format","name":"Format Bot Reply","type":"n8n-nodes-base.function","typeVersion":2,
     "position":[460,1400],
     "parameters":{"functionCode":
        "\nconst cmd=$node['Parse Command'].json.cmd;\n"
        "const chatId=$node['Parse Command'].json.chatId;\n"
        "const rows=items.map(i=>i.json);\n"
        "const today=new Date().toISOString().slice(0,10);\nlet text='';\n"
        "if(cmd==='today'){\n"
        "  const sent=rows.filter(r=>(r['Sent Date']||'')===today);\n"
        "  const queued=rows.filter(r=>(r.Status||'').toLowerCase()==='queued');\n"
        "  text='TODAY ('+today+'):\\nSent: '+sent.length+'\\nQueued: '+queued.length+'\\nTotal: '+rows.length;\n"
        "}else if(cmd==='due'){\n"
        "  const due=rows.filter(r=>(r['Next Follow-up Date']||'')<=today&&!['closed','unsubscribed'].includes((r.Status||'').toLowerCase()));\n"
        "  const lines=due.slice(0,15).map(r=>'- '+(r['Business Name']||'?')+' ('+(r.Status||'?')+')').join('\\n');\n"
        "  text='FOLLOW-UPS DUE ('+due.length+'):\\n'+(lines||'None!');\n"
        "}else if(cmd==='top10'){\n"
        "  const scored=rows.filter(r=>r['Lead Score']).sort((a,b)=>Number(b['Lead Score'])-Number(a['Lead Score'])).slice(0,10);\n"
        "  const lines=scored.map((r,i)=>(i+1)+'. '+(r['Business Name']||'?')+' Score:'+(r['Lead Score']||'')).join('\\n');\n"
        "  text='TOP 10 LEADS:\\n'+(lines||'No scored leads.');\n"
        "}\nreturn [{json:{chatId,text}}];\n"}},
    {"id":"TG_Reply","name":"Telegram \u2013 Bot Reply","type":"n8n-nodes-base.telegram","typeVersion":1,
     "position":[680,1400],
     "parameters":{"chatId":"={{$json.chatId}}","text":"={{$json.text}}"},"credentials":TG},
    {"id":"TG_AppendP","name":"Sheets \u2013 Append Portfolio","type":"n8n-nodes-base.googleSheets","typeVersion":4,
     "position":[240,1600],
     "parameters":{"operation":"append",
        "documentId":"={{$node['Config \u2013 Telegram'].json.sheetId}}",
        "sheetName":"={{$node['Config \u2013 Telegram'].json.portfolioTab}}",
        "columns":{"mappingMode":"defineBelow","value":{
            "Date":"={{new Date().toISOString().slice(0,10)}}",
            "Entry":"={{$node['Parse Command'].json.payload}}"}},"options":{}},
     "credentials":GS},
    {"id":"TG_PReply","name":"Telegram \u2013 Portfolio Confirm","type":"n8n-nodes-base.telegram","typeVersion":1,
     "position":[460,1600],
     "parameters":{"chatId":"={{$node['Parse Command'].json.chatId}}",
        "text":"=\u2705 Saved: {{$node['Parse Command'].json.payload}}"},"credentials":TG},
    {"id":"TG_Help","name":"Telegram \u2013 Help Reply","type":"n8n-nodes-base.telegram","typeVersion":1,
     "position":[240,1800],
     "parameters":{"chatId":"={{$node['Parse Command'].json.chatId}}",
        "text":"Commands:\n/today \u2013 Summary\n/due \u2013 Follow-ups due\n/top10 \u2013 Top leads\n/addportfolio <text> \u2013 Log entry"},
     "credentials":TG},
])

# ==== COMBINE ALL NODES ====
all_nodes = [
    make_cfg("CfgCol","Config \u2013 Collector",[-920,-400]),
    make_cfg("CfgSnd","Config \u2013 Sender",[-920,200]),
    make_cfg("CfgFU","Config \u2013 Followup",[-420,800]),
    make_cfg("CfgTG","Config \u2013 Telegram",[-420,1400]),
] + outreach_nodes + followup_nodes + tg_nodes

# ==== CONNECTIONS ====
def c(node,idx=0): return {"node":node,"type":"main","index":idx}

connections = {
    # --- COLLECTOR ---
    "Collector \u2013 Every 6 hours":{"main":[[c("Config \u2013 Collector")]]},
    "Config \u2013 Collector":{"main":[[c("Seed Queries")]]},
    "Seed Queries":{"main":[[c("Split Queries")]]},
    "Split Queries":{"main":[[c("Google Places \u2013 Text Search")],[c("Split Queries",1)]]},
    "Google Places \u2013 Text Search":{"main":[[c("Flatten Places")]]},
    "Flatten Places":{"main":[[c("Split Places")]]},
    "Split Places":{"main":[[c("Google Places \u2013 Details")],[c("Split Places",1)]]},
    "Google Places \u2013 Details":{"main":[[c("Normalize Lead")]]},
    "Normalize Lead":{"main":[[c("Sheets \u2013 Read Leads (dedupe)")]]},
    "Sheets \u2013 Read Leads (dedupe)":{"main":[[c("Dedupe Place ID")]]},
    "Dedupe Place ID":{"main":[[c("IF Website Exists")]]},
    "IF Website Exists":{"main":[[c("HTTP \u2013 Fetch Homepage")],[c("Queue ContactForm (no email)")]]},
    "HTTP \u2013 Fetch Homepage":{"main":[[c("Extract Email (Homepage)")]]},
    "Extract Email (Homepage)":{"main":[[c("IF Email Found (Home)")]]},
    "IF Email Found (Home)":{"main":[[c("Set Contact Method")],[c("HTTP \u2013 Fetch /contact")]]},
    "HTTP \u2013 Fetch /contact":{"main":[[c("Extract Email (/contact)")]]},
    "Extract Email (/contact)":{"main":[[c("Set Contact Method")]]},
    "Set Contact Method":{"main":[[c("IF ContactMethod = Email")]]},
    "IF ContactMethod = Email":{"main":[[c("AI \u2013 Draft Email")],[c("Queue ContactForm (no email)")]]},
    "AI \u2013 Draft Email":{"main":[[c("Merge Draft")]]},
    "Merge Draft":{"main":[[c("Sheets \u2013 Append Lead")]]},
    "Queue ContactForm (no email)":{"main":[[c("Sheets \u2013 Append Lead")]]},
    # --- SENDER ---
    "Sender \u2013 Every 10 min":{"main":[[c("Config \u2013 Sender")]]},
    "Config \u2013 Sender":{"main":[[c("Sheets \u2013 Read Leads (send)")]]},
    "Sheets \u2013 Read Leads (send)":{"main":[[c("Select One Queued (6am-9pm + cap)")]]},
    "Select One Queued (6am-9pm + cap)":{"main":[[c("IF mode=send")]]},
    "IF mode=send":{"main":[[c("Wait Random")],[]]},
    "Wait Random":{"main":[[c("Gmail \u2013 Send")]]},
    "Gmail \u2013 Send":{"main":[[c("Sheets \u2013 Update Row (sent)")]]},
    "Sheets \u2013 Update Row (sent)":{"main":[[c("Increment Sent Counter")]]},
    # --- FOLLOWUP ---
    "Followup \u2013 Weekdays 9:15":{"main":[[c("Config \u2013 Followup")]]},
    "Config \u2013 Followup":{"main":[[c("Sheets \u2013 Read Leads (followup)")]]},
    "Sheets \u2013 Read Leads (followup)":{"main":[[c("Bucket Leads")]]},
    "Bucket Leads":{"main":[[c("Build Interested Alert"),c("Build No-Response Alert"),c("Build Timing Alert")]]},
    "Build Interested Alert":{"main":[[c("IF Send Interested Alert")]]},
    "IF Send Interested Alert":{"main":[[c("Telegram \u2013 Interested Alert")],[]]},
    "Build No-Response Alert":{"main":[[c("IF Send No-Response Alert")]]},
    "IF Send No-Response Alert":{"main":[[c("Telegram \u2013 No-Response Alert")],[]]},
    "Build Timing Alert":{"main":[[c("IF Send Timing Alert")]]},
    "IF Send Timing Alert":{"main":[[c("Telegram \u2013 Timing Alert")],[]]},
    # --- TELEGRAM BOT ---
    "Telegram Trigger":{"main":[[c("Config \u2013 Telegram")]]},
    "Config \u2013 Telegram":{"main":[[c("Parse Command")]]},
    "Parse Command":{"main":[[c("Switch Command")]]},
    "Switch Command":{"main":[
        [c("Sheets \u2013 Read Leads (bot)")],   # today
        [c("Sheets \u2013 Read Leads (bot)")],   # due
        [c("Sheets \u2013 Read Leads (bot)")],   # top10
        [c("Sheets \u2013 Append Portfolio")],   # addportfolio
        [c("Telegram \u2013 Help Reply")],       # help
    ]},
    "Sheets \u2013 Read Leads (bot)":{"main":[[c("Format Bot Reply")]]},
    "Format Bot Reply":{"main":[[c("Telegram \u2013 Bot Reply")]]},
    "Sheets \u2013 Append Portfolio":{"main":[[c("Telegram \u2013 Portfolio Confirm")]]},
}

merged = {"name":"Core Exteriors \u2013 Complete Outreach System",
          "nodes":all_nodes,"connections":connections,"active":False,"versionId":"1"}

out = os.path.join(base, "core_exteriors_combined.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(merged, f, indent=2, ensure_ascii=False)

print(f"Done! {len(all_nodes)} nodes written to: {out}")
