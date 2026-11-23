#!/bin/bash
# run-all.sh - builds studio.html, checks it, runs every test. A crash counts as FAIL.
cd "$(dirname "$0")/.."
python3 tools/build.py || exit 1
node tools/xlcheck.cjs studio.html; X=$?
[ $X -eq 0 ] || { echo "xlcheck FAIL"; exit 1; }
F=0
node tests/test-core.mjs > /tmp/st-core.log 2>&1; tail -1 /tmp/st-core.log; grep -q "RESULT PASS" /tmp/st-core.log || F=1
node tests/test-studio.cjs studio.html tests/shots > /tmp/st-ui.log 2>&1; tail -1 /tmp/st-ui.log; grep -q "RESULT PASS" /tmp/st-ui.log || F=1
node tests/test-iosload.cjs studio.html tests/shots > /tmp/st-ios.log 2>&1; tail -1 /tmp/st-ios.log; grep -q "RESULT PASS" /tmp/st-ios.log || F=1
node tests/test-seeit.cjs studio.html tests/shots > /tmp/st-see.log 2>&1; tail -1 /tmp/st-see.log; grep -q "RESULT PASS" /tmp/st-see.log || F=1
node tests/test-cuts.cjs studio.html tests/shots > /tmp/st-cut.log 2>&1; tail -1 /tmp/st-cut.log; grep -q "RESULT PASS" /tmp/st-cut.log || F=1
node tests/test-projects.mjs studio.html tests/shots > /tmp/st-proj.log 2>&1; tail -1 /tmp/st-proj.log; grep -q "RESULT PASS" /tmp/st-proj.log || F=1
node tests/test-fullcontrol.cjs studio.html tests/shots > /tmp/st-full.log 2>&1; tail -1 /tmp/st-full.log; grep -q "RESULT PASS" /tmp/st-full.log || F=1
node tests/test-nozoom.cjs studio.html tests/shots > /tmp/st-zoom.log 2>&1; tail -1 /tmp/st-zoom.log; grep -q "RESULT PASS" /tmp/st-zoom.log || F=1
node tests/test-learn.mjs studio.html tests/shots > /tmp/st-learn.log 2>&1; tail -1 /tmp/st-learn.log; grep -q "RESULT PASS" /tmp/st-learn.log || F=1
node tests/test-colorlineup.mjs studio.html tests/shots > /tmp/st-cl.log 2>&1; tail -1 /tmp/st-cl.log; grep -q "RESULT PASS" /tmp/st-cl.log || F=1
node tests/test-autoedit.mjs studio.html tests/shots > /tmp/st-ai.log 2>&1; tail -1 /tmp/st-ai.log; grep -q "RESULT PASS" /tmp/st-ai.log || F=1
[ $F -eq 0 ] && echo "ALL PASS" || { echo "SOME FAILED - see /tmp/st-*.log"; exit 1; }
