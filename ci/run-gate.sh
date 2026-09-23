#!/usr/bin/env bash
# 统一的门禁包装：把输出落盘，并在**失败时**把判据行 + 日志尾部发成 GitHub annotation。
#
# 存在理由（第 53 轮实测）：GitHub 的 job 日志要 admin 权限才能读，而 check-run 的
#   **annotations 接口是匿名可读的**（实测 HTTP 200）。把失败原因打成 ::error::，就等于给门禁
#   装了一条"远程可读"的诊断通道 —— 代理在没有 admin、没有 playwright 的机器上也能定位红因。
#   ⚠ 只发"尾部"不够：第一版实测只能看到表格最后几行，看不到真正失败的那条判据
#     ⇒ 现在**先 grep 判据行（❌/FAIL/未通过/✗），再发尾部**。
#
# 用法: bash ci/run-gate.sh <日志路径> <命令...>
#   ⚠ 退出码**原样透传**（set -o pipefail + exit $code）：门禁该拦人还是拦人，
#     所以调用方**不需要** continue-on-error，也不会触犯 ci/gate-audit.mjs 的"守卫必须真拦人"。
set -o pipefail
LOG="$1"; shift
mkdir -p "$(dirname "$LOG")"
"$@" 2>&1 | tee "$LOG"
code=$?
if [ "$code" != "0" ]; then
  echo "::error::$* —— 退出码 $code（完整日志见 ci/out 产物）"
  echo "::error::---- 判据行（含 ❌ / FAIL / 未通过）----"
  grep -n '❌\|FAIL\|未通过\|✘\|✗' "$LOG" 2>/dev/null | tail -n 18 | sed 's/%/%25/g' | while IFS= read -r l; do echo "::error::$l"; done
  echo "::error::---- 日志尾部 18 行 ----"
  tail -n 18 "$LOG" | sed 's/%/%25/g' | while IFS= read -r l; do echo "::error::$l"; done
fi
exit $code
