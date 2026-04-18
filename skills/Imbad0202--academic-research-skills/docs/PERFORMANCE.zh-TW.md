# ARS 效能說明

> **建議模型：Claude Opus 4.7**，搭配 **Max plan**（或同等配置）。Opus 4.7 採用 adaptive thinking，不需要手動指定 thinking budget。
>
> 完整學術 pipeline（10 階段）會消耗**大量 token** — 單次完整執行可能超過 200K 輸入 + 100K 輸出 token，視論文長度和修訂輪數而定。請依預算斟酌使用。
>
> 單獨使用個別 skill（如只用 `deep-research` 或 `academic-paper-reviewer`）的消耗明顯較少。

## 各模式 Token 消耗估算

| Skill / 模式 | 輸入 Token | 輸出 Token | 估算費用（Opus 4.7）|
|---|---|---|---|
| `deep-research` socratic | ~30K | ~15K | ~$0.60 |
| `deep-research` full | ~60K | ~30K | ~$1.20 |
| `deep-research` systematic-review | ~100K | ~50K | ~$2.00 |
| `academic-paper` plan | ~40K | ~20K | ~$0.80 |
| `academic-paper` full | ~80K | ~50K | ~$1.80 |
| `academic-paper-reviewer` full | ~50K | ~30K | ~$1.10 |
| `academic-paper-reviewer` quick | ~15K | ~8K | ~$0.30 |
| **完整 pipeline（10 階段）** | **~200K+** | **~100K+** | **~$4-6** |
| + 跨模型驗證 | +~10K（外部）| +~5K（外部）| +~$0.60-1.10 |

*以 ~15,000 字論文、~60 篇引用為基準估算。實際消耗隨論文長度、修訂輪數、對話深度而異。費用以 Anthropic API 2026 年 4 月定價計算。*

## 建議 Claude Code 設定

| 設定 | 功能說明 | 啟用方式 | 官方文件 |
|---|---|---|---|
| **Agent Team** | 產生子代理（subagent）平行執行研究、撰寫、審查 — 多 Agent pipeline 的核心機制 | 設定 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`（研究預覽） | 實驗性功能 — 尚無穩定文件 |
| **Ralph Loop** | 在長時間 pipeline 階段保持 session 持續運作，讓 Claude 能自主執行而不會逾時中斷 | 使用 `/ralph-loop` 啟動 | 社群插件 — 實驗性 |
| **Skip Permissions** | 跳過每次工具使用的確認提示，實現全 pipeline 不中斷的自主執行 | 啟動時加上 `claude --dangerously-skip-permissions` | [Permissions](https://docs.anthropic.com/en/docs/claude-code/cli-reference) · [Advanced Usage](https://docs.anthropic.com/en/docs/claude-code/advanced) |

> **⚠️ Skip Permissions 注意事項**：此旗標會停用所有工具使用的確認對話框。請自行斟酌使用 — 在可信任的長時間 pipeline 中非常方便，但會移除手動審核的安全機制。僅在你確定接受 Claude 自動執行檔案讀寫、shell 指令等操作時才啟用。
