const root = document.getElementById('root');

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== undefined && v !== null) {
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

async function checkAuth() {
  const r = await fetch('/api/me', { credentials: 'same-origin' });
  const j = await r.json();
  return Boolean(j && j.authenticated);
}

function renderLogin(errorMessage) {
  clear(root);
  const form = el('form', { onSubmit: handleLogin }, [
    el('input', {
      type: 'password',
      name: 'password',
      placeholder: 'password',
      required: 'required',
      autofocus: 'autofocus',
    }),
    el('button', { type: 'submit', class: 'primary' }, 'unlock'),
    errorMessage ? el('p', { class: 'error' }, errorMessage) : null,
  ]);
  root.appendChild(
    el('section', { class: 'login' }, [el('h1', {}, 'Lighthouse'), form]),
  );
}

async function handleLogin(ev) {
  ev.preventDefault();
  const form = ev.target;
  const password = form.elements.password.value;
  const r = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ password }),
  });
  if (r.ok) {
    renderDashboard();
  } else {
    renderLogin('incorrect password');
  }
}

async function handleLogout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  renderLogin();
}

function renderDashboard() {
  clear(root);
  root.appendChild(
    el('div', {}, [
      el('header', { class: 'app-header' }, [
        el('h1', {}, 'Lighthouse'),
        el('div', { class: 'right' }, [
          el('button', { type: 'button', onClick: handleLogout }, 'log out'),
        ]),
      ]),
      el('p', { class: 'empty' }, 'scenario picker + generate button land in step 9.'),
    ]),
  );
}

async function boot() {
  const authed = await checkAuth();
  if (authed) renderDashboard();
  else renderLogin();
}

boot();
