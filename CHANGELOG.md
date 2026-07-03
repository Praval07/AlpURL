# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-03

### Added
- **Core Engine**: FastAPI-based backend routing engine for redirections and click stats.
- **Key Generation Service (KGS)**: Persistent thread-safe block reservation coordinator preventing primary DB lookup delays.
- **Async Telemetry Ingestion**: Decoupled clickstream tracking running on background queues to protect latency SLAs.
- **Dashboard UI**: Premium glassmorphism SPA with linear orbs, stats indicators, and real-time Chart.js graphs.
- **Dev Runner**: Root-level runner `run.py` automating virtualenv setup and launching uvicorn.
- **Containerization**: Docker and Docker Compose support for scalable deployments.
- **CI Workflows**: GitHub Actions validating builds, lints, and test suites.
