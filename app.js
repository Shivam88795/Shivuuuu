(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  Public site: sab log sirf dekh / copy / sound sun sakte hain.
   *  Admin mode: sirf tab jab browser me tumhara GitHub token ho jo
   *  is repo me write kar sake. Bina token ke koi kuch save nahi kar sakta
   *  (GitHub khud rok deta hai).
   * ------------------------------------------------------------------ */

  const API = 'https://api.github.com';
  const TOKEN_KEY = 'reelsite_gh_token';
  const MAX_SOUND = 3 * 1024 * 1024; // 3 MB
  const cfg = window.SITE_CONFIG || {};

  const state = {
    data: { profile: { name: '', bio: '', avatar: '', sound: '' }, reels: [] },
    isAdmin: false,
    token: null,
    owner: '',
    repo: '',
    branch: 'main',
    overrides: { avatar: null, sound: null }, // owner ko turant preview dikhane ke liye
    query: '' // search box ka text
  };

  /* ------------------------------ helpers ------------------------------ */

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return el;
  }
  const $ = (s, r = document) => r.querySelector(s);

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = ''), isErr ? 5000 : 2600);
  }

  function detectRepo() {
    let owner = cfg.owner || '';
    let repo = cfg.repo || '';
    if ((!owner || !repo) && location.hostname.endsWith('.github.io')) {
      owner = owner || location.hostname.split('.')[0];
      const seg = location.pathname.split('/')[1];
      repo = repo || (seg && !seg.includes('.') ? seg : owner + '.github.io');
    }
    state.owner = owner;
    state.repo = repo;
  }

  function parseInsta(url) {
    const m = String(url || '').trim().match(
      /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]+)/i
    );
    if (!m) return null;
    const t = m[1].toLowerCase();
    const type = t.startsWith('reel') ? 'reel' : t;
    return { type, code: m[2], url: `https://www.instagram.com/${type}/${m[2]}/` };
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = h('textarea', { style: 'position:fixed;opacity:0;top:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      ta.remove();
      return ok;
    }
  }

  /* ------------------------------- sound ------------------------------- */

  let audio = null;
  let actx = null;
  function chime() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime;
      [[660, 0], [880, 0.12], [1320, 0.24]].forEach(([f, d]) => {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        o.connect(g);
        g.connect(actx.destination);
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.5);
        o.start(t + d);
        o.stop(t + d + 0.55);
      });
    } catch (_) {}
  }
  function playSound() {
    const src = state.overrides.sound || state.data.profile.sound;
    if (!src) { chime(); return; }
    try { if (audio) audio.pause(); } catch (_) {}
    audio = new Audio(src);
    audio.play().catch(() => chime());
  }

  /* ------------------------------ rendering ---------------------------- */

  function avatarSrc() {
    return state.overrides.avatar || state.data.profile.avatar || '';
  }

  function header() {
    const p = state.data.profile;
    const wrap = h('div', { class: 'avatar-wrap' });
    const btn = h('button', {
      class: 'avatar',
      type: 'button',
      'aria-label': 'Play sound',
      onclick: () => {
        wrap.classList.remove('pop');
        void wrap.offsetWidth;
        wrap.classList.add('pop');
        playSound();
      }
    }, avatarSrc()
      ? h('img', { src: avatarSrc(), alt: p.name || 'Profile picture' })
      : h('span', { class: 'initial' }, (p.name || '?').trim().charAt(0).toUpperCase() || '?'));
    wrap.append(btn);
    return h('section', { class: 'hero' },
      wrap,
      h('p', { class: 'hint' }, 'Tap the photo 🔊'),
      h('h1', {}, p.name || 'Your Name'),
      p.bio ? h('p', { class: 'bio' }, p.bio) : null
    );
  }

  function reelCard(r, i, total, canMove) {
    const embed = r.code
      ? h('div', { class: 'embed' }, h('iframe', {
          src: `https://www.instagram.com/${r.type}/${r.code}/embed/`,
          loading: 'lazy',
          allowfullscreen: true,
          scrolling: 'no',
          title: r.title || 'Instagram reel'
        }))
      : null;

    const copyBtn = h('button', { class: 'btn primary', type: 'button' }, '📋 Copy prompt');
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(r.prompt || '');
      copyBtn.textContent = ok ? '✓ Copied!' : 'Copy nahi hua';
      setTimeout(() => (copyBtn.textContent = '📋 Copy prompt'), 1600);
    });

    const actions = h('div', { class: 'row' },
      r.prompt ? copyBtn : null,
      h('a', { class: 'btn', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open ↗')
    );

    const admin = state.isAdmin
      ? h('div', { class: 'admin-row' },
          canMove ? h('button', { class: 'btn small', type: 'button', disabled: i === 0, onclick: () => moveReel(i, -1) }, '↑') : null,
          canMove ? h('button', { class: 'btn small', type: 'button', disabled: i === total - 1, onclick: () => moveReel(i, 1) }, '↓') : null,
          h('button', { class: 'btn small', type: 'button', onclick: () => openReelSheet(r) }, '✎ Edit'),
          h('button', { class: 'btn small danger', type: 'button', onclick: () => deleteReel(r) }, '🗑 Delete')
        )
      : null;

    return h('article', { class: 'card' },
      embed,
      h('div', { class: 'body' },
        r.title ? h('div', { class: 'title' }, highlight(r.title, state.query)) : null,
        r.prompt ? h('div', {}, h('div', { class: 'label' }, 'Prompt'), h('div', { class: 'prompt' }, r.prompt)) : null,
        actions,
        admin
      )
    );
  }

  // Title me match hue words ko highlight karta hai.
  function highlight(text, query) {
    const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return text;
    const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
    const re = new RegExp('(' + esc.join('|') + ')', 'gi');
    return text.split(re).map((part, i) => (i % 2 ? h('mark', {}, part) : part));
  }

  const SEARCH_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>';

  // Search: sirf title me dhundhta hai. Type kiye hue har word ka title me hona zaroori hai.
  function visibleReels() {
    const all = (state.data.reels || []).map((r, i) => ({ r, i }));
    const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return { list: all, filtering: false };
    const list = all.filter(({ r }) => {
      const title = (r.title || '').toLowerCase();
      return terms.every((t) => title.includes(t));
    });
    return { list, filtering: true };
  }

  function reelsSection() {
    const total = (state.data.reels || []).length;
    const countEl = h('span', { class: 'count' });
    const grid = h('div', { class: 'grid' });
    const input = h('input', {
      type: 'search',
      class: 'search-input',
      placeholder: 'Search reels by title…',
      'aria-label': 'Search reels',
      value: state.query,
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      enterkeyhint: 'search'
    });
    const clear = h('button', {
      class: 'search-clear',
      type: 'button',
      'aria-label': 'Clear search',
      onclick: () => { input.value = ''; state.query = ''; paint(); input.focus(); }
    }, '×');
    const chip = h('span', { class: 'search-chip', 'aria-hidden': 'true' });
    const kbd = h('kbd', { class: 'search-kbd', 'aria-hidden': 'true' }, '/');
    const icon = h('span', { class: 'search-icon', 'aria-hidden': 'true' });
    icon.innerHTML = SEARCH_SVG;
    const box = h('div', { class: 'search-box' },
      h('div', { class: 'search-field' }, icon, input, chip, kbd, clear));

    function paint() {
      const { list, filtering } = visibleReels();
      const has = !!state.query;
      clear.classList.toggle('show', has);
      box.classList.toggle('has-text', has);
      chip.classList.toggle('show', filtering);
      chip.classList.toggle('none', filtering && !list.length);
      chip.textContent = filtering ? (list.length ? `${list.length} found` : 'No match') : '';
      countEl.textContent = !total ? '' : filtering ? `${list.length} of ${total}` : `${total} reel${total > 1 ? 's' : ''}`;
      grid.replaceChildren(...(list.length
        ? list.map(({ r, i }) => reelCard(r, i, total, !filtering))
        : [h('div', { class: 'empty' }, total
            ? `"${state.query.trim()}" se koi reel nahi mili.`
            : 'Abhi koi reel nahi hai. Jaldi hi aayengi ✨')]));
    }

    input.addEventListener('input', () => { state.query = input.value; paint(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape' && state.query) { input.value = ''; state.query = ''; paint(); }
    });
    paint();

    // "/" dabao to search box me seedha cursor aa jaye (desktop)
    if (!window.__slashSearch) {
      window.__slashSearch = true;
      document.addEventListener('keydown', (e) => {
        const tag = (e.target && e.target.tagName) || '';
        if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(tag)) return;
        if (document.querySelector('.overlay')) return;
        const el = document.querySelector('.search-input');
        if (el) { e.preventDefault(); el.focus(); }
      });
    }

    return h('section', {},
      h('div', { class: 'sec-head' }, h('h2', {}, 'Reels & Prompts'), countEl),
      total > 0 ? h('div', { class: 'search' }, box) : null,
      grid
    );
  }

  function render() {
    const p = state.data.profile;
    document.title = p.name ? `${p.name} · Reels & Prompts` : 'Reels & Prompts';
    $('#app').replaceChildren(header(), reelsSection(), h('footer', {}, '© ' + (p.name || '')));
    renderFab();
  }

  function renderFab() {
    const old = $('.fab');
    if (old) old.remove();
    if (!state.isAdmin) return;
    document.body.append(h('button', { class: 'fab', type: 'button', onclick: openMenu }, '⚙ Admin'));
  }

  /* ------------------------------ GitHub API --------------------------- */

  function authHeaders(token) {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }
  const contentsUrl = (path) =>
    `${API}/repos/${state.owner}/${state.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  async function ghError(res, fallback) {
    let msg = fallback;
    try { const j = await res.json(); if (j && j.message) msg += ' (' + j.message + ')'; } catch (_) {}
    return new Error(msg);
  }

  async function verifyToken(token) {
    if (!state.owner || !state.repo) {
      throw new Error('Repo detect nahi hua. config.js me owner aur repo likho.');
    }
    const res = await fetch(`${API}/repos/${state.owner}/${state.repo}`, { headers: authHeaders(token) });
    if (res.status === 401) throw new Error('Token galat hai ya expire ho gaya.');
    if (!res.ok) throw new Error('Is repo ka access nahi mila. Token me sahi repository select kiya?');
    const j = await res.json();
    if (j.permissions && j.permissions.push === false) {
      throw new Error('Token ko is repo me write permission nahi hai (Contents: Read and write chahiye).');
    }
    return j.default_branch || 'main';
  }

  async function getFile(path) {
    const res = await fetch(contentsUrl(path) + '?ref=' + encodeURIComponent(state.branch), {
      headers: authHeaders(state.token),
      cache: 'no-store'
    });
    if (res.status === 404) return null;
    if (!res.ok) throw await ghError(res, 'File padh nahi payi: ' + path);
    return res.json();
  }

  async function putFile(path, b64, message) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await getFile(path);
      const body = { message, content: b64, branch: state.branch };
      if (existing && existing.sha) body.sha = existing.sha;
      const res = await fetch(contentsUrl(path), {
        method: 'PUT',
        headers: { ...authHeaders(state.token), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) return res.json();
      if (res.status === 409 && attempt === 0) continue; // sha purana tha, dobara try
      if (res.status === 403 || res.status === 404) {
        throw await ghError(res, 'Save nahi hua. Token ka Contents permission "Read and write" hai?');
      }
      throw await ghError(res, 'Save nahi hua');
    }
  }

  const textToB64 = (s) => bufToB64(new TextEncoder().encode(s));
  function bufToB64(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }
  const blobToB64 = async (blob) => bufToB64(await blob.arrayBuffer());
  const b64ToText = (b64) =>
    new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

  async function saveData(message) {
    state.data.updated = new Date().toISOString();
    await putFile('data.json', textToB64(JSON.stringify(state.data, null, 2) + '\n'), message);
  }

  async function loadPublicData() {
    const res = await fetch('data.json?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('data.json load nahi hua');
    return res.json();
  }

  async function loadAdminData() {
    // Admin ko hamesha latest (GitHub repo se) data dikhe, Pages ka purana cache nahi.
    const f = await getFile('data.json');
    return f ? JSON.parse(b64ToText(f.content)) : null;
  }

  function normalize(d) {
    d = d || {};
    d.profile = Object.assign({ name: '', bio: '', avatar: '', sound: '' }, d.profile || {});
    d.reels = Array.isArray(d.reels) ? d.reels : [];
    return d;
  }

  /* ------------------------------ admin UI ----------------------------- */

  function closeSheet() {
    const o = $('.overlay');
    if (o) o.remove();
  }
  function openSheet(...content) {
    closeSheet();
    const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) closeSheet(); } },
      h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, content));
    document.body.append(ov);
    const first = ov.querySelector('input,textarea');
    if (first) first.focus();
    return ov;
  }

  async function busy(btn, label, fn) {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try { await fn(); }
    catch (e) { toast(e.message || String(e), true); }
    finally { btn.disabled = false; btn.textContent = old; }
  }

  function openLogin() {
    const tokenInput = h('input', { type: 'password', id: 'tok', placeholder: 'github_pat_…', autocomplete: 'off' });
    const btn = h('button', { class: 'btn primary', type: 'button' }, 'Login');
    btn.addEventListener('click', () => busy(btn, 'Checking…', async () => {
      const token = tokenInput.value.trim();
      if (!token) throw new Error('Token paste karo.');
      state.branch = await verifyToken(token);
      state.token = token;
      localStorage.setItem(TOKEN_KEY, token);
      state.isAdmin = true;
      const d = await loadAdminData();
      if (d) state.data = normalize(d);
      history.replaceState(null, '', location.pathname + location.search);
      closeSheet();
      render();
      toast('Admin mode ON ✓');
    }));
    openSheet(
      h('h3', {}, 'Owner login'),
      h('p', { class: 'sub' }, 'Sirf site ka malik. Apna GitHub token yahan paste karo. Ye sirf is device ke browser me save hota hai.'),
      h('div', { class: 'field' }, h('label', { for: 'tok' }, 'GitHub token'), tokenInput),
      h('div', { class: 'row' }, btn, h('button', { class: 'btn', type: 'button', onclick: closeSheet }, 'Cancel'))
    );
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    state.token = null;
    state.isAdmin = false;
    state.overrides = { avatar: null, sound: null };
    closeSheet();
    loadPublicData().then((d) => { state.data = normalize(d); render(); }).catch(() => render());
    toast('Logout ho gaya');
  }

  function openMenu() {
    openSheet(
      h('h3', {}, 'Admin'),
      h('p', { class: 'sub' }, `Repo: ${state.owner}/${state.repo}`),
      h('div', { class: 'menu' },
        h('button', { class: 'btn', type: 'button', onclick: openProfileSheet }, '👤 Edit profile, photo & sound'),
        h('button', { class: 'btn', type: 'button', onclick: () => openReelSheet(null) }, '➕ Add new reel + prompt'),
        h('button', { class: 'btn danger', type: 'button', onclick: logout }, 'Logout'),
        h('p', { class: 'note' }, 'Save ke baad live site pe change aane me 1–2 minute lag sakte hain (GitHub Pages rebuild).')
      )
    );
  }

  function fileToAvatar(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(img.width, img.height);
        const out = 512;
        const c = document.createElement('canvas');
        c.width = c.height = out;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, out, out);
        URL.revokeObjectURL(url);
        c.toBlob((blob) => (blob ? resolve({ blob, dataUrl: c.toDataURL('image/jpeg', 0.9) }) : reject(new Error('Image process nahi hui'))), 'image/jpeg', 0.9);
      };
      img.onerror = () => reject(new Error('Ye image padh nahi payi. JPG ya PNG try karo.'));
      img.src = url;
    });
  }

  function openProfileSheet() {
    const p = state.data.profile;
    const name = h('input', { type: 'text', id: 'pn', value: p.name || '', maxlength: '60' });
    const bio = h('textarea', { id: 'pb', maxlength: '300' }, p.bio || '');
    const avatar = h('input', { type: 'file', id: 'pa', accept: 'image/*' });
    const sound = h('input', { type: 'file', id: 'ps', accept: 'audio/*,.mp3,.wav,.ogg,.m4a' });
    let removeSound = false;
    const rmBtn = h('button', { class: 'btn small', type: 'button' }, 'Remove current sound');
    rmBtn.addEventListener('click', () => { removeSound = true; rmBtn.textContent = 'Sound hat jaayegi (Save dabao)'; });
    const testBtn = h('button', { class: 'btn small', type: 'button', onclick: playSound }, '▶ Test sound');
    const save = h('button', { class: 'btn primary', type: 'button' }, 'Save');

    save.addEventListener('click', () => busy(save, 'Saving…', async () => {
      const np = { ...state.data.profile, name: name.value.trim(), bio: bio.value.trim() };
      const stamp = Date.now();

      if (avatar.files[0]) {
        const { blob, dataUrl } = await fileToAvatar(avatar.files[0]);
        const path = `assets/avatar-${stamp}.jpg`;
        await putFile(path, await blobToB64(blob), 'Update profile picture');
        np.avatar = path;
        state.overrides.avatar = dataUrl;
      }
      if (sound.files[0]) {
        const f = sound.files[0];
        if (f.size > MAX_SOUND) throw new Error('Sound 3 MB se chhoti honi chahiye.');
        const ext = (f.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
        const path = `assets/sound-${stamp}.${ext}`;
        await putFile(path, await blobToB64(f), 'Update profile sound');
        np.sound = path;
        state.overrides.sound = URL.createObjectURL(f);
      } else if (removeSound) {
        np.sound = '';
        state.overrides.sound = null;
      }

      state.data.profile = np;
      await saveData('Update profile');
      closeSheet();
      render();
      toast('Profile save ho gaya ✓ (live hone me 1–2 min)');
    }));

    openSheet(
      h('h3', {}, 'Edit profile'),
      h('p', { class: 'sub' }, 'Photo square me crop hoke chhoti ho jaati hai. Sound max 3 MB.'),
      h('div', { class: 'field' }, h('label', { for: 'pn' }, 'Name'), name),
      h('div', { class: 'field' }, h('label', { for: 'pb' }, 'Bio'), bio),
      h('div', { class: 'field' }, h('label', { for: 'pa' }, 'Profile picture (naya choose karo)'), avatar),
      h('div', { class: 'field' }, h('label', { for: 'ps' }, 'Click sound (mp3 / wav / ogg / m4a)'), sound,
        h('div', { class: 'row' }, testBtn, p.sound ? rmBtn : null)),
      h('div', { class: 'row' }, save, h('button', { class: 'btn', type: 'button', onclick: closeSheet }, 'Cancel'))
    );
  }

  function openReelSheet(reel) {
    const editing = !!reel;
    const link = h('input', { type: 'url', id: 'rl', placeholder: 'https://www.instagram.com/reel/XXXXXXXX/', value: reel ? reel.url : '' });
    const title = h('input', { type: 'text', id: 'rt', placeholder: 'Optional heading', value: reel ? reel.title || '' : '', maxlength: '120' });
    const prompt = h('textarea', { id: 'rp', placeholder: 'Is reel ka prompt yahan paste karo…' }, reel ? reel.prompt || '' : '');
    const save = h('button', { class: 'btn primary', type: 'button' }, editing ? 'Update reel' : 'Add reel');

    save.addEventListener('click', () => busy(save, 'Saving…', async () => {
      const info = parseInsta(link.value);
      if (!info) throw new Error('Sahi Instagram reel/post link daalo (instagram.com/reel/…).');
      const entry = {
        id: reel ? reel.id : Date.now().toString(36),
        url: info.url,
        type: info.type,
        code: info.code,
        title: title.value.trim(),
        prompt: prompt.value.trim()
      };
      if (editing) {
        const i = state.data.reels.findIndex((x) => x.id === reel.id);
        if (i > -1) state.data.reels[i] = entry;
      } else {
        state.data.reels.unshift(entry); // naya sabse upar
      }
      await saveData(editing ? 'Update reel' : 'Add reel');
      closeSheet();
      render();
      toast('Save ho gaya ✓ (live hone me 1–2 min)');
    }));

    openSheet(
      h('h3', {}, editing ? 'Edit reel' : 'Add reel'),
      h('p', { class: 'sub' }, 'Instagram link paste karo aur uska prompt likho. Jitni chaho utni reels add kar sakte ho.'),
      h('div', { class: 'field' }, h('label', { for: 'rl' }, 'Instagram reel link'), link),
      h('div', { class: 'field' }, h('label', { for: 'rt' }, 'Title (optional)'), title),
      h('div', { class: 'field' }, h('label', { for: 'rp' }, 'Prompt'), prompt),
      h('div', { class: 'row' }, save, h('button', { class: 'btn', type: 'button', onclick: closeSheet }, 'Cancel'))
    );
  }

  async function moveReel(i, dir) {
    const arr = state.data.reels;
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    render();
    try { await saveData('Reorder reels'); toast('Order save ho gaya ✓'); }
    catch (e) { toast(e.message, true); }
  }

  async function deleteReel(r) {
    if (!confirm('Is reel ko delete karna hai?')) return;
    state.data.reels = state.data.reels.filter((x) => x.id !== r.id);
    render();
    try { await saveData('Delete reel'); toast('Delete ho gaya ✓'); }
    catch (e) { toast(e.message, true); }
  }

  /* -------------------------------- boot ------------------------------- */

  async function boot() {
    detectRepo();

    // 1) Public data (har visitor ke liye)
    try { state.data = normalize(await loadPublicData()); }
    catch (e) { toast('Data load nahi hua', true); }
    render();

    // 2) Agar is device me pehle se owner token hai to admin mode chalu
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) {
      try {
        state.branch = await verifyToken(saved);
        state.token = saved;
        state.isAdmin = true;
        const d = await loadAdminData();
        if (d) state.data = normalize(d);
        render();
      } catch (e) {
        localStorage.removeItem(TOKEN_KEY);
        state.isAdmin = false;
        toast('Admin login expire: ' + e.message, true);
      }
    }

    // 3) Hidden login: URL ke end me #admin lagao
    const checkHash = () => {
      if (location.hash === '#admin' && !state.isAdmin) openLogin();
    };
    window.addEventListener('hashchange', checkHash);
    checkHash();
  }

  boot();
})();
