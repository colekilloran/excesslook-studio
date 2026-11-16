#!/bin/bash
# run-all.sh - builds studio.html, checks it, runs every test. A crash counts as FAIL.
cd "$(dirname "$0")/.."
python3 tools/build.py || exit 1
node tools/xlcheck.cjs studio.html; X=$?
[ $X -eq 0 ] || { echo "xlcheck FAIL"; exit 1; }
F=0
node tests/test-core.mjs > /tmp/st-core.log 2>&1; tail -1 /tmp/st-core.log; grep -q "RESULT PASS" /tmp/st-core.log || F=1
node tests/test-studio.cjs studio.html tests/shots > /tmp/st-ui.log 2>&1; tail -1 /tmp/st-ui.log; grep -q "RESULT PASS" /tmp/st-ui.log || F=1
node tests/test-autoedit.mjs studio.html tests/shots > /tmp/st-ai.log 2>&1; tail -1 /tmp/st-ai.log; grep -q "RESULT PASS" /tmp/st-ai.log || F=1
[ $F -eq 0 ] && echo "ALL PASS" || { echo "SOME FAILED - see /tmp/st-*.log"; exit 1; }
