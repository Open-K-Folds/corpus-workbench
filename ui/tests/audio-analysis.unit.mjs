import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeAudio, frequencyMagnitudes, FFT_SIZE, FLOOR_DECIBELS,
  MAX_ANALYSIS_BYTES, MAX_ANALYSIS_DURATION, MAX_DECODED_SAMPLES,
  MAX_ANALYSIS_CHANNELS,
  MAX_SPECTROGRAM_COLUMNS, SPECTROGRAM_BINS, WAVEFORM_PEAK_COUNT,
} from '../src/audio-analysis.ts';

const SAMPLE_RATE = 16000;
const tone = (frequency, duration = 1, amplitude = 0.8) => Float32Array.from(
  { length: Math.round(SAMPLE_RATE * duration) },
  (_, index) => amplitude * Math.sin(2 * Math.PI * frequency * index / SAMPLE_RATE),
);
const loudestRow = (analysis, column) => {
  const values = analysis.spectrogram.subarray(column * analysis.bins, (column + 1) * analysis.bins);
  return values.indexOf(Math.max(...values));
};
const rowFrequency = (analysis, row) => analysis.minFrequency *
  (analysis.maxFrequency / analysis.minFrequency) ** ((row + 0.5) / analysis.bins);

test('FFT measures the frequency and dBFS amplitude of a bin-centred synthetic tone', () => {
  const expectedBin = 128;
  const frequency = expectedBin * SAMPLE_RATE / FFT_SIZE;
  const amplitudes = frequencyMagnitudes(tone(frequency, FFT_SIZE / SAMPLE_RATE, 0.5));
  const loudest = amplitudes.indexOf(Math.max(...amplitudes));
  assert.equal(loudest, expectedBin);
  assert.ok(Math.abs(amplitudes[loudest] - 0.5) < 1e-6);
  assert.ok(Math.abs(20 * Math.log10(amplitudes[loudest]) + 6.0206) < 0.001);
});

test('silence has zero waveform and zero intensity rather than decorative readings', () => {
  const analysis = analyzeAudio([new Float32Array(SAMPLE_RATE)], SAMPLE_RATE);
  assert.ok(analysis.peaks.every(value => value === 0));
  assert.ok(analysis.spectrogram.every(value => value === 0));
  assert.equal(analysis.floorDecibels, FLOOR_DECIBELS);
  assert.equal(analysis.duration, 1);
});

test('a tone produces energy at its actual logarithmic frequency and fixed dBFS scale', () => {
  const analysis = analyzeAudio([tone(1000, 1, 0.5)], SAMPLE_RATE);
  const column = Math.floor(analysis.columns / 2);
  const row = loudestRow(analysis, column);
  assert.ok(Math.abs(rowFrequency(analysis, row) - 1000) < 100);
  const intensity = analysis.spectrogram[column * analysis.bins + row];
  assert.ok(Math.abs(intensity - 238) <= 1, `-6.02 dBFS should map to 238, got ${intensity}`);
  assert.ok(Math.max(...analysis.peaks) >= 0.49);
});

test('synthetic chirp progresses upward across time-frequency columns', () => {
  const seconds = 2;
  const startHz = 250;
  const endHz = 3000;
  const chirp = Float32Array.from({ length: SAMPLE_RATE * seconds }, (_, index) => {
    const time = index / SAMPLE_RATE;
    return 0.7 * Math.sin(2 * Math.PI * (startHz * time + (endHz - startHz) * time * time / (2 * seconds)));
  });
  const analysis = analyzeAudio([chirp], SAMPLE_RATE);
  const positions = [0.15, 0.5, 0.85];
  const frequencies = positions.map(position => {
    const column = Math.floor(position * analysis.columns);
    return rowFrequency(analysis, loudestRow(analysis, column));
  });
  assert.ok(frequencies[0] < frequencies[1] && frequencies[1] < frequencies[2]);
  positions.forEach((position, index) => {
    const expected = startHz + (endHz - startHz) * position;
    assert.ok(Math.abs(frequencies[index] - expected) / expected < 0.12);
  });
});

test('opposite-phase stereo retains energy and separate channel power is averaged', () => {
  const signal = tone(1000);
  const inverse = signal.map(value => -value);
  const mono = analyzeAudio([signal], SAMPLE_RATE);
  const stereo = analyzeAudio([signal, inverse], SAMPLE_RATE);
  assert.deepEqual(stereo.peaks, mono.peaks);
  assert.deepEqual(stereo.spectrogram, mono.spectrogram);
  const singleSided = analyzeAudio([signal, new Float32Array(signal.length)], SAMPLE_RATE);
  const middle = Math.floor(mono.columns / 2);
  const row = loudestRow(mono, middle);
  const difference = mono.spectrogram[middle * mono.bins + row] - singleSided.spectrogram[middle * mono.bins + row];
  assert.ok(difference >= 8 && difference <= 9, 'one silent stereo channel reduces power by 3 dB');
});

test('waveform covers every PCM sample, including a transient between FFT windows', () => {
  const signal = new Float32Array(SAMPLE_RATE * 12);
  signal[17] = 0.92;
  signal[signal.length - 1] = -0.73;
  const analysis = analyzeAudio([signal], SAMPLE_RATE);
  assert.ok(Math.abs(analysis.peaks[0] - 0.92) < 1e-6);
  assert.ok(Math.abs(analysis.peaks.at(-1) - 0.73) < 1e-6);
  assert.equal(analysis.peaks.length, WAVEFORM_PEAK_COUNT);
});

test('overview allocation and analysis are bounded on longer recordings', () => {
  const analysis = analyzeAudio([tone(440, 150)], SAMPLE_RATE);
  assert.equal(analysis.columns, MAX_SPECTROGRAM_COLUMNS);
  assert.equal(analysis.bins, SPECTROGRAM_BINS);
  assert.equal(analysis.spectrogram.length, MAX_SPECTROGRAM_COLUMNS * SPECTROGRAM_BINS);
  assert.equal(analysis.sampled, true);
  assert.equal(analysis.duration, 150);
  assert.equal(MAX_ANALYSIS_BYTES, 32 * 1024 * 1024);
});

test('unsupported input reports limits while empty input remains a real empty state', () => {
  const empty = analyzeAudio([], SAMPLE_RATE);
  assert.equal(empty.duration, 0);
  assert.equal(empty.columns, 0);
  assert.equal(empty.peaks.length, 0);
  assert.equal(empty.spectrogram.length, 0);
  assert.throws(() => analyzeAudio([new Float32Array(MAX_ANALYSIS_DURATION + 1)], 1), /10 minutes/);
  const oversized = new Float32Array(Math.floor(MAX_DECODED_SAMPLES / 2) + 1);
  assert.throws(() => analyzeAudio([oversized, oversized], 384000), /too large/);
  assert.throws(() => analyzeAudio([new Float32Array(4), new Float32Array(5)], SAMPLE_RATE), /equally sized/);
  assert.throws(() => analyzeAudio(Array.from({ length: MAX_ANALYSIS_CHANNELS + 1 }, () => new Float32Array(1)), SAMPLE_RATE), /too many channels/);
  for (const rate of [0, -1, NaN, Infinity, 384001]) {
    assert.throws(() => analyzeAudio([], rate), /sample rate/);
  }
});

test('non-finite PCM cannot pollute raster output and invalid FFT sizes are rejected', () => {
  const signal = new Float32Array(FFT_SIZE);
  signal[100] = NaN;
  signal[101] = Infinity;
  const analysis = analyzeAudio([signal], SAMPLE_RATE);
  assert.ok(analysis.peaks.every(Number.isFinite));
  assert.ok(analysis.spectrogram.every(value => value === 0));
  assert.throws(() => frequencyMagnitudes(signal, 1000), /power of two/);
});
