# Plan: Auto-Sync & Auto-Upload Photos from Phone

## Problem

Currently, uploading photos requires manually opening the web UI, selecting files, and waiting for them to finish. There's no way to automatically detect new photos on a phone and push them to the server in the background.

## Goal

Allow a phone to automatically detect new photos/videos and upload them to the photos platform without manual intervention — similar to how Google Photos or iCloud auto-syncs camera rolls.

---

## Architecture Overview

```
┌──────────────────────────────┐
│  Phone (PWA / Mobile App)    │
│  ┌────────────────────────┐  │
│  │ Background Sync Agent  │  │
│  │ - Watch camera roll    │  │
│  │ - Track uploaded files  │  │
│  │ - Queue new photos     │  │
│  └──────────┬─────────────┘  │
└─────────────┼────────────────┘
              │  HTTPS (presigned S3 + API)
              ▼
┌──────────────────────────────┐
│  Backend API                 │
│  ┌────────────────────────┐  │
│  │ /api/v1/sync/*         │  │
│  │ - Register device      │  │
│  │ - Diff check (hash)    │  │
│  │ - Reuse presign flow   │  │
│  │ - Track sync state     │  │
│  └──────────┬─────────────┘  │
└─────────────┼────────────────┘
              │
              ▼
      (existing pipeline)
   S3 → Redis Queue → Worker
```

---

## Approach Options

### Option A: Progressive Web App (PWA) — Recommended

Make the existing Next.js frontend installable as a PWA on the phone. Use the **File System Access API** or **Background Sync API** + **Periodic Background Sync** to detect and upload new photos.

**Pros:**
- No separate app to build/maintain
- Reuses 100% of existing upload infrastructure (presigned URLs, chunked upload, dedup)
- Works on Android (Chrome) with good background sync support
- Single codebase

**Cons:**
- iOS Safari has limited Background Sync / Periodic Sync support
- Camera roll access is restricted to user-initiated file picks (no true "watch" capability in PWA)
- Background execution is unreliable on both platforms

**Verdict:** Good for manual-trigger "sync all new" — not true background auto-sync.

---

### Option B: Companion Mobile App (React Native / Expo)

Build a lightweight mobile app dedicated to sync. It watches the camera roll, hashes new files, and uploads via the existing API.

**Pros:**
- True background execution (BackgroundFetch / WorkManager on Android, BGTaskScheduler on iOS)
- Direct camera roll access (CameraRoll API)
- Can detect new photos in real-time via photo library change observers
- Works reliably on both iOS and Android
- Can show upload progress as a notification

**Cons:**
- Separate codebase to maintain
- App Store / Play Store review process
- More complex deployment

**Verdict:** Best UX, most reliable, but highest effort.

---

### Option C: Server-Side Watch Folder + Third-Party Sync Tool

Add a server-side watched directory. Users configure a tool like **Syncthing**, **FolderSync**, or **PhotoSync** on their phone to push photos to this folder (via WebDAV, SFTP, or Syncthing protocol). A file watcher on the server auto-ingests new files.

```
Phone (Syncthing/FolderSync)
    │
    ▼  (Syncthing protocol / WebDAV / SFTP)
Watch Folder (/incoming/{userId}/)
    │
    ▼  (chokidar / inotify watcher)
Backend ingest service
    │
    ▼  (existing pipeline)
S3 → Redis Queue → Worker
```

**Pros:**
- Leverages battle-tested sync tools (Syncthing has excellent conflict resolution)
- No mobile app to build
- Works on any platform (phone, tablet, desktop)
- True background sync (Syncthing/FolderSync handle it natively)
- Minimal new code — just a folder watcher + ingest service

**Cons:**
- Requires users to install and configure a third-party app
- Extra infrastructure (watch folder, WebDAV/SFTP server or Syncthing node)
- Files land on disk before S3 (storage overhead, cleanup needed)

**Verdict:** Pragmatic, reliable, low code effort, but worse UX (setup friction).

---

## Recommended Approach: Hybrid (Option A + C)

### Phase 1 — PWA "Sync Now" Button + Smart Diff (Low effort, immediate value)

Add a "Sync Photos" feature to the existing web UI that:
1. User taps "Sync Photos" on their phone browser / PWA
2. Opens a multi-file picker pre-filtered to images/videos
3. Client hashes selected files (SHA-256 of first 1MB + file size)
4. Sends hashes to a new `/api/v1/sync/diff` endpoint
5. Backend returns which files are already uploaded (dedup)
6. Only new files get uploaded via existing presigned URL flow
7. Sync state (last sync timestamp, device ID) persisted in localStorage + DB

### Phase 2 — Server-Side Watch Folder (Medium effort, true auto-sync)

Add a file watcher service that auto-ingests photos from a watched directory:
1. New `SyncDevice` and `SyncState` DB tables to track per-device sync progress
2. WebDAV endpoint (or integrate Syncthing) for receiving files
3. Node.js file watcher (chokidar) monitors `/incoming/{userId}/`
4. On new file: hash → dedup check → upload to S3 → enqueue processing → delete local copy
5. Expose sync status via API for frontend to display

### Phase 3 — Mobile Companion App (High effort, best UX) *(Optional/Future)*

React Native app with background photo sync. Only if Phase 1+2 don't meet needs.

---

## Phase 1: Detailed Design

### New API Endpoints

#### `POST /api/v1/sync/diff`
Check which files from a batch are already uploaded.

```ts
// Request
{
  files: Array<{
    name: string;
    size: number;
    lastModified: number;       // epoch ms
    partialHash: string;        // SHA-256 of first 1MB
  }>
}

// Response
{
  newFiles: string[];            // names that need uploading
  existingFiles: string[];       // names already in library
  existingMediaIds: string[];    // IDs of existing matches
}
```

#### `GET /api/v1/sync/status`
Get sync history for the current device.

```ts
// Response
{
  deviceId: string;
  lastSyncAt: string;           // ISO timestamp
  totalSynced: number;
  pendingCount: number;
}
```

#### `POST /api/v1/sync/register-device`
Register a sync device (phone/tablet).

```ts
// Request
{
  deviceName: string;           // e.g. "John's iPhone"
  deviceType: "phone" | "tablet" | "desktop";
}

// Response
{
  deviceId: string;
}
```

### Database Changes

```prisma
model SyncDevice {
  id          String   @id @default(uuid())
  userId      String
  deviceName  String
  deviceType  String
  lastSyncAt  DateTime?
  createdAt   DateTime @default(now())

  user        User     @relation(fields: [userId], references: [id])
  syncHistory SyncEvent[]
}

model SyncEvent {
  id          String   @id @default(uuid())
  deviceId    String
  mediaItemId String?
  fileName    String
  status      String   // "uploaded" | "duplicate" | "failed"
  syncedAt    DateTime @default(now())

  device      SyncDevice @relation(fields: [deviceId], references: [id])
  mediaItem   MediaItem?  @relation(fields: [mediaItemId], references: [id])
}
```

Add to `MediaItem`:

```prisma
// New field on MediaItem
partialHash   String?    // SHA-256 of first 1MB, for dedup
```

### Frontend Changes

#### New "Sync" Page/Modal (`/sync`)

```
┌─────────────────────────────────┐
│  📱  Photo Sync                 │
│                                 │
│  Last sync: 2 hours ago         │
│  Device: John's iPhone          │
│                                 │
│  ┌───────────────────────────┐  │
│  │                           │  │
│  │   [  Sync New Photos  ]   │  │
│  │                           │  │
│  └───────────────────────────┘  │
│                                 │
│  Recent sync activity:          │
│  ✓ 23 photos uploaded           │
│  ⊘ 5 duplicates skipped         │
│  ✗ 1 failed (retry)            │
│                                 │
│  ──────────────────────────     │
│  Auto-sync: Coming soon         │
└─────────────────────────────────┘
```

#### Sync Flow (client-side)

```ts
async function syncPhotos() {
  // 1. Open file picker (accept images + videos)
  const files = await openFilePicker({ multiple: true, accept: "image/*,video/*" });

  // 2. Compute partial hashes for dedup
  const fileInfos = await Promise.all(files.map(async (f) => ({
    name: f.name,
    size: f.size,
    lastModified: f.lastModified,
    partialHash: await hashFirst1MB(f),
  })));

  // 3. Diff against server
  const { newFiles } = await api.post("/sync/diff", { files: fileInfos });

  // 4. Filter to only new files
  const toUpload = files.filter(f => newFiles.includes(f.name));

  // 5. Upload via existing UploadProvider
  uploadProvider.addFiles(toUpload);

  // 6. Record sync event
  await api.post("/sync/complete", { deviceId, count: toUpload.length });
}
```

#### PWA Manifest & Service Worker

```json
// next.config.js - add PWA support via next-pwa
{
  "name": "Photos",
  "short_name": "Photos",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#000000",
  "icons": [...]
}
```

### Dedup Improvements

Currently dedup is by filename only. Enhance with:

1. **Partial hash** (SHA-256 of first 1MB + file size) — fast, catches exact duplicates
2. **EXIF fingerprint** (camera model + datetime + dimensions) — catches renamed duplicates
3. Store `partialHash` on `MediaItem` for server-side lookups

---

## Phase 2: Detailed Design (Watch Folder)

### New Service: `SyncWatcher`

A Node.js service (runs alongside backend or as a separate process) that:

1. Watches `/data/incoming/{userId}/` directories using `chokidar`
2. On file stabilization (no writes for 2s), starts ingest
3. Computes hash → checks dedup → uploads to S3 → enqueues job → deletes local file
4. Reports status via the existing sync API

### WebDAV Endpoint (Alternative to Syncthing)

Add a lightweight WebDAV server (e.g., `webdav-server` npm package) that:
- Authenticates with existing session tokens or API keys
- Maps `PUT /webdav/{userId}/photo.jpg` to the incoming folder
- Compatible with FolderSync, PhotoSync, and built-in file managers

### Docker Compose Addition

```yaml
sync-watcher:
  build: ./backend
  command: ["node", "dist/sync-watcher.js"]
  volumes:
    - sync-data:/data/incoming
  environment:
    - WATCH_DIR=/data/incoming
    - BACKEND_URL=http://backend:4000
  depends_on:
    - backend
    - redis

volumes:
  sync-data:
```

---

## Implementation Order

| Step | What | Effort | Files Touched |
|------|------|--------|---------------|
| 1 | Prisma schema: `SyncDevice`, `SyncEvent`, `partialHash` on MediaItem | S | `schema.prisma` |
| 2 | Backend: `/sync/diff`, `/sync/status`, `/sync/register-device` routes | M | New `sync.controller.ts`, `sync.service.ts`, `sync.routes.ts` |
| 3 | Backend: partial-hash dedup logic in media service | S | `media.service.ts` |
| 4 | Frontend: `hashFirst1MB()` utility | S | New `lib/utils/hash.ts` |
| 5 | Frontend: Sync page/modal UI | M | New `app/(app)/sync/page.tsx`, components |
| 6 | Frontend: Wire sync flow into UploadProvider | M | `UploadProvider.tsx`, new `SyncProvider.tsx` |
| 7 | Frontend: PWA manifest + service worker | S | `next.config.js`, `public/manifest.json` |
| 8 | Phase 2: Watch folder service | L | New `sync-watcher.ts`, docker-compose changes |
| 9 | Phase 2: WebDAV endpoint | L | New `webdav.ts` service |

**S** = Small (< 2 hours) · **M** = Medium (2-4 hours) · **L** = Large (4-8 hours)

---

## Open Questions

1. **Auth for sync**: Should devices use long-lived API keys (like app passwords) instead of session tokens? Session tokens expire in 30 days and require re-login.
2. **Storage quotas**: Should there be per-user upload limits to prevent runaway auto-sync from filling storage?
3. **Conflict resolution**: If the same photo is uploaded from two devices simultaneously, how should we handle it? (Current: filename dedup. Proposed: hash dedup handles this.)
4. **Video auto-sync**: Should large videos (>500MB) be auto-synced or require manual confirmation?
5. **Network awareness**: Should sync pause on metered/cellular connections? (PWA can check `navigator.connection`)
6. **Phase 2 preference**: Syncthing integration vs. custom WebDAV? Syncthing is more robust but adds infrastructure complexity.
