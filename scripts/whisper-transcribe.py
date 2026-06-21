import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--model", default="base.en")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({
            "ok": False,
            "error": "faster-whisper is not installed. Run: pip install faster-whisper",
        }))
        return 1

    try:
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        segments, _info = model.transcribe(
            args.audio_path,
            beam_size=1,
            language="en",
            vad_filter=False,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        print(json.dumps({"ok": True, "text": text}))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
