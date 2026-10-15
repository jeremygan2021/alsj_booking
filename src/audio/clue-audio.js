// One owner for all evidence recordings, including the camera overlay.
export const CLUE_AUDIO_EVENT = "alsj:clue-audio";
let active = null;

const announce = () => {
  globalThis.window?.dispatchEvent(
    new CustomEvent(CLUE_AUDIO_EVENT, { detail: { active: Boolean(active) } }),
  );
};

export function isClueAudioActive() {
  return Boolean(active);
}

export function claimClueAudio(owner) {
  const previous = active;
  active = owner;
  if (previous !== owner) previous?.pause();
  announce();
}

export function releaseClueAudio(owner) {
  if (active !== owner) return;
  active = null;
  announce();
}
