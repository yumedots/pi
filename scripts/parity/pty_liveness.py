#!/usr/bin/env python3
"""Drive the port through a pty: type as soon as the process is up and see
whether the input receives the keystrokes.

Usage: pty_liveness.py [delay_ms] [binary] [keys]
"""
import os
import pty
import re
import select
import subprocess
import sys
import time

DELAY = int(sys.argv[1]) if len(sys.argv) > 1 else 0
BIN = sys.argv[2] if len(sys.argv) > 2 else "/Users/gabriel/pi-native/rpi/target/debug/rpi"
KEYS = (sys.argv[3] if len(sys.argv) > 3 else "hello world").encode()
SCRATCH = "/tmp/rpi-pty"

os.makedirs(f"{SCRATCH}/home", exist_ok=True)
os.makedirs(f"{SCRATCH}/agent", exist_ok=True)
os.makedirs(f"{SCRATCH}/work", exist_ok=True)
with open(f"{SCRATCH}/agent/models.json", "w") as handle:
    handle.write(
        '{"providers":{"mock":{"baseUrl":"http://127.0.0.1:9/v1","api":"openai-completions",'
        '"apiKey":"parity-key","models":[{"id":"mock-1","name":"Mock Model","contextWindow":128000,'
        '"maxTokens":4096}]}}}'
    )
with open(f"{SCRATCH}/agent/settings.json", "w") as handle:
    handle.write('{"threeDEmptySession": false}')

env = dict(os.environ)
env["HOME"] = f"{SCRATCH}/home"
env["PI_CODING_AGENT_DIR"] = f"{SCRATCH}/agent"
env["TERM"] = "xterm-256color"

master, slave = pty.openpty()
import fcntl
import struct
import termios

fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
process = subprocess.Popen(
    [
        BIN,
        "--offline",
        "--no-session",
        "--provider",
        "mock",
        "--model",
        "mock/mock-1",
        "--api-key",
        "parity-key",
    ],
    stdin=slave,
    stdout=slave,
    stderr=slave,
    env=env,
    cwd=f"{SCRATCH}/work",
    close_fds=True,
)
os.close(slave)

output = bytearray()


def drain(seconds):
    end = time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([master], [], [], 0.05)
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            output.extend(chunk)


drain(DELAY / 1000.0)
os.write(master, KEYS)
drain(2.0)
os.write(master, b"\r")
drain(3.0)

text = output.decode("utf-8", "replace")
alt = text.find("\x1b[?1049h")
after = text[alt:] if alt >= 0 else text
plain = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", after)
print(f"--- delay {DELAY}ms, keys {KEYS!r} ---")
print("echo before the alt screen:", KEYS.decode() in text[:alt] if alt >= 0 else "n/a")
print("typed text reached the app:", KEYS.decode() in plain)
print("--- tail ---")
print(plain[-800:])
process.terminate()
try:
    process.wait(timeout=5)
except subprocess.TimeoutExpired:
    process.kill()
