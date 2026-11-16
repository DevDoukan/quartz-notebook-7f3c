#include <windows.h>
#include <fltUser.h>
#include <stdio.h>
#include <stddef.h>
#include <string.h>
#include "KalkanProtocol.h"
#include "KalkanPolicy.h"
typedef struct _RECEIVE_BUFFER {
    FILTER_MESSAGE_HEADER Header;
    KALKAN_SCAN_REQUEST Request;
    unsigned char Content[KALKAN_MAX_SCAN_CHUNK];
} RECEIVE_BUFFER;
typedef struct _REPLY_BUFFER {
    FILTER_REPLY_HEADER Header;
    KALKAN_SCAN_RESULT Result;
} REPLY_BUFFER;
static int ReadPipeBytes(HANDLE pipe, void *buffer, DWORD length, ULONGLONG started)
{
    DWORD offset = 0;
    while (offset < length) {
        DWORD available = 0, read = 0, wanted;
        if (GetTickCount64() - started >= 2000 ||
            !PeekNamedPipe(pipe, NULL, 0, NULL, &available, NULL)) return 0;
        if (available == 0) { Sleep(1); continue; }
        wanted = length - offset;
        if (wanted > available) wanted = available;
        if (!ReadFile(pipe, (BYTE *)buffer + offset, wanted, &read, NULL) || read == 0) return 0;
        offset += read;
    }
    return 1;
}
static int ReceivePolicy(KALKAN_POLICY_UPDATE *update)
{
    KALKAN_HELLO_MESSAGE query = {KALKAN_PROTOCOL_VERSION, sizeof(query), KALKAN_POLICY_QUERY_COMMAND, 0};
    KALKAN_POLICY_STATE validation = {0};
    HANDLE input = GetStdHandle(STD_INPUT_HANDLE), output = GetStdHandle(STD_OUTPUT_HANDLE);
    DWORD length = sizeof(query), written = 0, responseLength = 0;
    ULONGLONG started = GetTickCount64();
    if (GetFileType(input) != FILE_TYPE_PIPE || GetFileType(output) != FILE_TYPE_PIPE) return 0;
    if (!WriteFile(output, &length, sizeof(length), &written, NULL) || written != sizeof(length) ||
        !WriteFile(output, &query, sizeof(query), &written, NULL) || written != sizeof(query)) return 0;
    return ReadPipeBytes(input, &responseLength, sizeof(responseLength), started) && responseLength == sizeof(*update) &&
        ReadPipeBytes(input, update, sizeof(*update), started) && GetTickCount64() - started < 2000 &&
        KalkanApplyPolicy(&validation, update, sizeof(*update));
}
static int SynchronizePolicy(HANDLE port)
{
    KALKAN_POLICY_UPDATE update = {0};
    DWORD returned = 0;
    if (!ReceivePolicy(&update)) return 0;
    return FilterSendMessage(port, &update, sizeof(update), NULL, 0, &returned) == S_OK;
}
static int ForwardScan(const KALKAN_SCAN_REQUEST *request, KALKAN_SCAN_RESULT *result)
{
    HANDLE input = GetStdHandle(STD_INPUT_HANDLE), output = GetStdHandle(STD_OUTPUT_HANDLE);
    DWORD written = 0, length = request->Size, responseLength = 0;
    ULONGLONG started = GetTickCount64();
    if (GetFileType(input) != FILE_TYPE_PIPE || GetFileType(output) != FILE_TYPE_PIPE) return 0;
    if (!WriteFile(output, &length, sizeof(length), &written, NULL) || written != sizeof(length) ||
        !WriteFile(output, request, length, &written, NULL) || written != length) return 0;
    if (!ReadPipeBytes(input, &responseLength, sizeof(responseLength), started) || responseLength != sizeof(*result) ||
        !ReadPipeBytes(input, result, sizeof(*result), started)) return 0;
    return GetTickCount64() - started < 2000 && KalkanValidScanResult(result, sizeof(*result), 0, 0,
        request->RequestId, request->PolicyRevision, request->ContentGeneration);
}
int main(int argc, char **argv)
{
    HANDLE port = INVALID_HANDLE_VALUE, event;
    KALKAN_HELLO_MESSAGE hello = { KALKAN_PROTOCOL_VERSION, sizeof(hello), KALKAN_HELLO, 0 };
    RECEIVE_BUFFER *buffer;
    HRESULT hr;
    unsigned long handled;
    int bridge = argc == 2 && strcmp(argv[1], "--stdio") == 0;
    if (argc != 1 && !bridge) return 2;
    hr = FilterConnectCommunicationPort(KALKAN_PORT_NAME, 0, &hello, sizeof(hello), NULL, &port);
    if (FAILED(hr)) { fprintf(stderr, "Connection failed: 0x%08lx\n", (unsigned long)hr); return 1; }
    event = CreateEventW(NULL, TRUE, FALSE, NULL);
    buffer = (RECEIVE_BUFFER *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*buffer));
    if (event == NULL || buffer == NULL) { if (event) CloseHandle(event); CloseHandle(port); if (buffer) HeapFree(GetProcessHeap(), 0, buffer); return 2; }
    if (!bridge) puts("Development receiver: BLOCK only; no content parser or allow decisions.");
    for (handled = 0; bridge || handled < 1000; ++handled) {
        OVERLAPPED operation = {0};
        DWORD bytes = 0;
        REPLY_BUFFER reply = {0};
        if (bridge && !SynchronizePolicy(port)) { hr = E_FAIL; break; }
        ResetEvent(event); operation.hEvent = event;
        ZeroMemory(buffer, sizeof(*buffer));
        hr = FilterGetMessage(port, &buffer->Header, sizeof(*buffer), &operation);
        if (hr != HRESULT_FROM_WIN32(ERROR_IO_PENDING) && FAILED(hr)) break;
        if (hr == HRESULT_FROM_WIN32(ERROR_IO_PENDING)) {
            DWORD waitResult;
            do {
                waitResult = WaitForSingleObject(event, bridge ? 1000 : 30000);
                if (bridge && waitResult == WAIT_TIMEOUT) {
                    DWORD available = 0;
                    if (!PeekNamedPipe(GetStdHandle(STD_INPUT_HANDLE), NULL, 0, NULL, &available, NULL)) {
                        waitResult = WAIT_FAILED; break;
                    }
                    if (!SynchronizePolicy(port)) { waitResult = WAIT_FAILED; break; }
                }
            } while (bridge && waitResult == WAIT_TIMEOUT);
            if (waitResult != WAIT_OBJECT_0) {
            CancelIoEx(port, &operation);
            /* Do not free an overlapped buffer until cancellation completes. */
            (VOID)GetOverlappedResult(port, &operation, &bytes, TRUE);
            hr = HRESULT_FROM_WIN32(ERROR_TIMEOUT); break;
            }
        }
        if (!GetOverlappedResult(port, &operation, &bytes, FALSE)) { hr = HRESULT_FROM_WIN32(GetLastError()); break; }
        if (bytes < offsetof(RECEIVE_BUFFER, Request) ||
            bytes > sizeof(*buffer) || !KalkanValidScanRequest(&buffer->Request,
                bytes - (unsigned long)offsetof(RECEIVE_BUFFER, Request))) {
            hr = E_INVALIDARG; break;
        }
        /* FltSendMessage reply length includes FILTER_REPLY_HEADER on the
           user side. Never return a result to an incompatible envelope. */
        if (buffer->Header.MessageId == 0 || buffer->Header.ReplyLength !=
            offsetof(REPLY_BUFFER, Result) + sizeof(reply.Result)) {
            hr = E_INVALIDARG; break;
        }
        reply.Header.MessageId = buffer->Header.MessageId;
        reply.Header.Status = 0;
        reply.Result.Version = KALKAN_PROTOCOL_VERSION;
        reply.Result.Size = sizeof(reply.Result);
        reply.Result.Command = KALKAN_SCAN_REPLY;
        reply.Result.Decision = KALKAN_DECISION_BLOCK;
        reply.Result.RequestId = buffer->Request.RequestId;
        reply.Result.PolicyRevision = buffer->Request.PolicyRevision;
        reply.Result.ContentGeneration = buffer->Request.ContentGeneration;
        if (bridge && !ForwardScan(&buffer->Request, &reply.Result)) {
            hr = E_FAIL; break;
        }
        hr = FilterReplyMessage(port, &reply.Header,
            (DWORD)(offsetof(REPLY_BUFFER, Result) + sizeof(reply.Result)));
        if (FAILED(hr)) break;
    }
    SecureZeroMemory(buffer, sizeof(*buffer));
    HeapFree(GetProcessHeap(), 0, buffer); CloseHandle(event); CloseHandle(port);
    if (FAILED(hr)) { fprintf(stderr, "Receiver stopped: 0x%08lx\n", (unsigned long)hr); return 1; }
    return 0;
}
