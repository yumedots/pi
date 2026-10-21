#!/usr/bin/env python3
"""Measure the time from a process start to the first painted session row.

The session picker is a TUI, so the measurement runs the command in a pty and
watches the output: the first byte is the first paint of the screen, and the
marker (a session title) is the first row of the session list.

Usage:
  python3 bench/harness/measure-picker.py --label port -- <command> [args...]
"""
import argparse
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="run")
    parser.add_argument("--marker", default="")
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--rows", type=int, default=30)
    parser.add_argument("--cols", type=int, default=100)
    parser.add_argument("--dump", default="")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("no command")

    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(command[0], command)

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, args.cols, 0, 0))

    start = time.perf_counter()
    first_output = None
    marker_at = None
    chunks: list[bytes] = []
    deadline = start + args.timeout
    while time.perf_counter() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.05)
        if not ready:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        now = time.perf_counter()
        if first_output is None:
            first_output = now
        chunks.append(data)
        if args.marker and marker_at is None and args.marker.encode() in b"".join(chunks):
            marker_at = now

    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass
    os.close(fd)

    output = b"".join(chunks)
    if args.dump:
        with open(args.dump, "wb") as handle:
            handle.write(output)

    result = {
        "label": args.label,
        "command": " ".join(command),
        "first_output_ms": None if first_output is None else round((first_output - start) * 1000),
        "marker": args.marker,
        "marker_ms": None if marker_at is None else round((marker_at - start) * 1000),
        "bytes": len(output),
    }
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
