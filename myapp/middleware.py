import logging
from django.utils import timezone

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
                from .models import UserSession
                now = timezone.now()
                UserSession.objects.filter(user=request.user).update(last_activity=now)
            except Exception:
                pass

        return response