#!/usr/bin/env bash
# 统一的门禁包装：把输出落盘，并在**失败时**把日志尾部发成 GitHub annotation。
#
# 存在理由（第 53 轮实测）：GitHub 的 job 日志要 admin 权限才能读，而 check-run 的
#   **annotations 接口是匿名可读的**。把失败原因打成 ::error:: 就等于给门禁装了一条
#   "远程可读"的诊断通道 —— 代理在没有 admin、没有 playwright 的机器上也能定位红因。
#
# 用法: bash ci/run-gate.sh <日志路径> <命令...>
#   ⚠ 退出码**原样透传**（set -o pipefail + exit $code）：门禁该拦人还是拦人。
set -o pipefail
LOG="$1"; shift
mkdir -p "$(dirname "$LOG")"
"$@" 2>&1 | tee "$LOG"
code=$?
if [ "$code" != "0" ]; then
  echo "::error::$* —— 退出码 $code（下方为 $LOG 尾部）"
  tail -n 14 "$LOG" | sed 's/%/%25/g' | while IFS= read -r l; do echo "::error::$l"; done
fi
exit $code
