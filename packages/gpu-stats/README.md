# @teamsuzie/gpu-stats

Zero-dependency reader for NVIDIA GPU load, memory, temperature and power. It shells out to `nvidia-smi` with a fixed
CSV query for the GPUs themselves (`parseGpus`) and for the processes currently using them (`parseProcesses`), and
turns the two CSV outputs into a single `GpuSnapshot` (`readGpus`). Optional fields that `nvidia-smi` reports as
`[N/A]`, `[Not Supported]` or `[Unknown Error]` (for example temperature or power on an unsupported card) come back
as `null`; a malformed line — wrong field count or a missing required number — throws rather than being silently
dropped, so a broken `nvidia-smi` output is never mistaken for "no GPUs".

`createGpuPoller({ intervalMs, keepMs, read?, log? })` polls on an interval, keeps every snapshot newer than
`keepMs` (callers use 5000 ms / 3,600,000 ms to keep an hour of samples), and exposes `state()` with `latest`,
`history` and `error`. A failed read never throws out of the poller and never falls back to stale or synthetic data:
it clears `latest`, records `error` with the real failure message and the time it was first seen, and calls `log`
only when the error message changes (not on every repeated failure) or when reads start succeeding again. Pass a
fake `read` (as the tests do) or a fake `exec` to `readGpus` to test without an actual NVIDIA GPU.
