# -*- coding: utf-8 -*-
"""CLI bridge called by the Node backends:   python run.py <command>   (JSON on stdin -> JSON on stdout)"""
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from models import COMMANDS  # noqa: E402


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.stdout.write(json.dumps({"error": "unknown command", "commands": sorted(COMMANDS)}))
        return 2
    try:
        data = json.loads(sys.stdin.read() or "{}")
        result = COMMANDS[sys.argv[1]](data)
        sys.stdout.write(json.dumps(result))
        return 0
    except Exception as exc:  # pragma: no cover
        sys.stdout.write(json.dumps({"error": str(exc), "trace": traceback.format_exc()}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
