from __future__ import annotations

import uuid
from pathlib import Path, PurePosixPath
from typing import AsyncIterator, Tuple
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import asyncssh
from fastapi import UploadFile

from app.core.config import settings


REMOTE_SCHEME = "sftp"


class MediaStorageError(Exception):
    pass


class MediaFileTooLarge(Exception):
    pass


class RemoteMediaNotFound(Exception):
    pass


def is_remote_storage_path(storage_path: str) -> bool:
    return urlsplit(storage_path).scheme == REMOTE_SCHEME


def _remote_root() -> PurePosixPath:
    remote_root = PurePosixPath(settings.MEDIA_SFTP_REMOTE_DIR)
    if not remote_root.is_absolute() or ".." in remote_root.parts:
        raise MediaStorageError("Remote media directory must be an absolute safe path")
    return remote_root


def _connection_options() -> dict:
    host = settings.MEDIA_SFTP_HOST
    username = settings.MEDIA_SFTP_USERNAME
    private_key = settings.MEDIA_SFTP_PRIVATE_KEY
    known_hosts = settings.MEDIA_SFTP_KNOWN_HOSTS
    if not host or not username or not private_key or not known_hosts:
        raise MediaStorageError("SFTP host, username, private key, and known_hosts are required")

    key_path = Path(private_key).expanduser()
    known_hosts_path = Path(known_hosts).expanduser()
    if not key_path.is_file():
        raise MediaStorageError("Configured SFTP private key was not found")
    if not known_hosts_path.is_file():
        raise MediaStorageError("Configured SSH known_hosts file was not found")

    return {
        "host": host,
        "port": settings.MEDIA_SFTP_PORT,
        "username": username,
        "client_keys": [str(key_path)],
        "known_hosts": str(known_hosts_path),
        "connect_timeout": settings.MEDIA_SFTP_CONNECT_TIMEOUT,
    }


def _remote_uri(remote_path: PurePosixPath) -> str:
    host_port = f"{settings.MEDIA_SFTP_HOST}:{settings.MEDIA_SFTP_PORT}"
    encoded_path = quote(str(remote_path), safe="/")
    return urlunsplit((REMOTE_SCHEME, host_port, encoded_path, "", ""))


def _remote_path(storage_path: str) -> PurePosixPath:
    parsed = urlsplit(storage_path)
    if parsed.scheme != REMOTE_SCHEME:
        raise MediaStorageError("Not an SFTP media path")

    expected_host_port = f"{settings.MEDIA_SFTP_HOST}:{settings.MEDIA_SFTP_PORT}"
    remote_path = PurePosixPath(unquote(parsed.path))
    root = _remote_root()
    if (
        parsed.netloc != expected_host_port
        or not remote_path.is_absolute()
        or ".." in remote_path.parts
        or not remote_path.is_relative_to(root)
    ):
        raise MediaStorageError("SFTP media path is outside the configured storage location")
    return remote_path


def _safe_filename(filename: str) -> str:
    if not filename or PurePosixPath(filename).name != filename or filename in {".", ".."}:
        raise MediaStorageError("Invalid media storage filename")
    return filename


async def save_upload(
    upload: UploadFile,
    filename: str,
    size_limit: int,
) -> Tuple[str, int]:
    filename = _safe_filename(filename)
    if settings.MEDIA_STORAGE_BACKEND == "local":
        return await _save_local(upload, filename, size_limit)
    if settings.MEDIA_STORAGE_BACKEND == "sftp":
        return await _save_remote(upload, filename, size_limit)
    raise MediaStorageError("Unsupported media storage backend")


async def _save_local(upload: UploadFile, filename: str, size_limit: int) -> Tuple[str, int]:
    destination = Path(settings.UPLOAD_DIR) / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    size_bytes = 0
    try:
        with destination.open("wb") as output:
            while chunk := await upload.read(1024 * 1024):
                size_bytes += len(chunk)
                if size_bytes > size_limit:
                    raise MediaFileTooLarge
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return str(destination), size_bytes


async def _save_remote(upload: UploadFile, filename: str, size_limit: int) -> Tuple[str, int]:
    root = _remote_root()
    destination = root / filename
    temporary = root / f".{filename}.{uuid.uuid4().hex}.uploading"
    options = _connection_options()
    size_bytes = 0
    completed = False

    try:
        async with asyncssh.connect(**options) as connection:
            async with connection.start_sftp_client() as sftp:
                await sftp.makedirs(str(root), exist_ok=True)
                async with sftp.open(str(temporary), "wb") as output:
                    while chunk := await upload.read(1024 * 1024):
                        size_bytes += len(chunk)
                        if size_bytes > size_limit:
                            raise MediaFileTooLarge
                        await output.write(chunk)
                await sftp.rename(str(temporary), str(destination))
                completed = True
    except MediaFileTooLarge:
        raise
    except Exception as exc:
        raise MediaStorageError("Could not store media on the configured VM") from exc
    finally:
        if not completed:
            try:
                async with asyncssh.connect(**options) as connection:
                    async with connection.start_sftp_client() as sftp:
                        await sftp.remove(str(temporary))
            except Exception:
                pass

    return _remote_uri(destination), size_bytes


async def delete_storage_path(storage_path: str) -> None:
    if not is_remote_storage_path(storage_path):
        Path(storage_path).unlink(missing_ok=True)
        return

    remote_path = _remote_path(storage_path)
    try:
        async with asyncssh.connect(**_connection_options()) as connection:
            async with connection.start_sftp_client() as sftp:
                await sftp.remove(str(remote_path))
    except asyncssh.SFTPNoSuchFile:
        return
    except Exception as exc:
        raise MediaStorageError("Could not delete media from the configured VM") from exc


async def remote_file_exists(storage_path: str) -> bool:
    remote_path = _remote_path(storage_path)
    try:
        async with asyncssh.connect(**_connection_options()) as connection:
            async with connection.start_sftp_client() as sftp:
                await sftp.stat(str(remote_path))
        return True
    except asyncssh.SFTPNoSuchFile:
        return False
    except Exception as exc:
        raise MediaStorageError("Could not access media on the configured VM") from exc


async def stream_remote_file(storage_path: str) -> AsyncIterator[bytes]:
    remote_path = _remote_path(storage_path)
    try:
        async with asyncssh.connect(**_connection_options()) as connection:
            async with connection.start_sftp_client() as sftp:
                async with sftp.open(str(remote_path), "rb") as remote_file:
                    while chunk := await remote_file.read(64 * 1024):
                        yield chunk
    except asyncssh.SFTPNoSuchFile as exc:
        raise RemoteMediaNotFound from exc
    except Exception as exc:
        raise MediaStorageError("Could not read media from the configured VM") from exc
