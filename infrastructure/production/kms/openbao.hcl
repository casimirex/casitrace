# OpenBao server for the passport signing key (ADR 0015).
# Listener without TLS is acceptable only because the port is never published outside the internal
# Docker network. If the KMS runs on another host, enable TLS here.
storage "file" {
  path = "/openbao/file"
}
listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = 1
}
ui       = false
api_addr = "http://openbao:8200"

# Every request (including each signing call) is logged; secrets are HMAC'd, not written in clear.
audit "file" "audit-log" {
  options {
    file_path = "/openbao/logs/audit.log"
  }
}
