#!/usr/bin/env python3
"""v1 cards.json から case 10件を v2 スキーマにマイグレーションする1回限りスクリプト。

実行:
  cd /Users/yuriko/Documents/Claude/Projects/cowork-guide
  python3 v2/scripts/migrate_v1_cases.py

出力:
  v2/data/cards.json
"""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
V1_CARDS = REPO / "scripts" / "cards.json"
V2_CARDS = REPO / "v2" / "data" / "cards.json"

PERSON_TO_ROLE: dict[str, list[str]] = {
    "Hiro": ["creative"],
    "Mizuki": ["creative"],
    "Wataru": ["backoffice"],
    "Nishijima": ["backoffice"],
    "Fujimoto": ["cross"],
    "PM担当": ["pm"],
}

CASE_OVERRIDES: dict[str, dict] = {
    "商品画像・打ち合わせ資料を 2時間 → 40分に": {
        "before_minutes": 120,
        "after_minutes": 40,
        "saved_minutes": 80,
        "monthly_frequency": 8,
        "monthly_saved_minutes": 630,
        "tool": "ChatGPT + Cowork",
    },
    "キャラクター版下PDFを 20秒で生成": {
        "before_minutes": 30,
        "after_minutes": 1,
        "saved_minutes": 29,
        "monthly_frequency": 4,
        "monthly_saved_minutes": 116,
        "tool": "Cowork (Illustrator script生成)",
    },
    "カレンダーの祝日・誕生日を一括登録": {
        "before_minutes": 30,
        "after_minutes": 5,
        "saved_minutes": 25,
        "monthly_frequency": 1,
        "monthly_saved_minutes": 25,
        "tool": "Cowork + Google Calendar",
    },
    "定例資料作成を 2時間 → 1時間に削減": {
        "before_minutes": 120,
        "after_minutes": 60,
        "saved_minutes": 60,
        "monthly_frequency": 4,
        "monthly_saved_minutes": 240,
        "tool": "Cowork",
    },
    "Illustratorデータ → AI が自動で内容を判定": {
        "before_minutes": 20,
        "after_minutes": 5,
        "saved_minutes": 15,
        "monthly_frequency": 12,
        "monthly_saved_minutes": 180,
        "tool": "Cowork",
    },
    "レシート写真 → スプレッドシートに自動データ化": {
        "before_minutes": 60,
        "after_minutes": 5,
        "saved_minutes": 55,
        "monthly_frequency": 20,
        "monthly_saved_minutes": 1100,
        "tool": "Cowork + GAS",
    },
    "シフト管理・集計を自動化": {
        "before_minutes": 60,
        "after_minutes": 10,
        "saved_minutes": 50,
        "monthly_frequency": 4,
        "monthly_saved_minutes": 200,
        "tool": "Cowork",
    },
    "経費申請をスキルで自動化": {
        "before_minutes": 30,
        "after_minutes": 5,
        "saved_minutes": 25,
        "monthly_frequency": 1,
        "monthly_saved_minutes": 25,
        "tool": "Cowork (/keihi スキル) + マネーフォワード",
        "skill_link": "/keihi",
    },
    "SNSスケジュール策定を半分の時間に": {
        "before_minutes": 120,
        "after_minutes": 60,
        "saved_minutes": 60,
        "monthly_frequency": 4,
        "monthly_saved_minutes": 240,
        "tool": "Cowork",
    },
    "韓国語ブランド翻訳・企画書を自動作成": {
        "before_minutes": 60,
        "after_minutes": 10,
        "saved_minutes": 50,
        "monthly_frequency": 4,
        "monthly_saved_minutes": 200,
        "tool": "Cowork",
    },
}


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"[^A-Za-z0-9一-龥ぁ-んァ-ヴー]+", "-", text).strip("-").lower()
    return text[:50] or "case"


def migrate() -> None:
    v1 = json.loads(V1_CARDS.read_text(encoding="utf-8"))
    cases = [c for c in v1 if c.get("type") == "case"]
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    today = datetime.now().strftime("%Y-%m-%d")

    out: list[dict] = []
    for i, c in enumerate(cases, start=1):
        title = c["title"]
        person = c.get("person", "Unknown")
        roles = PERSON_TO_ROLE.get(person, ["cross"])
        overrides = CASE_OVERRIDES.get(title, {})
        item_id = c.get("id") or f"case-{slugify(person).lower()}-{i:03d}"

        item: dict = {
            "id": item_id,
            "version": 2,
            "type": "case",
            "title": title,
            "person": person,
            "person_slack_id": None,
            "role": roles,
            "tool": overrides.get("tool", "Cowork"),
            "before_minutes": overrides.get("before_minutes"),
            "after_minutes": overrides.get("after_minutes"),
            "saved_minutes": overrides.get("saved_minutes"),
            "monthly_frequency": overrides.get("monthly_frequency"),
            "monthly_saved_minutes": overrides.get("monthly_saved_minutes"),
            "tags": c.get("tags", []),
            "is_common_tool": False,
            "common_tool_status": None,
            "desc": c.get("desc", ""),
            "detail": c.get("detail", ""),
            "skill_link": overrides.get("skill_link"),
            "github_url": None,
            "attachments": [],
            "stat_legacy": c.get("stat"),
            "migrated_from": "v1",
            "migration_note": "CORIN推測値（before/after分・頻度）— 本人レビューで上書き推奨",
            "created_at": "2026-05-09",
            "updated_at": today,
            "presented_at": None,
        }
        out.append(item)

    V2_CARDS.parent.mkdir(parents=True, exist_ok=True)
    V2_CARDS.write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    total_saved = sum((c.get("monthly_saved_minutes") or 0) for c in out)
    print(f"✅ {len(out)} cases migrated → {V2_CARDS}")
    print(f"   累計月次削減（CORIN推測値合計）: {total_saved}分 ≒ {total_saved/60:.1f}時間")


if __name__ == "__main__":
    migrate()
