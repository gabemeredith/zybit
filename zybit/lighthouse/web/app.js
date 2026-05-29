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
  const urlControls = buildUrlAuditControls(runPane);
  root.appendChild(el('div', {}, [header, controls, urlControls, runPane]));

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
  const layerBInput = el('input', { type: 'checkbox', name: 'layerB' });
  const generateBtn = el('button', { class: 'primary', type: 'button' }, 'generate');
  const compareBtn = el(
    'button',
    {
      class: 'primary',
      type: 'button',
      title: 'Run once with Layer B forced ON for every finding (facts derived from evidence) — see LLM vs template side by side',
    },
    'compare LLM vs template',
  );

  async function runGenerate(extra) {
    generateBtn.setAttribute('disabled', 'disabled');
    compareBtn.setAttribute('disabled', 'disabled');
    const body = {
      scenarioId: scenarioSelect.value,
      sessions: Number(sessionsInput.value),
      mode: modeSelect.value,
      ...extra,
    };
    try {
      const r = await api('/lighthouse/api/generate', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((r.body && r.body.error) || `http ${r.status}`);
      await pollRun(r.body.runId, runPane);
    } catch (err) {
      clear(runPane);
      runPane.appendChild(el('p', { class: 'error' }, `error: ${err.message}`));
    } finally {
      generateBtn.removeAttribute('disabled');
      compareBtn.removeAttribute('disabled');
    }
  }

  generateBtn.addEventListener('click', () => runGenerate({ layerB: layerBInput.checked }));
  compareBtn.addEventListener('click', () => runGenerate({ layerB: true, layerBDeriveFacts: true }));

  controls.appendChild(
    el('div', { class: 'control-row' }, [
      el('label', {}, ['scenario ', scenarioSelect]),
      el('label', {}, ['sessions ', sessionsInput]),
      el('label', {}, ['mode ', modeSelect]),
      el('label', { class: 'layerb-toggle', title: 'Generate finding prose with the LLM (Layer B) instead of templates' }, [
        layerBInput,
        ' Layer B (LLM prose)',
      ]),
      generateBtn,
      compareBtn,
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
    const { counts, sample, organizationId, siteId, snapshotErrors, experiment, flowGraph, layerB } = state.result;
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
    if (layerB) left.appendChild(buildLayerBPanel(layerB));
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

  // Right column — PM VIEW for scenario runs, PAGE INSPECTOR for URL audits.
  const isUrlAudit =
    state.status === 'done' && state.result && Array.isArray(state.result.inspector);
  const right = el('div', { class: 'col pm-col' }, [
    el('h2', {}, isUrlAudit ? 'page inspector' : 'pm view'),
  ]);
  if (state.status === 'done' && state.result) {
    if (isUrlAudit) {
      right.appendChild(buildInspectorView(state.result));
    } else {
      right.appendChild(buildPmView(state.result.siteId));
    }
  } else if (state.status === 'running') {
    right.appendChild(
      el('p', { class: 'pm-status' }, 'results appear here once the run finishes.'),
    );
  }

  runPane.appendChild(el('div', { class: 'two-col' }, [left, right]));
}

// --- Layer B (LLM finding prose) AI-engineering panel ---------------------

function fmtUsd(n) {
  if (n == null) return 'n/a';
  return n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(4)}`;
}
function fmtMs(n) {
  return n == null ? 'n/a' : `${Math.round(n)}ms`;
}

function proseBlock(title, prose) {
  if (!prose) {
    return el('div', { class: 'layerb-prose layerb-prose-empty' }, [
      el('h5', {}, title),
      el('p', { class: 'empty' }, '— no LLM prose (fell back to template) —'),
    ]);
  }
  const presc = prose.prescription || {};
  return el('div', { class: 'layerb-prose' }, [
    el('h5', {}, title),
    el('p', { class: 'layerb-summary' }, prose.summary || ''),
    presc.whatToChange ? el('p', {}, [el('strong', {}, 'Change: '), presc.whatToChange]) : null,
  ]);
}

function buildLayerBPanel(layerB) {
  if (!layerB.enabled) {
    return el('details', { class: 'group layerb-panel' }, [
      el('summary', {}, 'Layer B — LLM prose (off this run)'),
      el(
        'p',
        { class: 'empty' },
        'Layer B was disabled. Tick "Layer B (LLM prose)" before generating to compare LLM vs template prose.',
      ),
    ]);
  }

  const bp = layerB.brandProfile;
  const brandText = bp
    ? [
        bp.ctaVocabulary?.length ? `CTAs: ${bp.ctaVocabulary.slice(0, 5).join(' · ')}` : '',
        bp.voiceSamples?.length
          ? `voice: ${bp.voiceSamples.slice(0, 2).map((v) => `"${v}"`).join('  ')}`
          : '',
      ]
        .filter(Boolean)
        .join('  —  ') || 'derived (empty)'
    : 'none — no brand text extracted from the audited pages (thin / JS-rendered?)';

  const agg = el('table', { class: 'counts' }, [
    el('tr', {}, [el('th', {}, 'model'), el('td', {}, layerB.model || 'n/a')]),
    el('tr', {}, [el('th', {}, 'brand DNA'), el('td', {}, brandText)]),
    el('tr', {}, [el('th', {}, 'attempted'), el('td', {}, String(layerB.attempted))]),
    el('tr', {}, [el('th', {}, 'LLM won'), el('td', {}, `${layerB.llmWon} / ${layerB.attempted}`)]),
    el('tr', {}, [
      el('th', {}, 'fell back'),
      el('td', {}, `${layerB.fellBack} (${Math.round(layerB.fallbackRate * 100)}%)`),
    ]),
    el('tr', {}, [el('th', {}, 'fabrication rejects'), el('td', {}, String(layerB.fabricationRejections))]),
    el('tr', {}, [
      el('th', {}, 'latency p50 / p95'),
      el('td', {}, `${fmtMs(layerB.latencyMsP50)} / ${fmtMs(layerB.latencyMsP95)}`),
    ]),
    el('tr', {}, [
      el('th', {}, 'tokens in / out'),
      el('td', {}, `${layerB.totalPromptTokens} / ${layerB.totalResponseTokens}`),
    ]),
    el('tr', {}, [el('th', {}, 'est cost'), el('td', {}, fmtUsd(layerB.estTotalCostUsd))]),
  ]);

  const cards = (layerB.findings || []).map((f) => {
    const won = f.proseSource === 'llm-v1';
    const head = el('div', { class: 'layerb-card-head' }, [
      el('code', {}, `${f.ruleId}${f.pathRef ? ' · ' + f.pathRef : ''}`),
      el('span', { class: `layerb-badge ${won ? 'is-llm' : 'is-template'}` }, f.proseSource),
      el('span', { class: 'layerb-outcome' }, f.call?.outcome || ''),
    ]);
    const side = el('div', { class: 'layerb-side' }, [
      proseBlock('template', f.prose?.template),
      proseBlock('LLM', f.prose?.llm),
    ]);
    const fail =
      !won && f.call
        ? el('p', { class: 'layerb-fail' }, [
            el('strong', {}, `fallback: ${f.call.outcome}`),
            f.call.fabricationFailures?.length
              ? ` — rejected numbers: ${f.call.fabricationFailures.join(', ')}`
              : '',
          ])
        : null;
    const raw = el('details', { class: 'group layerb-raw' }, [
      el('summary', {}, 'prompt + raw response'),
      el('h6', {}, 'prompt'),
      el('pre', {}, f.call?.prompt || '(none)'),
      el('h6', {}, 'raw response'),
      el('pre', {}, f.call?.rawResponse || '(none)'),
    ]);
    return el('div', { class: 'layerb-card' }, [head, side, fail, raw]);
  });

  return el('details', { class: 'group layerb-panel', open: 'open' }, [
    el(
      'summary',
      {},
      `Layer B — LLM prose (${layerB.llmWon}/${layerB.attempted} LLM, ${layerB.fellBack} fallback)`,
    ),
    agg,
    ...cards,
  ]);
}

function buildUrlAuditControls(runPane) {
  const urlInput = el('input', {
    type: 'url',
    name: 'auditUrl',
    placeholder: 'https://example.com',
  });
  const pagesInput = el('input', {
    type: 'number',
    name: 'maxPages',
    min: '1',
    max: '40',
    value: '20',
  });
  const auditBtn = el('button', { class: 'primary', type: 'button' }, 'audit url');
  const compareBtn = el(
    'button',
    {
      class: 'primary',
      type: 'button',
      title: 'Audit this real URL with Layer B forced ON for every finding — see brand-aware LLM vs template prose',
    },
    'audit + compare LLM',
  );

  async function runAudit(extra) {
    const url = urlInput.value.trim();
    if (!url) return;
    auditBtn.setAttribute('disabled', 'disabled');
    compareBtn.setAttribute('disabled', 'disabled');
    try {
      const r = await api('/lighthouse/api/audit-url', {
        method: 'POST',
        body: JSON.stringify({ url, maxPages: Number(pagesInput.value) || 20, ...extra }),
      });
      if (!r.ok) {
        throw new Error((r.body && (r.body.detail || r.body.error)) || `http ${r.status}`);
      }
      await pollRun(r.body.runId, runPane);
    } catch (err) {
      clear(runPane);
      runPane.appendChild(el('p', { class: 'error' }, `error: ${err.message}`));
    } finally {
      auditBtn.removeAttribute('disabled');
      compareBtn.removeAttribute('disabled');
    }
  }

  auditBtn.addEventListener('click', () => runAudit({}));
  compareBtn.addEventListener('click', () => runAudit({ layerB: true, layerBDeriveFacts: true }));

  return el('section', { class: 'controls' }, [
    el('div', { class: 'control-row' }, [
      el('label', {}, ['audit url ', urlInput]),
      el('label', {}, ['max pages ', pagesInput]),
      auditBtn,
      compareBtn,
    ]),
  ]);
}

function buildInspectorView(result) {
  const wrap = el('div', { class: 'inspector' });
  if (result.crawl) {
    wrap.appendChild(
      el('table', { class: 'counts' }, [
        el('tr', {}, [el('th', {}, 'requested'), el('td', {}, result.crawl.requestedUrl)]),
        el('tr', {}, [
          el('th', {}, 'pages discovered'),
          el('td', {}, String(result.crawl.pagesDiscovered)),
        ]),
        el('tr', {}, [
          el('th', {}, 'pages snapshotted'),
          el('td', {}, String(result.crawl.pagesSnapshotted)),
        ]),
      ]),
    );
  }
  for (const page of result.inspector || []) {
    const ctaItems = (page.topCtas || []).map((c) =>
      el(
        'li',
        {},
        `${c.text || '(unnamed)'} — weight ${c.visualWeight}, ${c.landmark}, ${c.foldGuess}`,
      ),
    );
    wrap.appendChild(
      el('details', { class: 'group' }, [
        el(
          'summary',
          {},
          `${page.pathRef} — ${page.ctaCount} CTAs, ${page.formCount} forms, ${page.headingCount} headings`,
        ),
        el('p', {}, [el('strong', {}, 'title '), page.title || '(none)']),
        page.cssSystem ? el('p', {}, [el('strong', {}, 'css '), page.cssSystem]) : null,
        ctaItems.length > 0
          ? el('ul', {}, ctaItems)
          : el('p', {}, 'no CTAs extracted'),
      ]),
    );
  }
  return wrap;
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
