#!/usr/bin/env python3
"""tag-cleanup.py — cut set_tags changesets from a live RadioDJ snapshot.

    python3 -I tools/tag-cleanup.py <snapshot.json> <sheet_id> <out_dir>

<snapshot.json> is {"captured_at": ..., "rows": [{id, artist, title, subcat, enabled, path}]}
straight from `songs` (enabled Music only is used). Values must be byte-exact: set_tags
preconditions compare exactly (CHANGESET-CONTRACT.md §3).

Writes three changesets with disjoint songs, so each can be applied, skipped or rolled
back on its own. Every row carries that song's full correction (artist and title):
  <date>-tags-artists   any song whose artist changes
  <date>-tags-versions  title-only fixes that strip a version tag ((Clean), (PO Clean Edit)...)
  <date>-tags-bpm       title-only fixes that are only a Promo Only key/BPM suffix
Rules are the ones reviewed in sheets/2026-10-17-bolt-metadata-cleanup.md.
"""
import collections, json, re, sys

STATION_ID = "6a42a599-acfc-404f-a524-9fb9b65d36f3"

# Exact live artist string -> correction. Reviewed per row; see the sheet.
ARTIST = {
    'AC; DC': 'AC/DC', 'Mumford, Sons': 'Mumford & Sons', 'Coheed, Cambria': 'Coheed and Cambria',
    'Of Mice, Men': 'Of Mice & Men', 'Amyl, The Sniffers': 'Amyl and the Sniffers',
    'Black Crowes, The': 'The Black Crowes', 'Ax, The Hatchetmen': 'Ax and the Hatchetmen',
    'Ax, The Hatchetmen With Albert Hammond Jr.': 'Ax and the Hatchetmen feat. Albert Hammond Jr.',
    'Dexter, The Moonrocks': 'Dexter and the Moonrocks', 'Giovannie, The Hired Guns': 'Giovannie and the Hired Guns',
    'Brian Fallon, The Painkillers': 'Brian Fallon & The Painkillers', 'Caroline  Lachek': 'Caroline Polachek',
    'Rezz   Grabbitz': 'Rezz & Grabbitz', 'Noah Kahan W;  Post Malone': 'Noah Kahan feat. Post Malone',
    'Koяn, Korn': 'Korn', 'Koяn': 'Korn', 'Three Days Grace, Three Days Grace': 'Three Days Grace',
    'E, Tommy Walter': 'Eels', 'Falling In Reverse, Marilyn Mansion': 'Falling In Reverse, Marilyn Manson',
    # Spelling variants of one artist, unified so artist separation sees one artist.
    'Pretenders': 'The Pretenders', 'Tom Petty & The Heartbreakers': 'Tom Petty And The Heartbreakers',
    'The Goo Goo Dolls': 'Goo Goo Dolls', 'P.O.D': 'P.O.D.', 'Awolnation': 'AWOLNATION', 'Letdown': 'Letdown.',
    'Smith': 'SMITH', 'Mod Sun': 'MOD SUN', 'Don T Believe In Ghosts': "Don't Believe In Ghosts",
    "Smashing Pumpkins, Billy Corgan, James Iha, D'arcy Wretzky, Jimmy Chamberlin": 'The Smashing Pumpkins',
}

MEMBER_LISTS = {1512, 1517, 1518, 1524, 1531, 1534, 1538, 1545, 1547, 1553, 1578}

VERSION = (r'(?:po |pg |super )?(?:clean|dirty|explicit)(?:\.| edit| version| radio edit)?'
           r'|(?:radio |rado |clean )?edit(?: \d)?|radio edit \d|original mix|album version'
           r'|(?:\d{4} )?(?:- )?remaster(?:ed)?(?: \d{4})?(?: / new master)?|po intro edit - clean')


def file_artist(path):
    """Artist half of a VA-compilation filename: '084. Eels - Novocaine For The Soul.mp3' -> 'Eels'."""
    return re.sub(r'^\d+\.\s*', '', path.rsplit('\\', 1)[-1]).split(' - ')[0]


def fix_artist(r):
    a = r['artist']
    if a in ARTIST:
        return ARTIST[a]
    m = re.match(r'^(.*?) F\.; (.*)$', a)  # Promo Only "f." mangled to "F.;"
    if m:
        return f'{m[1]} feat. {m[2]}'
    # Gold VA-compilation rows whose artist tag lists band members after the band. Listed by
    # ID, not detected: "Queen, David Bowie" has the same shape and is a real duet.
    if r['id'] in MEMBER_LISTS and a.split(',')[0] == file_artist(r['path']).split(',')[0]:
        return a.split(',')[0]
    return re.sub(r'\s+', ' ', a).strip()


def fix_title(r):
    """Returns (title, set of classes)."""
    why = set()
    t = re.sub(r'\s+', ' ', r['title']).strip()
    if 'Promo Only' in r['path']:
        # Key + BPM, or a bare BPM in a plausible tempo range. Gold is exempt:
        # "Here I Go Again 87" is the '87 version, not a tempo.
        m = re.search(r'\s+(?:(\d{1,2}[AB])\s+(\d{2,3})|(\d{2,3}))$', t)
        if m and (m[1] or 60 <= int(m[3]) <= 200):
            t = t[:m.start()]
            why.add('bpm')
    v = re.sub(r'\s*[(\[](?:' + VERSION + r')[)\]]', '', t, flags=re.I)
    v = re.sub(r'\s+(?:po clean edit|radio edit|clean edit|clean|edit)$', '', v, flags=re.I)
    if v != t:
        why.add('version')
    return re.sub(r'\s+', ' ', v).strip(), why


def main():
    snap_path, sheet_id, out_dir = sys.argv[1:4]
    snap = json.load(open(snap_path, encoding='utf-8'))
    buckets = collections.defaultdict(list)
    for r in snap['rows']:
        if not r['enabled']:
            continue
        artist, title = fix_artist(r), None
        title, why = fix_title(r)
        if artist == r['artist'] and title == r['title']:
            continue
        op = {'rdj_song_id': r['id'], 'artist': r['artist'], 'title': r['title']}
        reasons = []
        if artist != r['artist']:
            op['to_artist'] = artist
            reasons.append(f'artist: {r["artist"]!r} -> {artist!r}')
        if title != r['title']:
            op['to_title'] = title
            reasons.append({'bpm': 'strip Promo Only key/BPM suffix', 'version': 'strip version tag'}.get(
                ' '.join(sorted(why)), 'strip version tag and Promo Only key/BPM suffix' if why else 'tidy whitespace'))
        op['reason'] = '; '.join(reasons)
        key = 'artists' if 'to_artist' in op else 'versions' if 'version' in why else 'bpm'
        buckets[key].append(op)

    date = snap['captured_at'][:10]
    intents = {
        'artists': 'Correct mangled and variant artist tags so artist separation sees one artist per act '
                   '(comma-split band names, AC; DC, band-member lists, spelling variants). Title fixes for the same songs ride along.',
        'versions': 'Strip version tags from titles ((Clean), (PO Clean Edit), (Radio Edit), (Original Mix), remaster notes); '
                    'real alternate versions (Acoustic, Live, Remix) are kept. Key/BPM suffixes on the same titles ride along.',
        'bpm': 'Strip Promo Only DJ key/BPM suffixes from titles ("Hooked 6A 128" -> "Hooked").',
    }
    for key in ('artists', 'versions', 'bpm'):
        cs_id = f'{date}-tags-{key}'
        cs = {
            'changeset_version': 1, 'id': cs_id, 'station_id': STATION_ID, 'authored_at': date,
            'intent': intents[key],
            'basis': {'sheet_id': sheet_id, 'sheet_captured_at': snap['captured_at']},
            'set_tags': buckets[key],
        }
        with open(f'{out_dir}/{cs_id}.json', 'w', encoding='utf-8') as f:
            json.dump(cs, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print(f'{cs_id}: {len(buckets[key])} song(s)')


if __name__ == '__main__':
    main()
