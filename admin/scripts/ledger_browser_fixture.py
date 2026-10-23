"""Loopback-only browser QA fixture. Uses no real users or credentials."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import argparse
from pathlib import Path
import base64
import json
import threading
import time
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--directory', required=True, type=Path)
parser.add_argument('--port', type=int, default=5176)
options = parser.parse_args()
ROOT = options.directory.resolve()
OWNER = '00000000-0000-4000-8000-000000000001'
LOCK = threading.Lock()
STATS = {'active': 0, 'peak': 0, 'details': [], 'lists': []}

def encoded(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')

def user():
    return {'id': OWNER, 'email': 'qa-owner@example.test', 'aud': 'authenticated',
            'role': 'authenticated', 'app_metadata': {}, 'user_metadata': {},
            'created_at': '2026-01-01T00:00:00Z'}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *_):
        pass

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', f'http://127.0.0.1:{options.port}')
        self.send_header('Access-Control-Allow-Headers', 'authorization,apikey,content-type,x-client-info,x-request-id,x-supabase-api-version')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def respond(self, payload, status=200):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except BrokenPipeError:
            pass

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/__qa/metrics':
            with LOCK:
                return self.respond(dict(STATS))
        if path == '/functions/v1/admin_auth/me':
            return self.respond({'user': user(), 'staff': {'role': 'owner', 'scopes': []}})
        if path == '/auth/v1/user':
            return self.respond(user())
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or '{}')
        if path == '/auth/v1/token':
            token = '.'.join([encoded({'alg': 'HS256', 'typ': 'JWT'}),
                              encoded({'sub': OWNER, 'aud': 'authenticated', 'role': 'authenticated',
                                       'exp': int(time.time()) + 3600}), 'fixture-only-signature'])
            return self.respond({'access_token': token, 'refresh_token': 'fixture-only-refresh',
                                 'token_type': 'bearer', 'expires_in': 3600, 'user': user()})
        if path == '/auth/v1/logout':
            return self.respond({})
        days = body.get('p_days', 30)
        if path == '/rest/v1/rpc/admin_activity_users':
            with LOCK:
                STATS['lists'].append(days)
            time.sleep(0.65 if days == 30 else 0.05)
            people = [{'id': f'fixture-{i:02}', 'display_name': f'Fixture Person {i:02}',
                       'email': f'person{i}@example.test', 'handle': f'person{i}',
                       'timezone': 'America/Los_Angeles', 'created_at': '2026-01-01T00:00:00Z',
                       'last_event_at': '2026-10-19T20:00:00Z',
                       'last_event_label': f'Window {days} list', 'event_count': 1}
                      for i in range(1, 13)]
            return self.respond({'period_days': days, 'total_matching_users': len(people), 'users': people})
        if path == '/rest/v1/rpc/admin_activity_user_detail':
            identity = body['p_target_user_id']
            with LOCK:
                STATS['active'] += 1
                STATS['peak'] = max(STATS['peak'], STATS['active'])
                STATS['details'].append({'id': identity, 'days': days})
            time.sleep(0.6 if days == 7 else 0.15)
            with LOCK:
                STATS['active'] -= 1
            return self.respond({'period_days': days, 'profile': {'id': identity}, 'timeline': [
                {'id': f'{identity}-{days}', 'occurred_at': '2026-10-19T20:00:00Z',
                 'source_table': 'app_events', 'event_name': 'screen_view',
                 'canonical_event': 'screen_view', 'category': 'screen_view',
                 'label': f'Window {days} action', 'basis': 'observed', 'safe_fields': {}}
            ]})
        return self.respond({'error': 'fixture_route_not_found'}, 404)

ThreadingHTTPServer(('127.0.0.1', options.port), Handler).serve_forever()
