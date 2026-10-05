# KumaFleet

Zero-touch Docker auto-discovery companion for [Uptime Kuma](https://github.com/louislam/uptime-kuma).

AutoKuma is great, but adding `kuma.*` labels to every single service across 40 different compose files gets old fast. KumaFleet takes the opposite approach: **mount the Docker socket and monitor everything by default.**

---

## What it does

- **Zero-touch discovery:** Watches `/var/run/docker.sock` and automatically creates native Docker container monitors in Uptime Kuma.
- **Smart grouping:** Automatically groups containers by their Docker Compose project (`com.docker.compose.project`) on your status page.
- **Opt-out filtering:** Exclude temp or internal containers with regex environment variables or a single label.
- **Lightweight:** Single small container, minimal memory footprint (~30MB), uses native Socket.io events.

---

## Quick Start

> **Note on Uptime Kuma v2:** Monitors in Uptime Kuma v2 are strictly tied to the account that creates them (`user_id`). If you use a separate service account, monitors will be managed and displayed on status pages, but hidden from your primary dashboard and Quick Stats. Use your primary account credentials if you want them on your main dashboard.

Add KumaFleet directly to the same compose file as your Uptime Kuma instance:

```yaml
services:
  uptime-kuma:
    image: louislam/uptime-kuma:2
    container_name: uptime-kuma
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - kuma-data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock:ro

  kumafleet:
    image: ghcr.io/otterboops/kumafleet:latest
    container_name: kumafleet
    restart: unless-stopped
    depends_on:
      - uptime-kuma
    environment:
      - KUMA_URL=http://uptime-kuma:3001
      - KUMA_USER=${KUMA_USER}
      - KUMA_PASS=${KUMA_PASS}
      - STATUS_PAGE_SLUG=homelab  # optional: groups containers on your status page
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro

volumes:
  kuma-data:
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `KUMA_URL` | `http://uptime-kuma:3001` | URL of your Uptime Kuma instance |
| `KUMA_USER` | *(required)* | Uptime Kuma username or service account |
| `KUMA_PASS` | *(required)* | Uptime Kuma password |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Path to Docker unix socket |
| `DOCKER_HOST_NAME` | `Local Docker` | Display name of the Docker host inside Kuma |
| `STATUS_PAGE_SLUG` | *(none)* | Status page slug to keep synced with grouped monitors |
| `SYNC_INTERVAL` | `30` | Sync frequency in seconds |
| `AUTO_DEREGISTER` | `true` | Automatically deregister monitors from Kuma when containers are destroyed or ignored |
| `DEFAULT_GROUP` | `Standalone` | Status page group name for non-compose containers |
| `IGNORE_CONTAINERS` | `uptime-kuma` | Comma-separated names or wildcards (`*-dev,builder-*`) |
| `SKIP_BUILDX` | `true` | Automatically ignore Docker Buildx / BuildKit builder instances |

---

### How Deregistration Works

- **Stopped / crashing containers:** KumaFleet keeps them monitored so Uptime Kuma can flag them as **Down** and send alerts.
- **Destroyed containers (`docker rm`):** KumaFleet automatically cleans up and deletes their monitors from Uptime Kuma on the next sync.
- **Ignored containers:** Adding `kumafleet.ignore: "true"` cleanly purges the monitor from Uptime Kuma and strips it from status pages.

---

### Optional Container Labels

You don't need any labels to get started. But if you want fine-grained control over specific containers, you can attach any of these:

```yaml
services:
  my-app:
    image: my-app:latest
    labels:
      # Ignore this container completely
      kumafleet.ignore: "true"

      # Override the display name in Uptime Kuma
      kumafleet.name: "Production API"

      # Override the status page group
      kumafleet.group: "Backend Services"

      # Override the check interval (seconds)
      kumafleet.interval: "15"
```

*(Note: `kuma.ignore`, `kuma.name`, and `kuma.group` are also accepted for backward compatibility with AutoKuma).*

---

## License

[DBAD](LICENSE) (Don't Be a Dick Public License).
