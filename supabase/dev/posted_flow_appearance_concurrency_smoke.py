#!/usr/bin/env python3
"""Disposable local DB only: real overlapping owner writes, with cleanup."""
import json
import subprocess
import sys
import time
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit('usage: posted_flow_appearance_concurrency_smoke.py <database-url>')
database_url = sys.argv[1]
owner = '00000000-0000-4000-8000-00000000fa11'
calendar = '10000000-0000-4000-8000-00000000fa11'
post = '20000000-0000-4000-8000-00000000fa11'
new_post = '20000000-0000-4000-8000-00000000fa12'
flow = 99006011
command = ['psql', database_url, '-X', '-v', 'ON_ERROR_STOP=1', '-Atq']
processes = []


def query(sql):
    return subprocess.run(command, input=sql, text=True, capture_output=True, check=True).stdout.strip()


def auth():
    claims = json.dumps({'sub': owner, 'role': 'authenticated'})
    return f"set local role authenticated; select set_config('request.jwt.claims', '{claims}', true);"


def appearance(image):
    return json.dumps({'image_object_path': f'{owner}/{image}.jpg'})


def source_write(image):
    return f"update public.flows set appearance = '{appearance(image)}' where id = {flow};"


def caption_write(caption):
    metadata = json.dumps({'shared_note': caption, 'opaque': {'retained': 7}, 'payload': {
        'appearance': json.loads(appearance('a')), 'events': [{'title': 'Published event'}]}})
    return f"update public.flow_posts set ai_metadata = '{metadata}' where id = '{post}';"


def insert_post():
    return f"""insert into public.flow_posts(id,user_id,flow_id,name,ai_metadata)
    values ('{new_post}','{owner}',{flow},'Concurrent publication',
    '{{"payload":{{"appearance":{appearance('a')},"events":[{{"title":"New publication"}}]}}}}');"""


def start(sql, name, hold=None):
    checkpoint = '' if hold is None else f'select pg_advisory_xact_lock(606,{hold}); select pg_sleep(2);'
    sql = f"begin; set local statement_timeout='15s'; set local application_name='{name}'; {auth()} {sql} {checkpoint} commit;"
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(sql)
    process.stdin.close()
    process.stdin = None
    processes.append(process)
    return process


def until(sql, message):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if query(sql) == 't':
            return
        time.sleep(.04)
    raise AssertionError(message)


def overlap(first_sql, second_sql, case):
    first = start(first_sql, f'appearance_first_{case}', hold=case)
    until(f"select exists(select 1 from pg_locks where locktype='advisory' and classid=606 and objid={case} and granted);", 'First transaction never reached checkpoint')
    second = start(second_sql, f'appearance_second_{case}')
    until(f"select exists(select 1 from pg_stat_activity where application_name='appearance_second_{case}' and wait_event_type='Lock');", 'Second transaction did not overlap the first on a lock')
    for process in [first, second]:
        stdout, stderr = process.communicate(timeout=20)
        if process.returncode:
            raise AssertionError(f'Concurrent transaction failed: {stderr} {stdout}')


def assert_image(image, expected_count):
    actual = query(f"select count(*)={expected_count} and bool_and(ai_metadata #> '{{payload,appearance}}' = '{appearance(image)}'::jsonb) from public.flow_posts where flow_id={flow} and user_id='{owner}';")
    if actual != 't':
        raise AssertionError(f'Concurrent writes left a stale image; expected {image}')


try:
    query(f"""insert into auth.users(id,email,aud,role) values ('{owner}','appearance-concurrency@example.test','authenticated','authenticated');
    insert into public.profiles(id,email,handle,display_name) values ('{owner}','appearance-concurrency@example.test','appearanceconcurrency','Appearance concurrency');
    insert into public.shared_calendars(id,owner_id,name) values ('{calendar}','{owner}','Appearance concurrency');
    insert into public.shared_calendar_members(calendar_id,user_id,role,status) values ('{calendar}','{owner}','owner','accepted');
    insert into public.flows(id,user_id,calendar_id,name,appearance) values ({flow},'{owner}','{calendar}','Concurrency source','{appearance('a')}');
    insert into public.flow_posts(id,user_id,flow_id,name,ai_metadata) values ('{post}','{owner}',{flow},'Initial publication','{{"payload":{{"events":[{{"title":"Published event"}}]}}}}');""")

    # Source already holds post/flow locks; stale whole-metadata write waits.
    overlap(source_write('b'), caption_write('Caption after source'), 1)
    assert_image('b', 1)
    assert query(f"select ai_metadata->>'shared_note' from public.flow_posts where id='{post}';") == 'Caption after source'

    # Caption owns the post lock; source projection waits, then merges its
    # appearance into the newly committed caption rather than an old row.
    overlap(caption_write('Caption before source'), source_write('c'), 2)
    assert_image('c', 1)
    assert query(f"select ai_metadata->>'shared_note' from public.flow_posts where id='{post}';") == 'Caption before source'

    # A publication started during a save must wait for canonical source data.
    overlap(source_write('d'), insert_post(), 3)
    assert_image('d', 2)
    query(f"delete from public.flow_posts where id='{new_post}';")

    # A save started during publication must see that publication on commit.
    overlap(insert_post(), source_write('e'), 4)
    assert_image('e', 2)

    # Seed an old-client post discrepancy, replay the migration backfill, and
    # prove its second run rewrites no rows and preserves exact payload content.
    query(f"alter table public.flow_posts disable trigger normalize_posted_flow_appearance; {caption_write('Retain backfilled caption')} alter table public.flow_posts enable trigger normalize_posted_flow_appearance;")
    before = json.loads(query(f"select (to_jsonb(p)-'updated_at') #- '{{ai_metadata,payload,appearance}}' from public.flow_posts p where id='{post}';"))
    migration = Path(__file__).resolve().parents[1] / 'migrations/20261006013056_sync_posted_flow_appearance.sql'
    query(migration.read_text())
    assert_image('e', 2)
    after = json.loads(query(f"select (to_jsonb(p)-'updated_at') #- '{{ai_metadata,payload,appearance}}' from public.flow_posts p where id='{post}';"))
    assert before == after, 'Backfill changed nonappearance content'
    versions = query(f"select id,ctid from public.flow_posts where flow_id={flow} order by id;")
    query(migration.read_text())
    assert versions == query(f"select id,ctid from public.flow_posts where flow_id={flow} order by id;"), 'Idempotent migration rewrote matching rows'
    print('Posted appearance concurrency passed: four forced lock interleavings, caption preservation, and idempotent backfill.')
finally:
    for process in processes:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)
    query(f"delete from auth.users where id='{owner}';")
