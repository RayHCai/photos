# Photos

Photos is a personal photo and video library with uploads, albums, share links, search and grouping by face. A Next.js web app talks to an Express API that keeps files in Amazon S3 and metadata in PostgreSQL, while a Python worker takes jobs from a Redis queue to build thumbnails, CLIP embeddings and face clusters.

```mermaid
flowchart LR
  web["Web<br/>TypeScript, Next.js"] --> api["API<br/>TypeScript, Express"]
  web --> s3["Amazon S3"]
  web --> cdn["Amazon CloudFront"]
  api --> db[("PostgreSQL")]
  api --> redis[("Redis")]
  api --> s3
  api --> cdn
  api --> worker["Worker<br/>Python, FastAPI"]
  worker --> redis
  worker --> api
  worker --> s3
  worker --> nominatim["Nominatim"]
```
