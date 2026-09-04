# The full verification gate. Canonical home: qa/ in the repo (rollback-proof).
# Runs from the scratchpad so screenshots and logs stay out of the tree:
#   bash qa/regress.sh            — syncs qa/ → $SP, runs everything there.
SP=${SP:-/tmp/claude-0/-home-user-dashb/e1e8e6e3-0252-58c0-8ecc-a3edec104fdd/scratchpad}
QA="$(cd "$(dirname "$0")" && pwd)"
mkdir -p $SP
cp $QA/*.mjs $QA/pc-suite.sh $QA/journey.sh $SP/ 2>/dev/null
cd $SP
RES=$SP/regress-results.txt
: > $RES


# ---- booting an API the suites can trust ------------------------------------
# Twice now a whole block of suites has failed, and both times the code was
# fine: a server from an earlier run still held the port, the new one died on
# EADDRINUSE without anybody looking at its log, and every suite in the block
# quietly talked to the OLD server with the OLD database. Five red suites that
# say nothing about the code cost more than a slow gate, so the boot is
# checked: the port must actually free, the process we started must still be
# alive, and the thing answering /api/health must be the one we started.
boot_api() {   # boot_api PORT DATA_DIR LOGFILE
  local port=$1 datadir=$2 log=$3 i
  fuser -k $port/tcp 2>/dev/null
  for i in $(seq 1 20); do
    curl -s -o /dev/null --max-time 1 http://localhost:$port/api/health || break
    sleep 0.5
  done
  if curl -s -o /dev/null --max-time 1 http://localhost:$port/api/health; then
    echo "PORT $port STILL HELD — refusing to run against somebody else's server" >> $RES
    return 1
  fi
  DATA_DIR=$datadir PORT=$port node $ROOT/server/index.js > $log 2>&1 &
  local pid=$!
  for i in $(seq 1 40); do
    curl -s -o /dev/null --max-time 1 http://localhost:$port/api/health && break
    sleep 0.5
  done
  if ! kill -0 $pid 2>/dev/null; then
    echo "SERVER ON $port DIED AT BOOT — see $log" >> $RES
    tail -5 $log >> $RES
    return 1
  fi
  if ! curl -s -o /dev/null --max-time 2 http://localhost:$port/api/health; then
    echo "SERVER ON $port NEVER ANSWERED — see $log" >> $RES
    return 1
  fi
  return 0
}

# ---- main 4090 stack on a fresh seeded DB ----
ROOT="${DASHB_ROOT:-/home/user/dashb}"
rm -f $SP/uxdata/dashboard.db
boot_api 4090 $SP/uxdata $SP/api4090.log || echo "4090 BLOCK SKIPPED" >> $RES
node seed.mjs > $SP/seed-run.log 2>&1 && echo "seed OK" >> $RES || echo "seed FAIL" >> $RES

for s in dash-suite brief-suite role-suite polish-suite programs-suite lens-dark-suite polish2-suite round-suite round3-suite round4-suite round5-suite round6-suite round7-suite round8-suite round9-suite round10-suite round11-suite round12-suite round14-suite round15-suite round16-suite round19-suite round20-suite round21-suite round22-suite round23-suite round24-suite round25-suite round27-suite round28-suite round29-suite round30-suite round31-suite round32-suite round33-suite round34-suite round35-suite round36-suite round37-suite round38-suite round39-suite round40-suite round41-suite round42-suite round43-suite round45-suite round46-suite round47-suite round48-suite round51-suite round52-suite round53-suite round54-suite round55-suite round57-suite round58-suite round60-suite round61-suite round62-suite round63-suite round86-suite round87-suite round88-suite deadlines-suite ownership-suite layout-suite sweep-suite mobile-suite; do
  # One retry per suite: the sandbox's memory flake crashes a random suite's
  # page mid-run about once per full gate. A retried pass is marked PASS* so
  # a REAL regression (failing twice) never hides behind the retry.
  if node $s.mjs > $SP/out-$s.log 2>&1; then echo "$s PASS" >> $RES
  elif node $s.mjs > $SP/out-$s.log 2>&1; then echo "$s PASS* (retry)" >> $RES
  else echo "$s FAIL" >> $RES; fi
done
fuser -k 4090/tcp 2>/dev/null; sleep 0.5

# ---- rp-suite on 4085 (fresh data dir every run — it seeds exact fixtures) ----
rm -f $SP/rpdata/dashboard.db
boot_api 4085 $SP/rpdata $SP/rp-api.log || echo "4085 BLOCK SKIPPED" >> $RES
if node rp-suite.mjs > $SP/out-rp-suite.log 2>&1; then echo "rp-suite PASS" >> $RES; else echo "rp-suite FAIL" >> $RES; fi
fuser -k 4085/tcp 2>/dev/null

# ---- login-suite manages its own 4092 server ----
if node login-suite.mjs > $SP/out-login-suite.log 2>&1; then echo "login-suite PASS" >> $RES; else echo "login-suite FAIL" >> $RES; fi

# ---- GitHub-driver suites, each against a freshly restarted mock ----
fuser -k 9977/tcp 2>/dev/null; sleep 0.5
MOCK_PORT=9977 node mock-gh.mjs > $SP/mock-gh.log 2>&1 &
sleep 1
if node gh-suite.mjs > $SP/out-gh-suite.log 2>&1; then echo "gh-suite PASS" >> $RES; else echo "gh-suite FAIL" >> $RES; fi
fuser -k 9977/tcp 2>/dev/null; sleep 0.5
MOCK_PORT=9977 node mock-gh.mjs > $SP/mock-gh.log 2>&1 &
sleep 1
if node gh500-suite.mjs > $SP/out-gh500-suite.log 2>&1; then echo "gh500-suite PASS" >> $RES; else echo "gh500-suite FAIL" >> $RES; fi
fuser -k 9977/tcp 2>/dev/null; sleep 0.5
# storage-suite brings its own mock (9989) and instances — outage survival
fuser -k 9989/tcp 2>/dev/null; sleep 0.5
if node storage-suite.mjs > $SP/out-storage-suite.log 2>&1; then echo "storage-suite PASS" >> $RES; else echo "storage-suite FAIL" >> $RES; fi
# round64 brings its own server (4103) and Telegram mock (9986)
fuser -k 4103/tcp 9986/tcp 2>/dev/null; sleep 0.5
if node round64-suite.mjs > $SP/out-round64-suite.log 2>&1; then echo "round64-suite PASS" >> $RES; else echo "round64-suite FAIL" >> $RES; fi
fuser -k 4103/tcp 9986/tcp 2>/dev/null; sleep 0.5
# round65 and round66 each bring their own server (4104 / 4105)
fuser -k 4104/tcp 2>/dev/null; sleep 0.5
if node round65-suite.mjs > $SP/out-round65-suite.log 2>&1; then echo "round65-suite PASS" >> $RES; else echo "round65-suite FAIL" >> $RES; fi
fuser -k 4104/tcp 2>/dev/null; sleep 0.5
fuser -k 4105/tcp 2>/dev/null; sleep 0.5
if node round66-suite.mjs > $SP/out-round66-suite.log 2>&1; then echo "round66-suite PASS" >> $RES; else echo "round66-suite FAIL" >> $RES; fi
fuser -k 4105/tcp 2>/dev/null; sleep 0.5
fuser -k 4106/tcp 2>/dev/null; sleep 0.5
if node round67-suite.mjs > $SP/out-round67-suite.log 2>&1; then echo "round67-suite PASS" >> $RES; else echo "round67-suite FAIL" >> $RES; fi
fuser -k 4106/tcp 2>/dev/null; sleep 0.5
# round68 imports server/text.js directly, so it runs from the REPO, not the
# scratchpad copy — the relative import has to resolve to the real tree.
fuser -k 4107/tcp 2>/dev/null; sleep 0.5
if node $QA/round68-suite.mjs > $SP/out-round68-suite.log 2>&1; then echo "round68-suite PASS" >> $RES; else echo "round68-suite FAIL" >> $RES; fi
fuser -k 4107/tcp 2>/dev/null; sleep 0.5
fuser -k 4108/tcp 2>/dev/null; sleep 0.5
if node round69-suite.mjs > $SP/out-round69-suite.log 2>&1; then echo "round69-suite PASS" >> $RES; else echo "round69-suite FAIL" >> $RES; fi
fuser -k 4108/tcp 2>/dev/null; sleep 0.5
fuser -k 4109/tcp 2>/dev/null; sleep 0.5
if node round70-suite.mjs > $SP/out-round70-suite.log 2>&1; then echo "round70-suite PASS" >> $RES; else echo "round70-suite FAIL" >> $RES; fi
fuser -k 4109/tcp 2>/dev/null; sleep 0.5
fuser -k 4110/tcp 2>/dev/null; sleep 0.5
if node round71-suite.mjs > $SP/out-round71-suite.log 2>&1; then echo "round71-suite PASS" >> $RES; else echo "round71-suite FAIL" >> $RES; fi
fuser -k 4110/tcp 2>/dev/null; sleep 0.5
fuser -k 4111/tcp 2>/dev/null; fuser -k 9973/tcp 2>/dev/null; sleep 0.5
if node round72-suite.mjs > $SP/out-round72-suite.log 2>&1; then echo "round72-suite PASS" >> $RES; else echo "round72-suite FAIL" >> $RES; fi
fuser -k 4111/tcp 2>/dev/null; fuser -k 9973/tcp 2>/dev/null; sleep 0.5
fuser -k 4112/tcp 2>/dev/null; sleep 0.5
if node round73-suite.mjs > $SP/out-round73-suite.log 2>&1; then echo "round73-suite PASS" >> $RES; else echo "round73-suite FAIL" >> $RES; fi
fuser -k 4112/tcp 2>/dev/null; sleep 0.5
fuser -k 4113/tcp 2>/dev/null; sleep 0.5
if node round74-suite.mjs > $SP/out-round74-suite.log 2>&1; then echo "round74-suite PASS" >> $RES; else echo "round74-suite FAIL" >> $RES; fi
fuser -k 4113/tcp 2>/dev/null; sleep 0.5
fuser -k 4114/tcp 2>/dev/null; fuser -k 9975/tcp 2>/dev/null; sleep 0.5
if node round75-suite.mjs > $SP/out-round75-suite.log 2>&1; then echo "round75-suite PASS" >> $RES; else echo "round75-suite FAIL" >> $RES; fi
fuser -k 4114/tcp 2>/dev/null; fuser -k 9975/tcp 2>/dev/null; sleep 0.5
fuser -k 4115/tcp 2>/dev/null; sleep 0.5
if node round76-suite.mjs > $SP/out-round76-suite.log 2>&1; then echo "round76-suite PASS" >> $RES; else echo "round76-suite FAIL" >> $RES; fi
fuser -k 4115/tcp 2>/dev/null; sleep 0.5
fuser -k 9989/tcp 2>/dev/null; sleep 0.5

# ---- the superuser, the register's door, and booked time the crew answer (4131) ----
fuser -k 4131/tcp 2>/dev/null; sleep 0.5
if node round80-suite.mjs > $SP/out-round80-suite.log 2>&1; then echo "round80-suite PASS" >> $RES; else echo "round80-suite FAIL" >> $RES; fi
fuser -k 4131/tcp 2>/dev/null; sleep 0.5

# ---- a finished piece stops saying it is late, and the register is a month (4132) ----
fuser -k 4132/tcp 2>/dev/null; sleep 0.5
if node round81-suite.mjs > $SP/out-round81-suite.log 2>&1; then echo "round81-suite PASS" >> $RES; else echo "round81-suite FAIL" >> $RES; fi
fuser -k 4132/tcp 2>/dev/null; sleep 0.5

# ---- Sprints: the guards a QA pass put in (4118) ----
fuser -k 4118/tcp 2>/dev/null; sleep 0.5
if node sprint-guards-suite.mjs > $SP/out-sprint-guards-suite.log 2>&1; then echo "sprint-guards-suite PASS" >> $RES; else echo "sprint-guards-suite FAIL" >> $RES; fi
fuser -k 4118/tcp 2>/dev/null; sleep 0.5

# ---- Sprints: the backlog and the promote flow (4116) ----
fuser -k 4116/tcp 2>/dev/null; sleep 0.5
if node sprint-backlog-suite.mjs > $SP/out-sprint-backlog-suite.log 2>&1; then echo "sprint-backlog-suite PASS" >> $RES; else echo "sprint-backlog-suite FAIL" >> $RES; fi
fuser -k 4116/tcp 2>/dev/null; sleep 0.5

# ---- the ambassador programme (4143) ----
fuser -k 4143/tcp 2>/dev/null; sleep 0.5
if node ambassador-suite.mjs > $SP/out-ambassador-suite.log 2>&1; then echo "ambassador-suite PASS" >> $RES; else echo "ambassador-suite FAIL" >> $RES; fi
fuser -k 4143/tcp 2>/dev/null; sleep 0.5

# ---- Sprints: the week keeps what it promised (4135) ----
fuser -k 4135/tcp 2>/dev/null; sleep 0.5
if node sprint-account-suite.mjs > $SP/out-sprint-account-suite.log 2>&1; then echo "sprint-account-suite PASS" >> $RES; else echo "sprint-account-suite FAIL" >> $RES; fi
fuser -k 4135/tcp 2>/dev/null; sleep 0.5

# ---- one page in Admin where the board's switches live (4133) ----
fuser -k 4133/tcp 2>/dev/null; sleep 0.5
if node settings-suite.mjs > $SP/out-settings-suite.log 2>&1; then echo "settings-suite PASS" >> $RES; else echo "settings-suite FAIL" >> $RES; fi
fuser -k 4133/tcp 2>/dev/null; sleep 0.5

# ---- what the work actually got watched (4134) ----
fuser -k 4134/tcp 2>/dev/null; sleep 0.5
if node views-suite.mjs > $SP/out-views-suite.log 2>&1; then echo "views-suite PASS" >> $RES; else echo "views-suite FAIL" >> $RES; fi
fuser -k 4134/tcp 2>/dev/null; sleep 0.5

# ---- pc-suite + journey on 4081 ----
if bash pc-suite.sh > $SP/out-pc-suite.log 2>&1; then echo "pc-suite PASS" >> $RES; else echo "pc-suite FAIL" >> $RES; fi
# By exit code, not by grepping the log for a word the log could never contain
# (see the note in journey.sh) — every other entry here is decided this way.
if bash journey.sh > $SP/out-journey.log 2>&1; then echo "journey PASS" >> $RES; else echo "journey FAIL" >> $RES; fi

echo DONE >> $RES
cat $RES
