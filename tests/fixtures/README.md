# Test TLS identity

`central-test-cert.pem` and `central-test-key.pem` are a public, self-signed localhost identity used exclusively by automated HTTPS tests. The private key is intentionally published test data; it provides no production identity or trust. Tests pass the certificate as an explicit per-request CA and never install it into Windows certificate stores. Production must use its own protected TLS key and trusted certificate. These fixtures are not included in endpoint installers.
