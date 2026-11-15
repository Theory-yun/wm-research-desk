#!/usr/bin/env bash
# 데이터 파일 커밋 & 푸시 (여러 워크플로가 동시에 돌아도 안전하게)
#
# push가 거절되면(다른 워크플로가 먼저 push) 원격 최신 상태로 맞춘 뒤,
# "이번 실행이 바꾼 파일만" 우리 버전으로 덮어써 다시 커밋합니다.
#  - 서로 다른 파일을 바꿨다면 둘 다 보존됩니다.
#  - 같은 파일(예: 공용 뉴스 아카이브)을 바꿨다면 나중 실행의 파일 전체가 남습니다.
#    (git의 줄 단위 병합은 JSON을 깨뜨릴 수 있어 쓰지 않습니다.)
set -u
MSG="$1"
git config user.name "wm-desk-bot"
git config user.email "actions@users.noreply.github.com"
git add data/
if git diff --quiet --cached; then echo "변경 사항 없음 — 커밋 생략"; exit 0; fi
git commit -q -m "$MSG"

for i in 1 2 3 4 5; do
  if git push -q; then echo "push 성공 (시도 $i)"; exit 0; fi
  echo "push 거절 (시도 $i/5) — 원격 최신 상태에 이번 변경 파일을 다시 얹습니다"
  CHANGED=$(git diff --name-only HEAD~1 HEAD)
  SAVE=$(mktemp -d)
  for f in $CHANGED; do [ -f "$f" ] && mkdir -p "$SAVE/$(dirname "$f")" && cp "$f" "$SAVE/$f"; done
  git fetch -q origin main
  git reset -q --hard origin/main
  for f in $CHANGED; do [ -f "$SAVE/$f" ] && mkdir -p "$(dirname "$f")" && cp "$SAVE/$f" "$f"; done
  git add data/
  if git diff --quiet --cached; then echo "원격과 동일 — 커밋 생략"; exit 0; fi
  git commit -q -m "$MSG"
  sleep $((RANDOM % 8 + 3))
done
echo "5회 재시도 후에도 push 실패"; exit 1
