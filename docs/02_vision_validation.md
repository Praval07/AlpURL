# Executive Decision Record

```text
Project Codename:           Project Lilliput
Official Product Name:      Distributed URL Shortener Reference Implementation
Research Framework Version: UDRPF v6.0
Document Version:           1.0
Status:                     Approved
Owner:                      Antigraviti Research & Design Team
Date:                       2026-07-03
Reviewers:                  Antigraviti Dev Engineering Board, Principal SRE
```

---

# UDRPF Phase 1: Vision & Problem Validation Report
## Project Lilliput — Distributed URL Shortener Reference Implementation

This Vision & Problem Validation Report evaluates target market problems, competitor limitations, engineering risks, and key hypotheses for **Project Lilliput**. It establishes the baseline justification for the system's architecture.

---

## 1. Problem Statement & Friction Points

URL shortening at high scale ($100\text{M}$ daily writes, $1\text{B}$ daily read redirects) presents critical distributed systems friction points:

1. **Lock Contention**: Concurrently writing random strings (keys) into a relational table causes locking on index B-Trees, choking writes.
2. **Speed-of-Light Redirection Latency**: Centralized database lookup routes force global network packets to travel thousands of miles, violating the target redirect SLA ($<10\text{ms}$).
3. **Write Amplification (Click Tracking)**: Tracking IP, User-Agent, and geolocation details synchronously on read operations creates database bottleneck locks.
4. **Link Abuse**: Scammers mask malware in shortened URLs, destroying the shortener's IP/domain trust score.

---

## 2. Competitor Landscape Analysis

| Competitor | Strong Points | Limitations | Lessons for Project Lilliput |
| :--- | :--- | :--- | :--- |
| **Bitly** | Market leader, rich feature set. | Expensive, complex multi-region coordination. | Focus on high-performance caching first. |
| **Dub.co** | Edge-native worker performance ($<15\text{ms}$). | Heavy Vercel lock-in, high serverless API database read costs. | Edge compute redirection is the gold standard; must design containerized/agnostic alternatives. |
| **Shlink** | Open-source, self-hostable. | Hard to scale horizontally due to dependency on SQL locks. | Separate read paths from write paths. |

---

## 3. Core Hypotheses & Validation

* **Hypothesis H1 (KGS Scaling)**: Pre-generating Base62 keys in blocks and storing them in local worker memory blocks prevents database checks during URL creation, dropping write latency to $<50\text{ms}$.
* **Hypothesis H2 (Edge Caching)**: Edge worker nodes (CDN Level 1) and memory read replicas (Level 2) keep read latencies under $10\text{ms}$ for $90\%$ of active redirects.
* **Hypothesis H3 (Decoupled Telemetry)**: Decoupling click analytics via Kafka ingestion buffers guarantees that click bursts have zero impact on the redirect engine's CPU.

---

## 4. Engineering Risks & Mitigations

### 4.1 Technical Risks
* **Risk T1: Redis Cache Eviction Churn (Thundering Herd)**
  * *Likelihood*: High | *Impact*: High
  * *Mitigation*: Configure cache keys with random TTL jitter and use LFU (Least Frequently Used) eviction instead of simple LRU.
* **Risk T2: Single Point of Failure (KGS Coordinator)**
  * *Likelihood*: Low | *Impact*: Critical
  * *Mitigation*: Deploy ZooKeeper in an odd-node quorum configuration ($3$ or $5$ nodes) to survive partition failures.

### 4.2 Operational Risks
* **Risk O1: Write API Starvation due to API Abuse**
  * *Likelihood*: High | *Impact*: High
  * *Mitigation*: Enforce Token-Bucket rate-limiting at the reverse proxy (Envoy/Nginx) before application servers.

### 4.3 Cost & Scaling Risks
* **Risk C1: Massive Ingress Bandwidth and Storage Overhead**
  * *Likelihood*: Medium | *Impact*: High
  * *Mitigation*: Implement data purging policies (TTL) and compress old records into cold object storage (S3/GCS) in parquet format.

### 4.4 Legal & Compliance Risks
* **Risk L1: GDPR "Right to Be Forgotten" on Analytics Telemetry**
  * *Likelihood*: Medium | *Impact*: High
  * *Mitigation*: Mask IP addresses (IPv4 subnet masking, IPv6 truncation) before writing to ClickHouse and build an automated user data purging routine.

---

## 5. Open Questions (Input for Phase 2)

* **Q1: Should ID generation be sequential or random?** (Sequential IDs leak total URL volume statistics; random IDs reduce B-Tree efficiency).
* **Q2: Should URLs expire by default?** (Default TTL of 2 years recommended to protect storage bounds).
* **Q3: Should analytics be real-time or batch processed?** (Batch/micro-batching via Kafka is needed for click stream ingestion).
* **Q4: How do we prevent domain reputation damage?** (Real-time safety checks using Google Safe Browsing and Web-Risk API integration).

---

## 6. Decision Log

### Decision D1.2: Analytics Telemetry Buffer Strategy
* **Chosen**: Asynchronous Kafka Messaging + ClickHouse Columnar DB.
* **Reason**: Relational databases degrade under high throughput logs. Kafka acts as a durable ingestion buffer, preventing backpressure on redirection engines. ClickHouse provides excellent compression and superfast analytical aggregations.
* **Rejected Alternatives**: PostgreSQL JSON logging, ElasticSearch.
* **Trade-offs**: Operational complexity of running Kafka clusters and ClickHouse alongside the primary NoSQL datastore.
* **Future Review Date**: 2026-09-10 (During Phase 9: Background Workers & Analytics).

---

## 7. Research Evidence & References

* **Bitly Architecture Reference**: Bitly engineering highlights using distributed key generators and edge cache redirection (*Bitly Engineering Blog*).
* **Consul/ZooKeeper Coordination**: ZooKeeper's consensus algorithm (ZAB) guarantees partition tolerance ($CP$) for distributed key block generation (*Apache ZooKeeper Documentation*).
* **GDPR Compliance in Distributed Systems**: Masking IP addresses at collection time removes PII compliance liabilities (*European Data Protection Board Guidelines*).

---

## 8. Phase Exit Checklist

* **[x] Scope Approved**: In-scope and Out-of-scope boundaries validated.
* **[x] Vision Approved**: Value propositions and problem statement aligned.
* **[x] Success Criteria Approved**: KPIs specified and measured.
* **[x] Risks Recorded**: Risks categorized with likelihood, impact, and mitigations.
* **[x] Unknowns Recorded**: Listed as open questions to resolve in Phase 2.
* **[x] Research Backlog Updated**: Scheduled for PRD mapping.
* **[x] Next Phase Ready**: Phase 1 officially baseline-approved.
