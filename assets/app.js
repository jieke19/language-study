/*!
 * 언어 학습 일지 — 앱 로직
 * Google Sheets(링크 공개 시트)를 GViz JSONP → CSV → 내장 스냅샷 순으로 읽어 화면을 그린다.
 */
(function () {
  'use strict';

  var P = window.StudyParse;

  var SOURCES = {
    zh: {
      id: '1xLU9z-efrT0T6C9wYCHAOtofFGXlzBQTKIMRmuJLgi8',
      tab: '시트1',
      tag: 'zh-CN',
      name: '중국어',
      flag: '🇨🇳'
    },
    en: {
      id: '1po1nVbKdk8fy8WB4mgnqspdYP9VnB7E0SNYIahqocqs',
      tab: '시트1',
      tag: 'en-US',
      name: '영어',
      flag: '🇺🇸'
    }
  };

  var LS = { theme: 'ls.theme', rate: 'ls.rate', lang: 'ls.lang' };

  var state = {
    lang: read('ls.lang', 'zh') === 'en' ? 'en' : 'zh',
    q: '',
    review: false,
    rate: clamp(parseFloat(read('ls.rate', '0.85')) || 0.85, 0.5, 1.2),
    data: { zh: null, en: null },
    meta: { zh: null, en: null },
    loading: false,
    view: [],
    lastSync: null,
    flash: { cards: [], i: 0, revealed: false }
  };

  /* ---------------------------------------------------------------- utils */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function read(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function hl(text, q) {
    var out = esc(text);
    if (!q) return out;
    try {
      var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      return out.replace(re, '<mark>$1</mark>');
    } catch (e) { return out; }
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ------------------------------------------------------------- fetching */
  function gvizUrl(src, cb) {
    return 'https://docs.google.com/spreadsheets/d/' + src.id +
      '/gviz/tq?tqx=out:json%3BresponseHandler%3A' + cb +
      '&sheet=' + encodeURIComponent(src.tab) + '&headers=1&_=' + Date.now();
  }

  function gvizToRows(resp) {
    if (!resp || resp.status !== 'ok' || !resp.table) {
      throw new Error('gviz status: ' + (resp && resp.status));
    }
    var cols = resp.table.cols || [];
    var rows = [cols.map(function (c) { return c.label || ''; })];
    (resp.table.rows || []).forEach(function (r) {
      rows.push((r.c || []).map(function (c) {
        if (!c) return '';
        if (c.f !== undefined && c.f !== null) return String(c.f);
        if (c.v instanceof Date) return P.isoOf(c.v);
        return c.v === null || c.v === undefined ? '' : String(c.v);
      }));
    });
    return rows;
  }

  function loadViaGviz(src) {
    return new Promise(function (resolve, reject) {
      var cb = '__gvizCb_' + Math.random().toString(36).slice(2);
      var script = document.createElement('script');
      var settled = false;
      var timer = setTimeout(function () { finish(new Error('gviz timeout')); }, 15000);

      function finish(err, resp) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        if (err) reject(err); else resolve(resp);
      }

      window[cb] = function (resp) { finish(null, resp); };
      script.onerror = function () { finish(new Error('gviz network error')); };
      script.src = gvizUrl(src, cb);
      document.head.appendChild(script);
    }).then(gvizToRows);
  }

  function parseCsv(text) {
    text = String(text).replace(/^\uFEFF/, '');
    var rows = [], row = [], field = '', inQ = false, i = 0;
    while (i < text.length) {
      var ch = text.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function loadViaCsv(src) {
    var url = 'https://docs.google.com/spreadsheets/d/' + src.id + '/export?format=csv&_=' + Date.now();
    return fetch(url, { cache: 'no-store', mode: 'cors' }).then(function (res) {
      if (!res.ok) throw new Error('csv HTTP ' + res.status);
      return res.text();
    }).then(parseCsv);
  }

  /**
   * GViz 와 CSV 를 동시에 요청하고 먼저 성공한 쪽을 쓴다.
   * 둘 다 실패하면 내장 스냅샷으로 떨어진다.
   */
  function loadSheet(lang) {
    var src = SOURCES[lang];
    return new Promise(function (resolve) {
      var settled = false;
      var failures = 0;
      var lastErr = null;

      function win(rows, method) {
        if (settled) return;
        if (!rows || !rows.length) {
          lose(new Error(method + ' empty'));
          return;
        }
        settled = true;
        resolve({
          entries: P.parseRows(rows, { lang: lang }),
          source: 'live',
          method: method,
          at: new Date(),
          error: null
        });
      }

      function lose(err) {
        failures++;
        lastErr = err || lastErr;
        if (settled || failures < 2) return;
        settled = true;
        console.warn('[study] 실시간 연결 실패 → 스냅샷', lang, lastErr && lastErr.message);
        var snap = (window.__STUDY_SNAPSHOT__ || {})[lang];
        resolve({
          entries: snap ? P.parseRows(snap.rows, { lang: lang }) : [],
          source: snap ? 'snapshot' : 'none',
          method: 'snapshot',
          at: new Date(),
          error: lastErr
        });
      }

      loadViaGviz(src).then(function (rows) { win(rows, 'gviz'); }, lose);
      loadViaCsv(src).then(function (rows) { win(rows, 'csv'); }, lose);
    });
  }

  /* ------------------------------------------------------------------ TTS */
  var tts = (function () {
    var synth = window.speechSynthesis;
    var voices = [];
    var activeBtn = null;
    var queue = [];

    function refresh() {
      try { voices = (synth && synth.getVoices ? synth.getVoices() : []) || []; } catch (e) { voices = []; }
    }
    if (synth) {
      refresh();
      if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', refresh);
      else synth.onvoiceschanged = refresh;
    }

    function pick(lang) {
      if (!voices.length) refresh();
      var target = String(lang).toLowerCase();
      var exact = voices.filter(function (v) { return v.lang && v.lang.toLowerCase().replace(/_/g, '-') === target; });
      var loose = voices.filter(function (v) {
        return v.lang && v.lang.toLowerCase().replace(/_/g, '-').indexOf(target.split('-')[0]) === 0;
      });
      var pool = exact.length ? exact : loose;
      if (!pool.length) return null;
      var nice = pool.filter(function (v) { return /siri|google|natural|premium|enhanced|neural|ting|mei|samantha|lili|yuna/i.test(v.name || ''); });
      return nice[0] || pool[0];
    }

    function clearActive() {
      if (activeBtn) { activeBtn.classList.remove('is-speaking'); activeBtn = null; }
    }

    function say(text, lang, btn) {
      if (!synth || !text) return;
      queue = [];
      try { if (synth.speaking || synth.pending) synth.cancel(); } catch (e) {}
      clearActive();
      var u = new SpeechSynthesisUtterance(String(text));
      u.lang = lang;
      u.rate = state.rate;
      var v = pick(lang);
      if (v) u.voice = v;
      if (btn) { activeBtn = btn; btn.classList.add('is-speaking'); }
      u.onend = clearActive;
      u.onerror = clearActive;
      synth.speak(u);
    }

    function sayAll(texts, lang, btn) {
      if (!synth) return;
      try { if (synth.speaking || synth.pending) synth.cancel(); } catch (e) {}
      queue = texts.slice();
      playNext(lang, btn);
    }

    function playNext(lang, btn) {
      if (!queue.length) { clearActive(); return; }
      var text = queue.shift();
      var u = new SpeechSynthesisUtterance(String(text));
      u.lang = lang;
      u.rate = state.rate;
      var v = pick(lang);
      if (v) u.voice = v;
      if (btn) { if (activeBtn && activeBtn !== btn) activeBtn.classList.remove('is-speaking'); activeBtn = btn; btn.classList.add('is-speaking'); }
      u.onend = function () { playNext(lang, btn); };
      u.onerror = function () { clearActive(); };
      synth.speak(u);
    }

    return {
      say: say,
      sayAll: sayAll,
      stop: function () {
        queue = [];
        try { if (synth) synth.cancel(); } catch (e) {}
        clearActive();
      },
      supported: !!synth
    };
  })();

  function langTag() { return SOURCES[state.lang].tag; }

  /* --------------------------------------------------------------- render */
  function render() {
    var lang = state.lang;
    document.body.classList.toggle('is-zh', lang === 'zh');
    document.body.classList.toggle('is-en', lang === 'en');
    document.body.classList.toggle('review-mode', state.review);

    $$('.tab').forEach(function (btn) {
      var on = btn.getAttribute('data-lang') === lang;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    var link = $('#sheetLink');
    if (link) {
      link.href = 'https://docs.google.com/spreadsheets/d/' + SOURCES[lang].id + '/edit';
      link.setAttribute('aria-label', SOURCES[lang].name + ' 원본 시트 열기');
    }

    renderStats();
    renderCards();
    renderSyncMeta();
  }

  function renderStats() {
    var host = $('#stats');
    if (!host) return;
    var active = P.computeStats(state.data[state.lang] || []);
    var other = P.computeStats(state.data[state.lang === 'zh' ? 'en' : 'zh'] || []);

    function tile(k, v, unit, accent) {
      return '<div class="stat' + (accent ? ' accent' : '') + '"><p class="k">' + k + '</p>' +
        '<p class="v">' + v + (unit ? '<small>' + unit + '</small>' : '') + '</p></div>';
    }

    host.innerHTML =
      tile('학습 일수', active.days, '일', false) +
      tile('누적 문장', active.sentences, '개', true) +
      tile('새 단어', active.words, '개', false) +
      tile('연속 학습', active.streak, '일', false);

    var note = $('#statsNote');
    if (!note) {
      note = document.createElement('p');
      note.id = 'statsNote';
      note.className = 'stats-note';
      host.parentNode.insertBefore(note, host.nextSibling);
    }
    var otherKey = state.lang === 'zh' ? 'en' : 'zh';
    var otherSrc = SOURCES[otherKey];
    note.innerHTML = '<span class="sn-item">' + SOURCES[state.lang].flag + ' ' + SOURCES[state.lang].name +
      ' <b>' + active.days + '일 · ' + active.sentences + '문장 · ' + active.words + '단어</b></span>' +
      '<span class="sn-sep">·</span>' +
      '<button class="sn-item sn-switch" data-switch="' + otherKey + '" type="button">' + otherSrc.flag + ' ' + otherSrc.name +
      ' <b>' + other.days + '일 · ' + other.sentences + '문장 · ' + other.words + '단어</b> →</button>';
  }

  function renderSyncMeta() {
    var el = $('#syncMeta');
    if (!el) return;
    var m = state.meta[state.lang];
    el.classList.remove('is-warn', 'is-bad');
    if (!m) {
      el.innerHTML = '<span class="dot"></span> 시트에 연결하는 중…';
      return;
    }
    if (m.source === 'live') {
      el.innerHTML = '<span class="dot"></span> 실시간 시트 연결 · 마지막 동기화 ' + P.stampFull(m.at) +
        (m.method === 'csv' ? ' · CSV 경로' : '');
    } else if (m.source === 'snapshot') {
      el.classList.add('is-warn');
      el.innerHTML = '<span class="dot"></span> 실시간 연결 실패 — 마지막 스냅샷 표시 중';
    } else {
      el.classList.add('is-bad');
      el.innerHTML = '<span class="dot"></span> 시트를 불러오지 못했습니다';
    }
  }

  function renderCards() {
    var host = $('#content');
    if (!host) return;
    var lang = state.lang;
    var entries = state.data[lang];

    if (entries === null) {
      host.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
      return;
    }
    if (!entries.length) {
      host.innerHTML = '<div class="empty"><p><strong>아직 기록이 없습니다.</strong></p>' +
        '<p>' + SOURCES[lang].flag + ' ' + SOURCES[lang].name + ' 학습 일지 시트에 오늘의 문장을 적으면 여기에 바로 나타납니다.</p></div>';
      return;
    }

    var q = state.q.trim();
    var ql = q.toLowerCase();
    var view = [];
    entries.forEach(function (e) {
      var filtered = filterEntry(e, ql, q);
      if (filtered) view.push(filtered);
    });
    state.view = view;

    if (!view.length) {
      host.innerHTML = '<div class="empty"><p><strong>‘' + esc(q) + '’</strong> 검색 결과가 없습니다.</p><p>다른 단어로 찾아보세요.</p></div>';
      return;
    }

    var html = '';
    if (state.meta[lang] && state.meta[lang].source === 'snapshot') {
      html += '<div class="banner"><span>📴</span><div><b>저장된 스냅샷을 보여 주고 있습니다.</b> ' +
        '시트에 실시간으로 연결되지 않아 마지막으로 받아 둔 기록을 표시합니다. ⟳ 동기화를 다시 눌러 보세요.</div></div>';
    }
    view.forEach(function (e, idx) { html += cardHtml(e, idx, q); });
    host.innerHTML = html;
  }

  function matchText(value, q) {
    return String(value || '').toLowerCase().indexOf(q) !== -1;
  }

  function filterEntry(e, ql, q) {
    if (!ql) return e;
    if (matchText(e.date, ql)) return e;
    var sentences = e.sentences.filter(function (s) { return matchText(s, ql); });
    var corrections = e.corrections.filter(function (c) {
      return matchText(c.before, ql) || matchText(c.after, ql) || matchText(c.note, ql);
    });
    var words = e.words.filter(function (w) {
      return matchText(w.term, ql) || matchText(w.pinyin, ql) || matchText(w.meaning, ql);
    });
    if (!sentences.length && !corrections.length && !words.length) return null;
    return { date: e.date, sentences: sentences, corrections: corrections, words: words };
  }

  function cardHtml(e, idx, q) {
    var d = P.dayInfo(e.date);
    var out = [];
    out.push('<article class="day-card">');

    var badges = '';
    if (d.rel === 0) badges += '<span class="badge today">오늘</span>';
    else if (d.rel === 1) badges += '<span class="badge yesterday">어제</span>';
    else if (d.rel > 1) badges += '<span class="badge">' + d.rel + '일 전</span>';
    if (e.sentences.length) badges += '<span class="badge">문장 ' + e.sentences.length + '</span>';
    if (e.words.length) badges += '<span class="badge">단어 ' + e.words.length + '</span>';

    out.push(
      '<header class="day-head">' +
        '<div class="day-date"><span class="d-num">' + d.day + '</span>' +
          '<span class="d-meta"><strong>' + d.year + '.' + pad2(d.month) + '</strong> · ' + d.weekday + '요일</span>' +
        '</div>' +
        '<div class="badges">' + badges + '</div>' +
      '</header>'
    );

    if (e.sentences.length) {
      var items = e.sentences.map(function (s, i) {
        var isTopic = /^(주제|topic)\s*[:：]/i.test(s);
        return '<li class="sent">' +
          '<span class="num">' + (i + 1) + '</span>' +
          '<p class="sent-text">' + (isTopic ? '<span class="topic">주제</span>' : '') + hl(s, q) + '</p>' +
          '<button class="speak" type="button" data-speak="' + esc(s) + '" aria-label="발음 듣기">🔊</button>' +
        '</li>';
      }).join('');
      out.push(
        '<section class="block">' +
          '<div class="block-head"><h3>오늘의 문장</h3>' +
            (e.sentences.length > 1 ? '<button class="mini-btn" type="button" data-play-all="' + idx + '">▶ 전체 듣기</button>' : '') +
          '</div>' +
          '<ol class="sent-list">' + items + '</ol>' +
        '</section>'
      );
    }

    if (e.corrections.length) {
      var fixes = e.corrections.map(function (c) {
        var isPair = !!(c.before && c.after);
        var inner = isPair
          ? '<div class="fix-main"><span class="fix-wrong">' + hl(c.before, q) + '</span>' +
            '<span class="fix-arrow">→</span><span class="fix-right">' + hl(c.after, q) + '</span></div>'
          : '<p class="fix-note only">' + hl(c.note, q) + '</p>';
        var note = (isPair && c.note) ? '<p class="fix-note">' + hl(c.note, q) + '</p>' : '';
        return '<li class="fix' + (isPair ? ' revealable' : '') + '"' +
          (isPair ? ' data-say-after="' + esc(c.after) + '"' : '') + '>' +
          inner + note + (isPair ? '<span class="reveal-pill">정답 보기</span>' : '') +
        '</li>';
      }).join('');
      out.push(
        '<section class="block">' +
          '<div class="block-head"><h3>교정</h3></div>' +
          '<ul class="fix-list">' + fixes + '</ul>' +
        '</section>'
      );
    }

    if (e.words.length) {
      var chips = e.words.map(function (w) {
        return '<div class="word revealable" data-word="' + esc(w.term) + '">' +
          '<div class="word-body">' +
            '<span class="word-term">' + hl(w.term, q) + '</span>' +
            (w.pinyin ? '<span class="word-py">' + hl(w.pinyin, q) + '</span>' : '') +
            (w.meaning ? '<span class="meaning">' + hl(w.meaning, q) + '</span>' : '') +
          '</div>' +
          '<button class="speak" type="button" data-speak="' + esc(w.term) + '" aria-label="단어 발음 듣기">🔊</button>' +
        '</div>';
      }).join('');
      out.push(
        '<section class="block">' +
          '<div class="block-head"><h3>새 단어</h3></div>' +
          '<div class="word-grid">' + chips + '</div>' +
        '</section>'
      );
    }

    out.push('</article>');
    return out.join('');
  }

  /* ------------------------------------------------------------ interaction */
  function setLang(lang) {
    if (!SOURCES[lang] || state.lang === lang) return;
    state.lang = lang;
    write(LS.lang, lang);
    tts.stop();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toggleReview(force) {
    state.review = typeof force === 'boolean' ? force : !state.review;
    var btn = $('#reviewToggle');
    if (btn) btn.setAttribute('aria-pressed', state.review ? 'true' : 'false');
    document.body.classList.toggle('review-mode', state.review);
    if (state.review) {
      $$('.fix.revealed, .word.revealed').forEach(function (el) { el.classList.remove('revealed'); });
    }
  }

  function sync() {
    if (state.loading) return;
    state.loading = true;
    var btn = $('#syncBtn');
    if (btn) btn.classList.add('is-busy');

    var remaining = 2;
    function finishOne() {
      remaining--;
      if (remaining > 0) return;
      state.loading = false;
      state.lastSync = new Date();
      if (btn) btn.classList.remove('is-busy');
      render();
    }

    // 두 언어를 따로 받아, 먼저 온 쪽부터 화면에 보여 준다
    ['zh', 'en'].forEach(function (lang) {
      loadSheet(lang).then(function (res) {
        state.data[lang] = res.entries;
        state.meta[lang] = { source: res.source, method: res.method, at: res.at };
        render();
      }).catch(function (err) {
        console.error('[study] 동기화 실패', lang, err);
      }).then(finishOne);
    });
  }

  /* --------------------------------------------------------- flashcard mode */
  function openFlash() {
    var cards = [];
    (state.data[state.lang] || []).forEach(function (e) {
      e.corrections.forEach(function (c) {
        if (c.before && c.after) {
          cards.push({ kind: '교정', q: c.before, a: c.after + (c.note ? '  ·  ' + c.note : ''), say: c.after, date: e.date });
        }
      });
      e.words.forEach(function (w) {
        if (!w.meaning) return;
        cards.push({
          kind: '단어',
          q: w.term + (w.pinyin ? '   ' + w.pinyin : ''),
          a: w.meaning,
          say: w.term,
          date: e.date
        });
      });
    });

    if (!cards.length) {
      alert('복습할 카드가 아직 없습니다. 시트에 교정과 단어를 기록해 보세요.');
      return;
    }
    state.flash.cards = cards;
    state.flash.i = 0;
    state.flash.revealed = false;
    $('#flashModal').hidden = false;
    document.body.style.overflow = 'hidden';
    paintFlash();
    var stage = $('#flashStage');
    if (stage) stage.focus({ preventScroll: true });
  }

  function closeFlash() {
    $('#flashModal').hidden = true;
    document.body.style.overflow = '';
    tts.stop();
  }

  function paintFlash() {
    var f = state.flash;
    var card = f.cards[f.i];
    if (!card) return;
    $('#flashKicker').textContent = SOURCES[state.lang].flag + ' ' + SOURCES[state.lang].name + ' 복습 카드 · ' + card.date;
    $('#flashKind').textContent = card.kind;
    $('#flashQ').textContent = card.q;
    $('#flashA').textContent = card.a;
    $('#flashCount').textContent = (f.i + 1) + ' / ' + f.cards.length;
    $('#flashBar').style.width = (((f.i + 1) / f.cards.length) * 100).toFixed(1) + '%';
    var stage = $('#flashStage');
    stage.classList.toggle('revealed', f.revealed);
    $('#flashHint').textContent = f.revealed ? '' : '눌러서 정답 보기';
  }

  function flashNext(step) {
    var f = state.flash;
    if (!f.cards.length) return;
    f.i = (f.i + step + f.cards.length) % f.cards.length;
    f.revealed = false;
    tts.stop();
    paintFlash();
  }

  function flashReveal() {
    state.flash.revealed = !state.flash.revealed;
    paintFlash();
  }

  /* -------------------------------------------------------------- roadmap */
  function openRoadmap() {
    $('#roadmapModal').hidden = false;
    document.body.style.overflow = 'hidden';
    var btn = $('#roadmapModal .icon-btn');
    if (btn) btn.focus({ preventScroll: true });
  }
  function closeRoadmap() {
    $('#roadmapModal').hidden = true;
    document.body.style.overflow = '';
  }

  /* ----------------------------------------------------------------- theme */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var btn = $('#themeBtn');
    if (btn) {
      btn.textContent = theme === 'light' ? '☀️' : '🌙';
      btn.setAttribute('aria-label', theme === 'light' ? '어두운 테마로' : '밝은 테마로');
    }
    write(LS.theme, theme);
  }

  function initTheme() {
    var saved = read(LS.theme, null);
    var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(saved || (prefersLight ? 'light' : 'dark'));
  }

  /* ------------------------------------------------------------------ bind */
  function bind() {
    document.addEventListener('click', function (ev) {
      var target = ev.target;
      if (!target || !target.closest) return;

      var speakEl = target.closest('[data-speak]');
      if (speakEl) {
        ev.preventDefault();
        tts.say(speakEl.getAttribute('data-speak'), langTag(), speakEl);
        return;
      }

      var playAll = target.closest('[data-play-all]');
      if (playAll) {
        ev.preventDefault();
        var idx = parseInt(playAll.getAttribute('data-play-all'), 10);
        var entry = state.view[idx];
        if (entry && entry.sentences.length) tts.sayAll(entry.sentences, langTag(), playAll);
        return;
      }

      var fix = target.closest('.fix');
      if (fix) {
        if (state.review && !fix.classList.contains('revealed')) {
          fix.classList.add('revealed');
          return;
        }
        var say = fix.getAttribute('data-say-after');
        if (say) {
          if (fix._speaking) { tts.stop(); fix._speaking = false; return; }
          tts.say(say, langTag(), null);
          fix._speaking = true;
          setTimeout(function () { fix._speaking = false; }, 1200);
        }
        return;
      }

      var word = target.closest('.word');
      if (word) {
        if (state.review && !word.classList.contains('revealed')) {
          word.classList.add('revealed');
          return;
        }
        tts.say(word.getAttribute('data-word'), langTag(), word.querySelector('.speak'));
        return;
      }

      var sw = target.closest('[data-switch]');
      if (sw) {
        setLang(sw.getAttribute('data-switch'));
        return;
      }

      if (target.closest('[data-close]')) {
        closeRoadmap();
        closeFlash();
      }
    });

    $$('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () { setLang(btn.getAttribute('data-lang')); });
    });

    var syncBtn = $('#syncBtn');
    if (syncBtn) syncBtn.addEventListener('click', sync);

    var reviewBtn = $('#reviewToggle');
    if (reviewBtn) reviewBtn.addEventListener('click', function () { toggleReview(); });

    var flashBtn = $('#flashBtn');
    if (flashBtn) flashBtn.addEventListener('click', openFlash);

    var roadBtn = $('#roadmapBtn');
    if (roadBtn) roadBtn.addEventListener('click', openRoadmap);

    var themeBtn = $('#themeBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        var now = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        applyTheme(now);
      });
    }

    var search = $('#search');
    if (search) {
      var timer = null;
      search.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          state.q = search.value;
          renderCards();
        }, 110);
      });
      search.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') { search.value = ''; state.q = ''; renderCards(); }
      });
    }

    var rate = $('#rate');
    if (rate) {
      rate.value = String(state.rate);
      rate.addEventListener('input', function () {
        state.rate = clamp(parseFloat(rate.value) || 0.85, 0.5, 1.2);
        write(LS.rate, String(state.rate));
      });
    }

    var stage = $('#flashStage');
    if (stage) {
      stage.addEventListener('click', flashReveal);
      stage.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); flashReveal(); }
      });
    }
    var prev = $('#flashPrev');
    if (prev) prev.addEventListener('click', function () { flashNext(-1); });
    var next = $('#flashNext');
    if (next) next.addEventListener('click', function () { flashNext(1); });
    var fs = $('#flashSpeak');
    if (fs) fs.addEventListener('click', function () {
      var card = state.flash.cards[state.flash.i];
      if (card) tts.say(card.say, langTag(), fs);
    });

    document.addEventListener('keydown', function (ev) {
      var flashOpen = !$('#flashModal').hidden;
      if (ev.key === 'Escape') {
        if (flashOpen) closeFlash();
        if (!$('#roadmapModal').hidden) closeRoadmap();
        return;
      }
      if (!flashOpen) return;
      if (ev.key === 'ArrowRight') { ev.preventDefault(); flashNext(1); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); flashNext(-1); }
      else if (ev.key === ' ' || ev.key === 'Enter') {
        if (document.activeElement === stage) return;
        ev.preventDefault();
        flashReveal();
      }
    });

    var searchFocus = function (ev) {
      if ((ev.key === '/' || (ev.key === 'k' && (ev.metaKey || ev.ctrlKey))) &&
          document.activeElement !== search) {
        ev.preventDefault();
        search.focus();
      }
    };
    document.addEventListener('keydown', searchFocus);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state.lastSync &&
          (Date.now() - state.lastSync.getTime()) > 3 * 60 * 1000) {
        sync();
      }
    });

    setInterval(function () {
      if (document.visibilityState === 'visible' && state.lastSync &&
          (Date.now() - state.lastSync.getTime()) > 5 * 60 * 1000) {
        sync();
      }
    }, 60 * 1000);
  }

  /* ------------------------------------------------------------------ init */
  function init() {
    initTheme();
    bind();
    render();
    sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
