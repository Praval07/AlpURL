# AlpURL Product Roadmap

This document outlines the milestones and future enhancements planned for **AlpURL** to evolve it from a single-node reference implementation to a globally distributed cloud-native platform.

---

## Phase 1: Local Reference Core (Current v1.0.0)
- [x] High-performance redirection and stats APIs via FastAPI
- [x] Persistent KGS block-range allocator (SQLite/File fallback)
- [x] Asynchronous clickstream telemetry running in background queues
- [x] Premium glassmorphism SPA dashboard with Chart.js analytics

---

## Phase 2: Distributed Scale (Q3 2026)
- [ ] **Multi-Node KGS Coordination**: Integrate ZooKeeper/Consul to coordinate range allocations across instances.
- [ ] **Distributed Cache Layer**: Introduce Redis Cluster as L2 cache to offload SQLite lookups on popular keys.
- [ ] **Token Bucket Rate Limiting**: Deploy rate-limiting middleware at API gateway levels to protect against write abuse.
- [ ] **Database Partitioning**: Migrate to PostgreSQL/Cassandra for range-sharding long URL mappings.

---

## Phase 3: Enterprise & Security (Q4 2026)
- [ ] **Role-Based Access Control (RBAC)**: Support team dashboards, custom domains (e.g. `brnd.url/alias`), and member permissions.
- [ ] **Link Reputation Guard**: Connect to Google Web Risk API to check target URLs in real-time.
- [ ] **Analytics Streaming Queue**: Decouple telemetry writing via Apache Kafka/RabbitMQ into ClickHouse database to handle 100M+ writes/day.
- [ ] **QR Code Analytics**: Add dynamic QR code generator on link shortening with scan tracking.
