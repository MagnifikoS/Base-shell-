# Audit Framework — Restaurant OS

## Purpose
This framework defines **9 specialized audit agents** that run independently and produce scored reports. The master prompt orchestrates them and produces a consolidated audit with a final score.

## Scoring System

### Per-Agent Scoring
Each agent scores their domain on a **0–10 scale** with:
- **10**: Perfect — production-grade, no issues
- **8-9**: Excellent — minor improvements possible
- **7**: Good — acceptable for production, some items to address
- **5-6**: Needs work — functional but risks exist
- **3-4**: Problematic — significant issues that block production
- **0-2**: Critical — broken or dangerous

### Weighted Final Score
| Agent | Weight | Why |
|-------|--------|-----|
| 01 Build & Compilation | 15% | If it doesn't build, nothing works |
| 02 Security | 20% | Customer data protection is paramount |
| 03 Database & Migrations | 10% | Data integrity |
| 04 Performance & Bundle | 10% | User experience at scale |
| 05 Architecture & Code Quality | 10% | Maintainability |
| 06 Tests & Coverage | 15% | Regression prevention |
| 07 UX/UI & Frontend | 10% | Customer-facing quality |
| 08 Edge Functions & Backend | 5% | API reliability |
| 09 DevOps & Prod Readiness | 5% | Operational maturity |

### Production Readiness Thresholds
| Score | Verdict |
|-------|---------|
| 90-100 | ✅ **Ship it** — production ready |
| 80-89 | ✅ **GO with monitoring** — minor items, safe to ship |
| 70-79 | ⚠️ **Conditional GO** — fix HIGH items first |
| 60-69 | 🔴 **HOLD** — too many issues for production |
| <60 | 🚫 **BLOCK** — critical fixes required |

## Report Structure
Each audit produces files in `docs/agents-audit/reports/YYYY-MM-DD/`:
```
reports/
└── 2026-02-17/
    ├── 01-build.md          # Agent 01 report
    ├── 02-security.md       # Agent 02 report
    ├── 03-database.md       # Agent 03 report
    ├── 04-performance.md    # Agent 04 report
    ├── 05-architecture.md   # Agent 05 report
    ├── 06-tests.md          # Agent 06 report
    ├── 07-ux-frontend.md    # Agent 07 report
    ├── 08-backend.md        # Agent 08 report
    ├── 09-devops.md         # Agent 09 report
    └── FINAL-AUDIT.md       # Consolidated report with final score
```

## Comparison
Each `FINAL-AUDIT.md` includes a comparison with the previous audit if one exists, showing delta per category and overall trend.

## Rules for All Agents
1. **Be specific**: cite file paths, line numbers, exact error messages
2. **Be fair**: acknowledge strengths, not just weaknesses
3. **Be actionable**: every issue must have a recommended fix
4. **Prioritize**: use 🔴 CRITICAL / 🟡 HIGH / 🟠 MEDIUM / 🔵 LOW severity
5. **No opinions without evidence**: every claim backed by a command output or code reference
6. **Test everything**: run commands, don't assume
7. **Never skip**: check every item in the checklist even if "it was fine last time"
