from django.contrib import admin
from django.urls import path
from django.shortcuts import redirect
from django.utils.html import format_html
from django.http import HttpResponseRedirect
from .models import Center, Patient, DoctorUpload, UserProfile, DICOMImage, CenterName, ReportTemplate
from django import forms

class UserProfileAdminForm(forms.ModelForm):
    class Meta:
        model = UserProfile
        fields = '__all__'
        widgets = {
            'qualification': forms.Textarea(attrs={
                'rows': 5, 
                'cols': 80,
                'style': 'width: 100%; max-width: 350px;'
            }),
        }

class CenterNameInline(admin.TabularInline):
    model = CenterName
    extra = 3

@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    form = UserProfileAdminForm
    list_display = ('user', 'center', 'full_name', 'role', 'show_assigned_institutions', 'can_assign_doctors', 'can_write_reports', 'can_manage_templates', 'can_view_images')
    list_filter = ('role', 'center', 'can_assign_doctors', 'can_write_reports', 'can_manage_templates', 'can_view_images')
    search_fields = ('user__username', 'full_name', 'bmdc_reg_no')
    filter_horizontal = ('assigned_institutions',)
    list_editable = ('can_assign_doctors', 'can_write_reports', 'can_manage_templates', 'can_view_images')
    
    fieldsets = (
        ('User Information', {
            'fields': ('user', 'role', 'center')
        }),
        ('Personal Details', {
            'fields': ('full_name', 'designation', 'qualification', 'contact_number', 'bmdc_reg_no', 'signature', 'biometric_scan')
        }),

        ('Permissions', {
            'fields': ('can_assign_doctors', 'can_write_reports', 'can_manage_templates', 'can_view_images')
        }),
        
        ('Institution Assignment (For Doctors)', {
            'fields': ('assigned_institutions',),
            'classes': ('collapse',),
        }),
    )

    def show_assigned_institutions(self, obj):
        if obj.role and obj.role.name == 'Doctor':
            institutions = obj.assigned_institutions.all()
            if institutions:
                return ", ".join([inst.institute_name for inst in institutions])
            return "None"
        return "-"
    show_assigned_institutions.short_description = "Assigned Institutions"
    
    def get_fieldsets(self, request, obj=None):
        fieldsets = super().get_fieldsets(request, obj)
        if obj and obj.role and obj.role.name == 'Doctor':
            return fieldsets
        else:
            return [fs for fs in fieldsets if 'Institution Assignment' not in fs[0]]

@admin.register(Center)
class CenterAdmin(admin.ModelAdmin):
    list_display = ('institute_name', 'user', 'is_default', 'show_assigned_doctors')
    inlines = [CenterNameInline]
    
    def show_assigned_doctors(self, obj):
        doctors = obj.assigned_doctors.all()
        if doctors:
            return ", ".join([doc.full_name or doc.user.username for doc in doctors])
        return "No doctors assigned"
    show_assigned_doctors.short_description = "Assigned Doctors"

@admin.register(DICOMImage)
class DICOMImageAdmin(admin.ModelAdmin):
    list_display = (
        'center_name', 'patient_name', 'patient_id', 
        'modality', 'study_description', 'created_at')
    list_filter = ('center_name', 'modality', 'study_date', 'created_at')
    search_fields = ('center_name', 'patient_name', 'patient_id')
    ordering = ('-created_at',)

@admin.register(ReportTemplate)
class ReportTemplateAdmin(admin.ModelAdmin):
    
    def has_module_permission(self, request):
        return True
    
    def has_add_permission(self, request):
        return HttpResponseRedirect('/api/template-manager/')
    
    def has_change_permission(self, request, obj=None):
        return True
    
    def changelist_view(self, request, extra_context=None):
        return HttpResponseRedirect('/api/template-manager/')
    
    def add_view(self, request, form_url='', extra_context=None):
        return HttpResponseRedirect('/api/template-manager/')
    
    def change_view(self, request, object_id, form_url='', extra_context=None):
        return HttpResponseRedirect('/api/template-manager/')

admin.site.site_header = "Telerad PACS Admin"
admin.site.site_title = "PACS Admin"
admin.site.index_title = "DICOM Data Management"