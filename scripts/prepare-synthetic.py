"""Create a new clearly synthetic TEITOK package; never alter an existing path."""
import argparse
import math
from pathlib import Path
import shutil
import struct
import wave

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
if args.out.exists():
    parser.error('Output already exists; choose a new directory.')
args.out.parent.mkdir(parents=True, exist_ok=True)
args.out.parent.chmod(0o700)
shutil.copytree(Path(__file__).resolve().parents[1] / 'fixtures/synthetic', args.out)
args.out.chmod(0o700)
audio = args.out / 'Audio'
audio.mkdir()
with wave.open(str(audio / 'synthetic-workbench.wav'), 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(16000)
    wav.writeframes(b''.join(struct.pack('<h', int(1200 * math.sin(2 * math.pi * 220 * i / 16000)))
                             for i in range(128000)))
print('Created synthetic package with an eight-second generated tone.')
