export type GameSound = "deal" | "fold" | "check" | "call" | "raise" | "all-in" | "win" | "lose";
export type VoiceGender = "male" | "female";
type VoiceAction = Extract<GameSound, "fold" | "check" | "call" | "raise" | "all-in">;

let audioContext: AudioContext | null = null;
let voiceLoadPromise: Promise<void> | null = null;
let activeVoiceSource: AudioBufferSourceNode | null = null;
const voiceBuffers = new Map<string, AudioBuffer>();
const voiceFiles: Record<VoiceGender, Record<VoiceAction, string>> = {
  male: {
    fold: "male-fold.mp3",
    check: "male-check.mp3",
    call: "male-call.mp3",
    raise: "male-raise.mp3",
    "all-in": "male-all-in.mp3",
  },
  female: {
    fold: "female-fold.mp3",
    check: "female-check.mp3",
    call: "female-call.mp3",
    raise: "female-raise.mp3",
    "all-in": "female-all-in.mp3",
  },
};

const isVoiceAction = (sound: GameSound): sound is VoiceAction => sound in voiceFiles.male;
const voiceKey = (gender: VoiceGender, action: VoiceAction): string => `${gender}:${action}`;

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

const preloadVoiceLines = (context: AudioContext): Promise<void> => {
  if (voiceLoadPromise) return voiceLoadPromise;
  voiceLoadPromise = Promise.all(Object.entries(voiceFiles).flatMap(([gender, files]) =>
    Object.entries(files).map(async ([action, filename]) => {
      const response = await fetch(`${import.meta.env.BASE_URL}audio/actions/${filename}`);
      if (!response.ok) throw new Error(`Unable to load voice line ${filename}.`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      voiceBuffers.set(voiceKey(gender as VoiceGender, action as VoiceAction), buffer);
    })))
    .then(() => undefined)
    .catch(() => undefined);
  return voiceLoadPromise;
};

const playVoiceLine = (context: AudioContext, action: VoiceAction, gender: VoiceGender) => {
  const buffer = voiceBuffers.get(voiceKey(gender, action));
  if (!buffer || context.state !== "running") return;
  try { activeVoiceSource?.stop(); } catch { /* The previous line already ended. */ }
  const source = context.createBufferSource();
  const gain = context.createGain();
  gain.gain.value = 0.95;
  source.buffer = buffer;
  source.connect(gain).connect(context.destination);
  source.onended = () => { if (activeVoiceSource === source) activeVoiceSource = null; };
  activeVoiceSource = source;
  source.start(context.currentTime + 0.035);
};

const playVoiceWhenReady = (context: AudioContext, sound: GameSound, gender: VoiceGender) => {
  if (!isVoiceAction(sound)) return;
  if (voiceBuffers.has(voiceKey(gender, sound))) {
    playVoiceLine(context, sound, gender);
    return;
  }
  void preloadVoiceLines(context).then(() => playVoiceLine(context, sound, gender));
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

export const playGameSound = (sound: GameSound, enabled: boolean, gender: VoiceGender = "male"): void => {
  if (!enabled || !audioContext || audioContext.state !== "running") return;
  renderSound(audioContext, sound);
  playVoiceWhenReady(audioContext, sound, gender);
};

export const activateGameAudio = (sound: GameSound | null, enabled: boolean, gender: VoiceGender = "male"): void => {
  if (!enabled) return;
  const context = getAudioContext();
  if (!context) return;
  if (context.state === "running") {
    void preloadVoiceLines(context);
    if (sound) renderSound(context, sound);
    if (sound) playVoiceWhenReady(context, sound, gender);
    return;
  }
  void context.resume()
    .then(() => {
      if (context.state !== "running") return;
      void preloadVoiceLines(context);
      if (sound) {
        renderSound(context, sound);
        playVoiceWhenReady(context, sound, gender);
      }
    })
    .catch(() => undefined);
};
