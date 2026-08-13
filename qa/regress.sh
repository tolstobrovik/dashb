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

# ---- main 4090 stack on a fresh seeded DB ----
ROOT="${DASHB_ROOT:-/home/user/dashb}"
fuser -k 4090/tcp 2>/dev/null; sleep 0.5
rm -f $SP/uxdata/dashboard.db
DATA_DIR=$SP/uxdata PORT=4090 node $ROOT/server/index.js > $SP/api4090.log 2>&1 &
for i in $(seq 1 30); do curl -s http://localhost:4090/api/health >/dev/null 2>&1 && break; sleep 0.5; done
node seed.mjs > $SP/seed-run.log 2>&1 && echo "seed OK" >> $RES || echo "seed FAIL" >> $RES

for s in dash-suite brief-suite role-suite polish-suite programs-suite lens-dark-suite polish2-suite round-suite round3-suite round4-suite round5-suite round6-suite round7-suite round8-suite round9-suite round10-suite round11-suite round12-suite round13-suite round14-suite round15-suite round16-suite round17-suite round19-suite round20-suite round21-suite round22-suite round23-suite round24-suite round25-suite round26-suite round27-suite round28-suite round29-suite round30-suite round31-suite round32-suite round33-suite round34-suite round35-suite round36-suite round37-suite round38-suite round39-suite round40-suite round41-suite round42-suite round43-suite round44-suite round45-suite round46-suite round47-suite round48-suite round51-suite round52-suite round53-suite round54-suite round55-suite round57-suite round58-suite round60-suite round61-suite round62-suite deadlines-suite ownership-suite; do
  # One retry per suite: the sandbox's memory flake crashes a random suite's
  # page mid-run about once per full gate. A retried pass is marked PASS* so
  # a REAL regression (failing twice) never hides behind the retry.
  if node $s.mjs > $SP/out-$s.log 2>&1; then echo "$s PASS" >> $RES
  elif node $s.mjs > $SP/out-$s.log 2>&1; then echo "$s PASS* (retry)" >> $RES
  else echo "$s FAIL" >> $RES; fi
done
fuser -k 4090/tcp 2>/dev/null; sleep 0.5

# ---- rp-suite on 4085 (fresh data dir every run — it seeds exact fixtures) ----
fuser -k 4085/tcp 2>/dev/null; sleep 0.5
rm -f $SP/rpdata/dashboard.db
DATA_DIR=$SP/rpdata PORT=4085 node $ROOT/server/index.js > $SP/rp-api.log 2>&1 &
for i in $(seq 1 30); do curl -s http://localhost:4085/api/health >/dev/null 2>&1 && break; sleep 0.5; done
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
fuser -k 9989/tcp 2>/dev/null; sleep 0.5

# ---- pc-suite + journey on 4081 ----
if bash pc-suite.sh > $SP/out-pc-suite.log 2>&1; then echo "pc-suite PASS" >> $RES; else echo "pc-suite FAIL" >> $RES; fi
bash journey.sh > $SP/out-journey.log 2>&1
grep -q "BUG" $SP/out-journey.log && echo "journey FAIL" >> $RES || echo "journey PASS" >> $RES

echo DONE >> $RES
cat $RES
