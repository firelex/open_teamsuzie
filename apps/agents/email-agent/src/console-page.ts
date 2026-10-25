/** The console page: plain HTML and script, no build step. Served at /console. */
export const CONSOLE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Email Agent Console</title>
<style>
  :root { --bg: #f6f6f4; --panel: #fff; --ink: #1d1d1b; --muted: #6b6b66; --line: #e2e1dc; --accent: #2f5bea; --bad: #c0392b; --good: #2e7d32; --warn: #b26a00; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161615; --panel: #1f1f1d; --ink: #ecebe6; --muted: #a09f98; --line: #34332f; --accent: #7b9bff; --bad: #ff7b6b; --good: #7bd88f; --warn: #f0b45a; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); }
  header { display: flex; gap: 12px; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
  header h1 { font-size: 16px; margin: 0 12px 0 0; }
  main { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 16px; padding: 16px; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 16px; min-width: 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 8px; }
  input, select, textarea, button { font: inherit; color: inherit; }
  input, select, textarea { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; width: 100%; }
  textarea { min-height: 110px; resize: vertical; }
  button { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
  button.secondary { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
  button:disabled { opacity: .5; cursor: default; }
  .row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
  .row > label { min-width: 64px; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; padding: 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr.click { cursor: pointer; } tr.click:hover { background: var(--bg); }
  .unread { font-weight: 600; }
  .muted { color: var(--muted); }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; border: 1px solid currentColor; }
  .healthy, .ready, .done { color: var(--good); } .broken, .failed, .account_mismatch, .needs_login { color: var(--bad); } .suspect, .relearning, .logging_in, .queued, .running, .awaiting_approval, .starting { color: var(--warn); }
  pre.body { white-space: pre-wrap; word-break: break-word; background: var(--bg); padding: 8px; border-radius: 6px; max-height: 360px; overflow: auto; }
  #log { font: 12px/1.4 ui-monospace, Menlo, monospace; max-height: 240px; overflow: auto; white-space: pre-wrap; }
  .ops { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px 12px; margin-top: 8px; }
</style>
</head>
<body>
<header>
  <h1>Email Agent Console</h1>
  <input id="token" type="password" placeholder="Admin token" style="max-width: 260px">
  <select id="account" style="max-width: 260px"></select>
  <button id="refresh" class="secondary">Refresh</button>
  <span class="muted">Mail actions run as the <b>console</b> agent, so sends wait for your approval below.</span>
</header>
<main>
  <div>
    <section>
      <h2>Inbox</h2>
      <div class="row">
        <button id="listInbox">List inbox</button>
        <input id="query" placeholder="Search the mailbox (its own syntax)">
        <button id="search" class="secondary">Search</button>
      </div>
      <table><tbody id="messages"><tr><td class="muted">Nothing listed yet.</td></tr></tbody></table>
    </section>
    <section>
      <h2>Message</h2>
      <div id="message" class="muted">Click a message to open it.</div>
    </section>
  </div>
  <div>
    <section>
      <h2>Account</h2>
      <div id="status" class="muted">Enter the admin token.</div>
      <div class="row" style="margin-top: 8px">
        <button id="login" class="secondary">Sign in (opens Chrome)</button>
        <button id="canary" class="secondary">Check every action</button>
      </div>
    </section>
    <section>
      <h2>Write</h2>
      <div class="row"><label>To</label><input id="to" placeholder="a@example.com, b@example.com"></div>
      <div class="row"><label>Cc</label><input id="cc"></div>
      <div class="row"><label>Subject</label><input id="subject"></div>
      <textarea id="body" placeholder="Plain text"></textarea>
      <div class="row" style="margin-top: 8px"><button id="send">Send</button></div>
    </section>
    <section>
      <h2>Waiting for approval</h2>
      <div id="approvals" class="muted">None.</div>
    </section>
    <section>
      <h2>Alerts</h2>
      <div id="alerts" class="muted">None.</div>
    </section>
    <section>
      <h2>Activity</h2>
      <div id="log"></div>
    </section>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
};
try { $('token').value = sessionStorage.getItem('emailAgentToken') || ''; } catch {}
$('token').addEventListener('change', () => { try { sessionStorage.setItem('emailAgentToken', $('token').value); } catch {} refresh(); });

function log(text) {
  const line = new Date().toLocaleTimeString() + '  ' + text + '\n';
  $('log').textContent = line + $('log').textContent;
}

async function http(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { authorization: 'Bearer ' + $('token').value, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && (data.error?.message || data.error)) || res.statusText);
  return data;
}
const tool = (name, args) => http('POST', '/console/api/tool', { tool: name, args });
const account = () => $('account').value;

/** Submit a job and wait for it to finish, logging each step. */
async function runJob(kind, params) {
  const submitted = await tool('submit_job', { account: account(), kind, params });
  log(kind + ': ' + submitted.status + ' (' + submitted.job_id + ')' + (submitted.reason ? ' — ' + submitted.reason : ''));
  if (submitted.status === 'awaiting_approval') { refreshApprovals(); }
  let view;
  do {
    view = await tool('wait_job', { job_id: submitted.job_id, timeout_seconds: 60 });
    if (view.status === 'awaiting_approval') refreshApprovals();
  } while (!['done', 'failed', 'cancelled'].includes(view.status));
  log(kind + ': ' + view.status + (view.error ? ' — ' + view.error.code + ': ' + view.error.message : ''));
  refreshStatus();
  if (view.status !== 'done') throw new Error(view.error ? view.error.code + ': ' + view.error.message : view.status);
  return view.result;
}

function busy(button, fn) {
  return async () => {
    button.disabled = true;
    try { await fn(); } catch (e) { log('Error: ' + e.message); } finally { button.disabled = false; }
  };
}

function showMessages(messages) {
  const body = $('messages');
  body.replaceChildren();
  if (messages.length === 0) { body.append(el('tr', {}, el('td', { className: 'muted' }, 'No messages.'))); return; }
  for (const m of messages) {
    const row = el('tr', { className: 'click' + (m.unread ? ' unread' : '') },
      el('td', {}, m.from), el('td', {}, m.subject, el('div', { className: 'muted' }, m.bodyPreview || '')),
      el('td', { className: 'muted' }, new Date(m.date).toLocaleString()));
    row.addEventListener('click', () => openMessage(m.id));
    body.append(row);
  }
}

async function openMessage(id) {
  $('message').replaceChildren(el('span', { className: 'muted' }, 'Opening ' + id + '…'));
  try {
    const { message } = await runJob('read_message', { message_id: id });
    const reply = el('textarea', { placeholder: 'Reply to ' + message.from });
    const send = el('button', {}, 'Send reply');
    send.addEventListener('click', busy(send, async () => {
      await runJob('reply', { message_id: id, body: reply.value });
      reply.value = '';
    }));
    $('message').replaceChildren(
      el('div', {}, el('b', {}, message.subject)),
      el('div', { className: 'muted' }, 'From ' + message.from + (message.to ? ' to ' + message.to : '') + (message.cc ? ', cc ' + message.cc : '') + ' · ' + new Date(message.date).toLocaleString()),
      el('pre', { className: 'body' }, message.bodyText),
      reply, el('div', { className: 'row', style: 'margin-top: 8px' }, send),
    );
  } catch (e) {
    $('message').replaceChildren(el('span', { className: 'failed' }, e.message));
  }
}

$('listInbox').addEventListener('click', busy($('listInbox'), async () => showMessages((await runJob('list_inbox', { limit: 25 })).messages)));
$('search').addEventListener('click', busy($('search'), async () => showMessages((await runJob('search', { query: $('query').value, limit: 25 })).messages)));
$('send').addEventListener('click', busy($('send'), async () => {
  const params = { to: $('to').value, subject: $('subject').value, body: $('body').value };
  if ($('cc').value.trim()) params.cc = $('cc').value;
  await runJob('send', params);
  for (const id of ['to', 'cc', 'subject', 'body']) $(id).value = '';
}));
$('login').addEventListener('click', busy($('login'), async () => {
  const r = await http('POST', '/admin/login/' + encodeURIComponent(account()));
  log(r.message);
}));
$('canary').addEventListener('click', busy($('canary'), async () => {
  log('Checking every action without sending (this can take a few minutes)…');
  const results = await http('POST', '/admin/canary/' + encodeURIComponent(account()));
  log(results.map((r) => r.operation + ': ' + r.outcome + (r.error ? ' (' + r.error.code + ')' : '') + (r.reason ? ' (' + r.reason + ')' : '')).join('\n'));
  refreshStatus();
}));

async function refreshStatus() {
  const all = await http('GET', '/admin/status');
  const select = $('account');
  if (select.options.length === 0) for (const s of all) select.append(el('option', { value: s.account }, s.account + ' (' + s.provider + ')'));
  const s = all.find((x) => x.account === account());
  if (!s) return;
  const ops = el('div', { className: 'ops' });
  for (const [op, h] of Object.entries(s.operations)) {
    ops.append(el('div', { title: h.last_error || '' }, op + ' ', el('span', { className: 'pill ' + h.state }, h.state + (h.send_unconfirmed ? ' · unconfirmed' : ''))));
  }
  $('status').replaceChildren(el('div', {}, 'Status ', el('span', { className: 'pill ' + s.status }, s.status)), s.failure ? el('div', { className: 'failed' }, s.failure) : '', ops);
}

async function refreshApprovals() {
  const items = await http('GET', '/admin/approvals');
  if (items.length === 0) { $('approvals').replaceChildren(el('span', { className: 'muted' }, 'None.')); return; }
  $('approvals').replaceChildren(...items.map((item) => {
    const p = item.payload.params;
    const approve = el('button', {}, 'Approve');
    const reject = el('button', { className: 'secondary' }, 'Reject');
    approve.addEventListener('click', busy(approve, async () => { await http('POST', '/admin/approvals/' + item.id + '/approve'); log('Approved ' + item.id); refreshApprovals(); }));
    reject.addEventListener('click', busy(reject, async () => { await http('POST', '/admin/approvals/' + item.id + '/reject', { reason: 'Rejected in the console' }); log('Rejected ' + item.id); refreshApprovals(); }));
    return el('div', { style: 'border-bottom: 1px solid var(--line); padding: 6px 0' },
      el('div', {}, el('b', {}, item.payload.kind), ' by ', item.subject_id, ' from ', item.payload.account),
      el('div', {}, 'To: ' + (p.to || '(original sender)') + (p.cc ? '  Cc: ' + p.cc : '')),
      p.subject ? el('div', {}, 'Subject: ' + p.subject) : '',
      el('pre', { className: 'body' }, p.body),
      el('div', { className: 'muted' }, item.metadata.reason),
      el('div', { className: 'row' }, approve, reject));
  }));
}

async function refreshAlerts() {
  const alerts = await http('GET', '/admin/alerts?after=0');
  if (alerts.length === 0) return;
  $('alerts').replaceChildren(...alerts.slice(-15).reverse().map((a) =>
    el('div', { style: 'padding: 4px 0; border-bottom: 1px solid var(--line)' }, el('span', { className: 'muted' }, new Date(a.created_at).toLocaleString() + ' · ' + a.account + ' · ' + a.kind), el('div', {}, a.message))));
}

async function refresh() {
  if (!$('token').value) return;
  try { await refreshStatus(); await refreshApprovals(); await refreshAlerts(); } catch (e) { log('Error: ' + e.message); }
}
$('refresh').addEventListener('click', refresh);
$('account').addEventListener('change', refreshStatus);
setInterval(refresh, 5000);
refresh();
</script>
</body>
</html>`;
