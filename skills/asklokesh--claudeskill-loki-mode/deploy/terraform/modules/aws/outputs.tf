# -----------------------------------------------------------------------------
# AWS Module Outputs
# -----------------------------------------------------------------------------

output "cluster_endpoint" {
  description = "EKS cluster API endpoint."
  value       = var.create_cluster ? aws_eks_cluster.this[0].endpoint : data.aws_eks_cluster.existing[0].endpoint
}

output "cluster_name" {
  description = "Name of the EKS cluster."
  value       = var.cluster_name
}

output "dashboard_url" {
  description = "URL to access the Autonomi dashboard."
  value       = var.domain_name != "" ? "https://${var.domain_name}" : "http://<ALB_DNS>:57374"
}

output "kubeconfig_command" {
  description = "Command to configure kubectl."
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${var.cluster_name}"
}

output "s3_bucket_name" {
  description = "Name of the S3 bucket for checkpoints and audit logs."
  value       = aws_s3_bucket.autonomi.id
}

output "s3_bucket_arn" {
  description = "ARN of the S3 bucket."
  value       = aws_s3_bucket.autonomi.arn
}
