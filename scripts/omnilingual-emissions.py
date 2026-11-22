"""Export the original Omnilingual CTC model's local frame evidence for verified PCM chunks."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import wave

import numpy as np
import torch
from fairseq2.nn.batch_layout import BatchLayout
from omnilingual_asr.models.inference.pipeline import ASRInferencePipeline


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            digest.update(block)
    return digest.hexdigest()


def write_json(path, value):
    staging = path.with_suffix('.temp')
    staging.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    staging.replace(path)


def receptive_geometry(model):
    stride, width, left = 1, 1, 0
    layers = []
    for layer in model.encoder_frontend.feature_extractor.modules():
        if not isinstance(layer, torch.nn.Conv1d):
            continue
        kernel, step, dilate, pad = (value[0] for value in (layer.kernel_size, layer.stride, layer.dilation, layer.padding))
        left -= pad * stride
        width += (kernel - 1) * dilate * stride
        stride *= step
        layers.append({'kernel': kernel, 'stride': step, 'dilation': dilate, 'padding': pad})
    if not layers:
        raise RuntimeError('No acoustic feature convolution found')
    return left, width, stride, layers


@torch.inference_mode()
def run(args):
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    raw = json.loads(args.raw.read_text(encoding='utf-8-sig'))
    args.out.mkdir(parents=True, exist_ok=True)
    pipe = ASRInferencePipeline(model_card='omniASR_CTC_300M_v2', device='cpu', dtype=torch.float32)
    vocab_model = pipe.tokenizer._model
    pieces = [vocab_model.index_to_token(i) for i in range(vocab_model.vocabulary_size)]
    left, width, stride, layers = receptive_geometry(pipe.model)
    vocab = {'pieces': pieces, 'blank_id': 0, 'bos_id': vocab_model.bos_idx, 'unk_id': vocab_model.unk_idx,
             'pad_id': vocab_model.pad_idx, 'eos_id': vocab_model.eos_idx,
             'checkpoint_sha256': sha(next(Path('/models/fairseq2/assets').glob('*/*.pt'))),
             'tokenizer_sha256': sha(next(Path('/models/fairseq2/assets').glob('*/*.model'))),
             'raw_sha256': sha(args.raw), 'torch_version': torch.__version__, 'threads': args.threads,
             'feature_layers': layers, 'frame_left_samples': left, 'receptive_field_samples': width, 'stride_samples': stride}
    write_json(args.out/'vocabulary.json', vocab)
    print('Model ready:', len(pieces), 'labels;', width, 'sample receptive field;', stride, 'sample hop', flush=True)
    for ordinal, chunk in enumerate(raw['chunks'], 1):
        if args.only and ordinal != args.only: continue
        path = args.chunks / Path(chunk['audio_path']).name
        if sha(path) != chunk['audio_sha256']:
            raise ValueError(f'WAV hash mismatch in chunk {ordinal}')
        with wave.open(str(path),'rb') as audio:
            sample_rate, samples = audio.getframerate(), audio.getnframes()
            if (audio.getnchannels(), audio.getsampwidth(), sample_rate) != (1, 2, 16000):
                raise ValueError('Expected original mono, 16 kHz, signed 16-bit PCM')
        t0 = time.perf_counter()
        # Use the service's byte-input decoder, resampler, waveform normalization and collater.
        waveform, = list(pipe._build_audio_wavform_pipeline([path.read_bytes()]).and_return())
        b = pipe._create_batch_simple([(waveform, None)])
        layout = BatchLayout(b.source_seqs.shape, seq_lens=b.source_seq_lens, device=b.source_seqs.device)
        logits, layout_out = pipe.model(b.source_seqs, layout)
        frames = int(layout_out.seq_lens[0])
        if frames != (samples - width - 2 * left) // stride + 1: raise ValueError('Source geometry does not match logit length')
        log_probs = logits[0,:frames].log_softmax(dim=-1)
        pred = log_probs.argmax(dim=-1)
        distinct, counts = torch.unique_consecutive(pred, return_counts=True)
        greedy_text = pipe.token_decoder(distinct)
        target = pipe.token_encoder(chunk['text']).to(torch.long)
        columns = torch.arange(log_probs.shape[1]) if args.full else torch.unique(torch.cat((pred.unique(),target,torch.tensor([0],dtype=torch.long))))
        stem = f'chunk-{ordinal:03d}'
        probs = log_probs[:,columns].contiguous().numpy()
        np.savez(args.out/(stem+'.npz'), column_ids=columns.numpy(), log_probs=probs,
                 argmax=pred.numpy(), target_ids=target.numpy())
        runs = []
        start = 0
        for label_id, count in zip(distinct.tolist(), counts.tolist()):
            end = start + count
            confidence = log_probs[start:end,label_id].exp()
            runs.append({'id': label_id, 'piece': pieces[label_id], 'start_frame':start, 'end_frame':end,
                         'mean_prob':float(confidence.mean()), 'min_prob':float(confidence.min())})
            start = end
        write_json(args.out/(stem+'.json'), {'ordinal':ordinal, 'wav_sha256':chunk['audio_sha256'],
                   'sample_rate':sample_rate,'samples':samples,'chunk_start_seconds':chunk['start_seconds'],
                   'chunk_end_seconds':chunk['end_seconds'],'frames':frames, 'stride_samples':stride,
                   'frame_left_samples':left, 'receptive_field_samples':width, 'blank_id':0,
                   'greedy_text':greedy_text,'exact_match':greedy_text==chunk['text'],
                   'target_roundtrip_exact':pipe.token_decoder(target)==chunk['text'], 'target_ids':target.tolist(),
                   'runs':runs})
        print(f'{stem}: {frames} frames; matches supplied text: {greedy_text == chunk["text"]}; {time.perf_counter()-t0:.1f}s', flush=True)


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--raw',type=Path,required=True)
    p.add_argument('--chunks',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    p.add_argument('--only',type=int)
    p.add_argument('--threads',type=int,default=4)
    p.add_argument('--full',action='store_true')
    run(p.parse_args())