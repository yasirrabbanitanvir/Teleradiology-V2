import hashlib, json
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from myapp.models import ReportTemplate

sha = lambda s: hashlib.sha256((s or '').encode('utf-8')).hexdigest()

class Command(BaseCommand):
    help = "Replace report templates with converted (Quill HTML) versions, atomically."

    def add_arguments(self, parser):
        parser.add_argument('json_path')
        parser.add_argument('--apply', action='store_true', help='actually write (default is dry run)')

    def handle(self, *args, **o):
        items = json.load(open(o['json_path'], encoding='utf-8'))
        users = {u.username: u for u in User.objects.filter(username__in={i['username'] for i in items})}
        old = {r.pk: r for r in ReportTemplate.objects.filter(pk__in=[i['old_pk'] for i in items]).select_related('created_by')}
        problems = []
        for i in items:
            r = old.get(i['old_pk'])
            if r is None:
                problems.append(f"missing old row {i['old_pk']} ({i['template_name']})"); continue
            if (r.created_by.username if r.created_by else None) != i['username'] or r.template_name != i['template_name']:
                problems.append(f"owner/name changed for pk {r.pk}")
            if sha(r.content) != i['old_content_sha256']:
                problems.append(f"content edited since export: pk {r.pk} ({r.template_name})")
            if i['username'] not in users:
                problems.append(f"user not found: {i['username']}")
        if problems:
            for p in problems[:30]: self.stderr.write(p)
            raise CommandError(f"{len(problems)} problem(s). Nothing changed.")
        self.stdout.write(f"Checked {len(items)} rows: OK")
        if not o['apply']:
            self.stdout.write(self.style.WARNING("DRY RUN - nothing written. Re-run with --apply."))
            return
        with transaction.atomic():
            ReportTemplate.objects.filter(pk__in=list(old)).delete()
            created = ReportTemplate.objects.bulk_create([
                ReportTemplate(body_part=i['body_part'], modality=i['modality'], template_name=i['template_name'],
                               content=i['content'], is_active=i['is_active'], created_by=users[i['username']])
                for i in items])
            expect = {(users[i['username']].pk, i['template_name'], i['body_part'], i['modality']): i['new_content_sha256'] for i in items}
            fresh = ReportTemplate.objects.filter(created_by__in=users.values(), created_at__gte=min(c.created_at for c in created))
            got = {}
            for r in fresh:
                got.setdefault((r.created_by_id, r.template_name, r.body_part, r.modality), []).append(sha(r.content))
            bad = sum(1 for k, h in expect.items() if h not in got.get(k, []))
            if bad:
                raise CommandError(f"verification failed for {bad} rows - rolled back")
        self.stdout.write(self.style.SUCCESS(f"Replaced {len(items)} templates. Content verified byte-for-byte."))