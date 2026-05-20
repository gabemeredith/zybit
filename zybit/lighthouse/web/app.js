const root = document.getElementById('root');

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== undefined && v !== null && v !== false) {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

async function api(path, opts) {
  const r = await fetch(path, {
    credentials: 'same-origin',
    headers: opts?.body ? { 'content-type': 'application/json' } : undefined,
    ...opts,
  });
  let body = null;
  try {
    body = await r.json();
  } catch {
    /* not JSON */
  }
  return { ok: r.ok, status: r.status, body };
}

async function checkAuth() {
  const { body } = await api('/lighthouse/api/me');
  return Boolean(body && body.authenticated);
}

function renderLogin(errorMessage) {
  clear(root);
  root.appendChild(
    el('section', { class: 'login' }, [
      el('h1', {}, 'Lighthouse'),
      el('form', { onSubmit: handleLogin }, [
        el('input', {
          type: 'password',
          name: 'password',
          placeholder: 'password',
          required: 'required',
          autofocus: 'autofocus',
        }),
        el('button', { type: 'submit', class: 'primary' }, 'unlock'),
        errorMessage ? el('p', { class: 'error' }, errorMessage) : null,
      ]),
    ]),
  );
}

async function handleLogin(ev) {
  ev.preventDefault();
  const password = ev.target.elements.password.value;
  const r = await api('/lighthouse/api/auth', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  if (r.ok) renderDashboard();
  else renderLogin('incorrect password');
}

async function handleLogout() {
  await api('/lighthouse/api/logout', { method: 'POST' });
  renderLogin();
}

async function renderDashboard() {
  clear(root);
  const header = el('header', { class: 'app-header' }, [
    el('h1', {}, 'Lighthouse'),
    el('div', { class: 'right' }, [
      el('button', { type: 'button', onClick: handleLogout }, 'log out'),
    ]),
  ]);

  const controls = el('section', { class: 'controls' }, [
    el('p', { class: 'loading' }, 'loading scenarios…'),
  ]);
  const runPane = el('section', { class: 'runpane' });
  root.appendChild(el('div', {}, [header, controls, runPane]));

  const { body } = await api('/lighthouse/api/scenarios');
  clear(controls);
  const scenarios = (body && body.scenarios) || [];
  if (scenarios.length === 0) {
    controls.appendChild(
      el('p', { class: 'empty' }, 'No scenarios registered yet. Step 12 adds the acmebank smoke scenario.'),
    );
    return;
  }

  const scenarioSelect = el(
    'select',
    { name: 'scenarioId' },
    scenarios.map((s) =>
      el('option', { value: s.id }, `${s.name} — ${s.siteSlug} (${s.bucket})`),
    ),
  );
  const sessionsInput = el('input', {
    type: 'number',
    name: 'sessions',
    min: '1',
    max: '5000',
    value: String(scenarios[0].defaultSessions || 50),
  });
  const modeSelect = el('select', { name: 'mode' }, [
    el('option', { value: 'direct' }, 'direct (write straight to DB)'),
    el('option', { value: 'posthog', disabled: 'disabled' }, 'posthog (Step 11)'),
  ]);
  const generateBtn = el('button', { class: 'primary', type: 'button' }, 'generate');

  generateBtn.addEventListener('click', async () => {
    generateBtn.setAttribute('disabled', 'disabled');
    const scenarioId = scenarioSelect.value;
    const sessions = Number(sessionsInput.value);
    const mode = modeSelect.value;
    try {
      const r = await api('/lighthouse/api/generate', {
        method: 'POST',
        body: JSON.stringify({ scenarioId, sessions, mode }),
      });
      if (!r.ok) throw new Error((r.body && r.body.error) || `http ${r.status}`);
      await pollRun(r.body.runId, runPane);
    } catch (err) {
      clear(runPane);
      runPane.appendChild(el('p', { class: 'error' }, `error: ${err.message}`));
    } finally {
      generateBtn.removeAttribute('disabled');
    }
  });

  controls.appendChild(
    el('div', { class: 'control-row' }, [
      el('label', {}, ['scenario ', scenarioSelect]),
      el('label', {}, ['sessions ', sessionsInput]),
      el('label', {}, ['mode ', modeSelect]),
      generateBtn,
    ]),
  );
}

async function pollRun(runId, runPane) {
  let lastProgressCount = -1;
  for (;;) {
    const { body } = await api(`/lighthouse/api/runs/${encodeURIComponent(runId)}`);
    if (!body) {
      clear(runPane);
      runPane.appendChild(el('p', { class: 'error' }, 'run vanished'));
      return;
    }
    if ((body.progress?.length ?? 0) !== lastProgressCount || body.status !== 'running') {
      lastProgressCount = body.progress?.length ?? 0;
      renderRunState(runPane, body);
    }
    if (body.status !== 'running') return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

function renderRunState(runPane, state) {
  clear(runPane);
  const left = el('div', { class: 'col' }, [
    el('h2', {}, 'progress'),
    el(
      'ul',
      { class: 'progress' },
      (state.progress || []).map((p) =>
        el('li', { class: `step-${p.step}` }, `${p.step} — ${p.message}`),
      ),
    ),
    state.status === 'error'
      ? el('p', { class: 'error' }, `error: ${state.error?.message ?? 'unknown'}`)
      : null,
  ]);

  const right = el('div', { class: 'col' });
  if (state.status === 'done' && state.result) {
    const { counts, sample, organizationId, siteId, snapshotErrors } = state.result;
    right.appendChild(el('h2', {}, 'results'));
    right.appendChild(
      el('p', {}, [
        el('strong', {}, 'org/site '),
        el('code', {}, `${organizationId} / ${siteId}`),
      ]),
    );
    right.appendChild(
      el('table', { class: 'counts' }, [
        el('tr', {}, [el('th', {}, 'sessions'), el('td', {}, String(counts.sessions))]),
        el('tr', {}, [el('th', {}, 'events'), el('td', {}, String(counts.events))]),
        el('tr', {}, [el('th', {}, 'snapshots'), el('td', {}, String(counts.snapshots))]),
        el('tr', {}, [el('th', {}, 'findings'), el('td', {}, String(counts.findings))]),
      ]),
    );
    if (snapshotErrors?.length) {
      right.appendChild(
        el('details', { class: 'group' }, [
          el('summary', {}, `${snapshotErrors.length} snapshot error(s)`),
          el('pre', {}, JSON.stringify(snapshotErrors, null, 2)),
        ]),
      );
    }
    right.appendChild(
      el('details', { class: 'group', open: 'open' }, [
        el('summary', {}, `findings (${sample.findings.length} shown)`),
        el('pre', {}, JSON.stringify(sample.findings, null, 2)),
      ]),
    );
    right.appendChild(
      el('details', { class: 'group' }, [
        el('summary', {}, `snapshots sample (${sample.snapshots.length})`),
        el('pre', {}, JSON.stringify(sample.snapshots, null, 2)),
      ]),
    );
    right.appendChild(
      el('details', { class: 'group' }, [
        el('summary', {}, `events sample (${sample.events.length})`),
        el('pre', {}, JSON.stringify(sample.events, null, 2)),
      ]),
    );
  }

  runPane.appendChild(el('div', { class: 'two-col' }, [left, right]));
}

async function boot() {
  const authed = await checkAuth();
  if (authed) renderDashboard();
  else renderLogin();
}

boot();
