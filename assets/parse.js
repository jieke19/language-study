/*!
 * 언어 학습 일지 — 시트 파서 (의존성 없음)
 * Google Sheets 의 네 열(날짜 / 오늘 문장 / 교정 / 새 단어)을 앱이 쓰는 구조로 바꾼다.
 */
(function (root) {
  'use strict';

  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function str(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date && !isNaN(v)) {
      return v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
    }
    return String(v).replace(/\r\n?/g, '\n');
  }

  /** '2026-11-18', '2026. 11. 18.', 'Date(2026,10,18)', '11/18/2026' → '2026-11-18' */
  function normalizeDate(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date && !isNaN(v)) {
      return v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
    }
    var s = String(v).trim();
    var m = s.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/);
    if (m) return m[1] + '-' + pad2(+m[2] + 1) + '-' + pad2(+m[3]);
    m = s.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
    if (m) return m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      var y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      return y + '-' + pad2(+m[1]) + '-' + pad2(+m[2]);
    }
    return s;
  }

  function stripNumber(s) {
    return s.replace(/^\s*\d+\s*[).]\s*/, '').trim();
  }

  /** 오늘 문장 열 → 문장 배열 (줄바꿈 또는 ' / ' 구분) */
  function parseSentences(text) {
    var out = [];
    var lines = str(text).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (/^(주제|topic)\s*[:：]/i.test(line)) { out.push(line); continue; }
      var segs = line.split(/\s+\/\s+/);
      for (var j = 0; j < segs.length; j++) {
        var s = stripNumber(segs[j].trim());
        if (s) out.push(s);
      }
    }
    return out;
  }

  /**
   * 교정 열 → [{ before, after, note }]
   * '원문 → 수정 / 설명' 형태와 '설명만 있는 줄' 을 모두 처리한다.
   */
  function parseCorrections(text) {
    var out = [];
    var lines = str(text).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var segs = line.split(/\s+\/\s+/);
      for (var j = 0; j < segs.length; j++) {
        var seg = stripNumber(segs[j].trim());
        if (!seg) continue;
        if (seg.indexOf('→') !== -1 || seg.indexOf('->') !== -1) {
          var parts = seg.split(/\s*(?:→|->)\s*/);
          var before = parts.shift().trim();
          var right = parts.join(' → ').trim();
          var after = right, note = '';
          var bits = right.split(/\s+\/\s+/);
          if (bits.length > 1) {
            after = bits[0].trim();
            note = bits.slice(1).join(' / ').trim();
          }
          out.push({ before: before, after: after, note: note });
        } else if (out.length && out[out.length - 1].before) {
          // 짝이 있는 교정 뒤에 붙은 설명 줄은 그 교정의 설명으로 붙인다
          var prev = out[out.length - 1];
          prev.note = prev.note ? prev.note + ' · ' + seg : seg;
        } else {
          out.push({ before: '', after: '', note: seg });
        }
      }
    }
    return out;
  }

  var PINYIN_TEST = /^[a-zA-Z\u00C0-\u024F\u0300-\u036F\u0100-\u017F' -]+$/;

  function looksLikePinyin(tok) {
    if (!tok) return false;
    if (!/[a-zA-Z]/.test(tok)) return false;
    if (/[\uAC00-\uD7A3\u4E00-\u9FFF\u3040-\u30FF]/.test(tok)) return false;
    return PINYIN_TEST.test(tok);
  }

  /**
   * 새 단어 열 → [{ term, pinyin, meaning }]
   * 구분자: 줄바꿈, 가운데점('·', 앞뒤 공백 있는 경우), ' / '
   * 표기: '周末 zhōumò 주말', 'pretty relaxed — 꽤 여유로운'
   */
  function parseWords(text) {
    var out = [];
    var chunks = str(text).split(/\n|\s+·\s+|\s+\/\s+/);
    for (var i = 0; i < chunks.length; i++) {
      var chunk = chunks[i].replace(/^\s*[-•*]\s*/, '').trim();
      if (!chunk) continue;

      var term = '', pinyin = '', meaning = '';
      var dash = chunk.search(/\s*[—–]\s*|\s+-\s+/);

      if (dash > 0) {
        term = chunk.slice(0, dash).trim();
        meaning = chunk.slice(dash).replace(/^\s*[—–]?\s*|^\s+-\s+/, '').trim();
      } else {
        var toks = chunk.split(/\s+/);
        term = toks[0];
        if (/[\u4E00-\u9FFF]/.test(term)) {
          // 중국어 단어: 뒤따르는 라틴 문자 토큰은 병음으로 묶는다 ('kuài dào le')
          var k = 1, py = [];
          while (k < toks.length && looksLikePinyin(toks[k])) { py.push(toks[k]); k++; }
          pinyin = py.join(' ');
          meaning = toks.slice(k).join(' ');
        } else if (toks.length === 1) {
          term = chunk;
        } else {
          meaning = toks.slice(1).join(' ');
        }
      }
      out.push({ term: term, pinyin: pinyin, meaning: meaning });
    }
    return out;
  }

  function detectColumns(header) {
    var map = { date: -1, sentences: -1, corrections: -1, words: -1 };
    if (header && header.length) {
      for (var i = 0; i < header.length; i++) {
        var h = str(header[i]).trim();
        if (!h) continue;
        if (map.date < 0 && /날짜|date/i.test(h)) map.date = i;
        else if (map.sentences < 0 && /문장|sentence/i.test(h)) map.sentences = i;
        else if (map.corrections < 0 && /교정|correct|수정/i.test(h)) map.corrections = i;
        else if (map.words < 0 && /단어|word|vocab/i.test(h)) map.words = i;
      }
    }
    if (map.date < 0) { map.date = 0; }
    if (map.sentences < 0) { map.sentences = 1; }
    if (map.corrections < 0) { map.corrections = 2; }
    if (map.words < 0) { map.words = 3; }
    return map;
  }

  /**
   * 시트 행 배열(헤더 포함) → 날짜 내림차순 학습 기록
   * @param {Array<Array>} rows
   * @param {{lang?: string}} opts
   */
  function parseRows(rows, opts) {
    opts = opts || {};
    var entries = [];
    if (!rows || !rows.length) return entries;

    var start = 0;
    var first = rows[0] || [];
    var looksLikeHeader = /날짜|date/i.test(str(first[0])) || /문장|교정|단어/.test(str(first[1]) + str(first[2]));
    var cols = detectColumns(looksLikeHeader ? first : null);
    if (looksLikeHeader) start = 1;

    for (var r = start; r < rows.length; r++) {
      var row = rows[r] || [];
      var date = normalizeDate(row[cols.date]);
      var sentences = parseSentences(row[cols.sentences]);
      var corrections = parseCorrections(row[cols.corrections]);
      var words = parseWords(row[cols.words]);

      if (!date && !sentences.length && !corrections.length && !words.length) continue;

      entries.push({
        date: date,
        sentences: sentences,
        corrections: corrections,
        words: words,
        counts: { sentences: sentences.length, corrections: corrections.length, words: words.length }
      });
    }

    entries.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return entries;
  }

  function isoOf(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function computeStats(entries, now) {
    var today = isoOf(now || new Date());
    var daySet = {};
    var sentences = 0, words = 0, corrections = 0;
    (entries || []).forEach(function (e) {
      if (e.date) daySet[e.date] = true;
      sentences += e.sentences.length;
      words += e.words.length;
      corrections += e.corrections.length;
    });
    var dates = Object.keys(daySet).sort();

    // 연속 학습 일수: 오늘(또는 어제)부터 거꾸로 이어진 날짜
    var streak = 0;
    if (dates.length) {
      var cursor = new Date();
      var last = dates[dates.length - 1];
      var t = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      var lastD = parseISO(last);
      if (lastD && (isoOf(t) === last || isoOf(addDays(t, -1)) === last)) {
        var walk = isoOf(t) === last ? t : addDays(t, -1);
        while (daySet[isoOf(walk)]) {
          streak++;
          walk = addDays(walk, -1);
        }
      }
    }

    return {
      days: dates.length,
      sentences: sentences,
      words: words,
      corrections: corrections,
      streak: streak,
      lastDate: dates.length ? dates[dates.length - 1] : '',
      today: today
    };
  }

  function parseISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  function addDays(d, n) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  }

  function dayInfo(iso, now) {
    var d = parseISO(iso);
    if (!d) return { date: iso, day: '', month: '', weekday: '', label: '', rel: '' };
    var today = new Date(now || new Date());
    var t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var diff = Math.round((t0 - d) / 86400000);
    var label = diff === 0 ? '오늘' : diff === 1 ? '어제' : diff > 1 ? diff + '일 전' : '예정';
    return {
      date: iso,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      weekday: WEEKDAYS[d.getDay()],
      label: label,
      rel: diff
    };
  }

  function stamp(now) {
    var d = now || new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function stampFull(now) {
    var d = now || new Date();
    return d.getMonth() + 1 + '월 ' + d.getDate() + '일 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  var api = {
    parseRows: parseRows,
    parseSentences: parseSentences,
    parseCorrections: parseCorrections,
    parseWords: parseWords,
    detectColumns: detectColumns,
    normalizeDate: normalizeDate,
    computeStats: computeStats,
    dayInfo: dayInfo,
    isoOf: isoOf,
    stamp: stamp,
    stampFull: stampFull,
    WEEKDAYS: WEEKDAYS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.StudyParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
