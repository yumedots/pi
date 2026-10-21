#!/usr/bin/env python3
"""Measure the time from a process start to the first painted session row.

The session picker is a TUI, so the measurement runs the command in a pty and
watches the output: the first byte is the first paint of the screen, and the
marker (a session title) is the first row of the session list.

This harness answers the terminal capability queries (DA1, OSC 10/11, OSC 4,
kitty keyboard protocol), so a runtime that waits for the terminal's reply is
not measured against a terminal that never answers.

Usage:
  python3 bench/harness/measure-picker-terminal.py --label port -- <command> [args...]
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

DA1 = b"\x1b[c"
KITTY_KEYBOARD = b"\x1b[?u"
XT_VERSION = b"\x1b[>7u"
OSC_10 = b"\x1b]10;?"
OSC_11 = b"\x1b]11;?"
OSC_4 = b"\x1b]4;"


def replies_for(data: bytes) -> bytes:
    """The answers a terminal emulator sends for the queries in `data`."""
    out = b""
    if DA1 in data:
        out += b"\x1b[?1;2c"
    if KITTY_KEYBOARD in data:
        out += b"\x1b[?0u"
    if XT_VERSION in data:
        out += b"\x1b[>0;1;0u"
    if OSC_10 in data:
        out += b"\x1b]10;rgb:ffff/ffff/ffff\x1b\\"
    if OSC_11 in data:
        out += b"\x1b]11;rgb:0000/0000/0000\x1b\\"
    if OSC_4 in data:
        out += b"\x1b]4;1;rgb:ffff/ffff/ffff\x1b\\"
    return out


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
    pending = b""
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
        pending += data
        answer = replies_for(pending)
        if answer:
            pending = pending[-64:]
            try:
                os.write(fd, answer)
            except OSError:
                pass
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
