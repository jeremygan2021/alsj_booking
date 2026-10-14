import { createInvestigationAudio } from "./investigation-audio.js";

// Original synthesized score and effects; no microphone, downloads or uploads.
export function createCastleAudio(onChange) {
  let context,
    master,
    noise,
    disposed = false,
    unlocked = false,
    enabled = true;
  const sources = new Set();
  const music = createInvestigationAudio();
  const notify = () => onChange?.({ enabled, unlocked });
  function stopEffects() {
    for (const node of sources) {
      try {
        node.stop();
      } catch {}
    }
    sources.clear();
  }
  function gesture() {
    if (disposed || !enabled) return;
    try {
      if (!context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        context = new Audio();
        master = context.createGain();
        master.gain.value = 0.38;
        master.connect(context.destination);
        noise = context.createBuffer(
          1,
          Math.ceil(context.sampleRate),
          context.sampleRate,
        );
        const samples = noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++)
          samples[i] = Math.random() * 2 - 1;
      }
      void context.resume().catch(() => {});
      if (music.getSnapshot().enabled) void music.playFromGesture();
      else void music.toggle();
      unlocked = true;
      notify();
    } catch {
      unlocked = false;
      notify();
    }
  }
  function voice(node, level, duration, delay = 0, filter) {
    const t = context.currentTime + delay,
      gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    if (filter) {
      node.connect(filter);
      filter.connect(gain);
    } else node.connect(gain);
    gain.connect(master);
    sources.add(node);
    node.onended = () => {
      sources.delete(node);
      node.disconnect();
      filter?.disconnect();
      gain.disconnect();
    };
    node.start(t);
    node.stop(t + duration + 0.025);
  }
  function tone(frequency, type, level, duration, delay = 0, endFrequency) {
    const node = context.createOscillator();
    node.type = type;
    node.frequency.setValueAtTime(frequency, context.currentTime + delay);
    if (endFrequency)
      node.frequency.exponentialRampToValueAtTime(
        endFrequency,
        context.currentTime + delay + duration,
      );
    voice(node, level, duration, delay);
  }
  function rustle(level, duration, frequency, type = "lowpass", delay = 0) {
    const node = context.createBufferSource();
    node.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    voice(node, level, duration, delay, filter);
  }
  function play(event) {
    if (
      disposed ||
      !enabled ||
      !unlocked ||
      context?.state !== "running" ||
      document.hidden
    )
      return;
    if (event === "step") {
      rustle(0.18, 0.12, 850);
      tone(115, "sine", 0.15, 0.09, 0, 65);
    }
    if (event === "hint") tone(587.33, "sine", 0.08, 0.5);
    if (event === "jump") tone(220, "sine", 0.08, 0.22, 0, 520);
    if (event === "hurt") {
      tone(180, "triangle", 0.1, 0.26, 0, 70);
      rustle(0.1, 0.18, 600);
    }
    if (event === "collect") {
      tone(880, "sine", 0.1, 0.32);
      tone(1320, "sine", 0.08, 0.38, 0.1);
    }
    if (event === "gate") {
      tone(74, "sawtooth", 0.05, 0.65, 0, 38);
      rustle(0.14, 0.65, 420);
      tone(720, "triangle", 0.06, 0.22, 0.42, 510);
    }
    if (event === "enter") {
      [392, 493.88, 587.33].forEach((f, i) =>
        tone(f, "sine", 0.14, 1.25, i * 0.13),
      );
    }
    if (event === "open") {
      rustle(0.14, 0.6, 1600, "highpass");
      tone(1350, "triangle", 0.09, 0.09);
      [659.25, 783.99, 987.77].forEach((f, i) =>
        tone(f, "sine", 0.1, 1.0, 0.2 + i * 0.12),
      );
    }
    if (event === "close") {
      rustle(0.15, 0.24, 1000);
      tone(180, "sine", 0.12, 0.12, 0.13, 110);
    }
  }
  function hidden() {
    if (document.hidden) {
      stopEffects();
      if (context?.state === "running") void context.suspend();
    }
  }
  document.addEventListener("visibilitychange", hidden);
  return {
    gesture,
    play,
    toggle() {
      enabled = !enabled;
      if (enabled) gesture();
      else {
        stopEffects();
        music.pause();
        if (context?.state === "running") void context.suspend();
      }
      notify();
    },
    dispose() {
      disposed = true;
      stopEffects();
      music.dispose();
      document.removeEventListener("visibilitychange", hidden);
      if (context && context.state !== "closed")
        void context.close().catch(() => {});
      onChange = null;
    },
  };
}
