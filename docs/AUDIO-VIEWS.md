# Recording audio views

The recording pane defaults to Waveform. Its compact Audio view radio group also
offers Spectrogram and Spectrum. Arrow keys move between the choices. The choice
is saved locally, including across documents and application restarts.

Waveform and Spectrogram share recording time and the existing playhead. Drag the
plot to scrub, use Left/Right to seek a second (Shift: five seconds), or Home/End
for the bounds. Transcript selection, Listen to selection, looping, the player's
seek control, pane resizing and annotation timelines retain the same audio engine.

Spectrogram is a sampled overview of actual source audio: time runs left to right,
frequency increases bottom to top on a logarithmic axis, and brighter pixels mean
stronger energy. Its fixed scale is −90 to 0 dBFS. Decode is resampled to 16 kHz,
so its displayed upper frequency is 8 kHz. Each column measures a centered
2048-sample Hann FFT window; at most 1024 time columns and 128 frequency rows are
retained. Long overviews can miss short events between sampled windows; they do
not provide exact word boundaries. Channel powers are averaged after FFT so
opposite-phase stereo does not disappear. Waveform shows absolute peaks without
normalizing quiet recordings to full height.

Spectrum measures the media engine's live output using Web Audio's analyser. Its
levels are labeled FFT dB, retaining the browser's Blackman-window normalization;
they are not directly comparable to the spectrogram's normalized dBFS scale. Its
horizontal axis is frequency, not recording time. Use the player to seek. Pausing,
seeking or buffering clears live bars and shows a state label. The browser's mono
analysis includes playback volume, mute and speed; it is not a calibrated sound
pressure meter. Switching views never replaces the audio element. Once attached,
the audio graph stays connected and resumes for all playback entry points.

Analysis is local. A same-origin module worker caches the current media overview
by content hash so annotation edits reuse it; stale fetches are aborted and workers
terminated when media changes.
Plots cache their static image, cap pixel ratio at 2, and update at most about
30 fps (8 fps with reduced motion). Animation stops when paused, hidden or collapsed.
No generated readings or corpus media are sent to external services.

Overview analysis is skipped above 32 MiB encoded bytes or 10 minutes of known
duration. Decode uses a fixed 16 kHz rate and is serialized across document changes;
decoded samples are checked after decoding against 32 million across at most 32
channels. The browser may temporarily allocate all source channels before that
check; compressed-byte and known-duration guards run before decode. An unavailable overview leaves native
playback, player seeking and live Spectrum available for playable media. Invalid
or absent media clears the preceding plot and exposes an unavailable/empty state.

Validation uses generated PCM only. `npm run test:audio --prefix ui` checks silence,
known tones, chirps, channel power and resource bounds. The browser audio-mode
suite checks real tone/silence pixels, live frequency changes, keyboard/pointer and
transcript seeks, persistence, missing/bad/oversized media, cancellation, resizing,
themes and reduced motion. The Electron audio-view journey verifies the bundled
worker and live analyser under `workbench://app`, without relaxing its CSP.
