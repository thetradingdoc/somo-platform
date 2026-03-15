# GitHub Tasks

Tasks to improve repo structure, hygiene, and maintainability based on branch and structure review.

---

## P1 — Immediate

- [ ] **Merge feature branch into main**  
  Merge `feature/layer2-rag-perceptual-state` into `main` when ready. Branch is 5 commits ahead with no conflicts (clean fast-forward).

- [ ] **Delete merged feature branch**  
  Remove `feature/knowledge-base-improvements-and-bug-fixes` from remote (already merged via PR #1):
  ```bash
  git push origin --delete feature/knowledge-base-improvements-and-bug-fixes
  ```

---

## P2 — Repository structure

- [ ] **Fix medical-rag-api embedded repo**  
  `medical-rag-api` is committed as gitlink; clones see empty directory. Choose one:
  - Convert to submodule: `git submodule add <repo-url> medical-rag-api`
  - Or remove from tracking and add to `.gitignore`; document setup in README

- [ ] **Optimize Knowledge/ large files**  
  Large binaries in `Knowledge/` (e.g. ~100MB+) bloat clones. Options:
  - Add Git LFS for `Knowledge/**` (`.gitattributes` + `git lfs track`)
  - Or move to external storage / data repo; document fetch in README

- [ ] **Add .gitignore for medical-rag-api (if not submodule)**  
  If dropping `medical-rag-api` from tracking:
  ```
  medical-rag-api/
  ```

---

## P3 — Documentation

- [ ] **Consolidate architecture docs**  
  Reduce overlap among:
  - `ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md`
  - `HYBRID_ARCHITECTURE_OVERVIEW.md`
  - `HYBRID_ARCHITECTURE_IMPROVEMENTS.md`  
  Merge or cross-link and clarify scope of each.

- [ ] **Add services overview**  
  Document payment services in `middleware-platform/services/README.md`:
  - `payment-service.js`, `payment-processor-service.js`, `payment-orchestrator.js`
  - `payment-method-config.js`, `payment-rails-service.js`, `payment-security.js`  
  Include roles and call flow.

---

## P4 — Ongoing hygiene

- [ ] **Branch naming convention**  
  Decide and document: e.g. `feature/*`, `fix/*`, `docs/*` and when to delete branches.

- [ ] **PR template**  
  Add `.github/PULL_REQUEST_TEMPLATE.md` for checklist (tests, docs, breaking changes).

- [ ] **Protected branches**  
  Consider protecting `main` (require PR, status checks, no force-push) if not already set.

---

## Quick reference

| Branch | Status |
|--------|--------|
| `main` | Default; `da298f4` |
| `feature/layer2-rag-perceptual-state` | 5 commits ahead; ready to merge |
| `feature/knowledge-base-improvements-and-bug-fixes` | Merged; safe to delete |

---

*Generated from branch and structure review. Update as tasks are completed.*
