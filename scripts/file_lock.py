"""
文件锁工具 — 防止多进程并发读写 JSON 文件导致数据丢失。

用法:
    from file_lock import atomic_json_update, atomic_json_read

    # 原子读取
    data = atomic_json_read(path, default=[])

    # 原子更新（读 → 修改 → 写回，全程持锁）
    def modifier(tasks):
        tasks.append(new_task)
        return tasks 
    atomic_json_update(path, modifier, default=[])
"""
try:
    import fcntl
    LOCK_SH = fcntl.LOCK_SH
    LOCK_EX = fcntl.LOCK_EX
    LOCK_UN = fcntl.LOCK_UN
    def flock(fd, flags):
        fcntl.flock(fd, flags)
except ImportError:
    LOCK_SH = 1
    LOCK_EX = 2
    LOCK_UN = 8
    def flock(fd, flags):
        import msvcrt
        if flags == LOCK_UN:
            # msvcrt locking requires seeking to 0 and locking a specific number of bytes
            try:
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            except OSError:
                pass
        else:
            try:
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_LOCK, 1)
            except OSError:
                pass
import json
import os
import pathlib
import tempfile
from typing import Any, Callable


def _lock_path(path: pathlib.Path) -> pathlib.Path:
    return path.parent / (path.name + '.lock')


def atomic_json_read(path: pathlib.Path, default: Any = None) -> Any:
    """持锁读取 JSON 文件。"""
    lock_file = _lock_path(path)
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(lock_file), os.O_CREAT | os.O_RDWR)
    try:
        flock(fd, LOCK_SH)
        try:
            return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default
        except Exception:
            return default
    finally:
        flock(fd, LOCK_UN)
        os.close(fd)


def atomic_json_update(
    path: pathlib.Path,
    modifier: Callable[[Any], Any],
    default: Any = None,
) -> Any:
    """
    原子地读取 → 修改 → 写回 JSON 文件。
    modifier(data) 应返回修改后的数据。
    """
    lock_file = _lock_path(path)
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(lock_file), os.O_CREAT | os.O_RDWR)
    try:
        flock(fd, LOCK_EX)
        # Read
        try:
            data = json.loads(path.read_text(encoding='utf-8')) if path.exists() else default
        except Exception:
            data = default
        # Modify
        result = modifier(data)
        # Atomic write via temp file + rename
        tmp_fd, tmp_path = tempfile.mkstemp(
            dir=str(path.parent), suffix='.tmp', prefix=path.stem + '_'
        )
        try:
            with os.fdopen(tmp_fd, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, str(path))
        except Exception:
            os.unlink(tmp_path)
            raise
        return result
    finally:
        flock(fd, LOCK_UN)
        os.close(fd)


def atomic_json_write(path: pathlib.Path, data: Any) -> None:
    """原子写入 JSON 文件（持排他锁 + tmpfile rename）。"""
    lock_file = _lock_path(path)
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(lock_file), os.O_CREAT | os.O_RDWR)
    try:
        flock(fd, LOCK_EX)
        tmp_fd, tmp_path = tempfile.mkstemp(
            dir=str(path.parent), suffix='.tmp', prefix=path.stem + '_'
        )
        try:
            with os.fdopen(tmp_fd, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, str(path))
        except Exception:
            os.unlink(tmp_path)
            raise
    finally:
        flock(fd, LOCK_UN)
        os.close(fd)
