/*
  seq.js — 文章を時間軸のマス目に並べて「再生」する

  書き方（記事の Markdown にそのまま HTML で書く）:

    <div class="seq" data-bpm="120">ゆきて_かえりし_物語</div>

    <div class="seq" data-div="1">
      <div>ドン_タン_</div>          ← 子要素ごとに 1 トラック（同じクロックで同時に進む）
      <div>[大河]ドラマ</div>
    </div>

  記号:
    1 文字   = 1 ステップ（空白・改行は無視）
    _        = 休符（何も出ないが、1 ステップぶん時間は進む）
    [ ... ]  = 括弧の中をまとめて 1 ステップ

  data 属性（すべて省略可）:
    data-bpm="120"      テンポ（1 拍の速さ）
    data-div="2"        1 拍を何ステップに割るか（2 = 8 分音符刻み）
    data-beats="4"      何ステップごとに区切り線を引くか
    data-mode="trail"   trail = 過ぎたマスは残る / gate = 今のマスだけ光る
    data-loop="false"   くりかえしを最初から切っておく
    data-sound="true"   音を最初から鳴らす（既定は無音）
*/
(function () {
  'use strict';

  var REST = '_';

  /* ---------- 記法の解釈 ---------- */

  function parse(text) {
    var chars = Array.from(String(text).replace(/\s+/g, ''));
    var steps = [];
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (ch === '[') {
        var j = chars.indexOf(']', i + 1);
        if (j === -1) j = chars.length; // 閉じ忘れは最後までを 1 マスにする
        var group = chars.slice(i + 1, j).join('');
        steps.push(group ? { text: group, rest: false } : { text: '', rest: true });
        i = j;
      } else if (ch === REST) {
        steps.push({ text: '', rest: true });
      } else {
        steps.push({ text: ch, rest: false });
      }
    }
    return steps;
  }

  function readTracks(el) {
    if (el.children.length) {
      return Array.prototype.map.call(el.children, function (c) { return c.textContent; });
    }
    return [el.textContent];
  }

  /* ---------- 音（出力先の 1 つ。文字の表示と同じ時計で鳴らす） ---------- */

  var ctx = null;
  var master = null;

  function audio() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    return ctx;
  }

  var SCALE = [0, 2, 4, 7, 9]; // ペンタトニック：どの文字が来ても濁らない

  function note(text, track, t, dur) {
    var deg = text.codePointAt(0) % 10; // 文字コードから音高を決める（同じ文字は同じ音）
    var semi = SCALE[deg % 5] + 12 * Math.floor(deg / 5) - 12 * track;
    var freq = 261.63 * Math.pow(2, semi / 12);
    var len = Math.min(dur * 0.9, 0.4);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = track % 2 ? 'square' : 'triangle';
    o.frequency.value = freq;
    var peak = track % 2 ? 0.12 : 0.3;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  /* ---------- 1 つのシーケンス ---------- */

  var LOOKAHEAD = 0.12; // 秒。この先までを予約しておく
  var TICK = 25;        // ミリ秒。予約係が起きる間隔

  function Seq(el) {
    var d = el.dataset;
    this.el = el;
    this.bpm = clamp(Number(d.bpm) || 120, 30, 300);
    this.div = Math.max(1, Number(d.div) || 2);
    this.beats = Math.max(1, Number(d.beats) || 4);
    this.mode = d.mode === 'gate' ? 'gate' : 'trail';
    this.loop = d.loop !== 'false';
    this.sound = d.sound === 'true';
    this.tracks = readTracks(el).map(parse).filter(function (t) { return t.length; });
    if (!this.tracks.length) return;
    this.length = Math.max.apply(null, this.tracks.map(function (t) { return t.length; }));
    this.playing = false;
    this.draw = this.draw.bind(this);
    this.render();
  }

  Seq.prototype.render = function () {
    var self = this;
    var el = this.el;
    var multi = this.tracks.length > 1;
    var widest = 1;
    this.tracks.forEach(function (t) {
      t.forEach(function (s) { widest = Math.max(widest, Array.from(s.text).length); });
    });

    el.textContent = '';
    el.classList.add('seq--ready', 'seq--' + this.mode);
    if (multi) el.classList.add('seq--multi');
    // 全マスを同じ幅にする（幅 = 時間。まとめたマスがあれば一番広いマスに揃える）
    el.style.setProperty('--seq-cell', widest);

    // 読み上げ用：記号を除いた本文
    var sr = h('p', 'seq__sr');
    sr.textContent = this.tracks.map(function (t) {
      return t.map(function (s) { return s.text; }).join('');
    }).join(' / ');
    el.appendChild(sr);

    this.grid = h('div', 'seq__tracks');
    this.grid.setAttribute('aria-hidden', 'true');
    this.cells = this.tracks.map(function (steps) {
      var row = h('div', 'seq__track');
      var cells = steps.map(function (s, i) {
        var c = h('span', 'seq__step' + (s.rest ? ' is-rest' : '') + (i % self.beats === 0 ? ' is-beat' : ''));
        c.textContent = s.text;
        row.appendChild(c);
        return c;
      });
      self.grid.appendChild(row);
      return cells;
    });
    el.appendChild(this.grid);

    // 操作部
    var ui = h('div', 'seq__controls');

    this.btn = h('button', 'seq__play');
    this.btn.type = 'button';
    this.btn.addEventListener('click', function () { self.playing ? self.stop() : self.start(); });
    ui.appendChild(this.btn);

    var tempo = h('label', 'seq__tempo');
    var range = h('input');
    range.type = 'range';
    range.min = 30;
    range.max = 300;
    range.value = this.bpm;
    var out = h('output');
    out.textContent = this.bpm;
    range.addEventListener('input', function () {
      self.bpm = Number(range.value);
      out.textContent = self.bpm;
    });
    tempo.appendChild(document.createTextNode('テンポ'));
    tempo.appendChild(range);
    tempo.appendChild(out);
    ui.appendChild(tempo);

    ui.appendChild(toggle('くりかえし', this.loop, function (on) { self.setLoop(on); }));
    ui.appendChild(toggle('音', this.sound, function (on) { self.sound = on; }));

    el.appendChild(ui);
    this.updateButton();
  };

  Seq.prototype.stepDur = function () {
    return 60 / this.bpm / this.div;
  };

  // トラック ti の step 番目にあたるマス（無ければ -1）
  Seq.prototype.index = function (ti, step) {
    var n = this.tracks[ti].length;
    if (this.wrap) return step % n;   // 各トラックが自分の長さで回る（長さが違えばずれていく）
    return step < n ? step : -1;      // 1 回きり：短いトラックは先に終わる
  };

  Seq.prototype.setLoop = function (on) {
    this.loop = on;
    if (!this.playing) return;
    if (on) {
      this.wrap = true;
      this.endStep = null;
    } else {
      // 今の周回の終わりで止める
      this.endStep = Math.ceil(this.step / this.length) * this.length;
    }
  };

  Seq.prototype.start = function () {
    var ac = audio();
    if (ac && ac.state !== 'running') ac.resume(); // クリック中に起こさないと iOS で鳴らない
    this.clock = ac
      ? function () { return ac.currentTime; }
      : function () { return performance.now() / 1000; };
    this.reset();
    this.playing = true;
    this.wrap = this.loop;
    this.endStep = this.loop ? null : this.length;
    this.endTime = null;
    this.step = 0;
    this.queue = [];
    this.cur = this.tracks.map(function () { return -1; });
    this.nextTime = this.clock() + 0.06;
    this.timer = setInterval(this.schedule.bind(this), TICK);
    this.schedule();
    this.raf = requestAnimationFrame(this.draw);
    this.updateButton();
  };

  Seq.prototype.stop = function () {
    this.playing = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    this.queue = [];
    var trail = this.mode === 'trail';
    this.cells.forEach(function (cells) {
      cells.forEach(function (c) {
        if (c.classList.contains('is-now')) {
          c.classList.remove('is-now');
          if (trail) c.classList.add('is-past');
        }
      });
    });
    this.updateButton();
  };

  Seq.prototype.reset = function () {
    this.cells.forEach(function (cells) {
      cells.forEach(function (c) { c.classList.remove('is-now', 'is-past'); });
    });
    this.grid.scrollLeft = 0;
  };

  // 予約係：少し先までのステップを「何秒に何番」と決めておく（音はここで予約）
  Seq.prototype.schedule = function () {
    var limit = this.clock() + LOOKAHEAD;
    while (this.endTime === null && this.nextTime < limit) {
      if (this.endStep !== null && this.step >= this.endStep) {
        this.endTime = this.nextTime;
        break;
      }
      var dur = this.stepDur();
      this.queue.push({ step: this.step, time: this.nextTime });
      if (this.sound && ctx) {
        for (var ti = 0; ti < this.tracks.length; ti++) {
          var i = this.index(ti, this.step);
          var s = i >= 0 ? this.tracks[ti][i] : null;
          if (s && !s.rest) note(s.text, ti, this.nextTime, dur);
        }
      }
      this.step++;
      this.nextTime += dur;
    }
  };

  // 描画係：予約された時刻を過ぎたステップを画面に反映する
  Seq.prototype.draw = function () {
    var now = this.clock();
    while (this.queue.length && this.queue[0].time <= now) this.show(this.queue.shift().step);
    if (this.endTime !== null && !this.queue.length && now >= this.endTime) {
      this.stop();
      return;
    }
    this.raf = requestAnimationFrame(this.draw);
  };

  Seq.prototype.show = function (step) {
    var trail = this.mode === 'trail';
    for (var ti = 0; ti < this.cells.length; ti++) {
      var cells = this.cells[ti];
      var i = this.index(ti, step);
      var prev = this.cur[ti];
      if (prev >= 0) {
        cells[prev].classList.remove('is-now');
        if (trail) cells[prev].classList.add('is-past');
      }
      if (i === 0 && step > 0 && trail) {
        // 周回の頭：前の周の跡を消してから書き直す
        cells.forEach(function (c) { c.classList.remove('is-past'); });
      }
      if (i >= 0) cells[i].classList.add('is-now');
      this.cur[ti] = i;
    }
    this.follow(step);
  };

  // 複数トラック（横スクロール）のとき、再生位置が見えるように追いかける
  Seq.prototype.follow = function (step) {
    var g = this.grid;
    if (g.scrollWidth <= g.clientWidth) return;
    var longest = 0;
    for (var ti = 1; ti < this.cells.length; ti++) {
      if (this.cells[ti].length > this.cells[longest].length) longest = ti;
    }
    var i = this.index(longest, step);
    if (i < 0) return;
    var c = this.cells[longest][i];
    var left = c.offsetLeft; // .seq__tracks は position: relative なので、そこからの距離
    if (left < g.scrollLeft || left + c.offsetWidth > g.scrollLeft + g.clientWidth) {
      g.scrollLeft = left - g.clientWidth / 3;
    }
  };

  Seq.prototype.updateButton = function () {
    this.btn.textContent = this.playing ? '■' : '▶';
    this.btn.setAttribute('aria-label', this.playing ? '停止' : '再生');
  };

  /* ---------- 小道具 ---------- */

  function h(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function toggle(label, on, cb) {
    var l = h('label', 'seq__toggle');
    var box = h('input');
    box.type = 'checkbox';
    box.checked = on;
    box.addEventListener('change', function () { cb(box.checked); });
    l.appendChild(box);
    l.appendChild(document.createTextNode(label));
    return l;
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function init(root) {
    var list = (root || document).querySelectorAll('.seq:not(.seq--ready)');
    Array.prototype.forEach.call(list, function (el) { new Seq(el); });
  }

  window.Seq = { init: init, parse: parse };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }
})();
