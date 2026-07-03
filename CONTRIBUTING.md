# Contributing to AlpURL

Thank you for your interest in contributing to **AlpURL**! We welcome bug reports, feature suggestions, documentation updates, and pull requests.

---

## Code of Conduct
By participating in this project, you agree to abide by the terms of our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## How to Contribute

### 1. Reporting Bugs
- Search existing issues to verify the bug hasn't been reported.
- Open a new issue with a clear title and description. Include steps to reproduce, expected behavior, and screenshots if applicable.

### 2. Feature Requests
- Search open issues to verify the feature hasn't been requested yet.
- Open an issue describing the proposed feature, the use case, and any architectural details.

### 3. Submission Guidelines
1. Fork the repository.
2. Create a new branch named according to conventional patterns (e.g., `feat/add-redis-cache`, `fix/db-connection`).
3. Write clear, formatted code following our standards.
4. Add unit tests for any new endpoints or utility methods.
5. Verify that all tests pass locally.
6. Commit your changes using Conventional Commit patterns:
   - `feat: add rate limiting support`
   - `fix: correct KGS boundary range issue`
   - `docs: update deployment instructions`
7. Push to your branch and open a Pull Request.

---

## Coding Standards

### Python (Backend)
- Adhere to PEP 8 guidelines.
- Use `black` for formatting and `flake8` / `pylint` for linting.
- Write clean unit tests under the `backend/tests/` folder.

### HTML/JS (Frontend)
- Use semantic HTML tags.
- Keep Javascript modular, separated from DOM events.
- Adhere to Tailwind CSS utility naming conventions.
