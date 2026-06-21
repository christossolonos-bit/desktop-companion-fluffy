import json
import os
import queue
import socket
import subprocess
import sys
import tempfile
import threading
import tkinter as tk
from tkinter import ttk

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

try:
    import pygame
except ImportError:
    print("Install pygame: pip install pygame", file=sys.stderr)
    raise

SPEAKER_REF = os.path.abspath(
    os.environ.get(
        "XTTS_SPEAKER_WAV",
        os.path.join(os.path.dirname(__file__), "..", "Serafina - Sensual Temptress_pvc_sp92_s31_sb81_v3.mp3"),
    )
)
XTTS_MODEL = os.environ.get("XTTS_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2")
PLAYER_PORT = int(os.environ.get("XTTS_PLAYER_PORT", "17351"))
AUDIO_DIR = os.path.join(tempfile.gettempdir(), "live2d-tts")


def load_tts():
    import torch
    from TTS.api import TTS

    want_gpu = os.environ.get("XTTS_GPU", "1") == "1"
    use_gpu = want_gpu and torch.cuda.is_available()

    if want_gpu and not use_gpu:
        raise RuntimeError(
            "CUDA was requested but is not available. "
            "Run: npm run setup:xtts (installs CUDA PyTorch) and ensure NVIDIA drivers are installed."
        )

    if not use_gpu:
        torch.set_num_threads(1)

    return TTS(XTTS_MODEL, gpu=use_gpu)


def wav_to_mp3(wav_path: str, mp3_path: str) -> bool:
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                wav_path,
                "-codec:a",
                "libmp3lame",
                "-qscale:a",
                "4",
                mp3_path,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


def synthesize_mp3(tts, text: str) -> tuple[str, float]:
    os.makedirs(AUDIO_DIR, exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
        wav_path = handle.name

    mp3_path = os.path.join(
        AUDIO_DIR,
        f"fluffy-{os.getpid()}-{threading.get_ident()}-{abs(hash(text)) % 10_000_000}.mp3",
    )

    try:
        tts.tts_to_file(
            text=text,
            file_path=wav_path,
            speaker_wav=SPEAKER_REF,
            language="en",
        )

        if wav_to_mp3(wav_path, mp3_path):
            try:
                os.unlink(wav_path)
            except OSError:
                pass
            audio_path = mp3_path
        else:
            audio_path = wav_path

        duration_sec = 0.0
        try:
            import mutagen
            from mutagen.mp3 import MP3
            from mutagen.wave import WAVE

            if audio_path.endswith(".mp3"):
                duration_sec = MP3(audio_path).info.length
            else:
                duration_sec = WAVE(audio_path).info.length
        except Exception:
            duration_sec = max(1.0, len(text.split()) * 0.35)

        return audio_path, duration_sec
    except Exception:
        for path in (wav_path, mp3_path):
            try:
                if os.path.isfile(path):
                    os.unlink(path)
            except OSError:
                pass
        raise


class XttsPlayerApp:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("Fluffy Voice (XTTS)")
        self.root.geometry("320x96")
        self.root.resizable(False, False)

        self.status = tk.StringVar(value="Loading XTTS model…")
        ttk.Label(self.root, text="Fluffy voice playback", font=("Segoe UI", 10, "bold")).pack(
            pady=(10, 2)
        )
        ttk.Label(self.root, textvariable=self.status, wraplength=300).pack(padx=12, pady=(0, 10))

        self.tts = None
        self.ready = False
        self.device_label = "starting"
        self.jobs: queue.Queue = queue.Queue()
        self.stop_playback = threading.Event()
        self.server = None
        self.running = True

        pygame.mixer.init()

        threading.Thread(target=self._load_model, daemon=True).start()
        threading.Thread(target=self._run_server, daemon=True).start()
        self.root.after(100, self._process_jobs)
        self.root.protocol("WM_DELETE_WINDOW", self._hide_window)

    def _hide_window(self) -> None:
        self.root.withdraw()

    def _load_model(self) -> None:
        try:
            if not os.path.isfile(SPEAKER_REF):
                raise FileNotFoundError(f"Speaker reference not found: {SPEAKER_REF}")
            self.tts = load_tts()
            import torch

            if torch.cuda.is_available():
                self.device_label = torch.cuda.get_device_name(0)
            else:
                self.device_label = "cpu"
            self.ready = True
            self._set_status(f"Ready — {self.device_label}")
        except Exception as error:
            self._set_status(f"Error: {error}")

    def _set_status(self, message: str) -> None:
        self.root.after(0, self.status.set, message)

    def _run_server(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", PLAYER_PORT))
        sock.listen(8)
        self.server = sock

        while self.running:
            try:
                conn, _addr = sock.accept()
            except OSError:
                break
            threading.Thread(target=self._handle_client, args=(conn,), daemon=True).start()

    def _handle_client(self, conn: socket.socket) -> None:
        try:
            chunks = []
            while True:
                part = conn.recv(65536)
                if not part:
                    break
                chunks.append(part)
                if b"}" in part:
                    break
            raw = b"".join(chunks).decode("utf-8", errors="replace").strip()
            request = json.loads(raw) if raw else {}
            response = self._dispatch(request)
            conn.sendall(json.dumps(response).encode("utf-8"))
        except Exception as error:
            try:
                conn.sendall(json.dumps({"ok": False, "error": str(error)}).encode("utf-8"))
            except OSError:
                pass
        finally:
            conn.close()

    def _dispatch(self, request: dict) -> dict:
        cmd = request.get("cmd")

        if cmd == "ping":
            return {"ok": True, "ready": self.ready, "speaker": os.path.basename(SPEAKER_REF), "device": self.device_label}

        if cmd == "stop":
            self.stop_playback.set()
            pygame.mixer.music.stop()
            return {"ok": True}

        if cmd == "shutdown":
            self.running = False
            self.root.after(0, self.root.destroy)
            if self.server:
                try:
                    self.server.close()
                except OSError:
                    pass
            return {"ok": True}

        if cmd == "speak":
            text = (request.get("text") or "").strip()
            if not text:
                return {"ok": False, "error": "Empty text."}
            if not self.ready or not self.tts:
                return {"ok": False, "error": "XTTS player is not ready yet."}

            done = threading.Event()
            result: dict = {}
            self.jobs.put((text, result, done))
            done.wait(timeout=600)
            return result

        return {"ok": False, "error": f"Unknown command: {cmd}"}

    def _process_jobs(self) -> None:
        try:
            while True:
                text, result, done = self.jobs.get_nowait()
                self._run_speak_job(text, result, done)
        except queue.Empty:
            pass
        if self.running:
            self.root.after(100, self._process_jobs)

    def _run_speak_job(self, text: str, result: dict, done: threading.Event) -> None:
        audio_path = None
        try:
            self.stop_playback.clear()
            self._set_status("Synthesizing…")
            audio_path, duration_sec = synthesize_mp3(self.tts, text)

            self._set_status("Speaking…")
            pygame.mixer.music.load(audio_path)
            pygame.mixer.music.play()

            while pygame.mixer.music.get_busy() and not self.stop_playback.is_set():
                self.root.update()
                pygame.time.wait(50)

            if self.stop_playback.is_set():
                pygame.mixer.music.stop()
                result.clear()
                result.update({"ok": False, "error": "Playback stopped."})
            else:
                result.clear()
                result.update({"ok": True, "durationMs": int(duration_sec * 1000)})
                self._set_status("Ready — playing voice in this window")
        except Exception as error:
            result.clear()
            result.update({"ok": False, "error": str(error)})
            self._set_status(f"Error: {error}")
        finally:
            if audio_path and os.path.isfile(audio_path):
                try:
                    os.unlink(audio_path)
                except OSError:
                    pass
            done.set()


def main() -> int:
    app = XttsPlayerApp()
    app.root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
