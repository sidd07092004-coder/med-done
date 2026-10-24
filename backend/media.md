# VM Media Storage

The existing upload endpoint remains `POST /admin/media/upload`. The API is running on the VM at `10.2.22.108:1008`, so the preferred configuration is the existing local-filesystem pipeline pointed at the VM's own disk:

```dotenv
MEDIA_STORAGE_BACKEND=local
UPLOAD_DIR=/home/aumble/medically_complicated_data/uploads
```

The VM-hosted backend writes directly to this absolute path. The API response and public URL format remain unchanged; downloads continue through `/uploads/{filename}`. SFTP mode is only needed if the backend process runs on a different machine from the VM.

For this repository's Docker Compose deployment, the root `.env` value is the **host-side** bind-mount source. Compose mounts it at `/app/uploads` and sets the backend's in-container `UPLOAD_DIR` to `/app/uploads`. `docker compose config` should show a bind source of `/home/aumble/medically_complicated_data/uploads` and target `/app/uploads`.

## VM Prerequisites

- SSH/SFTP server is running on the VM and reachable from the backend host at `10.2.22.108:22`.
- Use a dedicated non-root account with write/read/delete permission on `/home/aumble/medically_complicated_data/uploads`. The account may be `aumble` or another account with access to that directory.
- Create the directory and set its owner/permissions on the VM before enabling the feature.
- Configure public-key authentication from the backend host. Do not put an SSH password, private key contents, or bearer token in `.env` or this document.
- Verify the VM SSH host-key fingerprint with the VM administrator through a trusted channel. A result from `ssh-keyscan` alone is not verification.

## Backend Setup

The backend loads `.env` relative to its current working directory. The VM service must receive the two settings above in the repository-root `.env` and be recreated/restarted. The workspace root `.env` now contains the VM upload path; `backend/.env` remains configured for local development so tests and local runs do not try to write into a VM-only path.

### GitLab CI Deployment

The backend pipeline launches the image with `docker run`; it does not load the repository-root `.env`. Set this GitLab CI/CD variable:

```text
MEDIA_UPLOAD_HOST_DIR=/home/aumble/medically_complicated_data/uploads
```

`DATABASE_URL` and `SECRET_KEY` remain required CI/CD variables; `BACKEND_CORS_ORIGINS` is optional. The CI variable `MEDIA_UPLOAD_HOST_DIR` is the absolute path on the Docker daemon host, not a path inside the job container. The pipeline bind-mounts it to `/app/uploads` and sets `UPLOAD_DIR=/app/uploads` inside the backend container.

Ensure the path exists on the VM that runs the Docker daemon and is writable by image UID `10001`. If the GitLab runner connects to a Docker daemon on another host, the directory must exist on that Docker host instead. The pipeline intentionally fails if this variable is missing or not absolute. Before removing the current backend container, CI also mounts the directory into a one-shot container as UID `10001`, creates and removes a temporary probe file, and stops deployment if the write fails.

Before starting the backend on the VM, create the host directory and make it writable by the backend process. The Docker image runs as `appuser` UID `10001`; the bind-mounted host directory must grant that UID write and search permissions. Avoid world-writable permissions. Then, from the repository root on the VM:

```bash
mkdir -p /home/aumble/medically_complicated_data/uploads
docker compose config | grep -A3 -B2 /app/uploads
docker compose up -d --force-recreate backend
docker compose exec backend sh -c 'id; test -w /app/uploads && echo upload-directory-writable'
```

If the writable check fails, adjust ownership/group or ACLs on the VM directory according to your host policy, then recreate the backend container. Do not change the in-container target from `/app/uploads` unless you also change the Dockerfile and mount target.

If the backend is instead deployed on another machine, configure the optional SFTP adapter in the `.env` used by that backend:

```dotenv
MEDIA_STORAGE_BACKEND=sftp
MEDIA_SFTP_HOST=10.2.22.108
MEDIA_SFTP_PORT=22
MEDIA_SFTP_USERNAME=<dedicated-vm-ssh-user>
MEDIA_SFTP_PRIVATE_KEY=/absolute/path/to/private-key
MEDIA_SFTP_KNOWN_HOSTS=/absolute/path/to/verified-known_hosts
MEDIA_SFTP_REMOTE_DIR=/home/aumble/medically_complicated_data/uploads
MEDIA_SFTP_CONNECT_TIMEOUT=10
```

Keep the private key outside the repository and readable only by the backend service account. `MEDIA_SFTP_KNOWN_HOSTS` must point to a file containing the verified host key for the configured VM/port. Do not disable host-key checking.

To create a key pair on the backend host, use the system's approved key-management process. Install only the public key on the VM account. For an unattended service, the key must be usable by that service process; if policy requires an encrypted private key, configure an SSH agent or extend the adapter to support a passphrase rather than storing that passphrase in `.env`.

Verify access from the backend host using the same account, key, and known-hosts file before switching modes. Confirm that the account can create, read, rename, and remove a temporary file in the target directory. Check firewall rules to allow outbound SSH from the backend host to the VM. SSH key authentication from this workstation to `aumble@10.2.22.108` was attempted with strict host-key checking and was rejected; SFTP mode must not be enabled on this workstation until its public key is authorized on the VM.

Install project requirements in the backend virtual environment:

```bash
cd backend
.venv/bin/python -m pip install -r requirements.txt
```

`asyncssh` is declared in both `requirements.txt` and `pyproject.toml`. Restart the backend after changing `.env`; the settings are read at process startup.

## Behavior

- `POST /admin/media/upload` validates the existing extension/MIME allow-lists and per-media-kind size limits, then writes to `UPLOAD_DIR` in local mode or SFTP using a temporary name followed by a rename in SFTP mode.
- Media metadata is stored in PostgreSQL as before. For SFTP uploads, `storage_path` is an internal `sftp://` URI; `public_url` remains `/uploads/<generated-name>`.
- `GET /admin/media/` returns the same metadata contract.
- `GET /uploads/<generated-name>` resolves the metadata row and streams remote objects in SFTP mode. The path is derived from the stored URI and constrained to the configured remote directory.
- `DELETE /admin/media/{media_id}` removes the object from the configured backend and then deletes the metadata row. Storage connection failures return `503`; the database row is retained if file deletion cannot complete.
- Existing local media rows continue to use their local `storage_path` after SFTP mode is enabled. This switch affects new uploads only; it does not migrate files already on the local disk.
- No database schema migration is required because `storage_path` is already a text column.

## End-to-End Upload Test

1. Confirm the API is running on the VM and the container can write to the bind-mounted directory using the commands above. The expected Swagger URL in this deployment is `http://10.2.22.108:1008/docs`.
2. In Swagger, click **Authorize** and sign in with an active admin account. Do not save the password or bearer token in this file.
3. Open `POST /admin/media/upload`, choose **Try it out**, and upload a small real PNG/JPEG using an allowed extension. Avoid a text file renamed to `.png`; the endpoint's extension/MIME checks do not validate file signatures.
4. Click **Execute**. Expect `200` and record the returned `id`, `size_bytes`, and `public_url` for this one test upload.
5. On the VM host, verify the basename from `public_url` exists in the requested directory and has the expected size:

	```bash
	ls -l /home/aumble/medically_complicated_data/uploads/<generated-filename>
	stat /home/aumble/medically_complicated_data/uploads/<generated-filename>
	```

6. In a browser, request `http://10.2.22.108:1008<public_url>` and confirm the image loads. The public URL already begins with `/uploads/`.
7. In Swagger, call `DELETE /admin/media/{media_id}` with the upload's returned `id`. Expect `200 {"message":"Media deleted"}`.
8. On the VM, verify the same host file no longer exists. Do not delete other files from this upload directory.

Useful failure meanings: `401` means Swagger is not authorized; `403` means the token is not an admin for delete; `413` means the configured media-kind size limit was exceeded; `503` or a container filesystem error usually means the host directory is not mounted/writable or the running container was not recreated after the `.env` change.

## Troubleshooting

- `503 Media storage is unavailable`: in direct VM-local mode, check that the service account can create/read/delete files in `UPLOAD_DIR`; in SFTP mode, check host/port reachability, SSH username, private-key permissions, `known_hosts`, and backend logs. Do not log or share private-key contents.
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
11. `docker-compose.yml` - bind the configured VM host directory into the backend container.
12. `.gitlab-ci.backend.yml` - bind the VM host upload path in the GitLab deployment pipeline.
13. `DEPLOY.md` - document the required GitLab CI/CD variable and VM mount validation.
14. `backend/media.md` - this setup and behavior guide.
