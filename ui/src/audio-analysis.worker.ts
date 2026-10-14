import { analyzeAudio, type AudioAnalysisRequest, type AudioAnalysisResponse } from './audio-analysis';

// DOM's Window.postMessage overload differs from the worker overload. Keeping this
// tiny typed scope avoids including conflicting DOM + WebWorker global libraries.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AudioAnalysisRequest>) => void) | null;
  postMessage: (response: AudioAnalysisResponse, transfer?: Transferable[]) => void;
};

scope.onmessage = ({ data }) => {
  try {
    const analysis = analyzeAudio(data.channels, data.sampleRate);
    scope.postMessage({ id: data.id, result: analysis }, [analysis.peaks.buffer, analysis.spectrogram.buffer]);
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Audio analysis failed.' });
  }
};
