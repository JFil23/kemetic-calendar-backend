#!/usr/bin/env python3
"""Forced local interleavings for acknowledged memory and checked scheduling.

Uses the existing backend concurrency harness pattern; fixtures are isolated and
removed. Never accepts a hosted database URL.
"""
import json
import subprocess
import sys
import time
from urllib.parse import urlparse

if len(sys.argv) != 2 or urlparse(sys.argv[1]).hostname not in {"127.0.0.1", "localhost", "::1"}:
    raise SystemExit("usage: ask_haw_concurrency_smoke.py <loopback-database-url>")
command = ["psql", sys.argv[1], "-X", "-v", "ON_ERROR_STOP=1", "-Atq"]
owner = "00000000-0000-4000-8000-00000000ac11"
calendar = "10000000-0000-4000-8000-00000000ac11"
editor = "00000000-0000-4000-8000-00000000ac12"
flow = 99007111
processes = []


def query(sql):
    return subprocess.run(command, input=sql, text=True, capture_output=True, check=True).stdout.strip()


def auth(account=owner):
    claims = json.dumps({"sub": account, "role": "authenticated"})
    return f"set local role authenticated; select set_config('request.jwt.claims','{claims}',true);"


def memory(mutation, revision, epoch, operation, payload):
    return f"select public.apply_ask_haw_memory_v1('{owner}','{mutation}',{revision},{epoch},'{operation}','{json.dumps(payload)}');"


def start(sql, name, hold=None, account=owner):
    checkpoint = "" if hold is None else f"select pg_advisory_xact_lock(607,{hold}); select pg_sleep(1.5);"
    sql = f"begin; set local statement_timeout='15s'; set local application_name='{name}'; {auth(account)} {sql} {checkpoint} commit;"
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(sql)
    process.stdin.close()
    process.stdin = None
    processes.append(process)
    return process


def until(sql, message):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if query(sql) == "t":
            return
        time.sleep(.04)
    raise AssertionError(message)


def overlap(first_sql, second_sql, case, second_account=owner):
    first = start(first_sql, f"ask_first_{case}", hold=case)
    until(f"select exists(select 1 from pg_locks where locktype='advisory' and classid=607 and objid={case} and granted);", "First transaction missed checkpoint")
    second = start(second_sql, f"ask_second_{case}", account=second_account)
    until(f"select exists(select 1 from pg_stat_activity where application_name='ask_second_{case}' and wait_event_type='Lock');", "Second transaction did not overlap on a lock")
    outputs = []
    for process in [first, second]:
        stdout, stderr = process.communicate(timeout=20)
        if process.returncode:
            raise AssertionError(f"Concurrent transaction failed: {stderr} {stdout}")
        outputs.append(stdout)
    return outputs


try:
    query(f"""insert into auth.users(id,email,aud,role) values('{owner}','ask-concurrency@example.test','authenticated','authenticated');
    insert into public.profiles(id,email,handle,display_name) values('{owner}','ask-concurrency@example.test','askconcurrency','Ask concurrency');
    insert into public.shared_calendars(id,owner_id,name) values('{calendar}','{owner}','Ask concurrency');
    insert into public.shared_calendar_members(calendar_id,user_id,role,status) values('{calendar}','{owner}','owner','accepted');""")
    outputs = overlap(
        memory("20000000-0000-4000-8000-00000000ac11", 0, 0, "patch", {"winner": "first"}),
        memory("20000000-0000-4000-8000-00000000ac12", 0, 0, "patch", {"winner": "second"}), 1)
    assert '"status": "conflict"' in outputs[1], "Second stale edit overwrote memory"
    # The same identity/content replays one acknowledgement after waiting.
    same = memory("20000000-0000-4000-8000-00000000ac13", 1, 0, "patch", {"confirmed": True})
    outputs = overlap(same, same, 2)
    assert '"revision": 2' in outputs[0] and '"revision": 2' in outputs[1], "Concurrent retry duplicated a memory write"
    outputs = overlap(
        memory("20000000-0000-4000-8000-00000000ac14", 2, 0, "clear", {}),
        memory("20000000-0000-4000-8000-00000000ac15", 2, 0, "patch", {"resurrected": True}), 3)
    assert '"status": "conflict"' in outputs[1], "Queued learning survived clear"
    result = json.loads(query(f"begin; {auth()} select public.read_ask_haw_memory_v1('{owner}'); commit;").splitlines()[-1])
    assert result["row"] == {"revision": 3, "epoch": 1, "payload": {}}, "Clear did not fence final state"
    # A legacy direct writer already holds its row-exclusive table lock. Ask
    # must wait, then see the newly committed busy row before applying a plan.
    legacy = f"insert into public.user_events(user_id,calendar_id,client_event_id,title,starts_at,ends_at) values('{owner}','{calendar}','ask-legacy-race','Existing commitment','2045-01-01T10:00:00Z','2045-01-01T11:00:00Z');"
    actions = [{"kind": "event_create", "calendar_id": calendar, "client_event_id": "ask-planned-race", "avoid_conflicts": True,
                "event": {"title": "Proposed activity", "starts_at": "2045-01-01T10:30:00Z", "ends_at": "2045-01-01T10:40:00Z"}}]
    checked = f"select public.apply_ask_haw_actions_v1('{owner}','40000000-0000-4000-8000-00000000ac11','{json.dumps(actions)}');"
    outputs = overlap(legacy, checked, 4)
    assert '"status": "conflict"' in outputs[1], "Plan missed a concurrent existing commitment"
    assert query("select not exists(select 1 from public.user_events where client_event_id='ask-planned-race');") == "t", "Rejected plan partially wrote"
    query(f"""insert into auth.users(id,email,aud,role) values('{editor}','ask-editor-concurrency@example.test','authenticated','authenticated');
    insert into public.profiles(id,email,handle,display_name,timezone) values('{editor}','ask-editor-concurrency@example.test','askeditorconcurrency','Ask editor concurrency','Pacific/Honolulu');
    insert into public.shared_calendar_members(calendar_id,user_id,role,status) values('{calendar}','{editor}','editor','accepted');
    insert into public.flows(id,user_id,calendar_id,name,rules,assistance) values({flow},'{owner}','{calendar}','Shared authored practice',
      '[{{"type":"week","weekdays":[1,2,3,4,5,6,7]}}]',
      '{{"version":1,"steps":[{{"id":"practice","minutes":10}}]}}');""")
    def authored_action(cid, start, end):
        return [{"kind": "event_create", "calendar_id": calendar, "client_event_id": cid, "expected_flow_revision": 1,
                 "event": {"title": "Shared authored practice", "starts_at": start, "ends_at": end, "flow_local_id": flow,
                           "behavior_payload": {"ask_haw": {"step_id": "practice", "contract_version": 1, "counts_as_completion": True}}}}]
    first_action = authored_action("ask-step-device-a", "2050-06-01T18:00:00Z", "2050-06-01T18:10:00Z")
    second_action = authored_action("ask-step-device-b", "2050-06-01T19:00:00Z", "2050-06-01T19:10:00Z")
    first_sql = f"select public.apply_ask_haw_actions_v1('{owner}','40000000-0000-4000-8000-00000000ac12','{json.dumps(first_action)}');"
    second_sql = f"select public.apply_ask_haw_actions_v1('{editor}','40000000-0000-4000-8000-00000000ac13','{json.dumps(second_action)}');"
    outputs = overlap(first_sql, second_sql, 5, second_account=editor)
    assert '"status": "conflict"' in outputs[1] and 'duplicate_flow_step' in outputs[1], "Shared editors duplicated a step using different identities"
    assert query(f"select count(*)=1 from public.user_events where flow_local_id={flow};") == "t", "Duplicate proposal added a second occurrence"
    next_period = authored_action("ask-step-next-period", "2050-06-02T19:00:00Z", "2050-06-02T19:10:00Z")
    output = query(f"begin; {auth(editor)} select public.apply_ask_haw_actions_v1('{editor}','40000000-0000-4000-8000-00000000ac14','{json.dumps(next_period)}'); commit;")
    assert '"status": "applied"' in output, "Step guard blocked a legitimate next repeat period"
    print("Ask Haw concurrency passed: stale memory, exact retry, clear fencing, legacy scheduling and shared-editor step reservations.")
finally:
    for process in processes:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)
    query(f"delete from public.user_events where user_id in('{owner}','{editor}'); delete from auth.users where id in('{owner}','{editor}');")
