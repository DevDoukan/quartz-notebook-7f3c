/* Exercises the actual native pipe code without loading a kernel driver. */
#define main KalkanReceiverMain
#include "ScanReceiver.c"
#undef main
int main(void)
{
    struct { KALKAN_SCAN_REQUEST Header; BYTE Content; } request = {0};
    KALKAN_SCAN_RESULT result = {0};
    KALKAN_POLICY_UPDATE update = {0};
    int passed;
    request.Header.Version = KALKAN_PROTOCOL_VERSION;
    request.Header.Size = sizeof(request.Header) + 1;
    request.Header.Command = KALKAN_SCAN_REQUEST_COMMAND;
    request.Header.ContentLength = 1;
    request.Header.RequestId = 1;
    request.Header.PolicyRevision = 1;
    request.Header.ContentGeneration = 1;
    request.Header.FileId[0] = 1;
    request.Header.FileSize = 1;
    request.Content = 'a';
    passed = ReceivePolicy(&update) && update.Mode == KALKAN_POLICY_READY && update.Revision == 1 &&
        ForwardScan(&request.Header, &result) &&
        result.Decision == KALKAN_DECISION_ALLOW && result.Flags == KALKAN_RESULT_PARSER_COMPLETE;
    SecureZeroMemory(&request, sizeof(request));
    SecureZeroMemory(&result, sizeof(result));
    return passed ? 0 : 1;
}
