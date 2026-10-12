-- Worker liveness: upserted by each worker's heartbeat loop.
CREATE TABLE "worker_heartbeats" (
    "worker_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_heartbeat_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("worker_id")
);
