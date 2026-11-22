"""Add model-estimated word times to a fresh Workbench package using an exact local CTC replay."""
import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import xml.etree.ElementTree as ET


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def seconds_us(value):
    return int(round(Decimal(str(value)) * 1_000_000))


def package_file(root, relative):
    path = (root / relative).resolve()
    require(path.is_relative_to(root) and path.is_file(), "Expected a file inside the source package")
    return path


def word_spans(evidence, expected, vocabulary):
    groups, spaces, group = [], [], []
    cursor = 0
    decoded_ids = []
    for run in evidence["runs"]:
        index = run["id"]
        require(run["start_frame"] == cursor and cursor < run["end_frame"], "Invalid acoustic run")
        cursor = run["end_frame"]
        require(0 <= index < len(vocabulary["pieces"]) and vocabulary["pieces"][index] == run["piece"],
                "Token does not match the model vocabulary")
        if index == vocabulary["blank_id"]:
            continue
        decoded_ids.append(index)
        if run["piece"] == " ":
            if group:
                groups.append(group)
                group = []
                spaces.append(run)
        else:
            group.append(run)
    if group:
        groups.append(group)
    require(cursor == evidence["frames"] and decoded_ids == evidence["target_ids"],
            "Model frame sequence differs from the encoded source")
    require(["".join(r["piece"] for r in word) for word in groups] == expected,
            "Model pieces do not reconstruct the exact source words")

    rate, stride = evidence["sample_rate"], evidence["stride_samples"]
    # Each output describes a receptive field. Use adjacent frame centres'
    # halfway points as the frame boundaries in the original chunk's PCM clock.
    offset = evidence["frame_left_samples"] + (evidence["receptive_field_samples"] - stride) / 2
    def boundary(frame):
        sample = min(evidence["samples"], max(0, offset + frame * stride))
        return round(sample * 1_000_000 / rate)

    spans = []
    for runs in groups:
        start, end = boundary(runs[0]["start_frame"]), boundary(runs[-1]["end_frame"])
        largest_blank = max((b["start_frame"] - a["end_frame"] for a, b in zip(runs,runs[1:])), default=0)
        spans.append(dict(coreStartUs=start, coreEndUs=end, startUs=start, endUs=end,
                          largestInternalBlankUs=round(largest_blank * stride * 1_000_000 / rate)))
    # A decoded space between nearby words supplies a transition for the
    # reading caret. Leave longer inter-word pauses without word timing.
    for left, right, space in zip(spans, spans[1:], spaces):
        split = (boundary(space["start_frame"]) + boundary(space["end_frame"])) // 2
        if left["endUs"] <= split <= right["startUs"] and right["startUs"] - left["endUs"] <= 120_000:
            left["endUs"] = right["startUs"] = split
    return spans


def align(args):
    source, output = args.source.resolve(), args.out.resolve()
    require(not output.exists() and not output.is_relative_to(source), "Choose a new output package outside the source")
    xml = package_file(source, args.transcript)
    raw_path = package_file(source, args.raw)
    raw = read_json(raw_path)
    vocab = read_json(args.evidence / "vocabulary.json")
    require(digest(raw_path) == vocab["raw_sha256"], "The CTC evidence belongs to different ASR output")
    require(raw["model"] == "omniASR_CTC_300M_v2", "Expected the saved Omnilingual CTC 300M v2 run")
    parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True, insert_pis=True))
    tree = ET.parse(xml,parser=parser)
    media = {m.get("url") for m in tree.findall(".//{*}media")}
    require(len(media) == 1 and None not in media, "Expected a single linked source recording")
    media_ref = media.pop()
    media_files = {(source / prefix / media_ref).resolve() for prefix in ("", "Audio", "Video")}
    media_files = [p for p in media_files if p.is_relative_to(source) and p.is_file()]
    require(len(media_files) == 1 and digest(media_files[0]) == raw["source_sha256"],
            "The linked recording differs from the one used for ASR")

    turns = tree.findall(".//{*}u")
    chunks = [(i,c) for i,c in enumerate(raw["chunks"],1) if c["text"].split()]
    require(len(turns) == len(chunks) and turns, "Transcript must carry the saved chunk boundaries in order")
    records = []
    token_ids = set()
    for turn, (ordinal, chunk) in zip(turns, chunks):
        start, end = (seconds_us(chunk[k]) for k in ("start_seconds","end_seconds"))
        require(start == seconds_us(turn.attrib["start"]) and end == seconds_us(turn.attrib["end"]),
                f"Source timing differs in chunk {ordinal}")
        evidence = read_json(args.evidence / f"chunk-{ordinal:03d}.json")
        require(evidence["ordinal"] == ordinal and evidence["wav_sha256"] == chunk["audio_sha256"]
                and evidence["exact_match"] and evidence["target_roundtrip_exact"]
                and evidence["greedy_text"] == chunk["text"], f"Exact acoustic replay unavailable for chunk {ordinal}")
        require(start == seconds_us(evidence["chunk_start_seconds"]) and end == seconds_us(evidence["chunk_end_seconds"])
                and abs(round(evidence["samples"] * 1_000_000 / evidence["sample_rate"]) - (end-start)) <= 1,
                f"Original PCM clock differs for chunk {ordinal}")
        tokens = turn.findall(".//{*}tok")
        words = chunk["text"].split()
        require(["".join(t.itertext()) for t in tokens] == words, f"Source words differ in chunk {ordinal}")
        for token, span in zip(tokens, word_spans(evidence, words, vocab)):
            token_id = token.attrib["id"]
            require(token_id not in token_ids and not {"start","end"}.intersection(token.attrib),
                    "Expected unique source identities without existing word times")
            token_ids.add(token_id)
            for key in ("startUs","endUs","coreStartUs","coreEndUs"):
                span[key] += start
            require(start <= span["startUs"] < span["endUs"] <= end, "Word timing escaped its source chunk")
            token.set("start",format(Decimal(span["startUs"]) / 1_000_000,"f"))
            token.set("end",format(Decimal(span["endUs"]) / 1_000_000,"f"))
            token.set("wb_timing_origin","ctc-model-estimate")
            records.append(dict(tokenId=token_id,chunkId=turn.attrib["id"],**span))
    require(len(records) == len(tree.findall(".//{*}tok")), "Some words are outside the verified source chunks")

    report = dict(method="Original Omnilingual CTC replay; model-estimated word intervals",
                  humanReviewed=False, model=raw["model"], sourceAudioSha256=raw["source_sha256"],
                  sourceTranscriptSha256=digest(xml), rawASRSha256=vocab["raw_sha256"],
                  checkpointSha256=vocab["checkpoint_sha256"], tokenizerSha256=vocab["tokenizer_sha256"],
                  sampleRate=evidence["sample_rate"], frameStrideSamples=vocab["stride_samples"],
                  receptiveFieldSamples=vocab["receptive_field_samples"], exactChunks=len(chunks),
                  intervalPolicy="First to last lexical frame; adjacent words share the decoded space midpoint only across gaps of 120 ms or less. All times are microseconds on the recording clock.",
                  words=records)
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as tmp:
        staged = Path(tmp) / "package"
        shutil.copytree(source,staged)
        tree.write(staged / xml.relative_to(source),encoding="utf-8",xml_declaration=True)
        metadata = staged / "Resources" / "word-alignment.json"
        require(not metadata.exists(), "Package already has word alignment metadata")
        metadata.parent.mkdir(exist_ok=True)
        metadata.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
        staged.rename(output)
    print(f"Aligned {len(records)} source words in {len(chunks)} chunks.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source",type=Path,required=True)
    parser.add_argument("--transcript",required=True,help="Chunk-timed TEI XML path inside the source package")
    parser.add_argument("--raw",required=True,help="Original ASR chunk JSON path inside the source package")
    parser.add_argument("--evidence",type=Path,required=True,help="Directory produced by omnilingual-emissions.py")
    parser.add_argument("--out",type=Path,required=True)
    align(parser.parse_args())
