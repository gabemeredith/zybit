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
  // Persistent across run-pane re-renders so streaming logs keep their scroll.
  const logPane = el('section', { class: 'logpane' });
  const urlControls = buildUrlAuditControls(runPane, logPane);
  const dataPane = buildDataBrowser();
  root.appendChild(el('div', {}, [header, controls, urlControls, runPane, logPane, dataPane]));

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
      await pollRun(r.body.runId, runPane, logPane);
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

async function pollRun(runId, runPane, logPane) {
  let lastProgressCount = -1;
  let renderedLogs = 0;
  const logSink = logPane ? initLogPane(logPane) : null;
  for (;;) {
    // `sinceLog` fetches only log entries we haven't rendered yet.
    const { body } = await api(
      `/lighthouse/api/runs/${encodeURIComponent(runId)}?sinceLog=${renderedLogs}`,
    );
    if (!body) {
      clear(runPane);
      runPane.appendChild(el('p', { class: 'error' }, 'run vanished'));
      return;
    }
    if (logSink && Array.isArray(body.logs) && body.logs.length) {
      logSink.append(body.logs);
      renderedLogs = body.logTotal ?? renderedLogs + body.logs.length;
    } else if (typeof body.logTotal === 'number') {
      renderedLogs = body.logTotal;
    }
    if ((body.progress?.length ?? 0) !== lastProgressCount || body.status !== 'running') {
      lastProgressCount = body.progress?.length ?? 0;
      renderRunState(runPane, body, runId);
    }
    if (body.status !== 'running') {
      if (logSink) logSink.markDone();
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

// --- Developer log panel --------------------------------------------------
//
// Streams the per-run `console` capture (pipeline steps, DB writes, and every
// LLM call) into a scrollable pane. Lives outside the run pane so re-renders
// don't reset scroll. Category filters default to all-on; "AI/LLM" is the one
// you usually want when QA-ing the LLM path.

const LOG_CATEGORIES = [
  ['ai', 'AI/LLM'],
  ['snapshot', 'snapshot'],
  ['db', 'db'],
  ['pipeline', 'pipeline'],
  ['http', 'http'],
  ['other', 'other'],
];

const AI_FIELD_KEYS = ['service', 'model', 'promptTokens', 'responseTokens', 'totalTokens', 'latencyMs', 'outcome'];

function initLogPane(logPane) {
  clear(logPane);
  const stream = el('div', { class: 'log-stream' });
  const counter = el('span', { class: 'log-count' }, '0 lines');

  const filters = LOG_CATEGORIES.map(([cat, label]) => {
    const cb = el('input', { type: 'checkbox', checked: 'checked', 'data-cat': cat });
    cb.addEventListener('change', () => {
      stream.classList.toggle(`hide-${cat}`, !cb.checked);
    });
    return el('label', { class: `log-filter cat-${cat}` }, [cb, ' ', label]);
  });

  logPane.appendChild(
    el('div', { class: 'log-head' }, [
      el('h2', {}, 'logs'),
      el('div', { class: 'log-filters' }, filters),
      counter,
    ]),
  );
  logPane.appendChild(stream);

  let count = 0;
  return {
    append(entries) {
      // Autoscroll only if the user is already near the bottom.
      const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 40;
      for (const e of entries) stream.appendChild(renderLogLine(e));
      count += entries.length;
      counter.textContent = `${count} line${count === 1 ? '' : 's'}`;
      if (nearBottom) stream.scrollTop = stream.scrollHeight;
    },
    markDone() {
      stream.appendChild(el('div', { class: 'log-line log-info cat-other log-end' }, '— run finished —'));
      stream.scrollTop = stream.scrollHeight;
    },
  };
}

function renderLogLine(e) {
  const time = (e.ts || '').slice(11, 23);
  const children = [
    el('span', { class: 'log-ts' }, time),
    el('span', { class: `log-cat cat-badge-${e.category}` }, e.category),
    el('span', { class: 'log-msg' }, e.message || ''),
  ];
  // Surface the useful LLM fields inline (tokens, model, latency).
  if (e.fields && e.category === 'ai') {
    const bits = AI_FIELD_KEYS.filter((k) => e.fields[k] != null).map((k) => `${k}=${e.fields[k]}`);
    if (bits.length) children.push(el('span', { class: 'log-fields' }, bits.join(' ')));
  }
  return el('div', { class: `log-line log-${e.level} cat-${e.category}` }, children);
}

function renderRunState(runPane, state, runId) {
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
    if (layerB) left.appendChild(buildLayerBPanel(layerB, runId));
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

function buildLayerBPanel(layerB, runId) {
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
    buildCalibrationPanel(layerB, runId),
  ]);
}

// --- Eval calibration: blind human labeling vs the LLM judge ---------------
//
// "Eval the evaluator." Before we trust the judge's win-rate, a human labels
// each prose pair BLIND (we hide which side is template vs LLM and randomize
// A/B order per card), then we run the judge over the same run and report the
// human-vs-judge agreement %. Below ~80% the judge isn't calibrated and its
// win-rate shouldn't be trusted yet. Consumes POST /lighthouse/api/eval.

const CALIBRATION_AGREEMENT_THRESHOLD = 0.8;

function buildCalibrationPanel(layerB, runId) {
  // Only findings with BOTH a template and an LLM version can be compared —
  // same filter the eval runner applies (f.prose.llm truthy).
  const pairs = (layerB.findings || []).filter((f) => f.prose && f.prose.llm);

  if (pairs.length === 0) {
    return el('details', { class: 'group calib-panel' }, [
      el('summary', {}, 'Eval calibration — judge vs human'),
      el(
        'p',
        { class: 'empty' },
        'No comparable pairs this run (every finding fell back to template, so there is no LLM prose to judge).',
      ),
    ]);
  }

  // human picks: findingId -> 'llm' | 'template' | 'tie'
  const humanPicks = {};
  const resultBox = el('div', { class: 'calib-result' });
  const scoreBtn = el('button', { type: 'button', class: 'primary' }, 'score against judge');

  const cards = pairs.map((f) => {
    // Blind + randomize A/B per card so the human isn't cued by position or
    // by knowing which slot is the machine.
    const aIsLlm = Math.random() < 0.5;
    const proseA = aIsLlm ? f.prose.llm : f.prose.template;
    const proseB = aIsLlm ? f.prose.template : f.prose.llm;
    const pickOf = (slot) => (slot === 'tie' ? 'tie' : slot === 'A' ? (aIsLlm ? 'llm' : 'template') : aIsLlm ? 'template' : 'llm');

    const btns = ['A', 'tie', 'B'].map((slot) =>
      el('button', { type: 'button', class: 'calib-pick', 'data-slot': slot },
        slot === 'tie' ? 'tie' : `${slot} is better`),
    );
    const btnRow = el('div', { class: 'calib-pick-row' }, btns);
    btns.forEach((btn) => {
      btn.addEventListener('click', () => {
        humanPicks[f.findingId] = pickOf(btn.getAttribute('data-slot'));
        btns.forEach((b) => b.classList.remove('is-picked'));
        btn.classList.add('is-picked');
      });
    });

    return el('div', { class: 'calib-card', 'data-finding': f.findingId }, [
      el('div', { class: 'calib-card-head' }, [
        el('code', {}, `${f.ruleId}${f.pathRef ? ' · ' + f.pathRef : ''}`),
      ]),
      el('div', { class: 'calib-side' }, [
        proseBlock('A', proseA),
        proseBlock('B', proseB),
      ]),
      btnRow,
    ]);
  });

  scoreBtn.addEventListener('click', async () => {
    const labeled = Object.keys(humanPicks);
    if (labeled.length === 0) {
      clear(resultBox);
      resultBox.appendChild(el('p', { class: 'error' }, 'Label at least one pair first.'));
      return;
    }
    scoreBtn.setAttribute('disabled', 'disabled');
    clear(resultBox);
    resultBox.appendChild(el('p', { class: 'loading' }, 'judging…'));
    try {
      const r = await api('/lighthouse/api/eval', {
        method: 'POST',
        body: JSON.stringify({ runId }),
      });
      if (!r.ok) throw new Error((r.body && (r.body.detail || r.body.error)) || `http ${r.status}`);
      renderCalibrationResult(resultBox, r.body, humanPicks);
    } catch (err) {
      clear(resultBox);
      resultBox.appendChild(el('p', { class: 'error' }, `eval failed: ${err.message}`));
    } finally {
      scoreBtn.removeAttribute('disabled');
    }
  });

  return el('details', { class: 'group calib-panel' }, [
    el('summary', {}, `Eval calibration — judge vs human (${pairs.length} pair${pairs.length === 1 ? '' : 's'})`),
    el(
      'p',
      { class: 'calib-instructions' },
      'Pick the better write-up for a PM in each pair below (blind — A/B order is randomized and neither is labeled template/LLM). Then score against the judge to see if it agrees with you.',
    ),
    ...cards,
    el('div', { class: 'calib-actions' }, [scoreBtn]),
    resultBox,
  ]);
}

function renderCalibrationResult(box, report, humanPicks) {
  clear(box);
  const judgeByFinding = {};
  for (const pf of report.perFinding || []) judgeByFinding[pf.findingId] = pf.winner;

  // Compare only pairs the human labeled AND the judge also judged.
  const rows = [];
  let agree = 0;
  let compared = 0;
  for (const [findingId, humanPick] of Object.entries(humanPicks)) {
    const judgePick = judgeByFinding[findingId];
    if (judgePick === undefined) continue;
    compared += 1;
    const match = humanPick === judgePick;
    if (match) agree += 1;
    rows.push({ findingId, humanPick, judgePick, match });
  }

  const agreement = compared ? agree / compared : 0;
  const pass = compared > 0 && agreement >= CALIBRATION_AGREEMENT_THRESHOLD;

  box.appendChild(
    el('table', { class: 'counts' }, [
      el('tr', {}, [el('th', {}, 'judge LLM win-rate'), el('td', {}, `${Math.round((report.llmWinRate || 0) * 100)}% (${report.llmWins}/${report.judged})`)]),
      el('tr', {}, [el('th', {}, 'you labeled'), el('td', {}, String(Object.keys(humanPicks).length))]),
      el('tr', {}, [el('th', {}, 'judge ↔ human agreement'), el('td', {}, `${agree}/${compared} (${Math.round(agreement * 100)}%)`)]),
    ]),
  );

  box.appendChild(
    el('p', { class: pass ? 'calib-verdict is-pass' : 'calib-verdict is-fail' },
      compared === 0
        ? 'No overlap between your labels and the judged pairs — label some of the pairs above and re-score.'
        : pass
          ? `✓ Judge agrees with you ${Math.round(agreement * 100)}% of the time (≥ ${Math.round(CALIBRATION_AGREEMENT_THRESHOLD * 100)}%). Its win-rate is trustworthy.`
          : `✗ Judge agrees only ${Math.round(agreement * 100)}% of the time (< ${Math.round(CALIBRATION_AGREEMENT_THRESHOLD * 100)}%). Do NOT trust the win-rate yet — refine the judge prompt or label more pairs.`),
  );

  if (rows.length) {
    box.appendChild(
      el('table', { class: 'counts calib-breakdown' }, [
        el('tr', {}, [el('th', {}, 'finding'), el('th', {}, 'you'), el('th', {}, 'judge'), el('th', {}, '')]),
        ...rows.map((row) =>
          el('tr', {}, [
            el('td', {}, el('code', {}, row.findingId)),
            el('td', {}, row.humanPick),
            el('td', {}, row.judgePick),
            el('td', {}, row.match ? '✓' : '✗'),
          ]),
        ),
      ]),
    );
  }
}

function buildUrlAuditControls(runPane, logPane) {
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
      await pollRun(r.body.runId, runPane, logPane);
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

  // Owned-site presets — one click runs the full LLM surface (vision +
  // copy-critique + Layer B + fix-preview + variant advisor) against a site we
  // own, so QA-ing the LLM PR is a single button. Vision/page counts are kept
  // small to bound Browserless + OpenAI spend.
  const FULL_DEPTH = {
    layerB: true,
    layerBDeriveFacts: true,
    visionPagesLimit: 3,
    fixPreview: true,
    variantAdvisor: true,
  };
  function makePreset(label, url) {
    const btn = el(
      'button',
      { type: 'button', class: 'preset-btn', title: `Audit ${url} at full LLM depth` },
      label,
    );
    btn.addEventListener('click', () => {
      urlInput.value = url;
      pagesInput.value = '6';
      void runAudit(FULL_DEPTH);
    });
    return btn;
  }

  return el('section', { class: 'controls' }, [
    el('div', { class: 'control-row' }, [
      el('label', {}, ['audit url ', urlInput]),
      el('label', {}, ['max pages ', pagesInput]),
      auditBtn,
      compareBtn,
    ]),
    el('div', { class: 'control-row preset-row' }, [
      el('span', { class: 'preset-label' }, 'owned sites — full LLM depth:'),
      makePreset('commitmint.app', 'https://commitmint.app'),
      makePreset('cohor7.com', 'https://cohor7.com'),
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
  if (Array.isArray(result.fixPreviews) && result.fixPreviews.length) {
    wrap.appendChild(buildFixPreviewView(result.fixPreviews));
  }
  if (Array.isArray(result.variantProposals) && result.variantProposals.length) {
    wrap.appendChild(buildVariantProposalView(result.variantProposals));
  }
  return wrap;
}

function buildFixPreviewView(previews) {
  const withAfter = previews.filter((p) => p.afterUrl).length;
  const cards = previews.map((p) => {
    const head = el('div', { class: 'fp-head' }, [
      el('code', {}, `${p.ruleId}${p.pathRef ? ' · ' + p.pathRef : ''}`),
      el('span', { class: 'fp-tier' }, p.tier ? `tier ${p.tier}` : p.reason),
    ]);
    const imgs = [];
    if (p.beforeUrl) imgs.push(el('figure', { class: 'fp-fig' }, [el('img', { src: p.beforeUrl, alt: 'before' }), el('figcaption', {}, 'before')]));
    if (p.afterUrl) imgs.push(el('figure', { class: 'fp-fig' }, [el('img', { src: p.afterUrl, alt: 'after' }), el('figcaption', {}, 'after')]));
    return el('div', { class: 'fp-card' }, [
      head,
      imgs.length ? el('div', { class: 'fp-imgs' }, imgs) : el('p', { class: 'empty' }, `no preview (${p.reason})`),
      p.rationale ? el('p', { class: 'fp-rationale' }, p.rationale) : null,
    ]);
  });
  return el('details', { class: 'group', open: 'open' }, [
    el('summary', {}, `fix previews — ${withAfter}/${previews.length} with after-image`),
    ...cards,
  ]);
}

function buildVariantProposalView(proposals) {
  const totalOptions = proposals.reduce((n, v) => n + (v.options ? v.options.length : 0), 0);
  const cards = proposals.map((v) => {
    const head = el('div', { class: 'vp-head' }, [
      el('code', {}, `${v.ruleId}${v.pathRef ? ' · ' + v.pathRef : ''}`),
      v.error ? el('span', { class: 'vp-error' }, v.error) : el('span', {}, `${v.options.length} option(s)`),
    ]);
    const opts = (v.options || []).map((o, i) =>
      el('details', { class: 'group vp-option' }, [
        el('summary', {}, `${i + 1}. ${o.label || '(unnamed option)'} [${o.confidence || '?'}]`),
        el('pre', {}, JSON.stringify(o.modifications, null, 2)),
      ]),
    );
    return el('div', { class: 'vp-card' }, [
      head,
      v.note ? el('p', { class: 'vp-note' }, v.note) : null,
      ...opts,
    ]);
  });
  return el('details', { class: 'group', open: 'open' }, [
    el('summary', {}, `AI variant advisor — ${totalOptions} option(s) across ${proposals.length} finding(s)`),
    ...cards,
  ]);
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

// --- Read-only database browser -------------------------------------------
//
// A window onto the rows a Lighthouse run produced. Server-side it's scoped to
// lighthouse_* synthetic orgs/sites and read-only by construction. Lazy-loads
// its metadata the first time the panel is opened.

const DATA_PAGE_SIZE = 50;

function buildDataBrowser() {
  const section = el('section', { class: 'datapane' });
  const details = el('details', { class: 'group data-browser' });
  const body = el('div', { class: 'data-body' }, el('p', { class: 'loading' }, 'open to load tables…'));
  details.appendChild(el('summary', {}, 'database browser (read-only, all orgs)'));
  details.appendChild(body);
  section.appendChild(details);

  let loaded = false;
  details.addEventListener('toggle', () => {
    if (!details.open || loaded) return;
    loaded = true;
    void initDataBrowser(body);
  });
  return section;
}

function dataRowsUrl(tableName, orgId, siteId, page) {
  return (
    '/lighthouse/api/data/rows?' +
    new URLSearchParams({
      table: tableName,
      orgId: orgId || '',
      siteId: siteId || '',
      page: String(page),
      pageSize: String(DATA_PAGE_SIZE),
    }).toString()
  );
}

async function initDataBrowser(body) {
  clear(body);
  body.appendChild(el('p', { class: 'loading' }, 'loading metadata…'));
  const { ok, body: meta } = await api('/lighthouse/api/data/meta');
  clear(body);
  if (!ok || !meta) {
    body.appendChild(el('p', { class: 'error' }, 'failed to load metadata'));
    return;
  }

  // Filter every table at once. No per-table "load" button — opening the
  // panel loads the whole (lighthouse-scoped) DB; the org/site selectors
  // re-scope all tables together.
  const orgSelect = el('select', {}, [
    el('option', { value: '' }, '(all orgs)'),
    ...meta.orgs.map((o) => el('option', { value: o.id }, `${o.name} — ${o.id}`)),
  ]);
  const siteSelect = el('select', {}, [el('option', { value: '' }, '(all sites)')]);
  const tablesWrap = el('div', { class: 'data-tables' });

  function refreshSites() {
    const org = meta.orgs.find((o) => o.id === orgSelect.value);
    clear(siteSelect);
    siteSelect.appendChild(el('option', { value: '' }, '(all sites)'));
    for (const s of org?.sites ?? []) {
      siteSelect.appendChild(el('option', { value: s.id }, `${s.name} — ${s.id}`));
    }
  }

  async function loadAll() {
    clear(tablesWrap);
    tablesWrap.appendChild(el('p', { class: 'loading' }, 'loading all tables…'));
    const orgId = orgSelect.value;
    const siteId = siteSelect.value;
    const payloads = await Promise.all(
      meta.tables.map((t) =>
        api(dataRowsUrl(t.name, orgId, siteId, 0)).then((r) => ({ t, ok: r.ok, body: r.body })),
      ),
    );
    clear(tablesWrap);
    for (const p of payloads) {
      tablesWrap.appendChild(buildTableSection(p.t, p.ok, p.body, { orgId, siteId }));
    }
  }

  orgSelect.addEventListener('change', () => {
    refreshSites();
    void loadAll();
  });
  siteSelect.addEventListener('change', () => void loadAll());

  body.appendChild(
    el('div', { class: 'control-row data-controls' }, [
      el('label', {}, ['org ', orgSelect]),
      el('label', {}, ['site ', siteSelect]),
      el('span', { class: 'data-note' }, `first ${DATA_PAGE_SIZE} rows per table`),
    ]),
  );
  body.appendChild(tablesWrap);
  refreshSites();
  void loadAll();
}

// One table's rows as a collapsible section. Tables with rows open by default;
// empty ones collapse. Each section paginates independently.
function buildTableSection(tableMeta, ok, payload, filters) {
  const total = ok && payload ? payload.total : 0;
  const details = el('details', {
    class: 'group data-table-section',
    ...(total > 0 ? { open: 'open' } : {}),
  });
  details.appendChild(
    el('summary', {}, `${tableMeta.label} — ${ok ? `${total} row${total === 1 ? '' : 's'}` : 'error'}`),
  );
  const inner = el('div', { class: 'data-section-body' });
  details.appendChild(inner);

  let page = 0;
  function render(curOk, p) {
    clear(inner);
    if (!curOk || !p) {
      inner.appendChild(el('p', { class: 'error' }, 'query failed'));
      return;
    }
    renderDataTable(inner, p, {
      page,
      onPage: async (np) => {
        page = np;
        const r = await api(dataRowsUrl(tableMeta.name, filters.orgId, filters.siteId, np));
        render(r.ok, r.body);
      },
    });
  }
  render(ok, payload);
  return details;
}

function fmtCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function renderDataTable(box, payload, nav) {
  clear(box);
  const { columns, rows, total, pageSize } = payload;
  const shownFrom = rows.length ? nav.page * pageSize + 1 : 0;
  const shownTo = nav.page * pageSize + rows.length;

  // Pagination header.
  const prev = el('button', { type: 'button' }, 'prev');
  const next = el('button', { type: 'button' }, 'next');
  if (nav.page === 0) prev.setAttribute('disabled', 'disabled');
  if (shownTo >= total) next.setAttribute('disabled', 'disabled');
  prev.addEventListener('click', () => void nav.onPage(nav.page - 1));
  next.addEventListener('click', () => void nav.onPage(nav.page + 1));
  box.appendChild(
    el('div', { class: 'data-pager' }, [
      el('span', {}, `${shownFrom}–${shownTo} of ${total}`),
      prev,
      next,
    ]),
  );

  if (rows.length === 0) {
    box.appendChild(el('p', { class: 'empty' }, 'no rows'));
    return;
  }

  const head = el('tr', {}, [el('th', {}, ''), ...columns.map((c) => el('th', {}, c))]);
  const bodyRows = rows.map((row) => {
    const detail = el('tr', { class: 'data-detail' }, [
      el('td', { colspan: String(columns.length + 1) }, el('pre', {}, JSON.stringify(row, null, 2))),
    ]);
    detail.style.display = 'none';
    const toggle = el('button', { type: 'button', class: 'data-expand' }, '+');
    toggle.addEventListener('click', () => {
      const open = detail.style.display === 'none';
      detail.style.display = open ? 'table-row' : 'none';
      toggle.textContent = open ? '−' : '+';
    });
    const cells = columns.map((c) => {
      const s = fmtCell(row[c]);
      const short = s.length > 160 ? s.slice(0, 160) + '…' : s;
      return el('td', { title: s.length > 160 ? s : undefined }, short);
    });
    return [el('tr', {}, [el('td', {}, toggle), ...cells]), detail];
  });

  box.appendChild(
    el('div', { class: 'data-table-wrap' }, [
      el('table', { class: 'data-table' }, [el('thead', {}, head), el('tbody', {}, bodyRows.flat())]),
    ]),
  );
}

async function boot() {
  const authed = await checkAuth();
  if (authed) renderDashboard();
  else renderLogin();
}

boot();
