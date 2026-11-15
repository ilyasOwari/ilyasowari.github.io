(function () {
  "use strict";

  window.ELTOwari.Registry.registerModule("core-audio", function (app) {
    var ctx = null;

    function getCtx() {
      if (app.State.settings.muted) return null;
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      if (!ctx) ctx = new AudioCtx();
      if (ctx.state === "suspended") {
        try { ctx.resume(); } catch (e) {}
      }
      return ctx;
    }

    function themePitch() {
      var themeId = app.State.activeVisualTheme || "theme-classroom";
      var found = (app.VisualThemesCatalog || []).find(function (t) { return t.id === themeId; });
      return found ? found.pitch : 1.0;
    }

    function tone(freq, dur, type, volMult, delaySec) {
      var c = getCtx();
      if (!c) return;
      var start = c.currentTime + (delaySec || 0);
      var osc = c.createOscillator();
      var gain = c.createGain();
      var vol = (app.State.settings.soundVolume || 0.8) * (volMult || 0.25);
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq * themePitch(), start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.002, vol), start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    }

    function play(kind) {
      if (app.State.settings.muted) return;
      switch (kind) {
        case "click":
          tone(520, 0.06, "triangle", 0.16, 0);
          break;
        case "flip":
          tone(360, 0.07, "sine", 0.16, 0);
          tone(540, 0.08, "sine", 0.14, 0.05);
          break;
        case "snap":
          tone(660, 0.09, "triangle", 0.2, 0);
          break;
        case "tick":
          tone(880, 0.03, "square", 0.1, 0);
          break;
        case "correct":
          tone(523.25, 0.12, "triangle", 0.24, 0);
          tone(659.25, 0.12, "triangle", 0.24, 0.09);
          tone(783.99, 0.2, "triangle", 0.28, 0.18);
          break;
        case "wrong":
          tone(220, 0.16, "sawtooth", 0.18, 0);
          tone(175, 0.24, "sawtooth", 0.18, 0.12);
          break;
        case "pop":
          tone(420, 0.05, "sine", 0.25, 0);
          tone(740, 0.07, "sine", 0.2, 0.03);
          break;
        case "whack":
          tone(180, 0.08, "square", 0.22, 0);
          tone(310, 0.08, "triangle", 0.2, 0.04);
          break;
        case "drumroll":
          for (var i = 0; i < 8; i++) {
            tone(130 + (i % 2) * 35, 0.05, "triangle", 0.16 + i * 0.015, i * 0.07);
          }
          break;
        case "fanfare":
          tone(523.25, 0.14, "triangle", 0.28, 0);
          tone(659.25, 0.14, "triangle", 0.28, 0.11);
          tone(783.99, 0.14, "triangle", 0.28, 0.22);
          tone(1046.5, 0.36, "triangle", 0.34, 0.34);
          break;
        case "victory":
          [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach(function (f, idx) {
            tone(f, idx === 5 ? 0.45 : 0.13, "triangle", 0.26, idx * 0.12);
          });
          break;
      }
    }

    function playHappyBirthday() {
      if (app.State.settings.muted) return;
      var notes = [
        [261.6, 0.22], [261.6, 0.16], [293.6, 0.38], [261.6, 0.38], [349.2, 0.38], [329.6, 0.65],
        [261.6, 0.22], [261.6, 0.16], [293.6, 0.38], [261.6, 0.38], [392.0, 0.38], [349.2, 0.65],
        [261.6, 0.22], [261.6, 0.16], [523.2, 0.38], [440.0, 0.38], [349.2, 0.38], [329.6, 0.38], [293.6, 0.55],
        [466.1, 0.22], [466.1, 0.16], [440.0, 0.38], [349.2, 0.38], [392.0, 0.38], [349.2, 0.7]
      ];
      var t = 0.05;
      notes.forEach(function (pair) {
        tone(pair[0], pair[1] * 0.9, "triangle", 0.25, t);
        t += pair[1];
      });
    }

    app.Audio = {
      play: play,
      playHappyBirthday: playHappyBirthday
    };
  });
})();
