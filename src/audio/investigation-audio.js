const PREFERENCE_KEY = "alsj.ar-investigation.audio";
const DEFAULT_VOLUME = 0.4;
const BEAT_SECONDS = 60 / 68;
const LOOP_BEATS = 32;

const clampVolume = (value) =>
  Math.min(
    1,
    Math.max(
      0,
      Number.isFinite(Number(value)) ? Number(value) : DEFAULT_VOLUME,
    ),
  );

export function readInvestigationAudioPreference(storage) {
  try {
    const target = storage === undefined ? globalThis.sessionStorage : storage;
    const saved = JSON.parse(target?.getItem(PREFERENCE_KEY) || "null");
    return {
      enabled: saved?.enabled !== false,
      volume:
        saved?.volume == null ? DEFAULT_VOLUME : clampVolume(saved.volume),
    };
  } catch {
    return { enabled: true, volume: DEFAULT_VOLUME };
  }
}

const frequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
const chords = [
  [45, 52, 57, 59],
  [41, 48, 52, 57],
  [38, 45, 50, 52],
  [40, 47, 52, 56],
];
const score = chords
  .flatMap((chord, index) => {
    const start = index * 8;
    const melody = [
      [0, chord[2] + 12],
      [1.5, chord[1] + 12],
      [3, chord[3] + 12],
      [4.5, chord[2] + 12],
      [6, chord[1] + 12],
      [7, chord[index === 3 ? 3 : 2] + (index % 2 ? 12 : 24)],
    ];
    return [
      { beat: start, kind: "pad", notes: chord.slice(0, 3) },
      ...melody.map(([beat, note], noteIndex) => ({
        beat: start + beat,
        kind: "piano",
        note,
        strength: noteIndex === 0 ? 0.22 : 0.16,
      })),
    ];
  })
  .sort((a, b) => a.beat - b.beat);

/** Original, gently looping manor score. AudioContext is created only on interaction. */
export function createInvestigationAudio(options = {}) {
  const browserDocument = options.document ?? globalThis.document;
  const browserWindow = options.window ?? globalThis.window;
  const setTimer = options.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const clearTimer =
    options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const preference = readInvestigationAudioPreference(options.storage);
  let onChange = options.onChange;
  let context = null;
  let master = null;
  let timer = null;
  let revision = 0;
  let disposed = false;
  let intendedPlayback = false;
  let playing = false;
  let error = "";
  let eventIndex = 0;
  let loopStart = 0;
  const voices = new Set();

  const snapshot = () => ({ ...preference, playing, error });
  const notify = () => {
    if (!disposed) onChange?.(snapshot());
  };
  const persist = () => {
    try {
      const storage =
        options.storage === undefined
          ? globalThis.sessionStorage
          : options.storage;
      storage?.setItem(PREFERENCE_KEY, JSON.stringify(preference));
    } catch {
      // Private browsing may deny storage; playback still works for this visit.
    }
  };
  const masterVolume = () => preference.volume * 0.22;
  const stopTimeline = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    for (const voice of [...voices]) {
      try {
        voice.stop();
      } catch {
        // A completed oscillator can already have been stopped.
      }
    }
    voices.clear();
    if (context && master) {
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setValueAtTime(0, context.currentTime);
    }
  };
  const closeContext = () => {
    const oldContext = context;
    context = null;
    master = null;
    if (oldContext && oldContext.state !== "closed") {
      Promise.resolve(oldContext.close()).catch(() => {});
    }
  };
  const trackOscillator = (oscillator, end) => {
    voices.add(oscillator);
    oscillator.onended = () => {
      voices.delete(oscillator);
      oscillator.disconnect();
    };
    oscillator.stop(end);
  };
  const piano = (note, start, strength = 0.18, duration = 2.8) => {
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(strength, start + 0.025);
    envelope.gain.exponentialRampToValueAtTime(strength * 0.28, start + 0.45);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    envelope.connect(master);
    const fundamental = context.createOscillator();
    fundamental.type = "triangle";
    fundamental.frequency.setValueAtTime(frequency(note), start);
    fundamental.connect(envelope);
    fundamental.start(start);
    trackOscillator(fundamental, start + duration + 0.03);
    const overtone = context.createOscillator();
    const overtoneGain = context.createGain();
    overtone.type = "sine";
    overtone.frequency.setValueAtTime(frequency(note) * 2, start);
    overtoneGain.gain.value = 0.12;
    overtone.connect(overtoneGain);
    overtoneGain.connect(envelope);
    overtone.start(start);
    trackOscillator(overtone, start + duration + 0.03);
    fundamental.onended = () => {
      voices.delete(fundamental);
      fundamental.disconnect();
      envelope.disconnect();
      overtoneGain.disconnect();
    };
  };
  const pad = (notes, start) => {
    const envelope = context.createGain();
    const duration = BEAT_SECONDS * 9;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(0.026, start + 1.8);
    envelope.gain.setValueAtTime(0.026, start + duration - 2.5);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    envelope.connect(master);
    notes.forEach((note, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency(note), start);
      oscillator.detune.value = (index - 1) * 3;
      oscillator.connect(envelope);
      oscillator.start(start);
      trackOscillator(oscillator, start + duration + 0.03);
      if (index === notes.length - 1) {
        oscillator.onended = () => {
          voices.delete(oscillator);
          oscillator.disconnect();
          envelope.disconnect();
        };
      }
    });
  };
  const buildContext = () => {
    const AudioContextClass =
      options.AudioContext ??
      browserWindow?.AudioContext ??
      browserWindow?.webkitAudioContext;
    if (!AudioContextClass) throw new Error("这台设备暂不支持氛围音乐");
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = 0;
    const lowPass = context.createBiquadFilter();
    lowPass.type = "lowpass";
    lowPass.frequency.value = 2200;
    lowPass.Q.value = 0.4;
    master.connect(lowPass);
    lowPass.connect(context.destination);
    const echo = context.createDelay(1);
    const echoGain = context.createGain();
    echo.delayTime.value = BEAT_SECONDS / 3;
    echoGain.gain.value = 0.16;
    lowPass.connect(echo);
    echo.connect(echoGain);
    echoGain.connect(lowPass);
  };
  const schedule = (activeRevision) => {
    if (disposed || !playing || activeRevision !== revision || !context) return;
    const now = context.currentTime;
    const loopDuration = LOOP_BEATS * BEAT_SECONDS;
    if (now > loopStart + loopDuration) {
      loopStart += Math.floor((now - loopStart) / loopDuration) * loopDuration;
      eventIndex = 0;
    }
    const horizon = now + 1.2;
    while (loopStart + score[eventIndex].beat * BEAT_SECONDS < horizon) {
      const event = score[eventIndex];
      const scheduledStart = loopStart + event.beat * BEAT_SECONDS;
      // Skip missed notes after a device sleep instead of playing them together.
      if (scheduledStart >= now - 0.12) {
        const start = Math.max(now + 0.01, scheduledStart);
        if (event.kind === "pad") pad(event.notes, start);
        else piano(event.note, start, event.strength);
      }
      eventIndex++;
      if (eventIndex === score.length) {
        eventIndex = 0;
        loopStart += LOOP_BEATS * BEAT_SECONDS;
      }
    }
    timer = setTimer(() => schedule(activeRevision), 240);
  };
  const start = async () => {
    if (disposed || !preference.enabled) return false;
    intendedPlayback = true;
    if (playing) return true;
    if (browserDocument?.hidden) return false;
    const activeRevision = ++revision;
    try {
      if (!context || context.state === "closed") buildContext();
      const activeContext = context;
      // Always queue resume, even if the current state still says running: a
      // pending visibility suspension may not have updated that state yet.
      await activeContext.resume();
      if (
        disposed ||
        revision !== activeRevision ||
        !intendedPlayback ||
        !preference.enabled ||
        browserDocument?.hidden
      ) {
        if (
          context === activeContext &&
          (!intendedPlayback || !preference.enabled || browserDocument?.hidden)
        ) {
          Promise.resolve(activeContext.suspend()).catch(() => {});
        }
        return false;
      }
      if (activeContext.state !== "running")
        throw new Error("点按音乐按钮开启氛围音乐");
      error = "";
      playing = true;
      loopStart = context.currentTime + 0.06;
      eventIndex = 0;
      master.gain.setTargetAtTime(masterVolume(), context.currentTime, 0.15);
      schedule(activeRevision);
      notify();
      return true;
    } catch (failure) {
      if (disposed || activeRevision !== revision) return false;
      intendedPlayback = false;
      playing = false;
      stopTimeline();
      error = failure.message || "点按音乐按钮开启氛围音乐";
      notify();
      return false;
    }
  };
  const pause = (savePreference = true) => {
    revision++;
    intendedPlayback = false;
    playing = false;
    error = "";
    if (savePreference) {
      preference.enabled = false;
      persist();
    }
    stopTimeline();
    if (context?.state === "running")
      Promise.resolve(context.suspend()).catch(() => {});
    notify();
  };
  const visibilityChanged = () => {
    if (disposed) return;
    if (browserDocument.hidden) {
      revision++;
      playing = false;
      stopTimeline();
      if (context?.state === "running")
        Promise.resolve(context.suspend()).catch(() => {});
      notify();
    } else if (intendedPlayback && preference.enabled) {
      void start();
    }
  };
  const pageExited = () => {
    pause(false);
    closeContext();
  };
  browserDocument?.addEventListener("visibilitychange", visibilityChanged);
  browserWindow?.addEventListener("pagehide", pageExited);

  return {
    getSnapshot: snapshot,
    playFromGesture: start,
    toggle() {
      if (playing || intendedPlayback) {
        pause();
        return Promise.resolve(false);
      }
      preference.enabled = true;
      persist();
      return start();
    },
    pause,
    setVolume(value) {
      if (disposed) return;
      preference.volume = clampVolume(value);
      persist();
      if (master && context && playing)
        master.gain.setTargetAtTime(masterVolume(), context.currentTime, 0.08);
      notify();
    },
    playDiscovery() {
      if (
        disposed ||
        !playing ||
        context?.state !== "running" ||
        browserDocument?.hidden ||
        preference.volume === 0
      )
        return;
      const start = context.currentTime + 0.015;
      [76, 81, 83].forEach((note, index) =>
        piano(note, start + index * 0.14, 0.16, 1.8),
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      revision++;
      intendedPlayback = false;
      playing = false;
      onChange = null;
      browserDocument?.removeEventListener(
        "visibilitychange",
        visibilityChanged,
      );
      browserWindow?.removeEventListener("pagehide", pageExited);
      stopTimeline();
      closeContext();
    },
  };
}
