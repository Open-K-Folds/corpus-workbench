# English dictionary for meaning labels

The Workbench uses the [2025 edition of Open English Wordnet](https://github.com/globalwordnet/english-wordnet/releases/tag/2025-edition) by the Open English Wordnet team, derived from Princeton University WordNet. The upstream [Creative Commons Attribution 4.0 terms](LICENSE.md) and [WordNet notice](WNDB_License.txt) accompany the data.

The Workbench extracts written forms, synset IDs and definitions from the [official XML archive](https://en-word.net/static/english-wordnet-2025.xml.gz). It groups forms case-insensitively and partitions the index by initial letter for local lookup. To reproduce the index, run `python scripts/prepare-english-wordnet.py PATH_TO_ARCHIVE` from the source checkout. The generator verifies the archive's SHA-256 before conversion.
