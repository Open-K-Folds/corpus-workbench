"""Build the local meaning lookup from the official 2025 Open English Wordnet XML."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import string
import unicodedata
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, help='english-wordnet-2025.xml.gz')
    args = parser.parse_args()
    if hashlib.sha256(args.archive.read_bytes()).hexdigest() != '9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe':
        parser.error('Expected the official 2025 edition. See the bundled Wordnet README.')

    entries = {}
    definitions = {}
    with gzip.open(args.archive) as source:
        for _, node in ET.iterparse(source, events=('end',)):
            if node.tag == 'LexicalEntry':
                senses = [sense.attrib['synset'] for sense in node.findall('Sense')]
                for form in [node.find('Lemma'), *node.findall('Form')]:
                    word = ' '.join(unicodedata.normalize('NFC', form.attrib['writtenForm']).lower().split())
                    entries.setdefault(word, {}).update(dict.fromkeys(senses))
                node.clear()
            elif node.tag == 'Synset':
                definitions[node.attrib['id']] = node.findtext('Definition')
                node.clear()

    output = Path(__file__).resolve().parents[1] / 'ui/public/third-party/english-wordnet-2025'
    output.mkdir(parents=True, exist_ok=True)
    for letter in [*string.ascii_lowercase, 'other']:
        words = {word: list(entries[word]) for word in sorted(entries)
                 if (word[0] if word[0] in string.ascii_lowercase else 'other') == letter}
        senses = {key: definitions[key] for key in sorted({key for ids in words.values() for key in ids})}
        data = json.dumps({'words': words, 'senses': senses}, ensure_ascii=False, separators=(',', ':')).encode()
        (output / (letter + '.json.gz')).write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
    print(f'{len(entries):,} forms, {len(definitions):,} synsets')


if __name__ == '__main__':
    main()
