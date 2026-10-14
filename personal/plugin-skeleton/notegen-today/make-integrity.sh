#!/usr/bin/env bash
# 產生 NoteGen 開發外掛所需的 integrity.json（src-tauri/src/plugins.rs:519 IntegrityManifest）
# 每次改完 plugin.json / entry.mjs / lib/* 後重跑一次，再按「匯入」或等自動 reload。
cd "$(dirname "$0")"
{
  echo '{"version":1,"algorithm":"sha256","files":['
  first=1
  find . -type f \( -name '*.json' -o -name '*.mjs' -o -name '*.js' -o -name '*.css' -o -name '*.md' \) \
    ! -name integrity.json ! -name signature.sig ! -path './node_modules/*' | sort | while read -r f; do
    p="${f#./}"; s=$(wc -c < "$f" | tr -d " "); h=$(shasum -a 256 "$f" | cut -d' ' -f1)
    [ $first -eq 1 ] && first=0 || echo ','
    printf '{"path":"%s","size":%s,"sha256":"%s"}' "$p" "$s" "$h"
  done
  echo ']}'
} > integrity.json
echo "integrity.json 已更新：$(grep -o '"path"' integrity.json | wc -l | tr -d ' ') 個檔案"
