import gzip
import logging
from django.core.cache import cache
from django.utils import timezone
from django.utils.cache import patch_vary_headers

logger = logging.getLogger(__name__)


class DisableCSRFForAPIMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/api/'):
            setattr(request, '_dont_enforce_csrf_checks', True)
        
        response = self.get_response(request)
        return response


class AuthDebugMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        
        if request.path.startswith('/api/') and response.status_code in [401, 403]:
            logger.warning(f"Auth failed: {response.status_code} for {request.path}")
        
        return response


class SessionActivityMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if request.path.startswith('/api/') and request.user.is_authenticated:
            try:
                if cache.add(f"session_activity_{request.user.pk}", 1, 20):
                    from .models import UserSession
                    now = timezone.now()
                    UserSession.objects.filter(user=request.user).update(last_activity=now)
            except Exception:
                pass

        return response


class JSONGZipMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if (
            request.path.startswith('/api/')
            and response.status_code == 200
            and not response.streaming
            and not response.has_header('Content-Encoding')
            and 'gzip' in request.META.get('HTTP_ACCEPT_ENCODING', '')
            and response.get('Content-Type', '').startswith('application/json')
            and len(response.content) >= 1024
        ):
            compressed = gzip.compress(response.content, compresslevel=5)
            if len(compressed) < len(response.content):
                response.content = compressed
                response['Content-Encoding'] = 'gzip'
                response['Content-Length'] = str(len(compressed))
                patch_vary_headers(response, ('Accept-Encoding',))

        return response
