export type GameSound = "deal" | "fold" | "check" | "call" | "raise" | "all-in" | "win" | "lose";

let audioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  try {
    if (!audioContext) audioContext = new AudioContext();
  } catch {
    return null;
  }
  return audioContext;
};

const tone = (
  context: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine",
) => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
};

const chipClick = (context: AudioContext, start: number, frequency = 900, volume = 0.025) => {
  tone(context, frequency, start, 0.055, volume, "triangle");
  tone(context, frequency * 1.7, start + 0.008, 0.035, volume * 0.45, "square");
};

const renderSound = (context: AudioContext, sound: GameSound) => {
  const now = context.currentTime + 0.015;
  switch (sound) {
    case "deal":
      tone(context, 210, now, 0.07, 0.018, "triangle");
      tone(context, 150, now + 0.045, 0.06, 0.014, "triangle");
      break;
    case "fold":
      tone(context, 180, now, 0.11, 0.018, "sine");
      break;
    case "check":
      chipClick(context, now, 720, 0.018);
      break;
    case "call":
      chipClick(context, now, 820);
      chipClick(context, now + 0.065, 760, 0.018);
      break;
    case "raise":
      chipClick(context, now, 760);
      chipClick(context, now + 0.065, 980, 0.03);
      break;
    case "all-in":
      chipClick(context, now, 720, 0.03);
      chipClick(context, now + 0.06, 920, 0.035);
      chipClick(context, now + 0.12, 1180, 0.04);
      break;
    case "win":
      tone(context, 523.25, now, 0.22, 0.03);
      tone(context, 659.25, now + 0.11, 0.25, 0.035);
      tone(context, 783.99, now + 0.22, 0.34, 0.04);
      break;
    case "lose":
      tone(context, 392, now, 0.2, 0.022);
      tone(context, 329.63, now + 0.12, 0.3, 0.018);
      break;
  }
};

export const playGameSound = (sound: GameSound, enabled: boolean): void => {
  if (!enabled || !audioContext || audioContext.state !== "running") return;
  renderSound(audioContext, sound);
};

export const activateGameAudio = (sound: GameSound | null, enabled: boolean): void => {
  if (!enabled) return;
  const context = getAudioContext();
  if (!context) return;
  if (context.state === "running") {
    if (sound) renderSound(context, sound);
    return;
  }
  void context.resume()
    .then(() => { if (sound && context.state === "running") renderSound(context, sound); })
    .catch(() => undefined);
};
