"""Per-session raw Opus / signed 16-bit little-endian PCM conversion.

The device protocol carries one mono 60 ms Opus packet per binary message.
These objects are intentionally synchronous: each session owns its own codecs
and the WebSocket layer supplies bounded queues, cancellation and send pacing.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import sys
from array import array
from functools import lru_cache


FRAME_DURATION_MS = 60
MAX_OPUS_PACKET_BYTES = 4096
SUPPORTED_SAMPLE_RATES = frozenset({8000, 12000, 16000, 24000, 48000})
_OPUS_APPLICATION_VOIP = 2048
_BYTE_POINTER = ctypes.POINTER(ctypes.c_ubyte)
_PCM_POINTER = ctypes.POINTER(ctypes.c_int16)


class AudioError(ValueError):
    """An unsupported format, invalid packet or codec lifecycle error."""


@lru_cache(maxsize=1)
def _opus() -> ctypes.CDLL:
    library_name = ctypes.util.find_library("opus")
    if not library_name:
        raise AudioError("libopus is required; install the Linux libopus0 package")
    try:
        lib = ctypes.CDLL(library_name)
    except OSError as exc:
        raise AudioError("Unable to load libopus") from exc
    lib.opus_strerror.argtypes = [ctypes.c_int]
    lib.opus_strerror.restype = ctypes.c_char_p
    lib.opus_decoder_create.argtypes = [
        ctypes.c_int32, ctypes.c_int, ctypes.POINTER(ctypes.c_int)
    ]
    lib.opus_decoder_create.restype = ctypes.c_void_p
    lib.opus_decoder_destroy.argtypes = [ctypes.c_void_p]
    lib.opus_decoder_destroy.restype = None
    lib.opus_decode.argtypes = [
        ctypes.c_void_p, _BYTE_POINTER, ctypes.c_int32,
        _PCM_POINTER, ctypes.c_int, ctypes.c_int,
    ]
    lib.opus_decode.restype = ctypes.c_int
    lib.opus_packet_get_nb_samples.argtypes = [
        _BYTE_POINTER, ctypes.c_int32, ctypes.c_int32
    ]
    lib.opus_packet_get_nb_samples.restype = ctypes.c_int
    lib.opus_packet_get_nb_channels.argtypes = [_BYTE_POINTER]
    lib.opus_packet_get_nb_channels.restype = ctypes.c_int
    lib.opus_encoder_create.argtypes = [
        ctypes.c_int32, ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int)
    ]
    lib.opus_encoder_create.restype = ctypes.c_void_p
    lib.opus_encoder_destroy.argtypes = [ctypes.c_void_p]
    lib.opus_encoder_destroy.restype = None
    lib.opus_encode.argtypes = [
        ctypes.c_void_p, _PCM_POINTER, ctypes.c_int,
        _BYTE_POINTER, ctypes.c_int32,
    ]
    lib.opus_encode.restype = ctypes.c_int32
    return lib


def _frame_samples(sample_rate: int) -> int:
    if type(sample_rate) is not int or sample_rate not in SUPPORTED_SAMPLE_RATES:
        raise AudioError("Unsupported Opus sample rate")
    return sample_rate * FRAME_DURATION_MS // 1000


def _bytes(value: bytes | bytearray | memoryview, name: str) -> bytes:
    if not isinstance(value, (bytes, bytearray, memoryview)):
        raise AudioError(f"{name} must be bytes")
    return bytes(value)


def _check_opus(lib: ctypes.CDLL, code: int, operation: str) -> None:
    if code < 0:
        detail = lib.opus_strerror(code).decode("utf-8", errors="replace")
        raise AudioError(f"{operation} failed: {detail}")


class _Codec:
    _destroy_name: str

    def _initialize(self, sample_rate: int) -> None:
        # Set handle first so cleanup remains safe after a failed constructor.
        self._handle = None
        self.sample_rate = sample_rate
        self.frame_samples = _frame_samples(sample_rate)
        self.frame_bytes = self.frame_samples * 2
        self._lib = _opus()

    def _require_open(self) -> None:
        if not self._handle:
            raise AudioError("Audio codec is closed")

    def close(self) -> None:
        """Destroy native state immediately; repeated calls are harmless."""
        handle = self._handle
        self._handle = None
        if handle:
            getattr(self._lib, self._destroy_name)(handle)

    def __enter__(self):
        self._require_open()
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            # close() or a context manager is the deterministic cleanup path.
            pass


class OpusDecoder(_Codec):
    """Decode exactly one mono 60 ms packet to PCM16LE (16 kHz by default)."""

    _destroy_name = "opus_decoder_destroy"

    def __init__(self, sample_rate: int = 16000):
        self._initialize(sample_rate)
        error = ctypes.c_int()
        self._handle = self._lib.opus_decoder_create(sample_rate, 1, ctypes.byref(error))
        _check_opus(self._lib, error.value, "Create Opus decoder")
        if not self._handle:
            raise AudioError("Create Opus decoder returned no state")

    def decode(self, packet: bytes | bytearray | memoryview) -> bytes:
        self._require_open()
        packet = _bytes(packet, "Opus packet")
        if not 1 <= len(packet) <= MAX_OPUS_PACKET_BYTES:
            raise AudioError("Opus packet must contain 1–4096 bytes")
        compressed = (ctypes.c_ubyte * len(packet)).from_buffer_copy(packet)
        if self._lib.opus_packet_get_nb_channels(compressed) != 1:
            raise AudioError("Opus packet must be mono")
        samples = self._lib.opus_packet_get_nb_samples(
            compressed, len(packet), self.sample_rate
        )
        _check_opus(self._lib, samples, "Read Opus packet duration")
        if samples != self.frame_samples:
            raise AudioError("Opus packet must contain exactly 60 ms of audio")
        pcm = (ctypes.c_int16 * self.frame_samples)()
        decoded = self._lib.opus_decode(
            self._handle, compressed, len(packet), pcm, self.frame_samples, 0
        )
        _check_opus(self._lib, decoded, "Decode Opus packet")
        if decoded != self.frame_samples:
            raise AudioError("Decoded Opus packet is not exactly 60 ms")
        result = bytes(pcm)
        if sys.byteorder != "little":
            native = array("h", result)
            native.byteswap()
            result = native.tobytes()
        return result


class OpusEncoder(_Codec):
    """Encode one mono 60 ms PCM16LE frame (24 kHz by default)."""

    _destroy_name = "opus_encoder_destroy"

    def __init__(self, sample_rate: int = 24000):
        self._initialize(sample_rate)
        error = ctypes.c_int()
        self._handle = self._lib.opus_encoder_create(
            sample_rate, 1, _OPUS_APPLICATION_VOIP, ctypes.byref(error)
        )
        _check_opus(self._lib, error.value, "Create Opus encoder")
        if not self._handle:
            raise AudioError("Create Opus encoder returned no state")

    def encode(self, pcm: bytes | bytearray | memoryview) -> bytes:
        self._require_open()
        pcm = _bytes(pcm, "PCM frame")
        if len(pcm) != self.frame_bytes:
            raise AudioError(f"PCM frame must contain exactly {self.frame_bytes} bytes")
        if sys.byteorder != "little":
            native = array("h", pcm)
            native.byteswap()
            pcm = native.tobytes()
        samples = (ctypes.c_int16 * self.frame_samples).from_buffer_copy(pcm)
        compressed = (ctypes.c_ubyte * MAX_OPUS_PACKET_BYTES)()
        length = self._lib.opus_encode(
            self._handle, samples, self.frame_samples,
            compressed, MAX_OPUS_PACKET_BYTES,
        )
        _check_opus(self._lib, length, "Encode Opus frame")
        if length == 0:
            raise AudioError("Encode Opus frame returned an empty packet")
        return bytes(compressed[:length])


class PcmFramer:
    """Reassemble arbitrary PCM chunks into 60 ms PCM16LE frames.

    A chunk may split a 16-bit sample. flush() pads the last complete samples
    with silence; a stream ending halfway through a sample is invalid.
    clear() discards a cancelled response so it cannot bleed into the next.
    """

    def __init__(self, sample_rate: int = 24000):
        self.sample_rate = sample_rate
        self.frame_samples = _frame_samples(sample_rate)
        self.frame_bytes = self.frame_samples * 2
        self._buffer = bytearray()

    @property
    def buffered_bytes(self) -> int:
        return len(self._buffer)

    def feed(self, pcm: bytes | bytearray | memoryview) -> list[bytes]:
        pcm = _bytes(pcm, "PCM chunk")
        data = bytes(self._buffer) + pcm
        complete_end = len(data) // self.frame_bytes * self.frame_bytes
        frames = [
            data[offset:offset + self.frame_bytes]
            for offset in range(0, complete_end, self.frame_bytes)
        ]
        self._buffer[:] = data[complete_end:]
        return frames

    def flush(self) -> list[bytes]:
        if len(self._buffer) % 2:
            raise AudioError("PCM16 stream ended halfway through a sample")
        if not self._buffer:
            return []
        frame = bytes(self._buffer).ljust(self.frame_bytes, b"\x00")
        self.clear()
        return [frame]

    def clear(self) -> None:
        self._buffer.clear()

    def close(self) -> None:
        self.clear()
