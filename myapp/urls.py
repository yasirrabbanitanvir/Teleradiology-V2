from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    get_image_report, get_study_reports, get_report_history, get_patient_history_data,
    PatientViewSet, DoctorUploadViewSet, CustomLoginView, UserViewSet,
    CenterViewSet, DICOMImageViewSet, ReceiveDICOMView, template_manager_page,
    get_report_templates, manage_templates, register_viewer, update_viewer_activity,
    unregister_viewer, check_active_viewers, kick_all_viewers, am_i_active,
    list_active_sessions, kill_session, change_user_password, toggle_user_active,
    doctor_groups_list, doctor_groups_detail
)

from . import views

router = DefaultRouter()
router.register(r'patients', PatientViewSet)
router.register(r'uploads', DoctorUploadViewSet)
router.register(r'users', UserViewSet, basename='user')
router.register(r'centers', CenterViewSet)
router.register(r'dicom-images', DICOMImageViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('studies-grouped/', views.get_studies_grouped, name='get_studies_grouped'),
    path('studies/<str:study_uid>/images/', views.get_study_images, name='get_study_images'),
    path('login/', CustomLoginView.as_view(), name='login'),
    path('dicom/receive/', ReceiveDICOMView.as_view(), name='receive_dicom'),
    path('info/', views.api_info, name='api_info'),
    path('studies/', views.get_studies, name='get_studies'),
    path('studies/<int:study_id>/', views.get_study_detail, name='get_study_detail'),
    path('stats/', views.get_stats, name='get_stats'),
    path('test/', views.test_api, name='test_api'),
    path('dicom-images-all/', views.get_all_dicom_images, name='get_all_dicom_images'),
    path('dicom-stats/', views.get_fixed_stats, name='get_fixed_stats'),
    path('centers-list/', views.get_centers, name='get_centers'),
    path('centers/<str:center_name>/', views.get_center_detail, name='get_center_detail'),
    path('assign-doctors/', views.assign_doctors_to_images, name='assign_doctors_to_images'),
    path('dicom-list/', views.DICOMImageListView.as_view(), name='dicom-list'),
    path('current-user/', views.current_user, name='current-user'),
    path('doctors/', views.get_doctors, name='get_doctors'),
    path('user-info/', views.get_current_user_info, name='user_info'),
    path('dicom-images/<int:dicom_id>/update_status/', views.update_dicom_status, name='update_dicom_status'),
    path('dicom-images/<int:dicom_id>/upload_report/', views.upload_dicom_report, name='upload_dicom_report'),
    path('dicom-images/remove_single_doctor/', views.remove_single_doctor, name='remove_single_doctor'),
    path('institute-info/', views.get_institute_info, name='get_institute_info'),
    path('institute-studies/', views.get_institute_studies, name='get_institute_studies'),
    path('institute-stats/', views.get_institute_stats, name='get_institute_stats'),
    
    path('report-templates/', get_report_templates, name='get_report_templates'),
    path('manage-templates/', manage_templates, name='manage_templates'),
    path('template-manager/', template_manager_page, name='template_manager_page'),
    
    path('generate-report-docx/', views.generate_report_docx, name='generate_report_docx'),
    
    path('viewer/register/', register_viewer, name='register_viewer'),
    path('viewer/update/', update_viewer_activity, name='update_viewer_activity'),
    path('viewer/unregister/', unregister_viewer, name='unregister_viewer'),
    path('viewer/check/', check_active_viewers, name='check_active_viewers'),
    path('viewer/kick-all/', kick_all_viewers, name='kick_all_viewers'),
    path('viewer/am-i-active/', am_i_active, name='am_i_active'),
    path('dicom-images/<int:dicom_id>/report/', get_image_report, name='get_image_report'),
    path('dicom-images/<int:dicom_id>/report-history/', get_report_history, name='get_report_history'),
    path('study-reports/', get_study_reports, name='get_study_reports'),
    path('patient-history/', get_patient_history_data, name='get_patient_history_data'),

    path('update-user-profile/', views.update_user_profile, name='update_user_profile'),
    path('user-assigned-institutions/<int:user_id>/', views.get_user_assigned_institutions, name='user_assigned_institutions'),
    path('center-names/', views.create_center_name, name='create_center_name'),
    path('centers-with-doctors/', views.get_centers_with_doctors, name='centers_with_doctors'),
    path('active-sessions/', list_active_sessions, name='list_active_sessions'),
    path('kill-session/', kill_session, name='kill_session'),

    path('server-info/', views.server_info, name='server_info'),
    path('change-user-password/', change_user_password, name='change_user_password'),
    path('toggle-user-active/', toggle_user_active, name='toggle_user_active'),
    path('doctor-groups/', doctor_groups_list, name='doctor_groups_list'),
    path('doctor-groups/<str:group_id>/', doctor_groups_detail, name='doctor_groups_detail'),
]

