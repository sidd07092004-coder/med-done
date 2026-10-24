from io import BytesIO
from pathlib import Path, PurePosixPath

import pytest
from fastapi import UploadFile

from app.core.config import settings
from app.services.media_storage import (
    MediaFileTooLarge,
    MediaStorageError,
    _remote_path,
    _remote_uri,
    save_upload,
)


@pytest.mark.asyncio
async def test_local_upload_preserves_storage_contract(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "MEDIA_STORAGE_BACKEND", "local")
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    upload = UploadFile(filename="sample.png", file=BytesIO(b"abc"))

    storage_path, size_bytes = await save_upload(upload, "stored.png", 3)

    assert storage_path == str(tmp_path / "stored.png")
    assert size_bytes == 3
    assert (tmp_path / "stored.png").read_bytes() == b"abc"


@pytest.mark.asyncio
async def test_local_upload_removes_partial_file_when_too_large(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "MEDIA_STORAGE_BACKEND", "local")
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    upload = UploadFile(filename="sample.png", file=BytesIO(b"abcd"))

    with pytest.raises(MediaFileTooLarge):
        await save_upload(upload, "too-large.png", 3)

    assert not (tmp_path / "too-large.png").exists()


def test_remote_storage_uri_round_trips_inside_configured_root(monkeypatch):
    monkeypatch.setattr(settings, "MEDIA_SFTP_HOST", "10.2.22.108")
    monkeypatch.setattr(settings, "MEDIA_SFTP_PORT", 22)
    monkeypatch.setattr(
        settings,
        "MEDIA_SFTP_REMOTE_DIR",
        "/home/aumble/medically_complicated_data/uploads",
    )
    remote_path = PurePosixPath(settings.MEDIA_SFTP_REMOTE_DIR) / "stored image.png"

    assert _remote_path(_remote_uri(remote_path)) == remote_path


@pytest.mark.parametrize(
    "storage_path",
    [
        "sftp://other-vm:22/home/aumble/medically_complicated_data/uploads/image.png",
        "sftp://10.2.22.108:22/home/aumble/medically_complicated_data/uploads/../secret",
        "sftp://10.2.22.108:22/home/other/uploads/image.png",
    ],
)
def test_remote_storage_rejects_untrusted_host_or_path(storage_path, monkeypatch):
    monkeypatch.setattr(settings, "MEDIA_SFTP_HOST", "10.2.22.108")
    monkeypatch.setattr(settings, "MEDIA_SFTP_PORT", 22)
    monkeypatch.setattr(
        settings,
        "MEDIA_SFTP_REMOTE_DIR",
        "/home/aumble/medically_complicated_data/uploads",
    )

    with pytest.raises(MediaStorageError):
        _remote_path(storage_path)