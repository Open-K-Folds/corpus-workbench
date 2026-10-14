/** Bounded, local PCM analysis. No audio or derived data leaves the renderer. */
export const MAX_ANALYSIS_BYTES = 32 * 1024 * 1024;
export const MAX_ANALYSIS_DURATION = 600;
export const MAX_DECODED_SAMPLES = 32 * 1024 * 1024;
export const MAX_ANALYSIS_CHANNELS = 32;
export const FFT_SIZE = 2048;
export const MAX_SPECTROGRAM_COLUMNS = 1024;
export const SPECTROGRAM_BINS = 128;
export const WAVEFORM_PEAK_COUNT = 2048;
export const FLOOR_DECIBELS = -90;

export interface AudioAnalysis {
  /** Absolute peak amplitude per equal-width time interval, across all channels. */
  peaks: Float32Array;
  /** Column-major intensity, with row zero at the lowest frequency; 0 = <= -90 dBFS. */
  spectrogram: Uint8Array;
  columns: number;
  bins: number;
  minFrequency: number;
  maxFrequency: number;
  duration: number;
  fftSize: number;
  floorDecibels: number;
  /** True when the overview's FFT windows have gaps between them. */
  sampled: boolean;
}

export interface AudioAnalysisRequest {
  id: number;
  channels: Float32Array[];
  sampleRate: number;
}

export type AudioAnalysisResponse =
  | { id: number; result: AudioAnalysis }
  | { id: number; error: string };

interface FftPlan {
  size: number;
  real: Float64Array;
  imaginary: Float64Array;
  reverse: Uint32Array;
  cosine: Float64Array;
  sine: Float64Array;
  window: Float64Array;
  windowSum: number;
}

function createPlan(size: number): FftPlan {
  if (!Number.isInteger(size) || size < 16 || size > 32768 || (size & (size - 1)) !== 0) {
    throw new RangeError('FFT size must be a power of two between 16 and 32768.');
  }
  const reverse = new Uint32Array(size);
  const bits = Math.log2(size);
  const cosine = new Float64Array(size / 2);
  const sine = new Float64Array(size / 2);
  const window = new Float64Array(size);
  let windowSum = 0;
  for (let index = 0; index < size; index++) {
    let value = index;
    let reversed = 0;
    for (let bit = 0; bit < bits; bit++) {
      reversed = (reversed << 1) | (value & 1);
      value >>>= 1;
    }
    reverse[index] = reversed;
    // Periodic Hann: coherent gain is exactly 0.5, including for bin-centred tones.
    window[index] = 0.5 * (1 - Math.cos(2 * Math.PI * index / size));
    windowSum += window[index];
    if (index < size / 2) {
      cosine[index] = Math.cos(2 * Math.PI * index / size);
      sine[index] = -Math.sin(2 * Math.PI * index / size);
    }
  }
  return {
    size, reverse, cosine, sine, window, windowSum,
    real: new Float64Array(size), imaginary: new Float64Array(size),
  };
}

function transform(samples: Float32Array, start: number, plan: FftPlan): void {
  const { size, real, imaginary, reverse, window, cosine, sine } = plan;
  for (let index = 0; index < size; index++) {
    const sample = samples[start + index] ?? 0;
    real[reverse[index]] = Number.isFinite(sample) ? sample * window[index] : 0;
    imaginary[index] = 0;
  }
  for (let width = 2; width <= size; width *= 2) {
    const half = width / 2;
    const step = size / width;
    for (let offset = 0; offset < size; offset += width) {
      for (let index = 0; index < half; index++) {
        const twiddle = index * step;
        const even = offset + index;
        const odd = even + half;
        const re = real[odd] * cosine[twiddle] - imaginary[odd] * sine[twiddle];
        const im = real[odd] * sine[twiddle] + imaginary[odd] * cosine[twiddle];
        real[odd] = real[even] - re;
        imaginary[odd] = imaginary[even] - im;
        real[even] += re;
        imaginary[even] += im;
      }
    }
  }
}

/** Hann-windowed, full-scale-normalized positive-frequency amplitudes (including DC). */
export function frequencyMagnitudes(samples: Float32Array, fftSize = FFT_SIZE): Float32Array {
  const plan = createPlan(fftSize);
  transform(samples, 0, plan);
  const magnitudes = new Float32Array(fftSize / 2 + 1);
  for (let bin = 0; bin < magnitudes.length; bin++) {
    const scale = bin === 0 || bin === fftSize / 2 ? 1 : 2;
    magnitudes[bin] = scale * Math.hypot(plan.real[bin], plan.imaginary[bin]) / plan.windowSum;
  }
  return magnitudes;
}

function validatePcm(channels: Float32Array[], sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > 384000) {
    throw new RangeError('Audio sample rate is invalid or unsupported.');
  }
  if (channels.length > MAX_ANALYSIS_CHANNELS) {
    throw new RangeError('Audio has too many channels to visualize safely. Playback remains available.');
  }
  const length = channels[0]?.length ?? 0;
  if (channels.some(channel => !(channel instanceof Float32Array) || channel.length !== length)) {
    throw new RangeError('Audio channels must contain equally sized PCM samples.');
  }
  if (length / sampleRate > MAX_ANALYSIS_DURATION) {
    throw new RangeError('Audio visualization is limited to recordings of 10 minutes. Playback remains available.');
  }
  if (length * channels.length > MAX_DECODED_SAMPLES) {
    throw new RangeError('Decoded audio is too large to visualize safely. Playback remains available.');
  }
  return length;
}

/**
 * Waveform uses every sample. Spectrogram uses a centred 2048-sample Hann window
 * per overview column, with logarithmic frequency rows and a fixed -90..0 dBFS
 * range. Channel powers are averaged after FFT, so antiphase stereo stays visible.
 * Windows can be separated on long recordings; `sampled` makes that explicit.
 */
export function analyzeAudio(channels: Float32Array[], sampleRate: number): AudioAnalysis {
  const length = validatePcm(channels, sampleRate);
  const duration = length / sampleRate;
  const columns = Math.min(MAX_SPECTROGRAM_COLUMNS, Math.ceil(length / (FFT_SIZE / 4)));
  const bins = SPECTROGRAM_BINS;
  const maxFrequency = Math.min(sampleRate / 2, 20000);
  const minFrequency = Math.min(20, maxFrequency / 2);
  const peaks = new Float32Array(Math.min(WAVEFORM_PEAK_COUNT, length));
  const spectrogram = new Uint8Array(columns * bins);
  const analysis: AudioAnalysis = {
    peaks, spectrogram, columns, bins, minFrequency, maxFrequency, duration,
    fftSize: FFT_SIZE, floorDecibels: FLOOR_DECIBELS,
    sampled: columns > 0 && length / columns > FFT_SIZE,
  };
  if (length === 0) return analysis;

  for (const channel of channels) {
    for (let peak = 0; peak < peaks.length; peak++) {
      const start = Math.floor(peak * length / peaks.length);
      const end = Math.floor((peak + 1) * length / peaks.length);
      let amplitude = peaks[peak];
      for (let index = start; index < end; index++) {
        const value = Math.abs(channel[index]);
        if (Number.isFinite(value)) amplitude = Math.max(amplitude, Math.min(1, value));
      }
      peaks[peak] = amplitude;
    }
  }

  const plan = createPlan(FFT_SIZE);
  const power = new Float64Array(FFT_SIZE / 2 + 1);
  const rowStarts = new Uint16Array(bins);
  const rowEnds = new Uint16Array(bins);
  for (let row = 0; row < bins; row++) {
    const low = minFrequency * (maxFrequency / minFrequency) ** (row / bins);
    const high = minFrequency * (maxFrequency / minFrequency) ** ((row + 1) / bins);
    // A low-frequency row narrower than one FFT bin shows the nearest measured bin.
    rowStarts[row] = Math.max(1, Math.min(FFT_SIZE / 2, Math.round(low * FFT_SIZE / sampleRate)));
    rowEnds[row] = Math.max(rowStarts[row], Math.min(FFT_SIZE / 2, Math.round(high * FFT_SIZE / sampleRate)));
  }
  for (let column = 0; column < columns; column++) {
    power.fill(0);
    const centre = Math.floor((column + 0.5) * length / columns);
    const start = centre - FFT_SIZE / 2;
    for (const channel of channels) {
      transform(channel, start, plan);
      for (let bin = 1; bin < power.length; bin++) {
        const scale = bin === FFT_SIZE / 2 ? 1 : 2;
        const re = plan.real[bin] * scale / plan.windowSum;
        const im = plan.imaginary[bin] * scale / plan.windowSum;
        power[bin] += (re * re + im * im) / channels.length;
      }
    }
    for (let row = 0; row < bins; row++) {
      let maximumPower = 0;
      for (let bin = rowStarts[row]; bin <= rowEnds[row]; bin++) {
        maximumPower = Math.max(maximumPower, power[bin]);
      }
      const decibels = maximumPower > 0 ? 10 * Math.log10(maximumPower) : FLOOR_DECIBELS;
      spectrogram[column * bins + row] = Math.round(255 * Math.max(0, Math.min(1,
        (decibels - FLOOR_DECIBELS) / -FLOOR_DECIBELS)));
    }
  }
  return analysis;
}
