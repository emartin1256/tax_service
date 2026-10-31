resource "google_monitoring_dashboard" "tax_service" {
  dashboard_json = file("${path.module}/dashboards/tax_service.json")
}
