/*
 * Core Exteriors CRM screen — one file, two homes:
 *   - the manager dashboard (admin.html → CRM tab), fed by the Mac's sync through /api/quick-leads?kind=crm
 *   - the Mac's local page (core-exteriors-agents, localhost:4640/crm), fed live by crm.mjs
 *
 *   const crm = CoreCRM.mount(hostElement, {
 *     mode: "embedded" | "full",        // embedded = tab inside another page; full = its own page with a sidebar
 *     theme: "dark" | "light" | "auto",
 *     adapter: {
 *       load(): Promise<data>,          // snapshot: contacts, opps, tasks, activity, drafts, … (+ data.sync for the cloud)
 *       act(op, body): Promise<{ ok, error?, queued? }>,
 *       chat?(agent, message, sessionId, onEvent): Promise<void>,      // live agent (Mac)
 *       ask?(agent, message, sessionId): Promise<ask>, asks?(): Promise<ask[]>,  // queued agent (cloud)
 *     },
 *     salesLeads?(): lead[],            // admin Sales records, linked by email / estimate number
 *     onOpenSale?(lead), onData?(data),
 *   });
 *   crm.reload(); crm.openContact(id); crm.show(view); crm.data;
 *
 * Renders inside a shadow root so its styles and the host page's never touch.
 * Drafts only: nothing in here sends, posts or charges anything.
 */
(function () {
  const NAV = [
    ["dashboard", "Dashboard", "◧"], ["conversations", "Conversations", "✉"], ["contacts", "Contacts", "☺"],
    ["opportunities", "Opportunities", "▥"], ["calendar", "Calendar", "▦"], ["payments", "Payments", "$"],
    ["marketing", "Marketing", "✎"], ["reputation", "Reputation", "★"], ["automations", "Automations", "↻"],
  ];
  const TEST_EMAILS = ["luke@niccai.com", "corexteriors@gmail.com"];
  const AGENTS = ["chief", "sales", "books", "office", "crew", "studio", "presence", "research"];

  const CSS = `
  :host { display: block; }
  .root {
    --navy: #002147; --gold: #C9A84C;
    --bg: #f4f5f7; --panel: #ffffff; --solid: #ffffff; --ink: #1a1f2b; --ink-2: #444c5c; --muted: #6b7385; --line: #e3e6ec; --soft: #f3efe2;
    --bar: #002147; --track: #eceff4; --hover: #f4f5f7; --primary: #002147; --on-primary: #fff;
    --good: #1e7a46; --warn: #a15c00; --bad: #b3261e; --shadow: 0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.08);
    color: var(--ink); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
  }
  .root.dark {
    --bg: #0b111b; --panel: #121a27; --solid: #121a27; --ink: #e8ebf1; --ink-2: #c3c9d5; --muted: #8b94a7; --line: #233046; --soft: #2a2615;
    --bar: #C9A84C; --track: #1c2638; --hover: #172133; --primary: #C9A84C; --on-primary: #002147;
    --good: #5cc28a; --warn: #e6a64a; --bad: #f2867c; --shadow: none;
  }
  /* Inside the manager dashboard: sit on its navy gradient. */
  .root.embedded.dark { --bg: rgba(255,255,255,.04); --panel: rgba(255,255,255,.05); --solid: #0f1d36; --line: rgba(255,255,255,.1); --track: rgba(255,255,255,.08); --hover: rgba(255,255,255,.06); --ink: #fff; --ink-2: rgba(255,255,255,.75); --muted: rgba(255,255,255,.5); --soft: rgba(201,168,76,.16); }
  * { box-sizing: border-box; }
  button, input, select, textarea { font: inherit; color: inherit; }
  a { color: inherit; }
  .full { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 100vh; background: var(--bg); }
  .side { background: var(--navy); color: #fff; display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; }
  .brand { padding: 16px 16px 14px; border-bottom: 3px solid var(--gold); }
  .brand b { display: block; font-size: 15px; }
  .brand span { color: var(--gold); font-size: 12px; letter-spacing: .4px; text-transform: uppercase; }
  .nav { display: flex; flex-direction: column; padding: 10px 8px; gap: 2px; overflow-y: auto; }
  .nav button { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; border: 0; background: none; color: rgba(255,255,255,.82); cursor: pointer; text-align: left; }
  .nav button:hover { background: rgba(255,255,255,.08); color: #fff; }
  .nav button[aria-current="page"] { background: var(--gold); color: var(--navy); font-weight: 600; }
  .nav i { font-style: normal; width: 18px; text-align: center; }
  .nav em { margin-left: auto; font-style: normal; font-size: 11px; background: rgba(255,255,255,.16); border-radius: 999px; padding: 0 7px; }
  .nav button[aria-current="page"] em { background: rgba(0,33,71,.15); }
  .side .foot { margin-top: auto; padding: 12px 16px; font-size: 12px; color: rgba(255,255,255,.6); border-top: 1px solid rgba(255,255,255,.1); }
  .subnav { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
  .subnav button { display: flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--ink-2); cursor: pointer; white-space: nowrap; font-size: 13px; }
  .subnav button[aria-current="page"] { background: var(--gold); color: var(--navy); border-color: var(--gold); font-weight: 600; }
  .subnav em { font-style: normal; font-size: 11px; background: var(--soft); border-radius: 999px; padding: 0 6px; }
  .subnav i { font-style: normal; }
  .main { min-width: 0; display: flex; flex-direction: column; }
  .top { display: flex; align-items: center; gap: 10px; padding: 12px 20px; background: var(--panel); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5; flex-wrap: wrap; }
  .embedded .top { position: static; background: none; border: 0; padding: 0 0 12px; }
  .top h1 { font-size: 18px; margin: 0; margin-right: auto; }
  .search { width: 260px; max-width: 100%; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
  .btn { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 7px 12px; cursor: pointer; white-space: nowrap; }
  .btn:hover { border-color: var(--muted); }
  .btn:disabled { opacity: .5; cursor: default; }
  .btn.primary { background: var(--primary); color: var(--on-primary); border-color: var(--primary); }
  .btn.gold { background: var(--gold); color: var(--navy); border-color: var(--gold); font-weight: 600; }
  .btn.sm { padding: 3px 9px; font-size: 12px; border-radius: 6px; }
  .btn.link { border: 0; background: none; padding: 0; color: var(--ink-2); cursor: pointer; }
  .content { padding: 20px; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .embedded .content { padding: 0; }
  .syncbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--muted); padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
  .syncbar.stale { border-color: var(--warn); color: var(--warn); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(165px, 1fr)); gap: 12px; }
  .tile { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; box-shadow: var(--shadow); }
  .tile b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; letter-spacing: -.3px; }
  .tile span { color: var(--muted); font-size: 12px; }
  .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr)); gap: 16px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); min-width: 0; }
  .panel > h2 { font-size: 13px; margin: 0; padding: 12px 16px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 8px; }
  .panel > h2 small { color: var(--muted); font-weight: 400; margin-left: auto; }
  .empty { color: var(--muted); padding: 16px; margin: 0; }
  .muted { color: var(--muted); }
  .num { font-variant-numeric: tabular-nums; }
  .bars { padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 9px; }
  .bar-row { display: grid; grid-template-columns: 110px 1fr 96px; gap: 10px; align-items: center; }
  .bar-row .lbl { color: var(--ink-2); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar-row .trk { display: block; height: 12px; background: var(--track); border-radius: 0 4px 4px 0; }
  .bar-row .fill { display: block; height: 100%; background: var(--bar); border-radius: 0 4px 4px 0; min-width: 2px; }
  .bar-row:hover .fill { filter: brightness(1.2); }
  .bar-row .val { font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
  .tip { position: fixed; pointer-events: none; background: var(--ink); color: var(--solid); font-size: 12px; padding: 6px 9px; border-radius: 6px; z-index: 50; display: none; max-width: 260px; }
  .rows { display: flex; flex-direction: column; }
  .r { display: flex; gap: 10px; align-items: flex-start; padding: 10px 16px; border-top: 1px solid var(--line); text-decoration: none; }
  .r:first-child { border-top: 0; }
  .r .grow { flex: 1; min-width: 0; }
  .r .t { font-weight: 600; }
  .r .s { color: var(--muted); font-size: 12px; }
  pre { white-space: pre-wrap; font: inherit; color: var(--ink-2); margin: 6px 0 0; font-size: 13px; }
  .pill { display: inline-block; font-size: 11px; background: var(--soft); color: var(--ink-2); border-radius: 999px; padding: 1px 8px; margin: 0 4px 0 0; white-space: nowrap; }
  .pill.navy { background: var(--navy); color: #fff; }
  .embedded.dark .pill.navy { background: var(--gold); color: var(--navy); }
  .st { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; }
  .st.good { color: var(--good); } .st.warn { color: var(--warn); } .st.bad { color: var(--bad); }
  .clickable { cursor: pointer; }
  .clickable:hover .t, .clickable:hover .name { text-decoration: underline; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 9px 12px; border-top: 1px solid var(--line); vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: var(--muted); font-weight: 600; border-top: 0; }
  tbody tr.clickable:hover { background: var(--hover); }
  .tablewrap { overflow-x: auto; }
  .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .toolbar select { padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--solid); }
  .board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(230px, 1fr); gap: 12px; overflow-x: auto; padding-bottom: 8px; }
  .col { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; display: flex; flex-direction: column; min-height: 160px; }
  .col.over { outline: 2px dashed var(--gold); }
  .col h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; padding: 10px 12px; border-bottom: 1px solid var(--line); color: var(--muted); }
  .col h3 em { float: right; font-style: normal; color: var(--ink); text-transform: none; }
  .cards { padding: 8px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
  .card { border: 1px solid var(--line); border-left: 3px solid var(--gold); border-radius: 8px; padding: 8px 10px; background: var(--bg); cursor: grab; }
  .card.drag { opacity: .4; }
  .card.pending { border-style: dashed; }
  .card .name { font-weight: 600; cursor: pointer; }
  .card .m { color: var(--muted); font-size: 12px; }
  select.mini { margin-top: 6px; width: 100%; font-size: 12px; padding: 3px; border-radius: 6px; border: 1px solid var(--line); background: var(--solid); }
  .old { color: var(--bad); }
  .cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
  .cal .dow { font-size: 11px; color: var(--muted); padding: 6px 8px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); text-transform: uppercase; }
  .cal .day { min-height: 96px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 4px 6px; font-size: 12px; overflow: hidden; }
  .cal .day.out { background: var(--bg); color: var(--muted); }
  .cal .day.today .d { background: var(--gold); color: var(--navy); border-radius: 999px; padding: 0 6px; font-weight: 700; }
  .ev { display: block; margin-top: 3px; padding: 2px 6px; border-radius: 4px; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; border: 0; width: 100%; text-align: left; }
  .ev.job { background: var(--navy); color: #fff; }
  .embedded.dark .ev.job { background: var(--gold); color: var(--navy); }
  .ev.task { background: var(--soft); color: var(--ink); }
  .ev.post { background: transparent; color: var(--ink-2); border: 1px dashed var(--line); }
  .convo { display: grid; grid-template-columns: 300px 1fr; min-height: 560px; }
  .convo .list { border-right: 1px solid var(--line); overflow-y: auto; max-height: 75vh; }
  .convo .list .r.on { background: var(--hover); box-shadow: inset 3px 0 0 var(--gold); }
  .thread { padding: 16px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; max-height: 75vh; }
  .bubble { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; max-width: 760px; }
  .bubble.out { align-self: flex-end; background: var(--bg); border-color: var(--gold); }
  .bubble.sys { align-self: center; border: 0; color: var(--muted); font-size: 12px; padding: 2px; text-align: center; }
  .bubble .h { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .bubble pre { margin: 0; color: var(--ink); }
  details summary { cursor: pointer; color: var(--ink-2); }
  .drawer, .agent { position: fixed; top: 0; right: 0; height: 100vh; width: min(520px, 100vw); background: var(--solid); color: var(--ink); border-left: 1px solid var(--line); box-shadow: -8px 0 24px rgba(0,0,0,.25); z-index: 2000; transform: translateX(105%); transition: transform .18s ease; display: flex; flex-direction: column; }
  .drawer.open, .agent.open { transform: none; }
  .agent { width: min(440px, 100vw); z-index: 2010; }
  .dh { padding: 14px 16px; border-bottom: 1px solid var(--line); display: flex; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
  .dh h2 { margin: 0; font-size: 17px; }
  .dh .x { margin-left: auto; }
  .db { overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 16px; }
  .db h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .4px; color: var(--muted); margin: 0 0 6px; }
  .kv { display: grid; grid-template-columns: 90px 1fr; gap: 4px 10px; font-size: 13px; margin: 0; }
  .kv dt { color: var(--muted); } .kv dd { margin: 0; overflow-wrap: anywhere; }
  .box { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  .box.sale { border-color: var(--gold); }
  .acts { display: flex; gap: 6px; flex-wrap: wrap; }
  .tl { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
  .tl div { border-left: 2px solid var(--line); padding-left: 10px; }
  .tl small { color: var(--muted); display: block; }
  textarea, .field input, .field select { width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--solid); }
  .alog { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
  .alog .me { align-self: flex-end; background: var(--navy); color: #fff; border-radius: 12px 12px 2px 12px; padding: 8px 12px; max-width: 85%; white-space: pre-wrap; }
  .alog .bot { background: var(--bg); border-radius: 12px 12px 12px 2px; padding: 8px 12px; max-width: 95%; }
  .alog .bot p { margin: 0 0 6px; } .alog .bot ul { margin: 0 0 6px; padding-left: 18px; }
  .alog .tool { font-size: 12px; color: var(--muted); }
  .alog .err { color: var(--bad); font-size: 13px; }
  .aform { border-top: 1px solid var(--line); padding: 10px 12px; display: flex; gap: 8px; align-items: flex-end; }
  .aform textarea { resize: none; min-height: 40px; max-height: 160px; }
  .scrim { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 1990; display: none; }
  .scrim.on { display: block; }
  dialog { border: 1px solid var(--line); border-radius: 12px; padding: 0; background: var(--solid); color: var(--ink); width: min(520px, 94vw); }
  dialog::backdrop { background: rgba(0,0,0,.45); }
  dialog form { padding: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  dialog h2 { grid-column: 1 / -1; margin: 0 0 4px; font-size: 16px; }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
  .field.full { grid-column: 1 / -1; }
  dialog .acts { grid-column: 1 / -1; justify-content: flex-end; margin-top: 4px; }
  .note { font-size: 12px; color: var(--muted); margin: 0; }
  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--ink); color: var(--solid); padding: 8px 14px; border-radius: 8px; z-index: 2100; display: none; max-width: 90vw; }
  @media (max-width: 860px) {
    .full { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 1fr; }
    .side { position: static; height: auto; min-width: 0; }
    .brand, .side .foot { display: none; }
    .nav { flex-direction: row; overflow-x: auto; padding: 6px; }
    .nav button { white-space: nowrap; }
    .top, .full .content { padding-left: 16px; padding-right: 16px; }
    .search { width: 100%; order: 5; }
    .convo { grid-template-columns: 1fr; }
    .convo .list { max-height: 260px; border-right: 0; border-bottom: 1px solid var(--line); }
    .cal .day { min-height: 64px; padding: 2px; }
    .cal .dow { padding: 4px 2px; font-size: 10px; }
    .ev { padding: 1px 3px; font-size: 10px; }
    .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .bar-row { grid-template-columns: 84px 1fr 80px; }
    dialog form { grid-template-columns: 1fr; }
  }`;

  const DIALOGS = `
  <dialog data-dlg="lead"><form method="dialog">
    <h2>Add lead</h2>
    <label class="field">Name<input name="name" required></label>
    <label class="field">Company<input name="company"></label>
    <label class="field">Email<input name="email" type="email"></label>
    <label class="field">Phone<input name="phone"></label>
    <label class="field full">Address<input name="address"></label>
    <label class="field">City<input name="city" value="London"></label>
    <label class="field">Source<select name="source"></select></label>
    <label class="field">Service<input name="service" placeholder="Gutter cleaning"></label>
    <label class="field">Value before HST ($)<input name="value" type="number" min="0" step="1"></label>
    <label class="field">Stage<select name="stage"></select></label>
    <label class="field">Tags (comma)<input name="tags" placeholder="residential"></label>
    <label class="field full">Notes<textarea name="notes" rows="2"></textarea></label>
    <div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Add lead</button></div>
  </form></dialog>
  <dialog data-dlg="task"><form method="dialog">
    <h2>Add task</h2>
    <label class="field">Type<select name="type"><option>call</option><option>text</option><option>email</option><option>visit</option><option>todo</option></select></label>
    <label class="field">Due<input name="due" type="date" required></label>
    <label class="field full">Title<input name="title" required></label>
    <label class="field full">Notes / script<textarea name="script" rows="3"></textarea></label>
    <div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Add task</button></div>
  </form></dialog>
  <dialog data-dlg="lost"><form method="dialog">
    <h2>Why was it lost?</h2>
    <label class="field full">Reason<select name="reason"></select></label>
    <div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Move to Lost</button></div>
  </form></dialog>
  <dialog data-dlg="post"><form method="dialog">
    <h2>Plan a social post</h2>
    <label class="field">Platform<select name="platform"><option>facebook</option><option>instagram</option><option>google</option></select></label>
    <label class="field">Date<input name="when" type="date" required></label>
    <label class="field full">Text<textarea name="text" rows="4" required></textarea></label>
    <label class="field full">Image (path or note)<input name="image"></label>
    <p class="note" style="grid-column:1/-1">Saved as a draft. You post it yourself.</p>
    <div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Save draft</button></div>
  </form></dialog>
  <dialog data-dlg="value"><form method="dialog">
    <h2>Card details</h2>
    <label class="field">Value before HST ($)<input name="value" type="number" min="0" step="1"></label>
    <label class="field">Service<input name="service"></label>
    <label class="field">Job date<input name="date" type="date"></label>
    <label class="field">Start time<input name="time" type="time"></label>
    <label class="field full">Job notes<input name="notes"></label>
    <div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Save</button></div>
  </form></dialog>
  <dialog data-dlg="tag"><form method="dialog">
    <h2>Add a tag</h2>
    <label class="field full">Tag<input name="tag" required placeholder="vip, commercial, referral…"></label>
    <div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Add</button></div>
  </form></dialog>`;

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cad = (n, dp = 0) => "$" + Number(n || 0).toLocaleString("en-CA", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const norm = (e) => String(e || "").trim().toLowerCase();
  const day = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  const today = () => day(new Date());
  const fdate = (iso, opts = { month: "short", day: "numeric" }) => iso ? new Date(String(iso).length === 10 ? iso + "T12:00" : iso).toLocaleDateString("en-CA", opts) : "";
  const ftime = (iso) => iso ? new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const ago = (iso) => { const m = Math.floor((Date.now() - Date.parse(iso)) / 60000); if (m < 1) return "just now"; if (m < 60) return `${m} min ago`; const h = Math.floor(m / 60); if (h < 24) return `${h} h ago`; const d = Math.floor(h / 24); return d === 1 ? "yesterday" : `${d} days ago`; };
  const money = (v) => Number(String(v ?? "").replace(/[$,\s]/g, "")) || 0;
  function md(src) {
    const inline = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    const out = []; let list = null;
    for (const line of String(src || "").split("\n")) {
      const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
      if (li) { (list ||= []).push("<li>" + inline(li[1]) + "</li>"); continue; }
      if (list) { out.push("<ul>" + list.join("") + "</ul>"); list = null; }
      const h = line.match(/^#{1,4}\s+(.*)/);
      if (h) out.push("<p><b>" + inline(h[1]) + "</b></p>"); else if (line.trim()) out.push("<p>" + inline(line) + "</p>");
    }
    if (list) out.push("<ul>" + list.join("") + "</ul>");
    return out.join("");
  }

  function mount(host, opts = {}) {
    const mode = opts.mode === "full" ? "full" : "embedded";
    const ad = opts.adapter;
    const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    const dark = opts.theme === "dark" || (opts.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    const rootCls = `root ${mode} ${dark ? "dark" : ""}`;
    const topbar = `<header class="top"><h1 data-el="title">Dashboard</h1>
        <input class="search" data-el="q" type="search" placeholder="Search contacts…" aria-label="Search contacts">
        <button class="btn" data-act="ask">Ask an agent</button>
        <button class="btn gold" data-act="new-lead">+ Add lead</button></header>`;
    shadow.innerHTML = `<style>${CSS}</style><div class="${rootCls}">
      ${mode === "full"
        ? `<div class="full"><aside class="side"><div class="brand"><b>Core Exteriors</b><span>CRM</span></div><nav class="nav" data-el="nav"></nav>
            <div class="foot">Drafts only. Nothing here sends, posts or charges.<br><a href="/">Full agent chat →</a></div></aside>
            <div class="main">${topbar}<main class="content" data-el="view"><p class="empty">Loading…</p></main></div></div>`
        : `<div class="main">${topbar}<div class="content"><nav class="subnav" data-el="nav"></nav><div data-el="sync"></div>
            <div data-el="view" style="display:flex;flex-direction:column;gap:16px"><p class="empty">Loading…</p></div></div></div>`}
      <div class="scrim" data-el="scrim"></div>
      <aside class="drawer" data-el="drawer" aria-label="Contact"></aside>
      <aside class="agent" data-el="agent" aria-label="Ask an agent">
        <div class="dh"><div><h2>Ask an agent</h2><p class="note" data-el="anote"></p></div>
          <select data-el="agentSel" aria-label="Agent" style="margin-left:auto;padding:5px;border:1px solid var(--line);border-radius:6px;background:var(--solid)">${AGENTS.map((a) => `<option>${a}</option>`).join("")}</select>
          <button class="btn sm" data-act="agent-new">New</button><button class="btn sm" data-act="agent-close" aria-label="Close">✕</button></div>
        <div class="alog" data-el="alog"></div>
        <form class="aform" data-el="aform"><textarea data-el="amsg" rows="1" placeholder="Message… (Enter to send)"></textarea><button class="btn primary" data-el="ago">Send</button></form>
      </aside>
      ${DIALOGS}<div class="tip" data-el="tip"></div><div class="toast" data-el="toast"></div></div>`;
    const R = shadow.querySelector(".root");
    const el = (n) => R.querySelector(`[data-el="${n}"]`);
    const qs = (s) => R.querySelector(s);
    const queueAgent = !ad.chat;
    el("anote").textContent = queueAgent ? "Runs on your Mac with Claude Code. Drafts only; answers arrive in a minute or two." : "Claude Code (opus · medium). Drafts only.";

    let D = null, view = "dashboard", openContact = null, q = "", tagFilter = "", srcFilter = "", showLost = false, calMonth = null, convoKey = null;

    const contactById = (id) => D.contacts.find((c) => c.id === id);
    const oppsOf = (cid) => D.opps.filter((o) => o.contactId === cid).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const latestOpp = (cid) => oppsOf(cid)[0];
    const contactByEmail = (e) => D.contacts.find((c) => norm(c.email) === norm(e));
    const draftsOf = (c) => c.email ? D.drafts.filter((d) => norm(d.to) === norm(c.email)) : [];
    const lastTouch = (c) => [...D.activity.filter((x) => x.contactId === c.id).map((x) => x.at), ...draftsOf(c).map((x) => x.createdAt), c.updatedAt].filter(Boolean).sort().pop();
    const salesFor = (c) => {
      const leads = (opts.salesLeads && opts.salesLeads()) || [];
      const ests = oppsOf(c.id).map((o) => norm(o.estimateNumber)).filter(Boolean);
      return leads.filter((l) => (c.email && norm(l.email) === norm(c.email)) || (l.estimateNumber && ests.includes(norm(l.estimateNumber))));
    };

    function toast(msg) { const t = el("toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(t._h); t._h = setTimeout(() => (t.style.display = "none"), 3200); }

    async function load(force = true) {
      try {
        D = await ad.load();
      } catch (e) {
        el("view").innerHTML = `<p class="empty">Could not load the CRM: ${esc(e.message || e)}</p>`;
        return;
      }
      if (!D || !Array.isArray(D.contacts)) {
        el("view").innerHTML = `<p class="empty">${esc(D?.message || "No CRM data yet. It appears once your Mac's watcher syncs (every few minutes while it's on).")}</p>`;
        if (mode !== "full") el("sync").innerHTML = "";
        return;
      }
      opts.onData?.(D);
      render(force);
    }

    async function act(op, body = {}) {
      const out = await ad.act(op, body).catch((e) => ({ ok: false, error: e.message }));
      if (!out || !out.ok) { alert(out?.error || "That didn't work."); return null; }
      if (out.queued) toast("Saved. Your Mac applies it within a minute.");
      await load();
      return out;
    }

    // ---------- shell ----------
    function counts() {
      return {
        conversations: convoList().filter((x) => x.drafts.length).length,
        contacts: D.contacts.length,
        opportunities: D.opps.filter((o) => D.openStages.includes(o.stage)).length,
        payments: D.opps.filter((o) => o.stage === "Invoiced").length,
      };
    }
    function nav() {
      const c = counts();
      el("nav").innerHTML = NAV.map(([k, label, icon]) => `<button data-view="${k}" ${k === view ? 'aria-current="page"' : ""}><i>${icon}</i>${label}${c[k] ? `<em>${c[k]}</em>` : ""}</button>`).join("");
    }
    function syncbar() {
      if (mode === "full" || !D.sync) return;
      const s = D.sync;
      const stale = !s.syncedAt || Date.now() - Date.parse(s.syncedAt) > 15 * 60000;
      const failed = (s.results || []).filter((r) => !r.ok && Date.now() - Date.parse(r.at) < 864e5);
      el("sync").innerHTML = `<div class="syncbar ${stale ? "stale" : ""}">
        <span>${stale ? "⚠ " : "● "}${s.syncedAt ? `Synced from your Mac ${ago(s.syncedAt)}` : "Not synced yet"}${stale ? ". Changes apply once your Mac and its watcher are on." : ""}</span>
        ${s.pending?.length ? `<span class="pill">${s.pending.length} change${s.pending.length === 1 ? "" : "s"} waiting for your Mac</span>` : ""}
        ${failed.map((r) => `<span class="st bad">✕ ${esc(r.op)}: ${esc(r.error)}</span>`).join("")}
        <span style="margin-left:auto">Drafts only. Nothing here sends, posts or charges.</span></div>`;
    }
    function render(force = true) {
      if (!D || !Array.isArray(D.contacts)) return;
      const a = shadow.activeElement;
      const typing = a && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName) && a.dataset.el !== "q";
      if (!force && (typing || qs("dialog[open]"))) return;
      nav(); syncbar();
      el("title").textContent = mode === "full" ? NAV.find((n) => n[0] === view)[1] : "CRM";
      el("view").innerHTML = VIEWS[view]();
      const th = qs(".thread"); if (th) th.scrollTop = th.scrollHeight;
      if (openContact) drawer(openContact, !force);
    }
    function show(v) {
      if (!NAV.some((n) => n[0] === v)) v = "dashboard";
      closeDrawer(); view = v;
      if (mode === "full" && location.hash.slice(1) !== v) history.replaceState(null, "", "#" + v);
      render();
    }

    // ---------- charts ----------
    function bars(rows, fmt, tipFn) {
      const max = Math.max(1, ...rows.map((r) => r.v));
      if (!rows.length) return `<p class="empty">Nothing yet.</p>`;
      return `<div class="bars" role="table">${rows.map((r) => `
        <div class="bar-row" role="row" data-tip="${esc(tipFn(r))}">
          <span class="lbl" role="cell">${esc(r.k)}</span>
          <span class="trk" role="cell"><span class="fill" style="width:${(r.v / max) * 100}%;${r.v ? "" : "min-width:0"}"></span></span>
          <span class="val" role="cell">${esc(fmt(r))}</span></div>`).join("")}</div>`;
    }
    const tile = (b, s) => `<div class="tile"><b>${esc(b)}</b><span>${esc(s)}</span></div>`;

    // ---------- views ----------
    const VIEWS = {
      dashboard() {
        const r = D.report || {};
        const open = D.opps.filter((o) => D.openStages.includes(o.stage));
        const paid30 = D.opps.filter((o) => o.paidAt && Date.now() - Date.parse(o.paidAt) < 30 * 864e5);
        const unpaid = D.opps.filter((o) => o.stage === "Invoiced");
        const stageRows = D.stages.filter((s) => s !== "Lost").map((s) => { const l = D.opps.filter((o) => o.stage === s); return { k: s, v: l.reduce((t, o) => t + (o.value || 0), 0), n: l.length }; });
        const srcRows = Object.entries(r.bySource || {}).map(([k, v]) => ({ k, v: v.leads, won: v.won, wv: v.wonValue })).sort((a, b) => b.v - a.v);
        const t = today();
        const tasks = D.tasks.filter((x) => !x.done && x.due <= t).sort((a, b) => a.due.localeCompare(b.due));
        const soon = D.opps.filter((o) => o.stage === "Booked" && o.booked?.when).sort((a, b) => a.booked.when.localeCompare(b.booked.when));
        const stale = open.filter((o) => o.daysInStage > 7 && !["Booked", "Invoiced"].includes(o.stage));
        const waiting = D.drafts.filter((d) => !d.sent && !TEST_EMAILS.includes(norm(d.to)) && Date.now() - Date.parse(d.createdAt) < 3 * 864e5);
        const late = unpaid.filter((o) => Date.now() - Date.parse(o.invoicedAt || o.stageAt) > 7 * 864e5);
        const feed = D.activity.filter((a) => a.contactId).slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 12);
        return `
        <div class="tiles">
          ${tile(cad(r.openPipelineValue), `open pipeline · ${open.length} cards`)}
          ${tile(cad(unpaid.reduce((s, o) => s + (o.invoice?.amount || o.value || 0), 0)), `unpaid invoices · ${unpaid.length}`)}
          ${tile(cad(r.wonValue), `won, last 30 days · ${r.won ?? 0}`)}
          ${tile(cad(paid30.reduce((s, o) => s + (o.invoice?.amount || o.value || 0), 0)), "collected, 30 days")}
          ${tile(r.leads ?? 0, "new leads, 30 days")}
          ${tile((r.winRate ?? 0) + "%", "win rate, 30 days")}
          ${tile(r.medianHoursToQuote == null ? "—" : r.medianHoursToQuote + " h", "lead → quote sent")}
        </div>
        <div class="grid2">
          <section class="panel"><h2>Pipeline value by stage <small>before HST</small></h2>
            ${bars(stageRows, (x) => [x.v ? cad(x.v) : "", x.n ? `${x.n} card${x.n === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "), (x) => `${x.k}: ${x.n} card${x.n === 1 ? "" : "s"}, ${cad(x.v)}`)}</section>
          <section class="panel"><h2>Leads by source <small>last 30 days</small></h2>
            ${bars(srcRows, (x) => String(x.v), (x) => `${x.k}: ${x.v} lead${x.v === 1 ? "" : "s"}, ${x.won} won (${cad(x.wv)})`)}</section>
        </div>
        <div class="grid2">
          <section class="panel"><h2>Today <small>${fdate(t, { weekday: "long", month: "long", day: "numeric" })}</small></h2><div class="rows">
            ${tasks.map(taskRow).join("")}
            ${soon.slice(0, 6).map((o) => { const c = contactById(o.contactId) || {}; return `<div class="r clickable" data-contact="${c.id}"><span class="pill navy">job</span><div class="grow"><div class="t">${esc(c.name)} · ${esc(o.service)}</div><div class="s">${esc(ftime(o.booked.when))} · ${esc(c.address || "")} · ${cad(o.value)}</div></div></div>`; }).join("")}
            ${!tasks.length && !soon.length ? `<p class="empty">No tasks due and no jobs booked.</p>` : ""}</div></section>
          <section class="panel"><h2>Needs attention</h2><div class="rows">
            ${waiting.length ? `<div class="r clickable" data-view="conversations"><span class="st warn">●</span><div class="grow"><div class="t">${waiting.length} draft${waiting.length === 1 ? "" : "s"} waiting in Gmail</div><div class="s">Written in the last 3 days. Review and send them yourself.</div></div></div>` : ""}
            ${stale.map((o) => { const c = contactById(o.contactId) || {}; return `<div class="r clickable" data-contact="${c.id}"><span class="st bad">●</span><div class="grow"><div class="t">${esc(c.name)}</div><div class="s">${o.daysInStage} days in ${esc(o.stage)} · ${esc(o.service || "")}${o.value ? " · " + cad(o.value) : ""}</div></div></div>`; }).join("")}
            ${late.map((o) => { const c = contactById(o.contactId) || {}; return `<div class="r clickable" data-contact="${c.id}"><span class="st warn">●</span><div class="grow"><div class="t">${esc(c.name)} hasn't paid</div><div class="s">Invoiced ${ago(o.invoicedAt || o.stageAt)} · ${cad(o.invoice?.amount || o.value, 2)}</div></div></div>`; }).join("")}
            ${!waiting.length && !stale.length && !late.length ? `<p class="empty">All clear.</p>` : ""}</div></section>
        </div>
        <section class="panel"><h2>Recent activity</h2><div class="rows">${feed.map(feedRow).join("") || `<p class="empty">No activity yet.</p>`}</div></section>`;
      },

      conversations() {
        const list = convoList().filter((x) => !q || (x.name + x.email).toLowerCase().includes(q.toLowerCase()));
        if (!convoKey || !list.some((x) => x.key === convoKey)) convoKey = list[0]?.key || null;
        const cur = list.find((x) => x.key === convoKey);
        return `<section class="panel convo">
          <div class="list rows">${list.map((x) => `
            <div class="r clickable ${x.key === convoKey ? "on" : ""}" data-convo="${esc(x.key)}">
              <div class="grow"><div class="t">${esc(x.name)}${x.contact ? "" : ` <span class="pill">not in CRM</span>`}</div>
              <div class="s">${esc(x.lastSubject || "")}</div><div class="s">${esc(ftime(x.last))}</div></div>
              ${x.drafts.length ? `<span class="pill">${x.drafts.length}</span>` : ""}</div>`).join("") || `<p class="empty">No conversations.</p>`}</div>
          <div class="thread">${cur ? thread(cur) : `<p class="empty">Pick a conversation.</p>`}</div></section>`;
      },

      contacts() {
        const tags = [...new Set(D.contacts.flatMap((c) => c.tags || []))].sort();
        const list = D.contacts.filter((c) => (!q || JSON.stringify(c).toLowerCase().includes(q.toLowerCase())) && (!tagFilter || (c.tags || []).includes(tagFilter)))
          .map((c) => ({ c, o: latestOpp(c.id), last: lastTouch(c), sale: salesFor(c)[0] })).sort((a, b) => String(b.last).localeCompare(String(a.last)));
        return `<div class="toolbar"><select data-el="tagSel" aria-label="Filter by tag"><option value="">All tags</option>${tags.map((t) => `<option ${t === tagFilter ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
            <span class="muted">${list.length} contact${list.length === 1 ? "" : "s"}</span></div>
          <section class="panel tablewrap"><table>
            <thead><tr><th>Name</th><th>Contact</th><th>Stage</th><th>Value</th><th>Tags</th><th>Last activity</th></tr></thead>
            <tbody>${list.map(({ c, o, last, sale }) => `<tr class="clickable" data-contact="${c.id}">
              <td><div class="name" style="font-weight:600">${esc(c.name)}${c.dnd ? ` <span class="st bad">DND</span>` : ""}</div><div class="muted" style="font-size:12px">${esc(c.company || c.address || "")}</div>${sale ? `<span class="pill">Sales: ${esc(sale.status || "")}</span>` : ""}</td>
              <td style="font-size:13px">${esc(c.email || "")}<div class="muted">${esc(c.phone || "")}</div></td>
              <td>${o ? `<span class="pill">${esc(o.stage)}</span>` : ""}</td>
              <td class="num">${o?.value ? cad(o.value) : ""}</td>
              <td>${(c.tags || []).map((t) => `<span class="pill">${esc(t)}</span>`).join("")}</td>
              <td class="muted" style="font-size:12px">${last ? ago(last) : ""}</td></tr>`).join("")}</tbody></table>
            ${list.length ? "" : `<p class="empty">No contacts match.</p>`}</section>`;
      },

      opportunities() {
        const srcs = [...new Set(D.opps.map((o) => o.source).filter(Boolean))];
        const cols = D.stages.filter((s) => showLost || s !== "Lost");
        const opps = D.opps.filter((o) => (!srcFilter || o.source === srcFilter) && (!q || JSON.stringify(contactById(o.contactId) || {}).toLowerCase().includes(q.toLowerCase())));
        return `<div class="toolbar">
            <select data-el="srcSel" aria-label="Filter by source"><option value="">All sources</option>${srcs.map((s) => `<option ${s === srcFilter ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
            <label class="muted"><input type="checkbox" data-el="lostChk" ${showLost ? "checked" : ""}> Show Lost</label>
            <span class="muted">Drag a card to move it, or use its menu.</span></div>
          <div class="board">${cols.map((s) => {
            const l = opps.filter((o) => o.stage === s);
            const tot = l.reduce((t, o) => t + (o.value || 0), 0);
            return `<section class="col" data-stage="${esc(s)}"><h3>${esc(s)} <em>${l.length}${tot ? " · " + cad(tot) : ""}</em></h3><div class="cards">${l.map((o) => {
              const c = contactById(o.contactId) || {};
              return `<div class="card ${o._pending ? "pending" : ""}" draggable="true" data-opp="${o.id}">
                <div class="name" data-contact="${c.id}">${esc(c.name)}</div>
                <div class="m">${esc(o.service || "")}</div>
                <div class="m">${o.value ? `<b class="num">${cad(o.value)}</b>` : ""} ${o.estimateNumber ? "· " + esc(o.estimateNumber) : ""}</div>
                ${o.booked?.when ? `<div class="m">📅 ${esc(ftime(o.booked.when))}</div>` : ""}
                <div class="m ${o.daysInStage > 7 && !["Booked", "Nurture", "Paid", "Review Asked", "Lost"].includes(o.stage) ? "old" : ""}">${o._pending ? "waiting for your Mac" : `${o.daysInStage} day${o.daysInStage === 1 ? "" : "s"} here`} · ${esc(o.source || "")}${o.lostReason ? " · " + esc(o.lostReason) : ""}</div>
                <select class="mini" data-move="${o.id}" aria-label="Move ${esc(c.name)}"><option value="">Move to…</option>${D.stages.filter((x) => x !== s).map((x) => `<option>${esc(x)}</option>`).join("")}</select>
              </div>`; }).join("")}</div></section>`;
          }).join("")}</div>`;
      },

      calendar() {
        const base = calMonth || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const first = new Date(base.getFullYear(), base.getMonth(), 1);
        const start = new Date(first); start.setDate(1 - first.getDay());
        const evs = {};
        const push = (d, html) => (evs[d] ||= []).push(html);
        for (const o of D.opps) if (o.booked?.when) { const c = contactById(o.contactId) || {}; push(day(o.booked.when), `<button class="ev job" data-contact="${c.id}" title="${esc(c.name + " · " + o.service)}">${esc(new Date(o.booked.when).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }))} ${esc(c.name)}</button>`); }
        for (const t of D.tasks) if (!t.done) { const c = contactById(t.contactId) || {}; push(t.due, `<button class="ev task" ${c.id ? `data-contact="${c.id}"` : ""} title="${esc(t.title)}">${esc(t.type)}: ${esc(c.name || t.title)}</button>`); }
        for (const p of D.posts) if (p.status !== "dropped") push(p.when, `<button class="ev post" data-view="marketing" title="${esc(p.text)}">${esc(p.platform)} post</button>`);
        const cells = [];
        for (let i = 0; i < 42; i++) {
          const d = new Date(start); d.setDate(start.getDate() + i);
          const k = day(d);
          cells.push(`<div class="day ${d.getMonth() !== base.getMonth() ? "out" : ""} ${k === today() ? "today" : ""}"><span class="d">${d.getDate()}</span>${(evs[k] || []).join("")}</div>`);
        }
        const upcoming = D.opps.filter((o) => o.booked?.when && o.booked.when >= today()).sort((a, b) => a.booked.when.localeCompare(b.booked.when));
        return `<div class="toolbar"><button class="btn sm" data-cal="-1" aria-label="Previous month">‹</button><b>${base.toLocaleDateString("en-CA", { month: "long", year: "numeric" })}</b><button class="btn sm" data-cal="1" aria-label="Next month">›</button><button class="btn sm" data-cal="0">Today</button>
            <span class="muted"><span class="pill navy">job</span><span class="pill">task</span> dashed = social post</span></div>
          <section class="panel"><div class="cal">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => `<div class="dow">${x}</div>`).join("")}${cells.join("")}</div></section>
          <section class="panel"><h2>Upcoming jobs</h2><div class="rows">${upcoming.map((o) => { const c = contactById(o.contactId) || {}; return `<div class="r clickable" data-contact="${c.id}"><div class="grow"><div class="t">${esc(ftime(o.booked.when))} · ${esc(c.name)}</div><div class="s">${esc(o.service)} · ${esc(c.address || "")} · ${cad(o.value)}</div>${o.booked.notes ? `<pre>${esc(o.booked.notes)}</pre>` : ""}</div></div>`; }).join("") || `<p class="empty">Nothing booked. Set a date on a card in Booked.</p>`}</div></section>`;
      },

      payments() {
        const inv = D.opps.filter((o) => ["Invoiced", "Paid", "Review Asked"].includes(o.stage) || o.invoice);
        const unpaid = inv.filter((o) => o.stage === "Invoiced");
        const paid = inv.filter((o) => o.paidAt);
        const amt = (o) => o.invoice?.amount || o.value || 0;
        const links = D.opps.flatMap((o) => (o.payLinks || []).map((l) => ({ ...l, o })));
        const invDrafts = D.drafts.filter((d) => d.kind === "invoice" && !TEST_EMAILS.includes(norm(d.to)));
        return `<div class="tiles">
            ${tile(cad(unpaid.reduce((t, o) => t + amt(o), 0), 2), `outstanding · ${unpaid.length}`)}
            ${tile(cad(paid.filter((o) => Date.now() - Date.parse(o.paidAt) < 30 * 864e5).reduce((t, o) => t + amt(o), 0), 2), "collected, 30 days")}
            ${tile(cad(paid.reduce((t, o) => t + amt(o), 0), 2), "collected, all time")}
            ${tile(links.filter((l) => l.status === "open").length, "open card pay links")}</div>
          <section class="panel tablewrap"><h2>Invoices <small>e-Transfer to corexteriors@gmail.com · RBC deposits mark them Paid</small></h2><table>
            <thead><tr><th>Client</th><th>Invoice</th><th>Amount</th><th>Invoiced</th><th>Status</th><th></th></tr></thead>
            <tbody>${inv.sort((a, b) => String(b.invoicedAt).localeCompare(String(a.invoicedAt))).map((o) => { const c = contactById(o.contactId) || {}; const days = o.invoicedAt ? Math.floor((Date.now() - Date.parse(o.invoicedAt)) / 864e5) : null; return `<tr>
              <td class="clickable" data-contact="${c.id}"><span class="name" style="font-weight:600">${esc(c.name)}</span><div class="muted" style="font-size:12px">${esc(c.company || o.service || "")}</div></td>
              <td>${esc(o.invoice?.number || "—")}</td><td class="num">${cad(amt(o), 2)}</td>
              <td>${esc(fdate(o.invoicedAt))}${days != null && o.stage === "Invoiced" ? `<div class="muted" style="font-size:12px">${days} days</div>` : ""}</td>
              <td>${o.stage === "Invoiced" ? `<span class="st ${days > 14 ? "bad" : days > 7 ? "warn" : ""}">${days > 14 ? "▲ overdue" : "● unpaid"}</span>` : `<span class="st good">✓ paid ${esc(fdate(o.paidAt))}</span>`}</td>
              <td>${o.stage === "Invoiced" ? `<button class="btn sm" data-paid="${o.id}">Mark paid</button>` : ""}</td></tr>`; }).join("")}</tbody></table>
            ${inv.length ? "" : `<p class="empty">No invoices yet.</p>`}</section>
          <section class="panel"><h2>Card pay links <small>only made when a client asks to pay by card</small></h2><div class="rows">${links.map((l) => `<div class="r"><div class="grow"><div class="t">${esc(contactById(l.o.contactId)?.name)} · ${cad(l.amount, 2)}</div><div class="s">${esc(l.url || l.code || "")} · ${esc(l.status || "")}</div></div></div>`).join("") || `<p class="empty">No card links on any card.</p>`}</div></section>
          <section class="panel"><h2>Invoice drafts</h2><div class="rows">${invDrafts.map(draftRow).join("") || `<p class="empty">No invoice drafts.</p>`}</div></section>`;
      },

      marketing() {
        const posts = [...D.posts].sort((a, b) => a.when.localeCompare(b.when));
        const queue = D.drafts.filter((d) => ["sms", "campaign"].includes(d.kind));
        return `<section class="panel"><h2>Social planner <small><button class="btn sm" data-act="new-post">+ Plan a post</button></small></h2><div class="rows">${posts.map((p) => `
            <div class="r"><div class="grow"><div class="t">${esc(fdate(p.when, { weekday: "short", month: "short", day: "numeric" }))} <span class="pill">${esc(p.platform)}</span><span class="pill ${p.status === "approved" ? "navy" : ""}">${esc(p.status)}</span></div>
              <pre>${esc(p.text)}</pre>${p.image ? `<div class="s">image: ${esc(p.image)}</div>` : ""}</div>
              <div class="acts">${["approved", "posted", "dropped"].filter((s) => s !== p.status).map((s) => `<button class="btn sm" data-post="${p.id}" data-status="${s}">${{ approved: "Approve", posted: "Mark posted", dropped: "Drop" }[s]}</button>`).join("")}</div></div>`).join("") || `<p class="empty">No posts planned. Plan one here or ask studio to plan the month.</p>`}</div></section>
          <section class="panel"><h2>Campaigns <small>each makes an unsent draft per person, skipping do-not-contact</small></h2><div class="rows">${D.campaigns.map((m) => `<div class="r"><div class="grow"><div class="t">${esc(m.name)} <span class="pill">${esc(m.channel)}</span></div><div class="s">${m.recipients} recipients · ${esc(fdate(m.createdAt))} · ${esc(m.status)}</div></div></div>`).join("") || `<p class="empty">No campaigns yet. Ask studio, e.g. "Draft a spring re-book campaign for past gutter customers".</p>`}</div></section>
          <section class="panel"><h2>Texts &amp; campaign drafts <small>not sent</small></h2><div class="rows">${queue.map(draftRow).join("") || `<p class="empty">No text or campaign drafts.</p>`}</div></section>`;
      },

      reputation() {
        const fb = D.activity.filter((a) => a.kind === "feedback");
        const stars = fb.map((a) => Number((a.text.match(/(\d)★/) || [])[1])).filter(Boolean);
        const avg = stars.length ? (stars.reduce((t, x) => t + x, 0) / stars.length).toFixed(1) : "—";
        const dist = [5, 4, 3, 2, 1].map((n) => ({ k: n + "★", v: stars.filter((s) => s === n).length }));
        const asked = D.opps.filter((o) => o.reviewAskedAt || o.stage === "Review Asked");
        const reqDrafts = D.drafts.filter((d) => d.kind === "review_request");
        return `<div class="tiles">${tile(avg, "average rating (review page)")}${tile(stars.length, "ratings received")}${tile(asked.length, "review asks")}${tile(stars.filter((s) => s < 5).length, "1–4★, came to you first")}</div>
          <div class="grid2">
            <section class="panel"><h2>Ratings <small>from the Rate us stars in emails</small></h2>${bars(dist, (x) => String(x.v), (x) => `${x.k}: ${x.v}`)}</section>
            <section class="panel"><h2>Latest ratings</h2><div class="rows">${fb.slice(-10).reverse().map((a) => { const c = contactById(a.contactId); return `<div class="r ${c ? "clickable" : ""}" ${c ? `data-contact="${c.id}"` : ""}><div class="grow"><div class="t">${esc(c?.name || "Unmatched rating")}</div><div class="s">${esc(a.text)} · ${esc(ftime(a.at))}</div></div></div>`; }).join("") || `<p class="empty">No ratings yet.</p>`}</div></section>
          </div>
          <section class="panel"><h2>Review asks</h2><div class="rows">${asked.map((o) => { const c = contactById(o.contactId) || {}; return `<div class="r clickable" data-contact="${c.id}"><div class="grow"><div class="t">${esc(c.name)}</div><div class="s">${esc(o.service)} · asked ${esc(fdate(o.reviewAskedAt || o.stageAt))}</div></div></div>`; }).join("") || `<p class="empty">The day after each job, presence drafts a thank-you and review ask.</p>`}
            ${reqDrafts.map(draftRow).join("")}</div></section>`;
      },

      automations() {
        const up = upcomingSteps();
        const due = [...(D.automations?.auto || []).map((a) => `${a.what} · ${a.name || ""}`), ...Object.entries(D.automations?.jobs || {}).flatMap(([agent, items]) => items.map((i) => `${agent}: ${String(i.text).split("\n")[0].slice(0, 140)}`))];
        const ran = D.activity.filter((a) => a.kind === "workflow").slice(-15).reverse();
        const RULES = [
          ["Quote follow-up", "Quote Sent, no reply: day 1 text · day 3 email · day 7 call task · day 14 last-chance email · day 30 check-in, then Nurture. A reply stops it."],
          ["Invoice", "Completed → books drafts the invoice the same day."],
          ["Payment reminders", "Invoiced → reminder drafts at day 7 and day 14. An RBC deposit match marks it Paid."],
          ["Review + referral ask", "The day after a job (Completed, or 24 h after a Booked job's end) → presence drafts the ask."],
          ["Customer tag", "Paid → tagged customer for next season's re-book list."],
          ["Seasonal reactivation", "Early March, September and October → studio drafts a re-book campaign."],
          ["Inbox routing", "Watcher checks Gmail every 60 s: quote requests → sales, deposits → books, reviews → presence, people → office."],
        ];
        return `<section class="panel"><h2>Due now <small>runs hourly 8am–9pm through the watcher on your Mac</small></h2><div class="rows">${due.map((x) => `<div class="r"><span class="st warn">●</span><div class="grow">${esc(x)}</div></div>`).join("") || `<p class="empty">Nothing due right now.</p>`}${D.automations?.error ? `<p class="empty">Could not read the workflow: ${esc(D.automations.error)}</p>` : ""}</div></section>
          <section class="panel tablewrap"><h2>Coming up</h2><table><thead><tr><th>When</th><th>Client</th><th>Step</th></tr></thead><tbody>${up.map((u) => `<tr class="clickable" data-contact="${u.c.id}"><td class="num">${esc(fdate(u.when, { weekday: "short", month: "short", day: "numeric" }))}</td><td><span class="name" style="font-weight:600">${esc(u.c.name)}</span></td><td>${esc(u.what)}</td></tr>`).join("")}</tbody></table>${up.length ? "" : `<p class="empty">No steps scheduled.</p>`}</section>
          <div class="grid2">
            <section class="panel"><h2>Workflows</h2><div class="rows">${RULES.map(([t, s]) => `<div class="r"><div class="grow"><div class="t">${esc(t)}</div><div class="s">${esc(s)}</div></div></div>`).join("")}</div></section>
            <section class="panel"><h2>Recent runs</h2><div class="rows">${ran.map(feedRow).join("") || `<p class="empty">No workflow steps have run yet.</p>`}</div></section></div>`;
      },
    };

    function taskRow(t) {
      const c = contactById(t.contactId) || {};
      const late = !t.done && t.due < today();
      return `<div class="r"><input type="checkbox" ${t.done ? "checked disabled" : ""} data-task="${t.id}" aria-label="Mark done: ${esc(t.title)}" style="margin-top:3px">
        <div class="grow ${c.id ? "clickable" : ""}" ${c.id ? `data-contact="${c.id}"` : ""}><div class="t">${esc(t.title)} <span class="pill">${esc(t.type)}</span>${late ? `<span class="st bad">overdue</span>` : ""}</div>
        <div class="s">${esc([c.phone, c.address, "due " + fdate(t.due)].filter(Boolean).join(" · "))}</div>${t.script ? `<details><summary class="s">Script</summary><pre>${esc(t.script)}</pre></details>` : ""}</div></div>`;
    }
    function feedRow(a) {
      const c = contactById(a.contactId);
      return `<div class="r ${c ? "clickable" : ""}" ${c ? `data-contact="${c.id}"` : ""}><span class="pill">${esc(a.kind)}</span><div class="grow"><div>${c ? `<b>${esc(c.name)}</b> · ` : ""}${esc(a.text)}</div><div class="s">${esc(ftime(a.at))} · ${esc(a.by)}</div></div></div>`;
    }
    function draftRow(d) {
      return `<div class="r"><span class="pill">${esc(d.kind)}</span><div class="grow"><div class="t">${esc(d.subject || "(no subject)")}</div><div class="s">to ${esc(d.to)} · ${esc(ftime(d.createdAt))} · ${d.inGmail ? "in Gmail Drafts" : "local draft"} · not sent</div><details><summary class="s">Show</summary><pre>${esc(d.body)}</pre></details></div></div>`;
    }
    function convoList() {
      const map = new Map();
      for (const c of D.contacts) map.set(c.id, { key: c.id, contact: c, name: c.name, email: c.email, drafts: draftsOf(c) });
      for (const d of D.drafts) {
        if (TEST_EMAILS.includes(norm(d.to)) || !d.to || contactByEmail(d.to)) continue;
        const k = "e:" + norm(d.to);
        if (!map.has(k)) map.set(k, { key: k, contact: null, name: d.to, email: d.to, drafts: [] });
        map.get(k).drafts.push(d);
      }
      return [...map.values()].map((x) => {
        const acts = x.contact ? D.activity.filter((a) => a.contactId === x.contact.id) : [];
        const ts = [...x.drafts.map((d) => [d.createdAt, d.subject]), ...acts.map((a) => [a.at, a.text])].sort((a, b) => String(b[0]).localeCompare(String(a[0])));
        return { ...x, last: ts[0]?.[0], lastSubject: ts[0]?.[1] };
      }).sort((a, b) => String(b.last).localeCompare(String(a.last)));
    }
    function thread(x) {
      const items = [
        ...x.drafts.map((d) => ({ at: d.createdAt, html: `<div class="bubble out"><div class="h">Draft ${esc(d.kind)} · ${esc(ftime(d.createdAt))} · ${d.inGmail ? "in Gmail Drafts" : "local"} · <b>not sent</b>${d.attachment ? " · 📎 " + esc(d.attachment) : ""}</div><b>${esc(d.subject)}</b><details><summary>Read</summary><pre>${esc(d.body)}</pre></details></div>` })),
        ...(x.contact ? D.activity.filter((a) => a.contactId === x.contact.id).map((a) => ({ at: a.at, html: `<div class="bubble sys">${esc(ftime(a.at))} · ${esc(a.kind)}: ${esc(a.text)}</div>` })) : []),
      ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
      const head = x.contact
        ? `<div class="acts"><button class="btn sm" data-contact="${x.contact.id}">Open contact</button><button class="btn sm primary" data-ask-contact="${x.contact.id}" data-agent="sales">Draft a reply with sales</button></div>`
        : `<div class="acts"><button class="btn sm gold" data-lead-from="${esc(x.email)}">Add as lead</button></div>`;
      return `<div><h2 style="margin:0;font-size:16px">${esc(x.name)}</h2><div class="muted" style="font-size:12px;margin-bottom:8px">${esc(x.email || "")}</div>${head}</div>
        <p class="note">Client emails stay in Gmail. This shows our drafts and everything the CRM logged.</p>${items.map((i) => i.html).join("")}`;
    }
    function upcomingSteps() {
      const out = [];
      const add = (c, when, what) => c && out.push({ c, when: day(when), what });
      const plus = (iso, d) => new Date(Date.parse(iso) + d * 864e5);
      for (const o of D.opps) {
        const c = contactById(o.contactId); if (!c || c.dnd) continue;
        const done = new Set(o.sequence?.done || []);
        if (o.stage === "Quote Sent" && o.quoteSentAt) {
          const next = [[1, "q1", "Day 1 text (sales drafts)"], [3, "q3", "Day 3 email (sales drafts)"], [7, "q7", "Day 7 call task for you"], [14, "q14", "Day 14 last-chance email"], [30, "q30", "Day 30 check-in, then Nurture"]].find(([, k]) => !done.has(k));
          if (next) add(c, plus(o.quoteSentAt, next[0]), next[2]);
        }
        if (o.stage === "Invoiced") {
          const base = o.invoicedAt || o.stageAt;
          if (!done.has("pay7")) add(c, plus(base, 7), "Payment reminder, day 7 (books drafts)");
          else if (!done.has("pay14")) add(c, plus(base, 14), "Payment reminder, day 14 (books drafts)");
        }
        if (o.stage === "Booked" && o.booked?.when && !done.has("rev")) add(c, plus(new Date(o.booked.end || o.booked.when).toISOString(), 1), "Review + referral ask (presence drafts)");
      }
      return out.sort((a, b) => a.when.localeCompare(b.when));
    }

    // ---------- contact drawer ----------
    function drawer(id, keep = false) {
      const c = contactById(id);
      if (!c) return closeDrawer();
      if (keep && el("drawer").contains(shadow.activeElement)) return;
      openContact = id;
      const opps = oppsOf(id);
      const tasks = D.tasks.filter((t) => t.contactId === id && !t.done);
      const drafts = draftsOf(c);
      const sales = salesFor(c);
      const tl = D.activity.filter((a) => a.contactId === id).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
      el("drawer").innerHTML = `
        <div class="dh"><div><h2>${esc(c.name)}</h2><p class="note">${esc(c.company || "")}${c.company ? " · " : ""}since ${esc(fdate(c.createdAt, { month: "short", day: "numeric", year: "numeric" }))}</p>
          <div style="margin-top:6px">${(c.tags || []).map((t) => `<span class="pill">${esc(t)} <button class="btn link" data-untag="${esc(t)}" aria-label="Remove tag ${esc(t)}">×</button></span>`).join("")}<button class="btn sm" data-act="add-tag">+ tag</button></div></div>
          <button class="btn sm x" data-act="close-drawer" aria-label="Close">✕</button></div>
        <div class="db">
          <div class="acts">
            <button class="btn sm primary" data-ask-contact="${id}" data-agent="sales">Ask sales</button>
            <button class="btn sm" data-ask-contact="${id}" data-agent="books">Ask books</button>
            <button class="btn sm" data-ask-contact="${id}" data-agent="crew">Ask crew</button>
            <button class="btn sm" data-act="add-task">+ Task</button>
            <button class="btn sm" data-act="dnd">${c.dnd ? "Allow contact again" : "Do not contact"}</button></div>
          ${c.dnd ? `<div class="st bad">Do not contact: campaigns and follow-ups skip this person.</div>` : ""}
          <dl class="kv">
            <dt>Email</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "—"}</dd>
            <dt>Phone</dt><dd>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : "—"}</dd>
            <dt>Address</dt><dd>${esc([c.address, c.city].filter(Boolean).join(", ") || "—")}</dd>
            <dt>Source</dt><dd>${esc(c.source || "")}${c.referredBy ? " · referred by " + esc(c.referredBy) : ""}</dd></dl>
          ${sales.map((l, i) => `<div class="box sale"><h3>Sales record</h3><div><b>${esc(l.serviceType || "")}</b> · ${esc(l.total || (l.estimatedValue ? cad(money(l.estimatedValue)) : ""))}</div>
              <p class="note">Status ${esc(l.status || "—")} · payment ${esc(l.paymentStatus || "Unpaid")}${l.estimateNumber ? " · " + esc(l.estimateNumber) : ""}${l.salesRep ? " · " + esc(l.salesRep) : ""}</p>
              ${opts.onOpenSale ? `<div class="acts" style="margin-top:6px"><button class="btn sm" data-sale="${i}">Open in Sales</button></div>` : ""}</div>`).join("")}
          <div><h3>Opportunities</h3>${opps.map((o) => `<div class="box" style="margin-bottom:8px">
              <div style="display:flex;gap:8px;align-items:center"><b style="flex:1">${esc(o.service || o.title)}</b><select class="mini" style="width:auto;margin:0" data-move="${o.id}" aria-label="Stage">${D.stages.map((s) => `<option ${s === o.stage ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
              <p class="note">${o.value ? cad(o.value) + " before HST" : "No value yet"}${o.estimateNumber ? " · " + esc(o.estimateNumber) : ""}${o.invoice?.number ? " · invoice " + esc(o.invoice.number) : ""}${o.invoice?.amount ? " · " + cad(o.invoice.amount, 2) : ""} · ${o.daysInStage} days in ${esc(o.stage)}</p>
              ${o.booked?.when ? `<p class="note">📅 ${esc(ftime(o.booked.when))}${o.booked.notes ? " · " + esc(o.booked.notes) : ""}</p>` : ""}
              <div class="acts" style="margin-top:6px"><button class="btn sm" data-edit="${o.id}">Edit value / job date</button></div></div>`).join("") || `<p class="note">No opportunity yet.</p>`}</div>
          <div><h3>Open tasks</h3><div class="rows">${tasks.map(taskRow).join("") || `<p class="note">None.</p>`}</div></div>
          <div><h3>Add a note</h3><textarea data-el="noteBox" rows="2" placeholder="Called, left a voicemail…"></textarea><div class="acts" style="margin-top:6px;justify-content:flex-end"><button class="btn sm primary" data-act="save-note">Save note</button></div></div>
          <div><h3>Drafts (${drafts.length})</h3><div class="rows">${drafts.slice(0, 8).map(draftRow).join("") || `<p class="note">None.</p>`}</div></div>
          <div><h3>Timeline</h3><div class="tl">${tl.map((a) => `<div>${esc(a.text)}<small>${esc(a.kind)} · ${esc(ftime(a.at))} · ${esc(a.by)}</small></div>`).join("") || `<p class="note">Nothing yet.</p>`}</div></div>
        </div>`;
      el("drawer").classList.add("open"); el("scrim").classList.add("on");
    }
    function closeDrawer() { openContact = null; el("drawer").classList.remove("open"); if (!el("agent").classList.contains("open")) el("scrim").classList.remove("on"); }

    // ---------- agent panel ----------
    let agentSession = null, agentBusy = false;
    const store = `ce-crm-agent-${mode}`;
    try { const s = JSON.parse(localStorage.getItem(store) || "{}"); if (s.agent) el("agentSel").value = s.agent; agentSession = s.sessionId || null; } catch {}
    const saveAgent = () => { try { localStorage.setItem(store, JSON.stringify({ agent: el("agentSel").value, sessionId: agentSession })); } catch {} };
    function alog(cls, html) { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; el("alog").append(d); el("alog").scrollTop = 1e9; return d; }
    function openAgent(agent, text) {
      if (agent && agent !== el("agentSel").value) { el("agentSel").value = agent; agentSession = null; el("alog").innerHTML = ""; saveAgent(); }
      el("agent").classList.add("open"); el("scrim").classList.add("on");
      if (!el("alog").children.length) alog("tool", agentSession ? "Continuing your last conversation. Click New to start fresh." : `Ask ${esc(el("agentSel").value)} anything about the business. It reads the CRM and saves drafts; nothing is sent.`);
      if (text) { el("amsg").value = text; autosize(); }
      el("amsg").focus();
    }
    function contactBrief(c) {
      const o = latestOpp(c.id);
      return [`About ${c.name}${c.company ? ` (${c.company})` : ""}`, c.email && `email ${c.email}`, c.phone && `phone ${c.phone}`, c.address && `address ${c.address}`,
        o && `card ${o.id}: ${o.stage}, ${o.service || ""}${o.value ? `, ${cad(o.value)} before HST` : ""}`].filter(Boolean).join(" · ") + ".\n\n";
    }
    async function sendAgent() {
      const message = el("amsg").value.trim();
      if (!message || agentBusy) return;
      agentBusy = true; el("ago").disabled = true; el("amsg").value = ""; autosize();
      alog("me", esc(message));
      const agent = el("agentSel").value;
      const wait = alog("tool", queueAgent ? `Sent to your Mac. ${esc(agent)} picks it up within a minute…` : `${esc(agent)} is working…`);
      try {
        if (queueAgent) {
          const ask = await ad.ask(agent, message, agentSession);
          for (let i = 0; i < 360; i++) {
            await new Promise((r) => setTimeout(r, 5000));
            const a = (await ad.asks()).find((x) => x.id === ask.id);
            if (!a) continue;
            if (a.status === "working") wait.textContent = `${agent} is working on your Mac…`;
            if (a.status === "done" || a.status === "error") {
              if (a.sessionId) { agentSession = a.sessionId; saveAgent(); }
              if (a.status === "error") alog("err", esc(a.reply || "The agent run failed.")); else alog("bot", md(a.reply || "(no reply)"));
              break;
            }
          }
        } else {
          let bot = null, text = "";
          await ad.chat(agent, message, agentSession, (ev) => {
            if (ev.t === "session") { agentSession = ev.id; saveAgent(); }
            else if (ev.t === "break") { bot = null; text = ""; }
            else if (ev.t === "text") { if (!bot) { bot = alog("bot", ""); el("alog").append(wait); } text += ev.d; bot.innerHTML = md(text); el("alog").scrollTop = 1e9; }
            else if (ev.t === "tool") { bot = null; text = ""; el("alog").insertBefore(Object.assign(document.createElement("div"), { className: "tool", innerHTML: `<b>${esc(ev.name)}</b> ${esc(ev.summary || "")}` }), wait); }
            else if (ev.t === "done") { if (ev.id) { agentSession = ev.id; saveAgent(); } if (ev.error) alog("err", esc(String(ev.error))); }
            else if (ev.t === "error") alog("err", esc(ev.msg));
          });
        }
      } catch (e) { alog("err", esc("Request failed: " + e.message)); }
      wait.remove(); agentBusy = false; el("ago").disabled = false; load();
    }
    function autosize() { const b = el("amsg"); b.style.height = "auto"; b.style.height = Math.min(b.scrollHeight, 160) + "px"; }
    el("amsg").addEventListener("input", autosize);
    el("amsg").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAgent(); } });
    el("aform").addEventListener("submit", (e) => { e.preventDefault(); sendAgent(); });
    el("agentSel").addEventListener("change", () => { agentSession = null; saveAgent(); el("alog").innerHTML = ""; openAgent(); });

    // ---------- dialogs ----------
    function ask(name, prep) {
      return new Promise((resolve) => {
        const d = qs(`dialog[data-dlg="${name}"]`), f = d.querySelector("form");
        f.reset(); prep?.(f);
        d.onclose = () => resolve(d.returnValue === "ok" ? Object.fromEntries(new FormData(f)) : null);
        d.returnValue = ""; d.showModal();
      });
    }
    async function newLead(prefill = {}) {
      const v = await ask("lead", (f) => {
        f.source.innerHTML = D.sources.map((s) => `<option>${esc(s)}</option>`).join("");
        f.stage.innerHTML = D.stages.filter((s) => s !== "Lost").map((s) => `<option>${esc(s)}</option>`).join("");
        for (const [k, val] of Object.entries(prefill)) if (f[k]) f[k].value = val;
      });
      if (!v) return;
      const data = { ...v, tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean) };
      if (v.value === "") delete data.value; else data.value = Number(v.value);
      for (const k of Object.keys(data)) if (data[k] === "") delete data[k];
      const out = await act("lead", { data });
      if (out?.contact) { toast(`${out.contact.name} added to ${out.opp.stage}`); drawer(out.contact.id); }
    }
    async function moveCard(opp, stage) {
      let reason = "";
      if (stage === "Lost") {
        const v = await ask("lost", (f) => (f.reason.innerHTML = D.lostReasons.map((r) => `<option>${esc(r)}</option>`).join("")));
        if (!v) return render();
        reason = v.reason;
      }
      const out = await act("move", { opp, stage, reason });
      if (out && !out.queued) toast(`Moved to ${stage}`);
    }

    // ---------- events ----------
    shadow.addEventListener("click", async (e) => {
      if (e.target.closest("summary, details, a[href^='mailto'], a[href^='tel'], a[href='/']")) return;
      if (e.target === el("scrim")) { closeDrawer(); el("agent").classList.remove("open"); el("scrim").classList.remove("on"); return; }
      const t = e.target.closest("button, [data-contact], [data-convo], [data-view]");
      if (!t || t.matches("select, input")) return;
      const a = t.dataset;
      if (a.view) return show(a.view);
      if (a.act === "new-lead") return newLead();
      if (a.act === "ask") return openAgent(null, openContact ? contactBrief(contactById(openContact)) : "");
      if (a.act === "agent-close") { el("agent").classList.remove("open"); if (!openContact) el("scrim").classList.remove("on"); return; }
      if (a.act === "agent-new") { agentSession = null; saveAgent(); el("alog").innerHTML = ""; return openAgent(); }
      if (a.act === "close-drawer") return closeDrawer();
      if (a.askContact) return openAgent(a.agent, contactBrief(contactById(a.askContact)));
      if (a.leadFrom) return newLead({ email: a.leadFrom });
      if (a.sale) { const l = salesFor(contactById(openContact))[Number(a.sale)]; closeDrawer(); return opts.onOpenSale?.(l); }
      if (a.convo) { convoKey = a.convo; return render(); }
      if (a.cal) { const b = calMonth || new Date(new Date().getFullYear(), new Date().getMonth(), 1); calMonth = a.cal === "0" ? null : new Date(b.getFullYear(), b.getMonth() + Number(a.cal), 1); return render(); }
      if (a.paid) return moveCard(a.paid, "Paid");
      if (a.post) { const out = await act("post-set", { post: a.post, status: a.status }); if (out && !out.queued) toast(`Post ${a.status}`); return; }
      if (a.act === "new-post") { const v = await ask("post", (f) => (f.when.value = today())); if (v) await act("post-add", { data: v }); return; }
      if (a.act === "save-note") { const text = el("noteBox").value.trim(); if (!text) return; const out = await act("note", { ref: openContact, text }); if (out && !out.queued) toast("Note saved"); return; }
      if (a.act === "add-task") {
        const c = contactById(openContact);
        const v = await ask("task", (f) => { f.due.value = today(); f.title.value = `Call ${String(c.name).split(" ")[0]}`; });
        if (!v) return;
        const o = latestOpp(openContact);
        const out = await act("task-add", { data: { ...v, contact: openContact, ...(o ? { opp: o.id } : {}) } });
        if (out && !out.queued) toast("Task added");
        return;
      }
      if (a.act === "dnd") { const c = contactById(openContact); await act("dnd", { contact: c.id, on: !c.dnd }); return; }
      if (a.act === "add-tag") { const v = await ask("tag"); if (v?.tag) await act("tag", { contact: openContact, add: v.tag }); return; }
      if (a.untag) return act("tag", { contact: openContact, remove: a.untag });
      if (a.edit) {
        const o = D.opps.find((x) => x.id === a.edit);
        const v = await ask("value", (f) => {
          f.value.value = o.value || ""; f.service.value = o.service || "";
          if (o.booked?.when) { f.date.value = o.booked.when.slice(0, 10); f.time.value = o.booked.when.slice(11, 16); }
          f.notes.value = o.booked?.notes || "";
        });
        if (!v) return;
        const data = {};
        if (v.value !== "" && Number(v.value) !== Number(o.value || 0)) data.value = Number(v.value);
        if (v.service && v.service !== o.service) data.service = v.service;
        if (v.date) data.booked = { when: `${v.date}T${v.time || "09:00"}`, ...(v.notes ? { notes: v.notes } : {}) };
        else if (v.notes && v.notes !== (o.booked?.notes || "")) data.booked = { notes: v.notes };
        if (!Object.keys(data).length) return;
        const out = await act("opp-set", { opp: o.id, data });
        if (out && data.booked?.when && o.stage !== "Booked" && confirm("Move this card to Booked too?")) await moveCard(o.id, "Booked");
        return;
      }
      if (a.contact) return drawer(a.contact);
    });
    shadow.addEventListener("change", async (e) => {
      const t = e.target, d = t.dataset;
      if (d.move) { if (t.value) await moveCard(d.move, t.value); return; }
      if (d.task) { const out = await act("task-done", { task: d.task }); if (out && !out.queued) toast("Task done"); return; }
      if (d.el === "tagSel") { tagFilter = t.value; return render(); }
      if (d.el === "srcSel") { srcFilter = t.value; return render(); }
      if (d.el === "lostChk") { showLost = t.checked; return render(); }
    });
    el("q").addEventListener("input", (e) => {
      q = e.target.value;
      if (!["contacts", "opportunities", "conversations"].includes(view)) show("contacts"); else render();
      el("q").focus();
    });
    shadow.addEventListener("mousemove", (e) => {
      const row = e.target.closest?.("[data-tip]"); const tip = el("tip");
      if (!row) { tip.style.display = "none"; return; }
      tip.textContent = row.dataset.tip; tip.style.display = "block";
      tip.style.left = Math.min(e.clientX + 14, innerWidth - 270) + "px"; tip.style.top = e.clientY + 14 + "px";
    });
    shadow.addEventListener("dragstart", (e) => { const c = e.target.closest?.(".card"); if (!c) return; e.dataTransfer.setData("text/plain", c.dataset.opp); c.classList.add("drag"); });
    shadow.addEventListener("dragend", (e) => e.target.closest?.(".card")?.classList.remove("drag"));
    shadow.addEventListener("dragover", (e) => { const col = e.target.closest?.(".col"); if (!col) return; e.preventDefault(); R.querySelectorAll(".col.over").forEach((x) => x !== col && x.classList.remove("over")); col.classList.add("over"); });
    shadow.addEventListener("dragleave", (e) => { const col = e.target.closest?.(".col"); if (col && !col.contains(e.relatedTarget)) col.classList.remove("over"); });
    shadow.addEventListener("drop", (e) => {
      const col = e.target.closest?.(".col"); if (!col) return;
      e.preventDefault(); col.classList.remove("over");
      const opp = e.dataTransfer.getData("text/plain");
      const o = D.opps.find((x) => x.id === opp);
      if (o && o.stage !== col.dataset.stage) moveCard(opp, col.dataset.stage);
    });
    shadow.addEventListener("keydown", (e) => { if (e.key === "Escape" && !qs("dialog[open]")) { el("agent").classList.remove("open"); closeDrawer(); el("scrim").classList.remove("on"); } });

    if (mode === "full") {
      const fromHash = () => location.hash.slice(1);
      if (NAV.some((n) => n[0] === fromHash())) view = fromHash();
      addEventListener("hashchange", () => { if (fromHash() !== view) show(fromHash()); });
    }
    const timer = setInterval(async () => { if (document.hidden || !host.isConnected) return; try { D = await ad.load(); opts.onData?.(D); render(false); } catch {} }, opts.refreshMs || 60_000);
    load();

    return {
      reload: () => load(),
      show,
      openContact: (id) => { if (D) drawer(id); },
      get data() { return D; },
      destroy: () => clearInterval(timer),
    };
  }

  // ---------- cloud adapter (manager dashboard) ----------
  // Reads the snapshot the Mac pushed and lays the not-yet-applied changes over it, so the board
  // shows what you did straight away. Changes queue until the Mac applies them.
  function cloudAdapter({ api = "/api/quick-leads?kind=crm", token }) {
    const auth = () => ({ Authorization: `Bearer ${typeof token === "function" ? token() : token}` });
    async function call(method, action, body) {
      const r = await fetch(api + (action ? `&action=${action}` : ""), { method, headers: { "Content-Type": "application/json", ...auth() }, body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.success === false) throw new Error(d.error || `HTTP ${r.status}`);
      return d;
    }
    let lastAsks = [];
    function overlay(snap, pending) {
      const D = JSON.parse(JSON.stringify(snap));
      const now = new Date().toISOString();
      for (const p of pending) {
        const b = p.body || {};
        const o = b.opp && D.opps.find((x) => x.id === b.opp);
        const c = (b.contact && D.contacts.find((x) => x.id === b.contact)) || (b.ref && (D.contacts.find((x) => x.id === b.ref) || D.contacts.find((x) => x.id === D.opps.find((y) => y.id === b.ref)?.contactId)));
        if (p.op === "move" && o) { o.stage = b.stage; o.stageAt = p.at; o.daysInStage = 0; o._pending = true; if (b.reason) o.lostReason = b.reason; }
        if (p.op === "opp-set" && o) { if (b.data?.value != null) o.value = Number(b.data.value); if (b.data?.service) o.service = b.data.service; if (b.data?.booked) o.booked = { ...(o.booked || {}), ...b.data.booked }; o._pending = true; }
        if (p.op === "task-done") { const t = D.tasks.find((x) => x.id === b.task); if (t) { t.done = true; t.doneAt = p.at; } }
        if (p.op === "post-set") { const x = D.posts.find((y) => y.id === b.post); if (x) x.status = b.status; }
        if (p.op === "dnd" && c) c.dnd = Boolean(b.on);
        if (p.op === "tag" && c) { const rm = new Set(String(b.remove || "").split(",").map((s) => s.trim().toLowerCase())); c.tags = [...new Set([...(c.tags || []), ...String(b.add || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)])].filter((t) => !rm.has(t)); }
        if (p.op === "note" && c) D.activity.push({ id: p.id, at: p.at, contactId: c.id, kind: "note", text: `${b.text} (waiting for your Mac)`, by: "luke" });
        if (p.op === "task-add") { const d = b.data || {}; D.tasks.push({ id: p.id, type: d.type || "todo", title: `${d.title} (waiting for your Mac)`, due: d.due || now.slice(0, 10), contactId: d.contact || null, done: false, script: d.script || "" }); }
        if (p.op === "post-add") { const d = b.data || {}; D.posts.push({ id: p.id, platform: d.platform, when: d.when, text: d.text, image: d.image, status: "waiting for your Mac" }); }
        if (p.op === "lead") { const d = b.data || {}; const cid = "pending-" + p.id; D.contacts.push({ id: cid, name: d.name, email: d.email, phone: d.phone, address: d.address, company: d.company, source: d.source, tags: d.tags || [], createdAt: p.at, updatedAt: p.at }); D.opps.push({ id: "pending-o-" + p.id, contactId: cid, service: d.service, value: Number(d.value) || 0, stage: d.stage || "New", stageAt: p.at, createdAt: p.at, daysInStage: 0, source: d.source, _pending: true, history: [] }); }
      }
      return D;
    }
    return {
      async load() {
        const d = await call("GET");
        lastAsks = d.asks || [];
        if (!d.snapshot) return { message: "The CRM hasn't synced from your Mac yet. It appears here once the watcher on your Mac is updated and running." };
        const D = overlay(d.snapshot, d.pending || []);
        D.sync = { syncedAt: d.snapshot.syncedAt, pending: d.pending || [], results: d.results || [] };
        return D;
      },
      async act(op, body) {
        if (String(body?.opp || body?.contact || body?.ref || "").startsWith("pending-")) return { ok: false, error: "That lead is still waiting for your Mac. Try again in a minute." };
        await call("POST", "queue", { op, body });
        return { ok: true, queued: true };
      },
      async ask(agent, message, sessionId) { return (await call("POST", "ask", { agent, message, sessionId })).ask; },
      async asks() { const d = await call("GET"); lastAsks = d.asks || []; return lastAsks; },
    };
  }

  // ---------- local adapter (localhost:4640 on the Mac) ----------
  function localAdapter() {
    return {
      async load() { const r = await fetch("/api/crm"); return r.json(); },
      async act(op, body) {
        const r = await fetch("/api/crm/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, ...body }) });
        return r.json().catch(() => ({ ok: false, error: "bad response" }));
      },
      async chat(agent, message, sessionId, onEvent) {
        const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, agent, sessionId }) });
        if (!r.ok) throw new Error((await r.json()).error || r.status);
        const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "";
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (line.trim()) onEvent(JSON.parse(line)); }
        }
      },
    };
  }

  window.CoreCRM = { mount, cloudAdapter, localAdapter };
})();
