# -----------------------------------------------------------------------------
# Azure Module Outputs
# -----------------------------------------------------------------------------

output "cluster_name" {
  description = "Name of the AKS cluster."
  value       = var.cluster_name
}

output "resource_group" {
  description = "Azure resource group name."
  value       = azurerm_resource_group.this.name
}

output "dashboard_url" {
  description = "URL to access the Autonomi dashboard."
  value       = var.domain_name != "" ? "https://${var.domain_name}" : "http://<LB_IP>:57374"
}

output "kubeconfig_command" {
  description = "Command to configure kubectl."
  value       = "az aks get-credentials --resource-group ${azurerm_resource_group.this.name} --name ${var.cluster_name}"
}

output "storage_account_name" {
  description = "Azure Storage Account name."
  value       = azurerm_storage_account.autonomi.name
}

output "storage_container_name" {
  description = "Blob container name for checkpoints and audit."
  value       = azurerm_storage_container.autonomi.name
}
