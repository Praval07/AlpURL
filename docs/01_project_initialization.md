# Executive Decision Record

```text
Project Codename:           Project Lilliput
Official Product Name:      Distributed URL Shortener Reference Implementation
Research Framework Version: UDRPF v6.0
Document Version:           1.0
Status:                     Approved
Owner:                      Antigraviti Research & Design Team
Date:                       2026-07-03
Reviewers:                  Antigraviti Dev Engineering Board, Principal Architect
```

---

# UDRPF Phase 1: Project Initialization Report
## Project Lilliput — Distributed URL Shortener Reference Implementation

This Project Initialization Report establishes the governing scope, success definitions, scale requirements, non-goals, and preliminary decisions for **Project Lilliput**. It serves as the baseline single source of truth for all downstream engineering phases.

---

## 1. Project Context & Objectives

### 1.1 Executive Summary
Project Lilliput is an enterprise-grade, globally distributed URL shortening service. It is designed as the reference architecture validating the integration of the Ultimate Deep Research Prompt Framework (UDRPF) and the Universal Engineering Execution Engine (UEEE).

### 1.2 Success Definition
For Project Lilliput to be deemed successful, the final reference implementation must satisfy the following criteria:
* **✓ Supports 100M users**: Handles 100M daily active users (DAUs) without database degradation.
* **✓ <10ms redirect latency**: Serves cached redirects from regional/edge caches in under 10ms.
* **✓ 99.99% uptime**: Delivers high write availability and 99.999% read availability.
* **✓ Multi-region deployment**: Architected to run active-active or active-replica across multiple geographic regions.
* **✓ Disaster recovery**: Automated database replica failover with RTO < 30 seconds and RPO < 5 seconds.
* **✓ Open-source ready**: Uses clean documentation, structured Docker/Kubernetes configurations, and modular dependency management.
* **✓ FAANG interview ready**: Exemplifies gold standard system design principles (KGS, consistent hashing, caching, rate limiting, and write-ahead logs).
* **✓ Startup MVP ready**: Highly cost-optimized serverless/edge configuration options for early-stage deployments.
* **✓ Enterprise ready**: Features robust rate limiting, multi-tenant database isolation, audit logs, and security controls.

---

## 2. Target Scale & System Requirements

### 2.1 Core Scale Assumptions
* **Daily Active Users (DAU)**: $100\text{ Million}$
* **Daily Write Transactions (New URL creation)**: $100\text{ Million}$ urls created per day.
* **Read-to-Write Ratio**: $10:1$ (highly read-heavy system).
* **Daily Read Transactions (Redirects)**: $1\text{ Billion}$ redirections processed per day.

### 2.2 Throughput Calculations
* **Average Write Throughput (Sustained)**:
  $$\text{Writes/sec} = \frac{100,000,000}{86,400\text{ seconds}} \approx 1,157\text{ QPS}$$
* **Peak Write Throughput (3x Spikes)**:
  $$\text{Peak Writes/sec} \approx 3,471\text{ QPS}$$
* **Average Read Throughput (Sustained)**:
  $$\text{Reads/sec} = \frac{1,000,000,000}{86,400\text{ seconds}} \approx 11,574\text{ QPS}$$
* **Peak Read Throughput (3x Spikes)**:
  $$\text{Peak Reads/sec} \approx 34,722\text{ QPS}$$

### 2.3 Storage Footprint Calculations (5-Year Horizon)
* **Average Metadata Size per URL**: $500\text{ Bytes}$
* **Total Writes over 5 Years**:
  $$\text{Total Records} = 100\text{M/day} \times 365\text{ days/year} \times 5\text{ years} = 182.5\text{ Billion records}$$
* **Raw Database Storage Requirements**:
  $$\text{Storage} = 182.5\text{B records} \times 500\text{ Bytes/record} = 91.25\text{ Terabytes (TB)}$$
* **Indexing Overhead (Estimated 25%)**: $\approx 22.81\text{ TB}$
* **Total Storage Target**: $\approx 114.06\text{ TB}$ (requires partitioning and sharding).

### 2.4 Network Bandwidth Calculations
* **Read Bandwidth (Egress)**:
  $$\text{Egress Bandwidth} = 11,574\text{ QPS} \times 500\text{ Bytes} = 5.79\text{ MB/s} \approx 46.3\text{ Mbps sustained}$$
  $$\text{Peak Egress Bandwidth} = 34,722\text{ QPS} \times 500\text{ Bytes} = 17.36\text{ MB/s} \approx 138.9\text{ Mbps peak}$$
* **Write Bandwidth (Ingress)**:
  $$\text{Ingress Bandwidth} = 1,157\text{ QPS} \times 500\text{ Bytes} = 0.58\text{ MB/s} \approx 4.64\text{ Mbps sustained}$$
  $$\text{Peak Ingress Bandwidth} = 3,471\text{ QPS} \times 500\text{ Bytes} = 1.74\text{ MB/s} \approx 13.92\text{ Mbps peak}$$

---

## 3. Scope Boundaries

### 3.1 In-Scope (Version 1)
1. **Collision-Free Short URL Generation**: Pre-allocated Base62 short keys.
2. **Global Redirect Engine**: Read-cached redirections served at edge nodes.
3. **Key Generation Service (KGS)**: Independent microservice handling key pre-generation and node synchronization.
4. **Custom Aliasing**: Collision-checked user-customized aliases (e.g., `lilli.put/custom-alias`).
5. **Asynchronous Telemetry Ingestion**: decourpled click telemetry logging via Kafka queue to ClickHouse analytics database.
6. **Rate Limiting**: Distributed rate-limiting layer protecting write APIs.
7. **Basic Multi-Tenant Isolation**: Header/JWT claims partition for enterprise custom domains.

### 3.2 Explicit Non-Goals (Version 1 will NOT support)
* **❌ QR Analytics**: Generation and tracking of QR codes for shortened links.
* **❌ Advanced Team Management**: Organization hierarchy workspace collaboration (beyond simple multi-tenancy).
* **❌ Subscription Billing**: Stripe checkout integration or tier limits.
* **❌ Geo-Routing / Smart Links**: Redirecting users to different long URLs based on their geographic location (e.g., routing UK users to a `.co.uk` domain).
* **❌ Deep Link Association**: Directly launching native mobile apps via Android App Links or iOS Universal Links.
* **❌ Granular Enterprise RBAC**: Custom fine-grained role-based permissions management.

---

## 4. Key Performance Indicators (KPIs) & Target SLAs

| Metric | Target SLA | Measurement Method |
| :--- | :--- | :--- |
| **Read Latency (Redirect)** | $< 10\text{ms}$ (Cached edge redirects) | P99 latency at CDN Edge workers. |
| **Write Latency (Creation)** | $< 50\text{ms}$ (Using pre-generated keys) | P99 latency at API Gateway boundary. |
| **Read Availability** | $99.999\%$ (Five Nines) | Total successful redirections / total requests. |
| **Write Availability** | $99.99\%$ (Four Nines) | Successful URL creations / total writes. |

---

## 5. Research Confidence Matrix & Assumptions

### 5.1 Research Confidence Matrix

| Area | Confidence | Rationale / Mitigation |
| :--- | :--- | :--- |
| **Capacity Planning** | **High** | Basic physics of request bandwidth and storage parameters. |
| **Storage Estimate** | **High** | Sized for standard metadata size; verified against DynamoDB storage overhead. |
| **Analytics Ingestion** | **High** | Industry-standard architecture (Kafka + ClickHouse) used by Uber and Cloudflare. |
| **CDN Strategy** | **Medium** | Need to benchmark edge workers cold starts under heavy write bursts. |
| **Security Controls** | **Medium** | API gateway rate limiting needs distributed state coordination (Redis vs. Token Bucket). |
| **Geo-Replication** | **Low** | Active-active replication conflicts for custom alias updates must be detailed in Phase 5. |

### 5.2 Architectural Assumptions

* **Assumption A1**: Distributed caching via Redis cluster or Memcached exists and is capable of holding the active working set (Pareto principle: 20% of links get 80% of traffic).
  * *Confidence*: High.
  * *Validation*: Verified during Technology Selection (Phase 6) and Caching Layer Design (Phase 8).
* **Assumption A2**: Pre-generating short keys in a central coordinator (ZooKeeper) and local memory buffers prevents duplicate keys.
  * *Confidence*: High.
  * *Validation*: Simulated in Key Generation Service architectural research (Phase 5).
* **Assumption A3**: Columnar storage (ClickHouse) scales to 1 Billion inserts/day with minimal indexing overhead.
  * *Confidence*: High.
  * *Validation*: Benchmarked in Industry Best Practices (Phase 4).

---

## 6. Decision Log

### Decision D1.1: Storage Backend Selection Strategy
* **Chosen**: NoSQL Key-Value Store (Distributed Bigtable / DynamoDB / Cassandra).
* **Reason**: Scale constraint of 114 TB over 5 years. Relational databases degrade rapidly at this storage volume and lack default partition scalability without expensive manual sharding. NoSQL provides predictable $O(1)$ read/write performance.
* **Rejected Alternatives**: Relational DB (PostgreSQL) with manual sharding.
* **Trade-offs**: Lost ACID guarantees for multi-key transactions (unneeded for single URL mapping writes).
* **Future Review Date**: 2026-09-01 (During Phase 7: Database Design).

---

## 7. Research Evidence & References

* **Twitter's Snowflake ID / UUIDv4**: Cites the use of decentralized ID generators to prevent database lock bottlenecks (*Twitter Engineering Blog*).
* **Cloudflare Workers Redirection Scaling**: Demonstrates edge execution latency of $< 15\text{ms}$ using Cloudflare KV stores (*Cloudflare Developer Docs*).
* **ClickHouse Columnar Storage Scaling**: Uber's engineering blog confirms ClickHouse ingestion rates exceeding 1M writes/sec on moderate cluster topologies (*Uber Engineering Blog*).

---

## 8. Phase Exit Checklist

* **[x] Scope Approved**: Core in-scope and out-of-scope parameters documented.
* **[x] Vision Approved**: Project target KPIs and success criteria validated.
* **[x] Success Criteria Approved**: Sized and measured via SLA targets.
* **[x] Risks Recorded**: Recorded in Vision Validation report.
* **[x] Unknowns Recorded**: Listed as entry parameters for PRD.
* **[x] Research Backlog Updated**: Sized and structured for Phase 2.
* **[x] Next Phase Ready**: Proceeding to Phase 2.
