import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = 'django-insecure-g5n0(vw&*g2)%=f+n_!qv0d@u4^05mmb2%*b_t-^7&p8-$cn_s'

DEBUG = True

# ALLOWED_HOSTS = [
#     "120.50.12.162",
#     "localhost",
#     "127.0.0.1",
#     "telesoftbangladesh.com",
#     "www.telesoftbangladesh.com",
#     "telesoftbangladesh.net",
#     "www.telesoftbangladesh.net",
# ]

ALLOWED_HOSTS = ['*']

INSTALLED_APPS = [
    'jazzmin',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework.authtoken',
    'corsheaders',
    'myapp',
    'django_filters',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'myapp.middleware.DisableCSRFForAPIMiddleware',
    'myapp.middleware.AuthDebugMiddleware',
]

ROOT_URLCONF = 'dicom_project.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'dicom_project.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Dhaka'  
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')

MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.TokenAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 10,
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
    ]
}

CORS_ALLOWED_ORIGINS = [
    "http://120.50.12.162",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "https://telesoftbangladesh.com",
    "https://www.telesoftbangladesh.com",
    "https://telesoftbangladesh.net",
    "https://www.telesoftbangladesh.net",
]

CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_ALL_ORIGINS = False  


CSRF_TRUSTED_ORIGINS = [
    "http://120.50.12.162",
    "https://telesoftbangladesh.com",
    "https://www.telesoftbangladesh.com",
    "https://telesoftbangladesh.net",
    "https://www.telesoftbangladesh.net",
]

CSRF_COOKIE_SECURE = False
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = None

SESSION_COOKIE_SECURE = False
SESSION_COOKIE_SAMESITE = None

EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = "smtp.gmail.com"
EMAIL_USE_TLS = True
EMAIL_PORT = 587
EMAIL_HOST_USER = "yasirtanvir16@gmail.com"
EMAIL_HOST_PASSWORD = "lwbx hcmh zirb biwq"

FILE_UPLOAD_HANDLERS = [
    'django.core.files.uploadhandler.MemoryFileUploadHandler',
    'django.core.files.uploadhandler.TemporaryFileUploadHandler',
]

DATA_UPLOAD_MAX_MEMORY_SIZE = 104857600 
FILE_UPLOAD_MAX_MEMORY_SIZE = 104857600  
DATA_UPLOAD_MAX_NUMBER_FIELDS = 10240  
DEFAULT_CHARSET = "utf-8"

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'file': {
            'level': 'INFO',
            'class': 'logging.FileHandler',
            'filename': BASE_DIR / 'django.log',
            'formatter': 'verbose',
        },
        'console': {
            'level': 'INFO',
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
    },
    'loggers': {
        'django': {
            'handlers': ['file', 'console'],
            'level': 'INFO',
            'propagate': True,
        },
        'myapp': {
            'handlers': ['file', 'console'],
            'level': 'DEBUG',
            'propagate': True,
        },
        'django.request': {
            'handlers': ['file', 'console'],
            'level': 'ERROR',
            'propagate': False,
        },
    },
}

JAZZMIN_SETTINGS = {
    "site_title": "Telerad Admin",
    "site_header": "Telerad Administration",
    "welcome_sign": "Welcome to Telerad Admin",
    "show_sidebar": True,
    "navigation_expanded": True,
    "order_with_respect_to": ["auth", "myapp"],
    "icons": {
        "auth": "fas fa-users-cog",
        "myapp": "fas fa-file-medical",
    },

    "custom_css": "styles/custom.css",
}

JAZZMIN_UI_TWEAKS = {
    "theme": "flatly",
    "dark_mode_theme": "darkly",
    "button_classes": {
        "primary": "btn-primary",
        "secondary": "btn-secondary",
        "info": "btn-info",
        "warning": "btn-warning",
        "danger": "btn-danger",
        "success": "btn-success"
    }
}
