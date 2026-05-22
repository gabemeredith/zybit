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

  // Left column — INTERNALS: progress + counts + sample JSON.
  const left = el('div', { class: 'col internals-col' }, [
    el('h2', {}, 'internals'),
    el('h3', { class: 'subhead' }, 'progress'),
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

  if (state.status === 'done' && state.result) {
    const { counts, sample, organizationId, siteId, snapshotErrors, experiment, flowGraph } = state.result;
    left.appendChild(el('h3', { class: 'subhead' }, 'results'));
    left.appendChild(
      el('p', {}, [
        el('strong', {}, 'org/site '),
        el('code', {}, `${organizationId} / ${siteId}`),
      ]),
    );
    left.appendChild(
      el('table', { class: 'counts' }, [
        el('tr', {}, [el('th', {}, 'sessions'), el('td', {}, String(counts.sessions))]),
        el('tr', {}, [el('th', {}, 'events'), el('td', {}, String(counts.events))]),
        el('tr', {}, [el('th', {}, 'snapshots'), el('td', {}, String(counts.snapshots))]),
        el('tr', {}, [el('th', {}, 'findings'), el('td', {}, String(counts.findings))]),
      ]),
    );
    if (experiment && experiment.action !== 'no-finding') {
      const liftLabel = experiment.liftPct != null ? `${experiment.liftPct.toFixed(1)}%` : 'n/a';
      const confLabel =
        experiment.confidence != null ? `${(experiment.confidence * 100).toFixed(1)}%` : 'n/a';
      left.appendChild(
        el('table', { class: 'counts' }, [
          el('tr', {}, [el('th', {}, 'experiment'), el('td', {}, experiment.action)]),
          el('tr', {}, [el('th', {}, 'result'), el('td', {}, experiment.result ?? 'n/a')]),
          el('tr', {}, [el('th', {}, 'lift'), el('td', {}, liftLabel)]),
          el('tr', {}, [el('th', {}, 'confidence'), el('td', {}, confLabel)]),
          el('tr', {}, [el('th', {}, 'participants'), el('td', {}, String(experiment.participants))]),
        ]),
      );
    }
    if (flowGraph) {
      left.appendChild(
        el('table', { class: 'counts' }, [
          el('tr', {}, [el('th', {}, 'flow routes'), el('td', {}, String(flowGraph.nodes))]),
          el('tr', {}, [el('th', {}, 'flow edges'), el('td', {}, String(flowGraph.edges))]),
          el('tr', {}, [el('th', {}, 'flow sessions'), el('td', {}, String(flowGraph.sessionCount))]),
          el('tr', {}, [
            el('th', {}, 'chokepoint'),
            el('td', {}, flowGraph.flowFindingFired
              ? `${flowGraph.chokepointRoute ?? '?'} ← flow-inter-step-dropoff fired ✓`
              : 'none (rule did not fire)'),
          ]),
        ]),
      );
    }
    if (snapshotErrors?.length) {
      left.appendChild(
        el('details', { class: 'group' }, [
          el('summary', {}, `${snapshotErrors.length} snapshot error(s)`),
          el('pre', {}, JSON.stringify(snapshotErrors, null, 2)),
        ]),
      );
    }
    left.appendChild(
      el('details', { class: 'group', open: 'open' }, [
        el('summary', {}, `findings (${sample.findings.length} shown)`),
        el('pre', {}, JSON.stringify(sample.findings, null, 2)),
      ]),
    );
    left.appendChild(
      el('details', { class: 'group' }, [
        el('summary', {}, `snapshots sample (${sample.snapshots.length})`),
        el('pre', {}, JSON.stringify(sample.snapshots, null, 2)),
      ]),
    );
    left.appendChild(
      el('details', { class: 'group' }, [
        el('summary', {}, `events sample (${sample.events.length})`),
        el('pre', {}, JSON.stringify(sample.events, null, 2)),
      ]),
    );
  }

  // Right column — PM VIEW: "Open as PM" button until clicked, then
  // an iframe of the embedded /app/loop loaded as the synthetic PM.
  const right = el('div', { class: 'col pm-col' }, [el('h2', {}, 'pm view')]);
  if (state.status === 'done' && state.result) {
    right.appendChild(buildPmView(state.result.siteId));
  } else if (state.status === 'running') {
    right.appendChild(
      el('p', { class: 'pm-status' }, 'pm view appears here once the run finishes.'),
    );
  }

  runPane.appendChild(el('div', { class: 'two-col' }, [left, right]));
}

function buildPmView(siteId) {
  const wrap = el('div', { class: 'pm-view' });
  const status = el(
    'p',
    { class: 'pm-status' },
    'embed /app as the synthetic PM for this site.',
  );

  function makeOpenBtn(label, appPath) {
    const btn = el('button', { type: 'button', class: 'primary' }, label);
    btn.addEventListener('click', async () => {
      btn.setAttribute('disabled', 'disabled');
      status.textContent = 'minting session…';
      try {
        const r = await api('/lighthouse/api/impersonate/start', {
          method: 'POST',
          body: JSON.stringify({ siteId, redirectPath: appPath }),
        });
        if (!r.ok) {
          const msg = (r.body && (r.body.detail || r.body.error)) || `http ${r.status}`;
          throw new Error(msg);
        }
        // Swap the buttons for the iframe.
        clear(wrap);
        wrap.appendChild(
          el('iframe', {
            src: r.body.embedUrl,
            class: 'pm-iframe',
            sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups',
            title: `PM view — ${appPath} (synthetic)`,
          }),
        );
      } catch (err) {
        status.textContent = `error: ${err.message}`;
        btn.removeAttribute('disabled');
      }
    });
    return btn;
  }

  wrap.appendChild(el('div', { class: 'pm-btn-row' }, [
    makeOpenBtn('open loop view', '/app/loop'),
    makeOpenBtn('open flow view', '/app/flow'),
  ]));
  wrap.appendChild(status);
  return wrap;
}

async function boot() {
  const authed = await checkAuth();
  if (authed) renderDashboard();
  else renderLogin();
}

boot();
