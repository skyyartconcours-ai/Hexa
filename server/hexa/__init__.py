"""Hexa — sous-titres traduits en quasi-direct pour les lives Twitch.

Le pipeline est toujours le même, quelle que soit la source audio :

    audio 16 kHz mono  ->  segmentation VAD  ->  transcription  ->  traduction  ->  overlay

Les briques `stt` et `translate` sont interchangeables (local ou API) et
importées paresseusement : on ne paie la dépendance que du backend utilisé.
"""

__version__ = "0.1.0"

SAMPLE_RATE = 16_000
FRAME_MS = 20
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000  # 320
FRAME_BYTES = FRAME_SAMPLES * 2  # int16 mono
