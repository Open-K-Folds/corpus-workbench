"""Create a new text-only synthetic package for the bounded split/merge UI."""
import argparse
from pathlib import Path

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out',type=Path,required=True)
args=parser.parse_args()
if args.out.exists():
    raise SystemExit('Destination exists; use a new protected directory.')
for folder in ['Resources','xmlfiles','Annotations']:
    (args.out/folder).mkdir(parents=True)
profile=Path(__file__).resolve().parents[1]/'assets/teitok-reader'
(args.out/'Resources/settings.xml').write_bytes((profile/'settings.xml').read_bytes())
(args.out/'Annotations/review_def.xml').write_bytes((profile/'review_def.xml').read_bytes())
(args.out/'xmlfiles/SYNTHETIC-STRUCTURAL.xml').write_text("<?xml version='1.0'?>\n<TEI><text><tok id='w1' form='é🙂x' nform='a🙂bc' wb_normalized='A🙂BC' variety='synthetic-local'>é🙂x</tok> <tok id='w2' form='SYNTHETIC' relation_target='#w1' relation_type='synthetic-context'>SYNTHETIC</tok><tok id='w3' form='ONLY'>ONLY</tok></text></TEI>\n",encoding='utf-8')
(args.out/'Annotations/review_SYNTHETIC-STRUCTURAL.xml').write_text("<spanGrp><span id='s1' corresp='#w1 #w3' label='synthetic discontinuous'/><span id='s2' corresp='#w1' wb_start='1' wb_end='2' wb_coordinate='unicode-codepoint' wb_layer='corrected' wb_quote='🙂' wb_status='resolved'/></spanGrp>\n",encoding='utf-8')
print('Created a synthetic text-only package. Media/ASR decoding remains a separate structural gate.')
