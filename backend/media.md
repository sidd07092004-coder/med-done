# VM Media Storage

The existing upload endpoint remains `POST /admin/media/upload`. The GitLab deployment uses password-authenticated SFTP to write new files to `10.2.22.108:/home/aumble/medically_complicated_data/uploads`. The database stores a validated `sftp://` storage URI and the API serves downloads through `/uploads/{filename}`.

```dotenv
MEDIA_STORAGE_BACKEND=sftp
MEDIA_SFTP_HOST=10.2.22.108
MEDIA_SFTP_PORT=22
MEDIA_SFTP_USERNAME=<vm-user>
MEDIA_SFTP_PASSWORD=<set-outside-the-repository>
MEDIA_SFTP_KNOWN_HOSTS_DATA=<verified-known-hosts-entry>
MEDIA_SFTP_REMOTE_DIR=/home/aumble/medically_complicated_data/uploads
```

Do not commit the password. In GitLab, store it as a masked/protected CI/CD variable. The `known_hosts` entry contains the server's public host key, not a client login key; verify its fingerprint with the VM administrator before using it. The adapter explicitly disables public-key authentication.

The Docker bind mount remains read-only at `/app/uploads` to serve legacy media rows created by the earlier local-storage setup. New uploads use SFTP and do not require the container process to write to that mount.

## VM Prerequisites

- SSH/SFTP server is running on the VM and reachable from the backend host at `10.2.22.108:22`.
- Use a dedicated non-root account with write/read/delete permission on `/home/aumble/medically_complicated_data/uploads`. The account may be `aumble` or another account with access to that directory.
- Create the directory and set its owner/permissions on the VM before enabling the feature.
- Enable SSH password authentication for the dedicated SFTP account and grant it read/write/delete access to the remote upload directory.
- Verify the VM SSH host-key fingerprint with the VM administrator through a trusted channel. Do not disable host-key verification.

## Backend Setup

The backend loads `.env` relative to its current working directory. For the GitLab pipeline, configure the CI/CD variables below; it does not load the repository-root `.env`. Local development remains in local-storage mode unless SFTP settings are explicitly supplied in `backend/.env`.

### GitLab CI Deployment

The backend pipeline launches the image with `docker run`; it does not load the repository-root `.env`. Configure these GitLab CI/CD variables:

| Variable | Required | Value/handling |
|---|---|---|
| `MEDIA_SFTP_PASSWORD` | Yes | VM account password; masked and protected. Never commit it. |
| `MEDIA_SFTP_KNOWN_HOSTS_DATA` | Yes | Verified OpenSSH known_hosts line for `10.2.22.108`; public key data, protected. |
| `DATABASE_URL` | Yes | PostgreSQL connection string; masked/protected. |
| `SECRET_KEY` | Yes | JWT signing secret; masked/protected. |

The pipeline defaults the SFTP username to `aumble`; override `MEDIA_SFTP_USERNAME` in GitLab if the VM account differs. Host, port, and remote directory are fixed in `.gitlab-ci.backend.yml`. It preflights SFTP by creating and removing a uniquely named file before removing the active container. If authentication, host verification, or remote write permission fails, the deployment stops and leaves the current backend running. `MEDIA_UPLOAD_HOST_DIR` is only mounted read-only for legacy local-media rows. Protect branch `reference-v2` so GitLab exposes its protected secrets to the job.

For local development against the VM, configure the optional SFTP adapter in the `.env` loaded by that backend:

```dotenv
MEDIA_STORAGE_BACKEND=sftp
MEDIA_SFTP_HOST=10.2.22.108
MEDIA_SFTP_PORT=22
MEDIA_SFTP_USERNAME=aumble
MEDIA_SFTP_PASSWORD=<do-not-commit>
MEDIA_SFTP_KNOWN_HOSTS_DATA=<verified-known-hosts-entry>
MEDIA_SFTP_REMOTE_DIR=/home/aumble/medically_complicated_data/uploads
MEDIA_SFTP_CONNECT_TIMEOUT=10
```

Never put the password in a committed file. For local testing, use an ignored local `.env`. Confirm the `known_hosts` line with the VM administrator; `ssh-keyscan` output must not be trusted without fingerprint verification. The account must be allowed to write, read, rename, and remove files in the target directory.

Install project requirements in the backend virtual environment:

```bash
cd backend
.venv/bin/python -m pip install -r requirements.txt
```

`asyncssh` is declared in both `requirements.txt` and `pyproject.toml`. Restart the backend after changing `.env`; the settings are read at process startup.

## Behavior

- `POST /admin/media/upload` validates the existing extension/MIME allow-lists and per-media-kind size limits, then writes to local `UPLOAD_DIR` in local mode or SFTP using a temporary name followed by a rename in SFTP mode.
- Media metadata is stored in PostgreSQL as before. For SFTP uploads, `storage_path` is an internal `sftp://` URI; `public_url` remains `/uploads/<generated-name>`.
- `GET /admin/media/` returns the same metadata contract.
- `GET /uploads/<generated-name>` resolves the metadata row and streams remote objects in SFTP mode. The path is derived from the stored URI and constrained to the configured remote directory.
- `DELETE /admin/media/{media_id}` removes the object from the configured backend and then deletes the metadata row. Storage connection failures return `503`; the database row is retained if file deletion cannot complete.
- Existing local media rows continue to use their local `storage_path` after SFTP mode is enabled. This switch affects new uploads only; it does not migrate files already on the local disk.
- No database schema migration is required because `storage_path` is already a text column.

## End-to-End Upload Test

1. Confirm the latest backend pipeline passed its password-authenticated SFTP preflight. The expected Swagger URL in this deployment is `http://10.2.22.108:1008/docs`.
2. In Swagger, click **Authorize** and sign in with an active admin account. Do not save the password or bearer token in this file.
3. Open `POST /admin/media/upload`, choose **Try it out**, and upload a small real PNG/JPEG using an allowed extension. Avoid a text file renamed to `.png`; the endpoint's extension/MIME checks do not validate file signatures.
4. Click **Execute**. Expect `200` and record the returned `id`, `size_bytes`, and `public_url` for this one test upload.
5. On the VM host, verify the basename from `public_url` exists in the SFTP destination directory and has the expected size:

	```bash
	ls -l /home/aumble/medically_complicated_data/uploads/<generated-filename>
	stat /home/aumble/medically_complicated_data/uploads/<generated-filename>
	```

6. In a browser, request `http://10.2.22.108:1008<public_url>` and confirm the image loads. The public URL already begins with `/uploads/`.
7. In Swagger, call `DELETE /admin/media/{media_id}` with the upload's returned `id`. Expect `200 {"message":"Media deleted"}`.
8. On the VM, verify the same host file no longer exists. Do not delete other files from this upload directory.

Useful failure meanings: `401` means Swagger is not authorized; `403` means the token is not an admin for delete; `413` means the configured media-kind size limit was exceeded; `503` means SFTP login, host-key verification, network access, or remote directory permissions need checking.

## Troubleshooting

- `503 Media storage is unavailable`: check host/port reachability, SFTP username/password, verified known-hosts data, remote directory permissions, and backend logs. Never log or share the password.
- `404 File not found` for an existing media row: confirm the remote file exists under the configured directory and the service account can traverse/read the path.
- Upload succeeds but public content cannot load: confirm the reverse proxy sends `/uploads/*` to this backend and that the process loads the `.env` containing the intended `UPLOAD_DIR`.
- New media is on SFTP but older media is not: expected; existing local media is not migrated automatically. Plan and validate a separate migration before removing local files.

## Changed Files

This VM-storage feature changes 14 files total, excluding the pre-existing root `test.md` from the earlier API-test task. Four are backend Python source files; six are environment/deployment/dependency configuration; one is a test file; and three are deployment/documentation files:

1. `backend/app/core/config.py` - storage backend and SFTP settings.
2. `backend/app/services/media_storage.py` - new local/SFTP storage adapter.
3. `backend/app/api/v1/routes/media.py` - upload and delete use the adapter.
4. `backend/app/main.py` - local/remote media delivery dispatch.
5. `.env` - VM-local upload directory used by the VM-hosted service.
6. `backend/.env` - local-development/SFTP settings; local backend mode remains enabled.
7. `backend/.env.example` - VM host/path and SSH settings template.
8. `backend/requirements.txt` - AsyncSSH runtime dependency.
9. `backend/pyproject.toml` - AsyncSSH runtime dependency.
10. `backend/tests/test_media_storage.py` - local-storage and SFTP-path tests.
11. `docker-compose.yml` - retain the optional direct VM-path mount for Compose deployments.
12. `.gitlab-ci.backend.yml` - use password-authenticated SFTP in the GitLab deployment pipeline.
13. `DEPLOY.md` - document required GitLab SFTP variables and preflight.
14. `backend/media.md` - this setup and behavior guide.
